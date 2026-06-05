import express from 'express'
import cors from 'cors'
import http from 'http'
import { launchBrowser } from './browser/launcher.js'
import { CDPSession } from './browser/cdp.js'
import { attachWebSocket } from './api/ws.js'
import { createRouter } from './api/http.js'

const PORT = Number(process.env.PORT ?? 3001)

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

  server.listen(PORT, () => {
    console.log(`[server] API listening on http://localhost:${PORT}`)
    console.log(`[server] WebSocket on ws://localhost:${PORT}/ws/meetings/:id`)
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
