import { spawn } from 'child_process'

export async function notifyMeetingDone(title: string, summaryPath: string): Promise<void> {
  const message = `会议已完成：${title}\n${summaryPath}`
  if (process.platform !== 'win32') {
    console.log(`[notify] ${message}`)
    return
  }

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
