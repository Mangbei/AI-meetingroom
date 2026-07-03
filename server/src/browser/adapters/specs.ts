import type { SiteSpec } from './generic.js'

/**
 * Best-effort selector specs for web AIs driven by the GenericWebChatAdapter.
 *
 * These are written from each site's known DOM shape but CANNOT be verified
 * against a live login from this environment. If a site has redesigned, the
 * adapter's preflight() check will skip that model with a clear "missing
 * inputBox" message — update the selectors here and re-run. Keeping every
 * site's selectors in this one file makes that maintenance a single-file edit.
 */

const STOP_BUTTON_COMMON = 'button[aria-label*="Stop"], button[aria-label*="停止"], [class*="stop"][role="button"], [class*="cancel"][role="button"]'

export const CLAUDE_SPEC: SiteSpec = {
  name: 'claude',
  homeUrl: 'https://claude.ai/new',
  urlPrefixes: ['https://claude.ai'],
  // Claude uses a ProseMirror contenteditable; fill() doesn't reliably trigger
  // its editor state, so type via keyboard.
  inputBox: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
  inputMode: 'type',
  sendButton: 'button[aria-label*="Send"], button[aria-label*="发送"]',
  stopButton: 'button[aria-label*="Stop"]',
  newChatButton: 'a[href="/new"], a[aria-label*="New chat"], button[aria-label*="New chat"]',
  fileInput: 'input[type="file"]',
  responseContainers: ['div.font-claude-message', '[data-testid*="message"]', '.prose'],
}

export const DOUBAO_SPEC: SiteSpec = {
  name: 'doubao',
  homeUrl: 'https://www.doubao.com/chat/',
  urlPrefixes: ['https://www.doubao.com'],
  inputBox: 'textarea[data-testid*="chat_input"], div[contenteditable="true"][data-testid*="input"], textarea, div[contenteditable="true"]',
  sendButton: 'button[data-testid*="send"], button[aria-label*="发送"], #flow-end-msg-send',
  stopButton: STOP_BUTTON_COMMON,
  newChatButton: '[data-testid*="create_conversation"], button:has-text("新对话"), button:has-text("新建对话")',
  fileInput: 'input[type="file"]',
  responseContainers: ['[data-testid*="message_text_content"]', '[data-testid*="receive_message"]', '[class*="message-content"]', '[class*="markdown"]'],
}

export const ZHIPU_SPEC: SiteSpec = {
  name: 'zhipu',
  homeUrl: 'https://chatglm.cn/main/alltoolsdetail',
  // 智谱清言改版较频繁；主路径找不到输入框时依次尝试这些入口。
  fallbackUrls: ['https://chatglm.cn/main/guest', 'https://chatglm.cn/'],
  urlPrefixes: ['https://chatglm.cn'],
  inputBox: 'textarea, div[contenteditable="true"]',
  // 清言 send control is an icon button; fall back to Enter when not matched.
  sendButton: 'button[class*="send"], [class*="enter"][role="button"], img[src*="send"]',
  stopButton: STOP_BUTTON_COMMON,
  newChatButton: 'button:has-text("新建对话"), [class*="new-chat"], [class*="newChat"]',
  fileInput: 'input[type="file"]',
  responseContainers: ['.markdown-body', '[class*="answer"] [class*="markdown"]', '[class*="assistant"]', '[class*="markdown"]'],
}

export const QWEN_SPEC: SiteSpec = {
  name: 'qwen',
  homeUrl: 'https://chat.qwen.ai/',
  fallbackUrls: ['https://www.tongyi.com/'],
  urlPrefixes: ['https://chat.qwen.ai', 'https://tongyi.aliyun.com', 'https://www.tongyi.com'],
  inputBox: 'textarea#chat-input, textarea, div[contenteditable="true"]',
  sendButton: '#send-message-button, button[class*="send"], button[aria-label*="发送"]',
  stopButton: STOP_BUTTON_COMMON,
  newChatButton: 'button:has-text("新对话"), button:has-text("新建对话"), [class*="new-chat"]',
  fileInput: 'input[type="file"]',
  responseContainers: ['[class*="response-message"]', '.tongyi-markdown', '[class*="markdown"]', '[class*="assistant"]'],
}

export const YUANBAO_SPEC: SiteSpec = {
  name: 'yuanbao',
  homeUrl: 'https://yuanbao.tencent.com/',
  urlPrefixes: ['https://yuanbao.tencent.com'],
  inputBox: 'div[contenteditable="true"], textarea',
  inputMode: 'type',
  sendButton: '[class*="send"][role="button"], button[class*="send-btn"], [class*="icon-send"]',
  stopButton: STOP_BUTTON_COMMON,
  newChatButton: '[class*="new-chat"], button:has-text("新建对话"), [class*="create"]',
  fileInput: 'input[type="file"]',
  responseContainers: ['[class*="agent-chat__bubble--ai"]', '[class*="hyc-content"]', '[class*="agent-chat__bubble"]', '[class*="markdown"]'],
}

export const KIMI_SPEC: SiteSpec = {
  name: 'kimi',
  homeUrl: 'https://www.kimi.com/',
  fallbackUrls: ['https://kimi.moonshot.cn/'],
  urlPrefixes: ['https://www.kimi.com', 'https://kimi.moonshot.cn'],
  inputBox: '.chat-input-editor, div[contenteditable="true"], textarea',
  inputMode: 'type',
  sendButton: '[class*="send-button"], button[class*="send"]',
  stopButton: STOP_BUTTON_COMMON,
  newChatButton: 'button:has-text("开启新对话"), [class*="new-chat"], [class*="newChat"]',
  fileInput: 'input[type="file"]',
  responseContainers: ['.segment-content-box', '.segment-content', '[class*="markdown"]', '[class*="assistant"]'],
}
