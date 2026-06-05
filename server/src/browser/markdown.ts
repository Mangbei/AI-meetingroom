import TurndownService from 'turndown'
// turndown-plugin-gfm has no type declarations on npm
// @ts-expect-error: no types published
import { gfm } from 'turndown-plugin-gfm'

const td = new TurndownService({
  headingStyle: 'atx',          // # H1 instead of underline ===
  codeBlockStyle: 'fenced',     // ``` instead of indented
  bulletListMarker: '-',
  emDelimiter: '_',
  hr: '---',
  linkStyle: 'inlined',
})
td.use(gfm)

// Strip UI chrome that gets rendered alongside model output: copy buttons,
// inline SVG icons, hidden ARIA labels. These would otherwise leak as
// "[复制]" / "Copy" / random unicode glyphs into the markdown.
td.addRule('strip-chrome', {
  filter: (node: HTMLElement) => {
    const tag = node.nodeName.toLowerCase()
    if (tag === 'button' || tag === 'svg') return true
    // Some sites put copy/edit affordances in toolbar divs with aria-label
    const ariaHidden = node.getAttribute?.('aria-hidden')
    if (ariaHidden === 'true' && (tag === 'div' || tag === 'span')) return true
    return false
  },
  replacement: () => '',
})

// ChatGPT and DeepSeek render a chrome strip above <pre> with
// a language label and copy buttons. Turndown's built-in fence rule reads
// language from <code class="language-X">, so we only need to strip the
// stray label so it doesn't appear as plain text before the fence.
td.addRule('strip-code-header', {
  filter: (node: HTMLElement) => {
    if (node.nodeName.toLowerCase() !== 'div') return false
    const cls = (node.className ?? '') as string
    // Known code-block toolbar classes across the three sites
    if (typeof cls === 'string' &&
        /rounded-t|code-header|code-block__header|md-code-block-banner/.test(cls)) {
      return true
    }
    // (a) div with svg + short label (ChatGPT)
    const children = Array.from(node.children ?? [])
    if (children.length === 1 && children[0].nodeName.toLowerCase() === 'svg') {
      const text = (node.textContent ?? '').trim()
      if (text.length > 0 && text.length <= 24 && /^[A-Za-z0-9+\-_#. ]+$/.test(text)) return true
    }
    // (b) tiny div with only a language-name text, sibling of a <pre>
    if (children.length === 0) {
      const text = (node.textContent ?? '').trim()
      if (text.length > 0 && text.length <= 15 && /^[A-Za-z0-9+\-_#.]+$/.test(text)) {
        const parent = node.parentElement
        if (parent && parent.querySelector('pre')) return true
      }
    }
    return false
  },
  replacement: () => '',
})

// DeepSeek's <pre> doesn't wrap content in <code>, so turndown's built-in
// fenced-code-block rule (which requires <pre><code>) misses it and falls
// back to processing children as inline text (escapes, line breaks lost).
// Emit a fence ourselves for any <pre> whose first child isn't <code>.
td.addRule('bare-pre', {
  filter: (node: HTMLElement) => {
    if (node.nodeName.toLowerCase() !== 'pre') return false
    const first = node.firstChild
    return !first || first.nodeName.toLowerCase() !== 'code'
  },
  replacement: (_content, node) => {
    const el = node as unknown as HTMLElement
    // Best effort language detection: look at preceding sibling banner text
    let lang = ''
    const prev = el.previousElementSibling as HTMLElement | null
    const cand = prev?.textContent?.trim()
    if (cand && cand.length <= 15 && /^[A-Za-z0-9+\-_#.]+$/.test(cand)) lang = cand
    const text = (el.textContent ?? '').replace(/\n+$/, '')
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
  },
})

// ChatGPT wraps inline math with <span class="katex"> and the rendered
// HTML contains BOTH the rendered glyphs and an <annotation>$...$</annotation>
// fallback. Prefer the annotation when present.
td.addRule('katex', {
  filter: (node: HTMLElement) => {
    const cls = node.className ?? ''
    return typeof cls === 'string' && cls.includes('katex')
  },
  replacement: (_content, node) => {
    const el = node as unknown as HTMLElement
    const ann = el.querySelector?.('annotation')
    const tex = ann?.textContent?.trim()
    if (tex) {
      const block = el.querySelector?.('.katex-display') != null
      return block ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
    }
    return el.textContent ?? ''
  },
})

export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  try {
    return td.turndown(html).trim()
  } catch (err) {
    console.warn('[markdown] turndown failed, falling back to text:', err)
    // Last-resort fallback: strip tags via a regex (loses structure but won't crash)
    return html.replace(/<[^>]+>/g, '').trim()
  }
}
