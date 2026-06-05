import { db } from './db.js'
import type { MeetingModelName } from '../browser/adapters/index.js'

export type MeetingStatus = 'pending' | 'running' | 'done' | 'error'
export type MeetingMode = 'relay' | 'parallel'

export interface MeetingRow {
  id: string
  title: string
  goal: string
  mode: MeetingMode
  participants_json: string
  moderator: MeetingModelName
  status: MeetingStatus
  created_at: number
  completed_at: number | null
  archive_dir: string
  summary_path: string
  json_path: string
}

export interface MeetingFileRow {
  id: number
  meeting_id: string
  filename: string
  kind: string
  content: string
  original_path: string
  created_at: number
}

export interface AgendaItemRow {
  id: number
  meeting_id: string
  position: number
  question: string
  summary: string
}

export interface MeetingMessageRow {
  id: number
  meeting_id: string
  agenda_id: number | null
  turn_index: number
  role: string
  model: MeetingModelName
  content: string
  created_at: number
}

export interface MeetingArtifactRow {
  meeting_id: string
  final_summary: string
  archive_dir: string
  summary_path: string
  json_path: string
  created_at: number
}

export interface MeetingLogRow {
  id: number
  meeting_id: string
  kind: string
  model: MeetingModelName | null
  filename: string | null
  status: string
  detail: string
  created_at: number
}

export const meetings = {
  create(args: {
    id: string
    title: string
    goal: string
    mode: MeetingMode
    participants: MeetingModelName[]
    moderator: MeetingModelName
  }): void {
    db.prepare(
      'INSERT INTO meetings (id, title, goal, mode, participants_json, moderator, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(args.id, args.title, args.goal, args.mode, JSON.stringify(args.participants),
      args.moderator, 'pending', Date.now())
  },

  setStatus(id: string, status: MeetingStatus): void {
    db.prepare('UPDATE meetings SET status = ? WHERE id = ?').run(status, id)
  },

  markDone(id: string): void {
    db.prepare("UPDATE meetings SET status = 'done', completed_at = ? WHERE id = ?").run(Date.now(), id)
  },

  setArchive(id: string, archiveDir: string, summaryPath: string, jsonPath: string): void {
    db.prepare('UPDATE meetings SET archive_dir = ?, summary_path = ?, json_path = ? WHERE id = ?')
      .run(archiveDir, summaryPath, jsonPath, id)
  },

  get(id: string): MeetingRow | undefined {
    return db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as MeetingRow | undefined
  },

  list(): MeetingRow[] {
    return db.prepare('SELECT * FROM meetings ORDER BY created_at DESC').all() as MeetingRow[]
  },
}

export const meetingFiles = {
  insert(meetingId: string, filename: string, kind: string, content: string, originalPath = ''): void {
    db.prepare(
      'INSERT INTO meeting_files (meeting_id, filename, kind, content, original_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(meetingId, filename, kind, content, originalPath, Date.now())
  },

  listByMeeting(meetingId: string): MeetingFileRow[] {
    return db.prepare(
      'SELECT * FROM meeting_files WHERE meeting_id = ? ORDER BY id'
    ).all(meetingId) as MeetingFileRow[]
  },
}

export const agendaItems = {
  insert(meetingId: string, position: number, question: string): number {
    const result = db.prepare(
      'INSERT INTO agenda_items (meeting_id, position, question) VALUES (?, ?, ?)'
    ).run(meetingId, position, question) as { lastInsertRowid?: number | bigint }
    return Number(result.lastInsertRowid ?? 0)
  },

  updateSummary(id: number, summary: string): void {
    db.prepare('UPDATE agenda_items SET summary = ? WHERE id = ?').run(summary, id)
  },

  listByMeeting(meetingId: string): AgendaItemRow[] {
    return db.prepare(
      'SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY position, id'
    ).all(meetingId) as AgendaItemRow[]
  },
}

export const meetingMessages = {
  insert(args: {
    meetingId: string
    agendaId: number | null
    turnIndex: number
    role: string
    model: MeetingModelName
    content: string
  }): void {
    db.prepare(
      'INSERT INTO meeting_messages (meeting_id, agenda_id, turn_index, role, model, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(args.meetingId, args.agendaId, args.turnIndex, args.role, args.model, args.content, Date.now())
  },

  updateLatest(meetingId: string, agendaId: number | null, model: MeetingModelName, content: string): number | undefined {
    const row = db.prepare(
      `SELECT id FROM meeting_messages
       WHERE meeting_id = ? AND (agenda_id IS ? OR agenda_id = ?) AND model = ?
       ORDER BY id DESC LIMIT 1`
    ).get(meetingId, agendaId, agendaId, model) as { id: number } | undefined
    if (!row) return undefined
    db.prepare('UPDATE meeting_messages SET content = ?, created_at = ? WHERE id = ?')
      .run(content, Date.now(), row.id)
    return row.id
  },

  listByMeeting(meetingId: string): MeetingMessageRow[] {
    return db.prepare(
      'SELECT * FROM meeting_messages WHERE meeting_id = ? ORDER BY id'
    ).all(meetingId) as MeetingMessageRow[]
  },
}

export const meetingArtifacts = {
  upsert(meetingId: string, finalSummary: string, archiveDir: string, summaryPath: string, jsonPath: string): void {
    db.prepare(
      'INSERT OR REPLACE INTO meeting_artifacts (meeting_id, final_summary, archive_dir, summary_path, json_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(meetingId, finalSummary, archiveDir, summaryPath, jsonPath, Date.now())
  },

  get(meetingId: string): MeetingArtifactRow | undefined {
    return db.prepare('SELECT * FROM meeting_artifacts WHERE meeting_id = ?').get(meetingId) as MeetingArtifactRow | undefined
  },
}

export const meetingLogs = {
  insert(args: {
    meetingId: string
    kind: string
    status: string
    model?: MeetingModelName | null
    filename?: string | null
    detail?: string
  }): void {
    db.prepare(
      'INSERT INTO meeting_logs (meeting_id, kind, model, filename, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(args.meetingId, args.kind, args.model ?? null, args.filename ?? null, args.status, args.detail ?? '', Date.now())
  },

  listByMeeting(meetingId: string): MeetingLogRow[] {
    return db.prepare(
      'SELECT * FROM meeting_logs WHERE meeting_id = ? ORDER BY id'
    ).all(meetingId) as MeetingLogRow[]
  },
}
