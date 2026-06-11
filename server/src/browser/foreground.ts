import type { Page } from 'playwright'

/**
 * By default the controlled browser runs quietly in the background: we never
 * raise its window or activate its tabs, so it won't steal focus while you work
 * in another app. Playwright still drives the pages (type, click, read) without
 * them being foregrounded.
 *
 * Set MEETINGROOM_FOREGROUND=1 to restore the old "bring each tab to front"
 * behavior (useful for debugging what a model is doing live).
 */
export const FOREGROUND = process.env.MEETINGROOM_FOREGROUND === '1'

export async function maybeBringToFront(page: Page): Promise<void> {
  if (!FOREGROUND) return
  await page.bringToFront().catch(() => {})
}
