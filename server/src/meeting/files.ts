import { createRequire } from 'module'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

const require = createRequire(import.meta.url)
const WordExtractor = require('word-extractor') as new () => {
  extract(input: Buffer | string): Promise<{
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string
    getFooters(): string
    getAnnotations(): string
    getTextboxes(): string
  }>
}

export type MeetingFileKind = 'txt' | 'md' | 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'csv'

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
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MEETINGS_DATA_DIR = resolve(PROJECT_ROOT, '.local-data', 'meetings')

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
}

export const ACCEPTED_FILE_EXTENSIONS = Object.keys(EXT_TO_KIND)

function cleanFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'uploaded-file'
}

export function kindFromFilename(filename: string): MeetingFileKind | undefined {
  return EXT_TO_KIND[extname(filename).toLowerCase()]
}

function decodeFile(file: UploadedMeetingFile): Buffer {
  if (file.dataBase64) return Buffer.from(file.dataBase64, 'base64')
  if (file.content != null) return Buffer.from(file.content, 'utf-8')
  throw new Error(`文件 ${file.filename} 缺少原始内容`)
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return normalizeText(result.text)
  } finally {
    await parser.destroy()
  }
}

async function extractWord(kind: MeetingFileKind, buffer: Buffer): Promise<string> {
  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return normalizeText(result.value)
  }

  const extractor = new WordExtractor()
  const doc = await extractor.extract(buffer)
  return normalizeText([
    doc.getBody(),
    doc.getHeaders(),
    doc.getFooters(),
    doc.getFootnotes(),
    doc.getEndnotes(),
    doc.getAnnotations(),
    doc.getTextboxes(),
  ].filter(Boolean).join('\n\n'))
}

function tableCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function worksheetToMarkdown(name: string, sheet: XLSX.WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
  })
  if (!rows.length) return `## Sheet: ${name}\n\n[空表]\n`

  const limitedRows = rows.slice(0, 200)
  const width = Math.min(20, Math.max(...limitedRows.map(row => row.length), 1))
  const normalized = limitedRows.map(row =>
    Array.from({ length: width }, (_, index) => tableCell(row[index])))

  const [first, ...rest] = normalized
  const header = first.map((cell, index) => cell || `Column ${index + 1}`)
  const divider = header.map(() => '---')
  const lines = [
    `## Sheet: ${name}`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...rest.map(row => `| ${row.join(' | ')} |`),
  ]
  if (rows.length > limitedRows.length) lines.push('', `[已截取前 ${limitedRows.length} 行，共 ${rows.length} 行。]`)
  return lines.join('\n')
}

function extractSpreadsheet(buffer: Buffer, kind: MeetingFileKind): string {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true, dense: false })
  const sheetNames = workbook.SheetNames.slice(0, 8)
  const text = sheetNames
    .map(name => worksheetToMarkdown(name, workbook.Sheets[name]))
    .join('\n\n---\n\n')
  const suffix = workbook.SheetNames.length > sheetNames.length
    ? `\n\n[已截取前 ${sheetNames.length} 个工作表，共 ${workbook.SheetNames.length} 个工作表。]`
    : ''
  return normalizeText(`${kind.toUpperCase()} 文件抽取结果\n\n${text}${suffix}`)
}

async function extractText(kind: MeetingFileKind, buffer: Buffer): Promise<string> {
  try {
    if (kind === 'txt' || kind === 'md') return normalizeText(buffer.toString('utf-8'))
    if (kind === 'pdf') return await extractPdf(buffer)
    if (kind === 'doc' || kind === 'docx') return await extractWord(kind, buffer)
    if (kind === 'xls' || kind === 'xlsx' || kind === 'csv') return extractSpreadsheet(buffer, kind)
    throw new Error(`unsupported file kind: ${kind}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `[文件文本抽取失败：${message}]\n\n如果原文件直传 AI 失败，请将该文件另存为 txt/md，或重新上传可提取文字的版本。`
  }
}

export async function prepareMeetingFiles(meetingId: string, files: UploadedMeetingFile[]): Promise<PreparedMeetingFile[]> {
  const uploadDir = join(MEETINGS_DATA_DIR, meetingId, 'uploads')
  mkdirSync(uploadDir, { recursive: true })

  const prepared: PreparedMeetingFile[] = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    if (!file.filename) throw new Error('上传文件缺少文件名')
    const kind = file.kind ?? kindFromFilename(file.filename)
    if (!kind) throw new Error(`暂不支持的文件格式：${file.filename}`)

    const buffer = decodeFile(file)
    const safeName = `${String(index + 1).padStart(2, '0')}-${cleanFilename(file.filename)}`
    const originalPath = join(uploadDir, safeName)
    writeFileSync(originalPath, buffer)

    const extracted = await extractText(kind, buffer)
    const content = extracted.trim()
      ? extracted
      : `[未能从 ${file.filename} 抽取到文字。该文件可能是扫描版 PDF 或图片型文档；本版会优先尝试把原文件直接上传给 AI。]`

    prepared.push({
      filename: file.filename,
      kind,
      content,
      originalPath,
      size: buffer.length,
    })
  }
  return prepared
}
