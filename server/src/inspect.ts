/**
 * Page-structure inspector: dumps what a site's chat page ACTUALLY looks like
 * (input candidates, send buttons, file inputs, iframes) so stale selectors in
 * adapters/specs.ts can be fixed from ground truth instead of guesswork.
 *
 * Usage (with the app's controlled browser already running and logged in):
 *   npm run inspect -w server -- zhipu          # one site
 *   npm run inspect -w server -- all            # every site
 *
 * Paste the output when reporting "页面结构自检失败" — it contains everything
 * needed to correct the selectors.
 */
import { CDPSession } from './browser/cdp.js'
import { ALL_MODELS, type MeetingModelName } from './browser/adapters/sites.js'

const arg = (process.argv[2] ?? '').trim() as MeetingModelName | 'all' | ''
if (!arg) {
  console.error(`用法: npm run inspect -w server -- <${ALL_MODELS.join('|')}|all>`)
  process.exit(1)
}
const targets: MeetingModelName[] = arg === 'all' ? [...ALL_MODELS] : [arg as MeetingModelName]
for (const t of targets) {
  if (!ALL_MODELS.includes(t)) {
    console.error(`未知模型: ${t} — 可选: ${ALL_MODELS.join(', ')}`)
    process.exit(1)
  }
}

let cdpPort = Number(process.env.BROWSER_CDP_PORT ?? 0)
if (!cdpPort) {
  for (const port of [9222, 9223, 9224]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) { cdpPort = port; break }
    } catch { /* continue */ }
  }
}
if (!cdpPort) {
  console.error('未发现正在运行的受控浏览器。请先启动程序（一键启动或 npm start），再运行本命令。')
  process.exit(1)
}

const cdp = new CDPSession()
await cdp.connect(cdpPort)
console.log(`[inspect] 已连接受控浏览器 (CDP 端口 ${cdpPort})`)

interface ElementInfo {
  tag: string
  id: string
  cls: string
  testid: string
  role: string
  placeholder: string
  ariaLabel: string
  visible: boolean
  snippet: string
}

// Serialized into the page context — keep this as plain JavaScript. Some TSX
// runtimes preserve type annotations in function.toString(), which makes
// Playwright evaluate fail inside the page.
const collectInFrame = Function(`
  return () => {
    const trim = (s, n = 120) => String(s ?? '').replace(/\\s+/g, ' ').slice(0, n)
    const info = (el) => {
      const rect = el.getBoundingClientRect?.()
      return {
        tag: el.tagName.toLowerCase(),
        id: trim(el.id, 60),
        cls: trim(el.getAttribute('class'), 140),
        testid: trim(el.getAttribute('data-testid'), 80),
        role: trim(el.getAttribute('role'), 30),
        placeholder: trim(el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder'), 60),
        ariaLabel: trim(el.getAttribute('aria-label'), 60),
        visible: !!rect && rect.width > 0 && rect.height > 0,
        snippet: trim(el.outerHTML, 200),
      }
    }
    const inputs = [
      ...document.querySelectorAll('textarea, div[contenteditable="true"], [contenteditable="true"], [role="textbox"], input[type="text"]'),
    ].map(info)
    const sendish = [...document.querySelectorAll('button, [role="button"], [class*="enter"], img[class*="enter"], [class*="send"]')]
      .filter(el => {
        const s = \`\${el.getAttribute('class') ?? ''} \${el.getAttribute('aria-label') ?? ''} \${el.getAttribute('data-testid') ?? ''} \${(el.textContent ?? '').slice(0, 20)}\`
        return /send|发送|submit|arrow|enter|停止|stop|新对话/i.test(s)
      })
      .slice(0, 16)
      .map(info)
    const fileInputs = document.querySelectorAll('input[type="file"]').length
    const loginish = [...document.querySelectorAll('button, a')]
      .filter(el => /登录|登 录|log ?in|sign ?in/i.test((el.textContent ?? '').slice(0, 30)))
      .slice(0, 5)
      .map(el => trim(el.textContent, 30))
    return { inputs, sendish, fileInputs, loginish }
  }
`)() as () => { inputs: ElementInfo[]; sendish: ElementInfo[]; fileInputs: number; loginish: string[] }

function printElements(label: string, items: ElementInfo[]): void {
  if (!items.length) { console.log(`  ${label}: （无）`); return }
  console.log(`  ${label}:`)
  for (const it of items) {
    const attrs = [
      it.id && `id="${it.id}"`,
      it.testid && `data-testid="${it.testid}"`,
      it.role && `role="${it.role}"`,
      it.placeholder && `placeholder="${it.placeholder}"`,
      it.ariaLabel && `aria-label="${it.ariaLabel}"`,
      it.cls && `class="${it.cls}"`,
    ].filter(Boolean).join(' ')
    console.log(`    <${it.tag} ${attrs}> visible=${it.visible}`)
  }
}

for (const target of targets) {
  console.log(`\n========== ${target} ==========`)
  try {
    const page = await cdp.ensurePage(target)
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 2_000))
    console.log(`URL: ${page.url()}`)
    console.log(`标题: ${await page.title().catch(() => '?')}`)

    const frames = page.frames()
    console.log(`frame 数: ${frames.length}${frames.length > 1 ? '（注意：输入框可能在 iframe 里）' : ''}`)
    for (const frame of frames) {
      const tag = frame === page.mainFrame() ? '主页面' : `iframe ${frame.url().slice(0, 100)}`
      let data
      try {
        data = await frame.evaluate(collectInFrame)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.log(`[${tag}] 无法读取: ${message}`)
        continue
      }
      console.log(`[${tag}]`)
      printElements('输入候选(textarea/contenteditable/textbox)', data.inputs)
      printElements('发送/停止按钮候选', data.sendish)
      console.log(`  input[type=file] 数量: ${data.fileInputs}`)
      if (data.loginish.length) console.log(`  ⚠ 发现登录相关按钮: ${data.loginish.join(' | ')} —— 可能未登录`)
    }
  } catch (err) {
    console.error(`[inspect] ${target} 失败:`, err instanceof Error ? err.message : err)
  }
}

console.log('\n[inspect] 完成。把上面输出贴给开发者/AI 即可精准修正 specs.ts 中的选择器。')
// Do not call cdp.disconnect() here: when attached to the app's controlled
// browser it closes that Chrome instance and breaks the running service.
process.exit(0)
