/**
 * Smoke test: connects to the running browser (via CDP port 9222) and sends
 * "你好，请用一句话介绍你自己" to one adapter, printing the streamed response.
 *
 * Usage (with server already running):
 *   npm run smoke -- [chatgpt|gemini|deepseek]
 *
 * If the server is not running, pass --launch to start a browser first.
 */
import { launchBrowser } from './browser/launcher.js'
import { CDPSession } from './browser/cdp.js'
import { ADAPTER_REGISTRY, MEETING_MODELS } from './browser/adapters/index.js'
import type { ModelName } from './browser/adapters/index.js'

const args = process.argv.slice(2)
const target = (args.find(a => !a.startsWith('--')) ?? 'chatgpt') as ModelName
const shouldLaunch = args.includes('--launch')

if (!(target in ADAPTER_REGISTRY)) {
  console.error('Unknown target:', target, `— use one of: ${MEETING_MODELS.join(', ')}`)
  process.exit(1)
}
const adapter = ADAPTER_REGISTRY[target].ctor()

console.log(`[smoke] Target: ${target}`)

let cdpPort = Number(process.env.BROWSER_CDP_PORT ?? 9222)
const cdp = new CDPSession()

if (shouldLaunch) {
  console.log('[smoke] Launching browser...')
  const result = await launchBrowser()
  cdpPort = result.port
} else {
  // try to detect the running port
  if (!process.env.BROWSER_CDP_PORT) {
    for (const port of [9222, 9223, 9224]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (res.ok) { cdpPort = port; break }
      } catch { /* continue */ }
    }
  }
  console.log(`[smoke] Connecting to existing browser on port ${cdpPort}`)
}

await cdp.connect(cdpPort)

const page = await cdp.ensurePage(target)
adapter.setPage(page)
await adapter.ensureReady()

// Quick login check
const loggedIn = await cdp.checkLoginStatus(target)
if (!loggedIn) {
  console.error(`[smoke] ❌ Not logged in to ${target}. Please log in and retry.`)
  if (shouldLaunch) await cdp.disconnect()
  process.exit(1)
}

console.log(`[smoke] ✓ Logged in. Starting new conversation...`)
await adapter.newConversation()

const msg = '你好，请用一句话介绍你自己'
console.log(`[smoke] Sending: "${msg}"`)
await adapter.sendMessage(msg)

process.stdout.write('[smoke] Response: ')
const full = await adapter.streamResponse(delta => process.stdout.write(delta))
process.stdout.write('\n')

if (full.length > 0) {
  console.log(`[smoke] ✓ Done. Response length: ${full.length} chars`)
} else {
  console.error(`[smoke] ❌ Empty response — check selectors in adapters/${target}.ts`)
}

if (shouldLaunch) await cdp.disconnect()
process.exit(full.length > 0 ? 0 : 1)
