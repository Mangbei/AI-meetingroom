import { createRequire } from 'module'
import { extname } from 'path'
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

export type MeetingFileKind = 'txt' | 'md' | 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'csv' | 'code' | 'ipynb'

// Cap extracted text so a single huge file can't bloat the DB or the prompt.
// The original file is still attached for the AI when possible, so truncating
// the text fallback is safe.
const MAX_EXTRACT_CHARS = 200_000

// A short language hint for fenced code blocks, keyed by extension.
const EXT_TO_LANG: Record<string, string> = {
  '.py': 'python', '.pyi': 'python', '.js': 'javascript', '.mjs': 'javascript',
  '.cjs': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.json': 'json', '.java': 'java', '.kt': 'kotlin', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cs': 'csharp', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.sh': 'bash',
  '.bash': 'bash', '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.html': 'html', '.css': 'css', '.xml': 'xml',
}

function countReplacement(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) n++
  return n
}

/**
 * Decode a text buffer robustly: honour UTF-8 / UTF-16 BOMs, and fall back to
 * GB18030 for legacy Chinese-encoded files (very common for .txt/.csv/code
 * saved on Windows). Node 22 ships with full ICU, so TextDecoder('gb18030')
 * is available without any extra dependency.
 */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8')
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    try { return new TextDecoder('utf-16le').decode(buffer.subarray(2)) } catch { /* fall through */ }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    try { return new TextDecoder('utf-16be').decode(buffer.subarray(2)) } catch { /* fall through */ }
  }

  const utf8 = buffer.toString('utf-8')
  const utf8Bad = countReplacement(utf8)
  if (utf8Bad === 0) return utf8
  // Mojibake from UTF-8: probably a legacy Chinese encoding. Try GB18030 and
  // keep whichever decoding has fewer replacement characters.
  try {
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(buffer)
    if (countReplacement(gb) < utf8Bad) return gb
  } catch { /* gb18030 unavailable in a minimal-ICU build */ }
  return utf8
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function cap(text: string): string {
  if (text.length <= MAX_EXTRACT_CHARS) return text
  return `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n[内容过长，已截断至前 ${MAX_EXTRACT_CHARS} 字；完整内容以原文件为准。]`
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
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true, dense: false, codepage: 65001 })
  const sheetNames = workbook.SheetNames.slice(0, 8)
  const text = sheetNames
    .map(name => worksheetToMarkdown(name, workbook.Sheets[name]))
    .join('\n\n---\n\n')
  const suffix = workbook.SheetNames.length > sheetNames.length
    ? `\n\n[已截取前 ${sheetNames.length} 个工作表，共 ${workbook.SheetNames.length} 个工作表。]`
    : ''
  return normalizeText(`${kind.toUpperCase()} 文件抽取结果\n\n${text}${suffix}`)
}

function cellSource(source: unknown): string {
  if (Array.isArray(source)) return source.join('')
  if (typeof source === 'string') return source
  return ''
}

/** Render a Jupyter notebook as clean markdown: markdown cells as prose, code
 *  cells as fenced blocks. Outputs (and embedded images) are dropped so the AI
 *  sees the actual logic instead of base64 noise. */
function extractNotebook(buffer: Buffer): string {
  const nb = JSON.parse(decodeText(buffer)) as {
    cells?: Array<{ cell_type?: string; source?: unknown }>
    metadata?: { kernelspec?: { language?: string } }
  }
  const lang = nb.metadata?.kernelspec?.language ?? 'python'
  const cells = Array.isArray(nb.cells) ? nb.cells : []
  const parts = cells.map(cell => {
    const text = cellSource(cell?.source).trimEnd()
    if (!text) return ''
    if (cell.cell_type === 'markdown' || cell.cell_type === 'raw') return text
    return `\`\`\`${lang}\n${text}\n\`\`\``
  }).filter(Boolean)
  return normalizeText(parts.join('\n\n'))
}

function extractCode(filename: string, buffer: Buffer): string {
  const ext = extname(filename).toLowerCase()
  const body = normalizeText(decodeText(buffer))
  const lang = EXT_TO_LANG[ext] ?? ''
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

/**
 * Turn an uploaded file buffer into clean text for the meeting context. Always
 * resolves to a string: on any extraction failure it returns a clear marker
 * instead of throwing, so one bad file never breaks meeting preparation.
 */
export async function extractText(kind: MeetingFileKind, buffer: Buffer, filename: string): Promise<string> {
  try {
    let text: string
    if (kind === 'txt' || kind === 'md') text = normalizeText(decodeText(buffer))
    else if (kind === 'pdf') text = await extractPdf(buffer)
    else if (kind === 'doc' || kind === 'docx') text = await extractWord(kind, buffer)
    else if (kind === 'xls' || kind === 'xlsx' || kind === 'csv') text = extractSpreadsheet(buffer, kind)
    else if (kind === 'ipynb') text = extractNotebook(buffer)
    else if (kind === 'code') text = extractCode(filename, buffer)
    else throw new Error(`unsupported file kind: ${kind}`)
    return cap(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `[文件文本抽取失败：${message}]\n\n如果原文件直传 AI 失败，请将该文件另存为 txt/md，或重新上传可提取文字的版本。`
  }
}
