/**
 * Minimal MCP (Model Context Protocol) server for the AI Meeting Room, exposing
 * the meeting REST API as native tools so agents like Claude Code or Codex can
 * start meetings, intervene, and read results without crafting HTTP calls.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio
 * transport). Hand-rolled with no SDK dependency to keep the bundle small.
 *
 * IMPORTANT: stdout carries protocol messages only — all logging goes to stderr.
 *
 * Config (env):
 *   MEETING_API_BASE   base URL of the running server API (default http://localhost:3001/api)
 *   MEETING_API_TOKEN  optional bearer token, sent as Authorization if the server enforces auth
 */

const API_BASE = (process.env.MEETING_API_BASE ?? 'http://localhost:3001/api').replace(/\/$/, '')
const API_TOKEN = process.env.MEETING_API_TOKEN ?? ''
const PROTOCOL_VERSION = '2024-11-05'

function log(...args: unknown[]): void {
  console.error('[meeting-mcp]', ...args)
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function send(message: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id: string | number | null | undefined, result: unknown): void {
  send({ jsonrpc: '2.0', id: id ?? null, result })
}

function replyError(id: string | number | null | undefined, code: number, message: string): void {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } })
  let body: unknown = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, body }
}

// ---- Tool definitions -------------------------------------------------------

const MEETING_MODELS = ['chatgpt', 'gemini', 'deepseek', 'claude', 'doubao', 'zhipu', 'qwen', 'yuanbao', 'kimi']

const TOOLS = [
  {
    name: 'list_meetings',
    description: '列出所有会议及其状态（pending/running/done/error）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'server_status',
    description: '查询受控浏览器与各网页端模型的登录/就绪状态。开会前应先确认模型已就绪。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_meeting',
    description: '创建并立即开始一场多模型会议。需要提供标题、目标、参会模型、主持人和至少一个议程问题。参会模型必须已在受控浏览器中登录。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '会议标题' },
        goal: { type: 'string', description: '会议目标' },
        participants: { type: 'array', items: { type: 'string', enum: MEETING_MODELS }, description: '2-5 位参会模型' },
        moderator: { type: 'string', enum: MEETING_MODELS, description: '主持人，必须是参会模型之一' },
        agenda: { type: 'array', items: { type: 'string' }, description: '议程问题列表，至少一个' },
        mode: { type: 'string', enum: ['relay', 'parallel'], description: '接力或并行，默认 relay' },
        agendaRounds: { type: 'number', description: '每个议程的讨论轮数 1-5，默认 1' },
      },
      required: ['title', 'goal', 'participants', 'moderator', 'agenda'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_meeting',
    description: '获取一场会议的当前状态、议程小结、最终纪要，以及抽取出的行动项和未解决问题。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '会议 ID' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'intervene',
    description: '作为人类主持人向正在进行的会议插话/追问。内容会注入下一轮提示，参会模型必须正面回应。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '会议 ID' },
        text: { type: 'string', description: '插话或追问内容' },
      },
      required: ['id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'continue_meeting',
    description: '基于一场已结束会议的未解决问题，开启一场续会，携带上一场结论作为背景继续讨论。返回新会议 ID。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '原会议 ID' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
]

function toolText(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function toolError(message: string): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_meetings': {
      const r = await api('/meetings')
      return r.ok ? toolText(r.body) : toolError(`list_meetings failed: ${r.status}`)
    }
    case 'server_status': {
      const r = await api('/status')
      return r.ok ? toolText(r.body) : toolError(`server_status failed: ${r.status}`)
    }
    case 'create_meeting': {
      const participants = Array.isArray(args.participants) ? args.participants.map(String) : []
      const payload = {
        title: String(args.title ?? ''),
        goal: String(args.goal ?? ''),
        participants,
        moderator: String(args.moderator ?? ''),
        agenda: Array.isArray(args.agenda) ? args.agenda.map(String) : [],
        mode: args.mode === 'parallel' ? 'parallel' : 'relay',
        agendaRounds: typeof args.agendaRounds === 'number' ? args.agendaRounds : 1,
        // An agent driving the API implies the human has already set up the
        // models, so auto-confirm the "highest model selected" gate.
        confirmations: Object.fromEntries(participants.map(m => [m, true])),
      }
      const r = await api('/meetings', { method: 'POST', body: JSON.stringify(payload) })
      if (!r.ok) return toolError(`create_meeting failed (${r.status}): ${JSON.stringify(r.body)}`)
      return toolText({ ...(r.body as object), note: '会议已开始。用 get_meeting 轮询状态与结果。' })
    }
    case 'get_meeting': {
      const id = String(args.id ?? '')
      const r = await api(`/meetings/${encodeURIComponent(id)}`)
      if (!r.ok) return toolError(`get_meeting failed: ${r.status}`)
      const data = r.body as {
        meeting?: { status?: string; title?: string }
        agenda?: Array<{ question: string; summary: string }>
        artifact?: { final_summary?: string; structured_json?: string }
      }
      let structured: unknown = null
      try { structured = data.artifact?.structured_json ? JSON.parse(data.artifact.structured_json) : null } catch { /* ignore */ }
      return toolText({
        status: data.meeting?.status ?? 'unknown',
        title: data.meeting?.title ?? '',
        agenda: (data.agenda ?? []).map(a => ({ question: a.question, summary: a.summary })),
        finalSummary: data.artifact?.final_summary ?? '',
        structuredMinutes: structured,
      })
    }
    case 'intervene': {
      const r = await api(`/meetings/${encodeURIComponent(String(args.id ?? ''))}/intervene`, {
        method: 'POST',
        body: JSON.stringify({ text: String(args.text ?? '') }),
      })
      return r.ok ? toolText('已插话，将在下一轮注入。') : toolError(`intervene failed (${r.status}): ${JSON.stringify(r.body)}`)
    }
    case 'continue_meeting': {
      const r = await api(`/meetings/${encodeURIComponent(String(args.id ?? ''))}/continue`, { method: 'POST', body: '{}' })
      return r.ok ? toolText(r.body) : toolError(`continue_meeting failed (${r.status}): ${JSON.stringify(r.body)}`)
    }
    default:
      return toolError(`unknown tool: ${name}`)
  }
}

// ---- JSON-RPC dispatch ------------------------------------------------------

async function handle(msg: JsonRpcMessage): Promise<void> {
  const { id, method, params } = msg
  // Notifications (no id) need no response.
  const isNotification = id === undefined || id === null

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'ai-meetingroom', version: '0.1.0' },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') { if (!isNotification) reply(id, {}); return }
  if (method === 'tools/list') { reply(id, { tools: TOOLS }); return }
  if (method === 'tools/call') {
    const name = String(params?.name ?? '')
    const args = (params?.arguments as Record<string, unknown>) ?? {}
    try {
      const result = await callTool(name, args)
      reply(id, result)
    } catch (err) {
      reply(id, toolError(`tool ${name} threw: ${err instanceof Error ? err.message : String(err)}`))
    }
    return
  }
  if (!isNotification) replyError(id, -32601, `method not found: ${method}`)
}

// ---- stdio loop -------------------------------------------------------------

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let newline: number
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line)
    } catch {
      log('failed to parse line:', line.slice(0, 200))
      continue
    }
    void handle(msg)
  }
})
process.stdin.on('end', () => process.exit(0))

log(`ready. API base: ${API_BASE}${API_TOKEN ? ' (with token)' : ''}`)
