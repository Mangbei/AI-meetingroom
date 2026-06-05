import { db } from './db.js'
import type { MeetingModelName, ModelName } from '../browser/adapters/index.js'

export type DebateStatus = 'pending' | 'running' | 'done' | 'error'
export type MeetingStatus = DebateStatus
export type MeetingMode = 'relay' | 'parallel'
// 5-phase iteration: 1=conceptual (no output); 2=各自方案; 3=匿名互评+排名;
// 4=作者修订; 5=综合; 6=终稿复核 (ratify/veto). The numbering keeps phase 1
// reserved for the conceptual "开题" so existing DB rows stay valid.
export type DebatePhase = 1 | 2 | 3 | 4 | 5 | 6

export interface DebateRow {
  id: string
  topic: string
  principles: string
  synthesizer: ModelName
  status: DebateStatus
  created_at: number
  completed_at: number | null
  deepseek_config: string
  claude_config: string
}

export interface DebateListRow {
  id: string
  topic: string
  synthesizer: ModelName
  status: DebateStatus
  created_at: number
  completed_at: number | null
}

export interface MessageRow {
  phase: DebatePhase
  model: ModelName
  content: string
  created_at: number
}

export interface SummaryRow {
  debate_id: string
  comparison: string
  final_proposal: string
  dissent: string
}

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

export const debates = {
  create(args: {
    id: string
    topic: string
    principles: string
    synthesizer: ModelName
    deepseekConfigJson: string
    claudeConfigJson: string
  }): void {
    db.prepare(
      'INSERT INTO debates (id, topic, principles, synthesizer, status, created_at, deepseek_config, claude_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(args.id, args.topic, args.principles, args.synthesizer, 'pending', Date.now(),
      args.deepseekConfigJson, args.claudeConfigJson)
  },

  setStatus(id: string, status: DebateStatus): void {
    db.prepare('UPDATE debates SET status = ? WHERE id = ?').run(status, id)
  },

  markDone(id: string): void {
    db.prepare("UPDATE debates SET status = 'done', completed_at = ? WHERE id = ?").run(Date.now(), id)
  },

  get(id: string): DebateRow | undefined {
    return db.prepare('SELECT * FROM debates WHERE id = ?').get(id) as DebateRow | undefined
  },

  getStatus(id: string): DebateStatus | undefined {
    const row = db.prepare('SELECT status FROM debates WHERE id = ?').get(id) as { status: DebateStatus } | undefined
    return row?.status
  },

  list(): DebateListRow[] {
    return db.prepare(
      'SELECT id, topic, synthesizer, status, created_at, completed_at FROM debates ORDER BY created_at DESC'
    ).all() as DebateListRow[]
  },

  delete(id: string): void {
    // Schema has no ON DELETE CASCADE — clean children first
    db.prepare('DELETE FROM messages WHERE debate_id = ?').run(id)
    db.prepare('DELETE FROM summaries WHERE debate_id = ?').run(id)
    db.prepare('DELETE FROM debates WHERE id = ?').run(id)
  },
}

export const messages = {
  insert(debateId: string, phase: DebatePhase, model: ModelName, content: string): void {
    db.prepare(
      'INSERT INTO messages (debate_id, phase, model, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(debateId, phase, model, content, Date.now())
  },

  listByDebate(debateId: string): MessageRow[] {
    return db.prepare(
      'SELECT phase, model, content, created_at FROM messages WHERE debate_id = ? ORDER BY id'
    ).all(debateId) as MessageRow[]
  },

  /**
   * Overwrite the content of the LATEST row for (debate, phase, model).
   * Used by the refetch endpoint when the stored content turned out to be
   * an error placeholder (e.g., rate-limit notice) but the model has since
   * produced a real reply that we need to pull in from the live tab.
   * Returns the row id that was updated, or undefined when nothing matched.
   */
  updateLatest(
    debateId: string, phase: DebatePhase, model: ModelName, content: string,
  ): number | undefined {
    const row = db.prepare(
      'SELECT id FROM messages WHERE debate_id = ? AND phase = ? AND model = ? ORDER BY id DESC LIMIT 1'
    ).get(debateId, phase, model) as { id: number } | undefined
    if (!row) return undefined
    db.prepare('UPDATE messages SET content = ?, created_at = ? WHERE id = ?')
      .run(content, Date.now(), row.id)
    return row.id
  },
}

export const summaries = {
  upsert(debateId: string, comparison: string, finalProposal: string, dissent: string = ''): void {
    db.prepare(
      'INSERT OR REPLACE INTO summaries (debate_id, comparison, final_proposal, dissent) VALUES (?, ?, ?, ?)'
    ).run(debateId, comparison, finalProposal, dissent)
  },

  get(debateId: string): SummaryRow | undefined {
    return db.prepare('SELECT * FROM summaries WHERE debate_id = ?').get(debateId) as SummaryRow | undefined
  },
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
  insert(meetingId: string, filename: string, kind: string, content: string): void {
    db.prepare(
      'INSERT INTO meeting_files (meeting_id, filename, kind, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(meetingId, filename, kind, content, Date.now())
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
