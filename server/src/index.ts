import express from 'express'
import cors from 'cors'
import http from 'http'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { launchBrowser } from './browser/launcher.js'
import { CDPSession } from './browser/cdp.js'
import { attachWebSocket } from './api/ws.js'
import { createRouter } from './api/http.js'

const PORT = Number(process.env.PORT ?? 3001)

// In a packaged / production run the server also serves the built web UI, so
// the whole app lives on one port. In dev the UI is served by Vite (5173),
// which proxies /api and /ws back here.
const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist')
const SERVE_WEB = existsSync(join(WEB_DIST, 'index.html'))
const APP_URL = process.env.APP_URL
  ?? (SERVE_WEB ? `http://localhost:${PORT}/meetings/new` : 'http://localhost:5173/meetings/new')

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url)
      return true
    } catch {
      await new Promise(r => setTimeout(r, 800))
    }
  }
  return false
}

async function openAppInControlledBrowser(cdp: CDPSession): Promise<void> {
  if (process.env.OPEN_APP_IN_BROWSER === '0') return
  const ready = await waitForHttp(APP_URL, 60_000)
  if (!ready) {
    console.warn(`[server] App URL not ready, skip opening controlled browser tab: ${APP_URL}`)
    return
  }
  const openedUrl = await cdp.openUrl(APP_URL)
  console.log(`[server] App opened in controlled browser: ${openedUrl}`)
}

async function main() {
  // Attach to an already-running browser when BROWSER_CDP_PORT is set
  // (useful when a Chrome with the right profile is already open). Otherwise
  // launch our own.
  const existing = process.env.BROWSER_CDP_PORT
  let cdpPort: number
  let isFirstRun = false
  if (existing) {
    cdpPort = Number(existing)
    console.log(`[server] Attaching to existing browser on CDP port ${cdpPort}`)
  } else {
    console.log('[server] Launching browser...')
    const result = await launchBrowser()
    cdpPort = result.port
    isFirstRun = result.isFirstRun
  }

  const cdp = new CDPSession()
  await cdp.connect(cdpPort)

  if (isFirstRun) {
    console.log('\n[server] First run detected!')
    console.log('[server] Please log into ChatGPT, Gemini, and DeepSeek in the browser window,')
    console.log('[server] then confirm the highest model choices in the web UI.\n')
  }

  const app = express()
  app.use(cors())
  const server = http.createServer(app)

  const wsClients = attachWebSocket(server)
  app.use('/api', createRouter(cdp, wsClients))

  // Serve the built web UI (single-port production). The SPA fallback returns
  // index.html for client-side routes, but never for /api or /ws.
  if (SERVE_WEB) {
    app.use(express.static(WEB_DIST))
    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
      res.sendFile(join(WEB_DIST, 'index.html'))
    })
    console.log(`[server] Serving web UI from ${WEB_DIST}`)
  }

  server.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}${SERVE_WEB ? ' (UI + API)' : ' (API only; run the web dev server for the UI)'}`)
    console.log(`[server] WebSocket on ws://localhost:${PORT}/ws/meetings/:id`)
    openAppInControlledBrowser(cdp).catch(err => {
      console.warn('[server] Failed to open app in controlled browser:', err)
    })
  })

  process.on('SIGINT', async () => {
    console.log('\n[server] Shutting down...')
    await cdp.disconnect()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('[server] Fatal:', err)
  process.exit(1)
})
