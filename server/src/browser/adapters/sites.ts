/**
 * Single source of truth for every web-AI site the app can drive.
 *
 * Connection info (URL, how to tell logged-in from logged-out) lives here so
 * the CDP layer and the adapter registry derive the SAME set of model names
 * from one place — adding a model means adding one entry here, not editing
 * several parallel maps that can drift out of sync.
 *
 * NOTE: selectors below are best-effort and may need re-verification against
 * the live site after a redesign. Each adapter's preflight() check turns a
 * stale selector into a clear "site changed" skip instead of a silent failure.
 */
export interface SiteConnect {
  /** Where to navigate to reach the chat UI. */
  url: string
  /** URL prefixes that count as "already on this site" (handles redirects/aliases). */
  urlPrefixes: string[]
  /** URL fragments that indicate a logged-out / login page. */
  loginUrlFragments: string[]
  /** A selector that is only present when logged OUT (e.g. a Log in button). */
  loggedOutSelector?: string
}

export const SITE_CONNECT = {
  chatgpt: {
    url: 'https://chatgpt.com',
    urlPrefixes: ['https://chatgpt.com', 'https://chat.openai.com'],
    loginUrlFragments: [],
    loggedOutSelector: [
      'button[data-testid="login-button"]',
      'a[href*="/auth/login"]',
      'button:has-text("Log in")',
      'a:has-text("Log in")',
      'button:has-text("登录")',
      'a:has-text("登录")',
    ].join(', '),
  },
  gemini: {
    url: 'https://gemini.google.com',
    urlPrefixes: ['https://gemini.google.com'],
    loginUrlFragments: ['accounts.google.com'],
    loggedOutSelector: [
      'button:has-text("Sign in")',
      'a:has-text("Sign in")',
      'button:has-text("登录")',
      'a:has-text("登录")',
    ].join(', '),
  },
  deepseek: {
    url: 'https://chat.deepseek.com',
    urlPrefixes: ['https://chat.deepseek.com'],
    loginUrlFragments: ['/sign_in', '/signin'],
  },
  claude: {
    url: 'https://claude.ai/new',
    urlPrefixes: ['https://claude.ai'],
    loginUrlFragments: ['/login'],
    loggedOutSelector: 'a[href*="/login"], button:has-text("Log in"), button:has-text("登录"), button:has-text("Continue with Google")',
  },
  doubao: {
    url: 'https://www.doubao.com/chat/',
    urlPrefixes: ['https://www.doubao.com'],
    loginUrlFragments: [],
    loggedOutSelector: 'button:has-text("登录"), button:has-text("登 录")',
  },
  zhipu: {
    url: 'https://chatglm.cn/main/alltoolsdetail',
    urlPrefixes: ['https://chatglm.cn'],
    loginUrlFragments: ['/login'],
    loggedOutSelector: 'button:has-text("登录"), button:has-text("登 录")',
  },
  qwen: {
    url: 'https://chat.qwen.ai/',
    urlPrefixes: ['https://chat.qwen.ai', 'https://tongyi.aliyun.com', 'https://www.tongyi.com'],
    loginUrlFragments: ['/login'],
    loggedOutSelector: 'button:has-text("登录"), button:has-text("登 录")',
  },
  yuanbao: {
    url: 'https://yuanbao.tencent.com/',
    urlPrefixes: ['https://yuanbao.tencent.com'],
    loginUrlFragments: [],
    loggedOutSelector: 'button:has-text("登录"), button:has-text("登 录")',
  },
  kimi: {
    url: 'https://www.kimi.com/',
    urlPrefixes: ['https://www.kimi.com', 'https://kimi.moonshot.cn'],
    loginUrlFragments: [],
    loggedOutSelector: 'button:has-text("登录"), button:has-text("登 录")',
  },
} satisfies Record<string, SiteConnect>

export type MeetingModelName = keyof typeof SITE_CONNECT

export const ALL_MODELS = Object.keys(SITE_CONNECT) as MeetingModelName[]
