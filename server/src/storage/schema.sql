CREATE TABLE IF NOT EXISTS debates (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  principles TEXT NOT NULL DEFAULT '',
  synthesizer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  deepseek_config TEXT NOT NULL DEFAULT '{"mode":"fast","deepThink":false,"smartSearch":false}',
  claude_config TEXT NOT NULL DEFAULT '{"model":"sonnet-4-6"}'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debate_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (debate_id) REFERENCES debates(id)
);

CREATE TABLE IF NOT EXISTS summaries (
  debate_id TEXT PRIMARY KEY,
  comparison TEXT NOT NULL,
  final_proposal TEXT NOT NULL,
  dissent TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (debate_id) REFERENCES debates(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_debate ON messages(debate_id);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  moderator TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  archive_dir TEXT NOT NULL DEFAULT '',
  summary_path TEXT NOT NULL DEFAULT '',
  json_path TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meeting_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  question TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE TABLE IF NOT EXISTS meeting_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL,
  agenda_id INTEGER,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id),
  FOREIGN KEY (agenda_id) REFERENCES agenda_items(id)
);

CREATE TABLE IF NOT EXISTS meeting_artifacts (
  meeting_id TEXT PRIMARY KEY,
  final_summary TEXT NOT NULL,
  archive_dir TEXT NOT NULL,
  summary_path TEXT NOT NULL,
  json_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_files_meeting ON meeting_files(meeting_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_messages_meeting ON meeting_messages(meeting_id);
