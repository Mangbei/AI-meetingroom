import { spawn } from 'child_process'

export async function notifyMeetingDone(title: string, summaryPath: string): Promise<void> {
  const message = `会议已完成：${title}\n${summaryPath}`
  console.log(`[notify] ${message}`)

  if (process.platform === 'darwin') {
    await notifyMac(title, summaryPath)
    return
  }
  if (process.platform === 'win32') {
    await notifyWindows(message)
    return
  }
  // Linux / other: the console log above is the notification.
}

// macOS native banner via osascript. Notifications don't render newlines, so
// the summary path goes in the subtitle.
async function notifyMac(title: string, summaryPath: string): Promise<void> {
  const script = `display notification ${JSON.stringify(`会议已完成：${title}`)} with title "AI Meeting Room" subtitle ${JSON.stringify(summaryPath)}`
  await new Promise<void>(resolve => {
    const child = spawn('osascript', ['-e', script], { stdio: 'ignore' })
    child.on('close', () => resolve())
    child.on('error', err => {
      console.warn('[notify] macOS notification failed:', err.message)
      resolve()
    })
  })
}

async function notifyWindows(message: string): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = 'AI Meeting Room'
$n.BalloonTipText = ${JSON.stringify(message)}
$n.Visible = $true
$n.ShowBalloonTip(7000)
Start-Sleep -Seconds 8
$n.Dispose()
`

  await new Promise<void>(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('close', () => resolve())
    child.on('error', err => {
      console.warn('[notify] desktop notification failed:', err.message)
      resolve()
    })
  })
}
