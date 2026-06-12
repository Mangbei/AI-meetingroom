import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  MEETING_MODELS,
  DEFAULT_PARTICIPANTS,
  MODEL_CANDIDATE_ORDER,
  MODEL_CANDIDATES,
  MODEL_META,
  type MeetingModelName,
  type ModelCandidateName,
} from '../lib/models.ts'

type MeetingMode = 'relay' | 'parallel'
type FileKind = 'txt' | 'md' | 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'csv' | 'code' | 'ipynb'
type ModelPosture = 'cooperative' | 'balanced' | 'critical'

interface UploadFile {
  filename: string
  kind: FileKind
  mimeType: string
  size: number
  dataBase64: string
  preview: string
}

interface RuntimeStatus {
  loggedIn: boolean
  requestedModel?: string
  detectedModel?: string
  configured: boolean
  needsManualConfirmation: boolean
  warning?: string
}

const POSTURE_META: Record<ModelPosture, { label: string; desc: string }> = {
  cooperative: { label: '协作', desc: '优先吸收和整合他人观点' },
  balanced: { label: '默认', desc: '独立判断，不过度附和或反对' },
  critical: { label: '反骨', desc: '主动质疑漏洞和薄弱假设' },
}

const KIND_BY_EXT: Record<string, FileKind> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  pdf: 'pdf',
  docx: 'docx',
  doc: 'doc',
  xlsx: 'xlsx',
  xls: 'xls',
  csv: 'csv',
  ipynb: 'ipynb',
}

// Common source/config extensions shown in the picker. Any other text file is
// still accepted (kindFromName falls back to 'code'); the server rejects only
// truly binary uploads.
const CODE_EXTS = [
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'java', 'kt', 'c', 'h',
  'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bash',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'css', 'scss', 'vue',
  'svelte', 'r', 'lua', 'pl', 'tex', 'rst',
]
for (const ext of CODE_EXTS) KIND_BY_EXT[ext] = 'code'

const FILE_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ipynb',
  ...CODE_EXTS.map(ext => `.${ext}`),
].join(',')

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 55 * 1024 * 1024

function isMeetingModel(model: ModelCandidateName): model is MeetingModelName {
  return MEETING_MODELS.includes(model as MeetingModelName)
}

function kindFromName(filename: string): FileKind | undefined {
  const parts = filename.split('.')
  if (parts.length < 2) return 'code' // extensionless files (Dockerfile, Makefile…) are usually text
  const ext = parts.pop()?.toLowerCase()
  if (!ext) return undefined
  // Known kind wins; otherwise assume a text/code file and let the server do
  // the final binary check.
  return KIND_BY_EXT[ext] ?? 'code'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value)
    }
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

async function buildPreview(file: File, kind: FileKind): Promise<string> {
  if (kind === 'txt' || kind === 'md' || kind === 'csv' || kind === 'code' || kind === 'ipynb') {
    const text = await file.text().catch(() => '')
    return text.slice(0, 500)
  }
  return '原文件将优先直传给网页端 AI；后端已准备文本兜底。'
}

export default function NewMeeting() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('文章选题会议')
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<MeetingMode>('relay')
  const [agendaRounds, setAgendaRounds] = useState(2)
  const [participants, setParticipants] = useState<MeetingModelName[]>([...DEFAULT_PARTICIPANTS])
  const [moderator, setModerator] = useState<MeetingModelName>('chatgpt')
  const [agenda, setAgenda] = useState<string[]>([''])
  const [useProvidedAgenda, setUseProvidedAgenda] = useState(false)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [modelPostures, setModelPostures] = useState<Record<MeetingModelName, ModelPosture>>(
    Object.fromEntries(MEETING_MODELS.map(m => [m, 'balanced'])) as Record<MeetingModelName, ModelPosture>,
  )
  const [confirmations, setConfirmations] = useState<Record<MeetingModelName, boolean>>(
    Object.fromEntries(MEETING_MODELS.map(m => [m, false])) as Record<MeetingModelName, boolean>,
  )
  const [runtimeStatus, setRuntimeStatus] = useState<Partial<Record<MeetingModelName, RuntimeStatus>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [openingTabs, setOpeningTabs] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [readingFiles, setReadingFiles] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = async (models = participants) => {
    setCheckingStatus(true)
    try {
      const query = encodeURIComponent(models.join(','))
      const status = await fetch(`/api/status?models=${query}`).then(r => r.json())
      setRuntimeStatus(prev => ({ ...prev, ...(status.runtimeStatus ?? {}) }))
    } catch {
      setRuntimeStatus(prev => ({ ...prev }))
    } finally {
      setCheckingStatus(false)
    }
  }

  useEffect(() => {
    void refreshStatus(DEFAULT_PARTICIPANTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!participants.includes(moderator)) setModerator(participants[0] ?? 'chatgpt')
  }, [moderator, participants])

  const canSubmit = useMemo(() => {
    return title.trim() && goal.trim() &&
      participants.length >= 2 && participants.length <= 5 &&
      participants.every(m => confirmations[m]) && !readingFiles
  }, [confirmations, goal, participants, readingFiles, title])

  const toggleParticipant = (model: MeetingModelName) => {
    setError('')
    const isRemoving = participants.includes(model)
    if (isRemoving) {
      if (participants.length <= 2) {
        setError('至少需要 2 位模型入会')
        return
      }
      setParticipants(prev => prev.filter(item => item !== model))
      return
    }
    if (participants.length >= 5) {
      setError('最多选择 5 位模型')
      return
    }
    setParticipants(prev => [...prev, model])
    // Newly added: open that site's tab so the user can log in on demand,
    // and refresh just its status. Mirrors a real attendee joining the room.
    void openTabs([model])
  }

  const readFiles = async (list: FileList | null) => {
    if (!list) return
    setError('')
    setReadingFiles(true)
    try {
      const currentTotal = files.reduce((sum, file) => sum + file.size, 0)
      let nextTotal = currentTotal
      const accepted: UploadFile[] = []
      const rejected: string[] = []

      for (const file of Array.from(list)) {
        const kind = kindFromName(file.name)
        if (!kind) {
          rejected.push(`${file.name} 格式暂不支持`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          rejected.push(`${file.name} 超过 ${formatBytes(MAX_FILE_BYTES)}`)
          continue
        }
        if (nextTotal + file.size > MAX_TOTAL_BYTES) {
          rejected.push(`总上传体积超过 ${formatBytes(MAX_TOTAL_BYTES)}`)
          break
        }

        nextTotal += file.size
        accepted.push({
          filename: file.name,
          kind,
          mimeType: file.type,
          size: file.size,
          dataBase64: await fileToBase64(file),
          preview: await buildPreview(file, kind),
        })
      }

      if (accepted.length) setFiles(prev => [...prev, ...accepted])
      if (rejected.length) setError(rejected.join('；'))
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setReadingFiles(false)
    }
  }

  const openTabs = async (models: MeetingModelName[]) => {
    if (!models.length) return
    setOpeningTabs(true)
    setError('')
    try {
      const res = await fetch('/api/browser/open-meeting-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      await refreshStatus(models)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setOpeningTabs(false)
    }
  }

  const openMeetingTabs = () => openTabs(participants)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError('')
    try {
      const uploadPayload = files.map(file => ({
        filename: file.filename,
        kind: file.kind,
        mimeType: file.mimeType,
        size: file.size,
        dataBase64: file.dataBase64,
      }))
      const res = await fetch('/api/meetings/agenda-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          goal: goal.trim(),
          mode,
          agendaRounds,
          participants,
          moderator,
          agenda: agenda.map(q => q.trim()).filter(Boolean),
          useProvidedAgenda,
          files: uploadPayload,
          modelPostures: Object.fromEntries(participants.map(model => [model, modelPostures[model]])),
          confirmations,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      navigate(`/meetings/agenda-review/${data.draftId}`)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '3rem 2.4rem 4rem' }}>
      <header className="fade-up" style={{ borderBottom: '1.5px solid var(--paper)', paddingBottom: '1.4rem', marginBottom: '2.2rem' }}>
        <Link to="/" className="byline" style={{ borderBottom: 'none', color: 'var(--paper-mute)' }}>← 返回广场</Link>
        <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 58px)', marginTop: '0.8rem', color: 'var(--paper)' }}>
          新建多模型会议
        </h1>
      </header>

      <form onSubmit={submit}>
        <div className="field">
          <label>会议标题</label>
          <input value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>会议目标</label>
          <textarea
            rows={4}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="例如：基于我的简历、现有总结和研究兴趣，帮我确定最适合写文章的选题方向。"
          />
        </div>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>上传资料</label>
          <input
            type="file"
            multiple
            accept={FILE_ACCEPT}
            onChange={e => {
              void readFiles(e.currentTarget.files)
              e.currentTarget.value = ''
            }}
            style={{ border: '1px solid var(--rule)', padding: '0.8rem', background: 'var(--ink-2)' }}
          />
          <p className="byline faint" style={{ marginTop: '0.6rem', textTransform: 'none', letterSpacing: 0 }}>
            TXT、MD、PDF、Word、Excel、CSV；原文件优先直传，失败后文本兜底。
          </p>
          {readingFiles && <p className="faint">正在读取文件...</p>}
          {files.length > 0 && (
            <ul style={{ marginTop: '0.8rem', color: 'var(--paper-mute)', paddingLeft: 0, listStyle: 'none' }}>
              {files.map((file, i) => (
                <li
                  key={`${file.filename}-${i}`}
                  style={{ borderBottom: '1px solid var(--rule)', padding: '0.65rem 0', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}
                >
                  <span>
                    <strong style={{ color: 'var(--paper)' }}>{file.filename}</strong>
                    <span className="byline faint" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                      {file.kind.toUpperCase()} · {formatBytes(file.size)}
                    </span>
                  </span>
                  <button type="button" className="ghost" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>已有议程提示（可选）</label>
          {agenda.map((q, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.8rem', marginBottom: '0.8rem' }}>
              <textarea
                rows={2}
                value={q}
                onChange={e => setAgenda(prev => prev.map((x, idx) => idx === i ? e.target.value : x))}
                placeholder={`给主持人的议程参考 ${i + 1}`}
              />
              <button type="button" className="ghost" onClick={() => setAgenda(prev => prev.filter((_, idx) => idx !== i))}>
                删除
              </button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setAgenda(prev => [...prev, ''])}>添加参考议程</button>

          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '1rem', cursor: 'pointer', fontWeight: 'normal' }}>
            <input
              type="checkbox"
              checked={useProvidedAgenda}
              onChange={e => setUseProvidedAgenda(e.target.checked)}
              style={{ marginTop: '0.25rem' }}
            />
            <span>
              直接使用我填写的议程（跳过主持人 AI 重拟）
              <span className="byline" style={{ textTransform: 'none', letterSpacing: 0, display: 'block', marginTop: '0.2rem' }}>
                勾选后，将以上面填写的议程原样进入下一步；不勾选则由主持人参考它重新拟定。两种情况都能在下一页微调。
              </span>
            </span>
          </label>
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>讨论设置</label>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className={mode === 'relay' ? 'primary' : 'ghost'} onClick={() => setMode('relay')}>接力模式</button>
            <button type="button" className={mode === 'parallel' ? 'primary' : 'ghost'} onClick={() => setMode('parallel')}>并行模式</button>
            <select value={agendaRounds} onChange={e => setAgendaRounds(Number(e.target.value))} style={{ maxWidth: 220 }}>
              {[1, 2, 3, 4, 5].map(round => (
                <option key={round} value={round}>{round} 轮 / 每个议程{round === 2 ? '（推荐）' : ''}</option>
              ))}
            </select>
          </div>
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>入会模型与运行前检查</label>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.8rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <button type="button" className="ghost" onClick={openMeetingTabs} disabled={openingTabs || participants.length < 2}>
              {openingTabs ? '正在打开...' : '打开/聚焦所选网页'}
            </button>
            <button type="button" className="ghost" onClick={() => void refreshStatus(participants)} disabled={checkingStatus}>
              {checkingStatus ? '检查中...' : '刷新连通性'}
            </button>
            <span className="byline faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
              选择 2-5 位；当前已接入 3 位，其他模型已确认未接入，暂不可选。
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            {MODEL_CANDIDATE_ORDER.map(candidate => {
              const meta = MODEL_CANDIDATES[candidate]
              const enabled = meta.enabled && isMeetingModel(candidate)
              const selected = enabled && participants.includes(candidate)
              const status = enabled ? runtimeStatus[candidate] : undefined
              return (
                <div
                  key={candidate}
                  style={{
                    borderLeft: `2px solid ${meta.tone}`,
                    paddingLeft: '1rem',
                    opacity: enabled ? 1 : 0.52,
                  }}
                >
                  <label style={{ letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--serif-body)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      disabled={!enabled}
                      checked={selected}
                      onChange={() => enabled && toggleParticipant(candidate)}
                      style={{ width: 14 }}
                    />
                    <h3 className="display" style={{ fontSize: 22, color: meta.tone, margin: 0 }}>{meta.display}</h3>
                  </label>
                  <p className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>{meta.targetModel}</p>
                  <p className="faint" style={{ fontSize: 13 }}>{meta.role}</p>
                  <p style={{ color: status?.loggedIn ? 'var(--paper-mute)' : 'var(--vermilion)', fontStyle: 'italic', fontSize: 14 }}>
                    {!enabled
                      ? '已确认未接入，等待适配器'
                      : status?.loggedIn
                        ? '已检测到登录或需人工确认'
                        : '未确认登录，可继续尝试但可能缺席'}
                  </p>
                  {enabled && selected && (
                    <>
                      <label style={{ marginTop: '0.8rem', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--serif-body)', fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={confirmations[candidate]}
                          onChange={e => setConfirmations(prev => ({ ...prev, [candidate]: e.target.checked }))}
                          style={{ width: 14, marginRight: 8 }}
                        />
                        我已确认该网页使用最高可用模型
                      </label>
                      <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        {(Object.keys(POSTURE_META) as ModelPosture[]).map(posture => (
                          <button
                            key={posture}
                            type="button"
                            className={modelPostures[candidate] === posture ? 'primary' : 'ghost'}
                            onClick={() => setModelPostures(prev => ({ ...prev, [candidate]: posture }))}
                            title={POSTURE_META[posture].desc}
                            style={{ padding: '0.45rem 0.6rem' }}
                          >
                            {POSTURE_META[posture].label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {status?.warning && <p className="faint" style={{ fontSize: 13 }}>{status.warning}</p>}
                </div>
              )
            })}
          </div>

          <div className="field" style={{ marginTop: '1.4rem' }}>
            <label>主持人 / 议程拟定者 / 最终归纳者</label>
            <select value={moderator} onChange={e => setModerator(e.target.value as MeetingModelName)}>
              {participants.map(m => <option key={m} value={m}>{MODEL_META[m].display}</option>)}
            </select>
          </div>
        </section>

        {error && <p style={{ color: 'var(--vermilion)', marginBottom: '1rem' }}>{error}</p>}
        <button type="submit" className="primary" disabled={!canSubmit || submitting}>
          {submitting ? '正在生成议程...' : '生成议程草案'}
        </button>
      </form>
    </div>
  )
}
