import { mkdirSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { extractText, SCANNED_PDF_NOTE, type MeetingFileKind } from './file-extractors.js'

export type { MeetingFileKind } from './file-extractors.js'

export interface UploadedMeetingFile {
  filename: string
  kind?: MeetingFileKind
  mimeType?: string
  size?: number
  dataBase64?: string
  content?: string
}

export interface PreparedMeetingFile {
  filename: string
  kind: MeetingFileKind
  content: string
  originalPath: string
  size: number
  // Set when the text fallback is unreliable (scanned PDF, empty extraction);
  // the original file is still attached, but the UI can warn the user.
  extractionWarning?: string
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MEETINGS_DATA_DIR = resolve(PROJECT_ROOT, '.local-data', 'meetings')

// Extensions we read as plain text / source code. The actual content is just
// text, so these are the *most* reliable kind to hand to any AI — both the
// original-file upload and the text fallback work. Any unknown extension that
// still decodes as text is treated as 'code' too (see looksLikeText).
const CODE_EXTENSIONS = [
  '.py', '.pyi', '.ipynb', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json',
  '.jsonl', '.java', '.kt', '.kts', '.scala', '.c', '.h', '.cc', '.cpp', '.cxx',
  '.hpp', '.hh', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.m', '.mm',
  '.r', '.jl', '.lua', '.pl', '.pm', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.proto', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.conf', '.env', '.properties', '.xml', '.html', '.htm', '.css', '.scss',
  '.sass', '.less', '.vue', '.svelte', '.astro', '.tex', '.rst', '.org',
  '.gradle', '.dockerfile', '.tf', '.hcl', '.make', '.cmake', '.bat',
]

const EXT_TO_KIND: Record<string, MeetingFileKind> = {
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.csv': 'csv',
  '.ipynb': 'ipynb',
  ...Object.fromEntries(CODE_EXTENSIONS.filter(e => e !== '.ipynb').map(e => [e, 'code' as MeetingFileKind])),
}

export const ACCEPTED_FILE_EXTENSIONS = Object.keys(EXT_TO_KIND)

/** Heuristic: a buffer is text if it has no NUL bytes and few control bytes. */
function looksLikeText(buffer: Buffer): boolean {
  if (!buffer.length) return true
  const sample = buffer.subarray(0, 8192)
  if (sample.includes(0)) return false
  // A high ratio of control bytes (excluding tab/newline/cr) signals binary.
  let control = 0
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control++
  }
  return control / sample.length < 0.1
}

// Replace filesystem-reserved and control characters with '_' for the on-disk
// copy. Done with a char-code scan to avoid fragile regex escaping.
const RESERVED_FILENAME_CHARS = '<>:"/\\|?*'
function cleanFilename(filename: string): string {
  const cleaned = Array.from(filename)
    .map(ch => (ch.charCodeAt(0) < 32 || RESERVED_FILENAME_CHARS.includes(ch)) ? '_' : ch)
    .join('')
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 160) || 'uploaded-file'
}

function decodeFile(file: UploadedMeetingFile): Buffer {
  if (file.dataBase64) return Buffer.from(file.dataBase64, 'base64')
  if (file.content != null) return Buffer.from(file.content, 'utf-8')
  throw new Error(`文件 ${file.filename} 缺少原始内容`)
}

export function kindFromFilename(filename: string): MeetingFileKind | undefined {
  return EXT_TO_KIND[extname(filename).toLowerCase()]
}

/** A file is acceptable if it has a known kind, or it decodes as plain text
 *  (so arbitrary source/config files are allowed). Only binary unknowns fail. */
export function isAcceptableUpload(file: UploadedMeetingFile): boolean {
  if (!file.filename) return false
  if (kindFromFilename(file.filename)) return true
  try {
    return looksLikeText(decodeFile(file))
  } catch {
    return false
  }
}

export async function prepareMeetingFiles(meetingId: string, files: UploadedMeetingFile[]): Promise<PreparedMeetingFile[]> {
  const uploadDir = join(MEETINGS_DATA_DIR, meetingId, 'uploads')
  mkdirSync(uploadDir, { recursive: true })

  const prepared: PreparedMeetingFile[] = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    if (!file.filename) throw new Error('上传文件缺少文件名')
    const buffer = decodeFile(file)
    // Known extension wins; otherwise accept anything that decodes as text so
    // users can drop arbitrary source / config files without us enumerating
    // every extension. Only truly binary unknowns are rejected.
    let kind = file.kind ?? kindFromFilename(file.filename)
    if (!kind) {
      if (looksLikeText(buffer)) kind = 'code'
      else throw new Error(`暂不支持的文件格式：${file.filename}（无法识别为文本/代码或受支持的文档）`)
    }

    const safeName = `${String(index + 1).padStart(2, '0')}-${cleanFilename(file.filename)}`
    const originalPath = join(uploadDir, safeName)
    writeFileSync(originalPath, buffer)

    const extracted = await extractText(kind, buffer, file.filename)
    const trimmed = extracted.trim()
    let content: string
    let extractionWarning: string | undefined
    if (!trimmed) {
      content = `[未能从 ${file.filename} 抽取到文字。该文件可能是扫描版 PDF 或图片型文档；本版会优先尝试把原文件直接上传给 AI。]`
      extractionWarning = `「${file.filename}」未能提取到文字，已优先直传原文件给 AI 识别。`
    } else {
      content = extracted
      if (extracted === SCANNED_PDF_NOTE) {
        extractionWarning = `「${file.filename}」疑似扫描件/图片型 PDF，本地无法提取文字，已优先直传原文件由 AI 识别。`
      }
    }

    prepared.push({
      filename: file.filename,
      kind,
      content,
      originalPath,
      size: buffer.length,
      extractionWarning,
    })
  }
  return prepared
}
