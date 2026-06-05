import { spawn, ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import net from 'net'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROFILE_DIR = join(PROJECT_ROOT, '.local-data', 'browser-profile')
const BASE_PORT = 9222

interface BrowserCandidate {
  name: string
  paths: string[]
}

interface BrowserBinary {
  name: string
  path: string
}

const BROWSER_CANDIDATES_MAC: BrowserCandidate[] = [
  { name: 'Google Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
  { name: 'Chromium', paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
  { name: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
]

const BROWSER_CANDIDATES_LINUX: BrowserCandidate[] = [
  { name: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] },
  { name: 'Chromium', paths: ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'] },
  { name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'] },
]

function browserCandidatesWin(): BrowserCandidate[] {
  const programFiles    = process.env['ProgramFiles']      ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData    = process.env['LOCALAPPDATA']      ?? join(homedir(), 'AppData', 'Local')
  return [
    {
      name: 'Google Chrome',
      paths: [
        join(programFiles,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData,    'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
    },
    {
      name: 'Chromium',
      paths: [
        join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
        join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
      ],
    },
    {
      name: 'Microsoft Edge',
      paths: [
        join(programFiles,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(localAppData,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
    },
  ]
}

function browserCandidates(): BrowserCandidate[] {
  return process.platform === 'win32' ? browserCandidatesWin() :
    process.platform === 'linux' ? BROWSER_CANDIDATES_LINUX :
    BROWSER_CANDIDATES_MAC
}

function findBrowserBinary(): BrowserBinary {
  const candidates =
    browserCandidates()
  for (const candidate of candidates) {
    for (const path of candidate.paths) {
      if (existsSync(path)) return { name: candidate.name, path }
    }
  }
  throw new Error(
    `No Chrome/Chromium/Edge installation found on ${process.platform}. ` +
    `Install Google Chrome or Microsoft Edge, or set BROWSER_BINARY env var.`
  )
}

// Allow override via env var (useful for non-standard installs / portable Chrome)
function resolveBrowserBinary(): BrowserBinary {
  const override = process.env.BROWSER_BINARY
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`BROWSER_BINARY="${override}" does not exist`)
    }
    return { name: 'custom browser', path: override }
  }
  return findBrowserBinary()
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
  })
}

async function findAvailablePort(start: number): Promise<number> {
  let port = start
  while (!(await isPortFree(port))) port++
  return port
}

async function waitForCDP(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      return
    } catch {
      await new Promise(r => setTimeout(r, 300))
    }
  }
  throw new Error(`Chrome CDP not available on port ${port} after ${timeoutMs}ms`)
}

export interface BrowserLaunchResult {
  port: number
  process: ChildProcess
  isFirstRun: boolean
}

export async function launchBrowser(): Promise<BrowserLaunchResult> {
  const isFirstRun = !existsSync(PROFILE_DIR)
  if (isFirstRun) {
    mkdirSync(PROFILE_DIR, { recursive: true })
  }

  const binary = resolveBrowserBinary()
  const port = await findAvailablePort(BASE_PORT)

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--start-maximized',
  ]

  console.log(`[launcher] Launching ${binary.name}: ${binary.path}`)

  const proc = spawn(binary.path, args, {
    detached: false,
    stdio: 'ignore',
  })

  proc.on('error', err => {
    console.error('[launcher] Browser process error:', err.message)
  })

  await waitForCDP(port)
  console.log(`[launcher] Browser ready on CDP port ${port}`)

  return { port, process: proc, isFirstRun }
}
