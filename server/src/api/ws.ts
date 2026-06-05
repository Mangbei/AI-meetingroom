import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server } from 'http'
import type { MeetingEvent } from '../meeting/meeting.js'

export type WsClients = Map<string, Set<(event: MeetingEvent) => void>>

export function attachWebSocket(server: Server): WsClients {
  // No `path` option: ws's path option is a strict match, but we want to
  // accept any /ws/meetings/:id path. The regex below does the routing.
  const wss = new WebSocketServer({ server })
  const clients: WsClients = new Map()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // expect path like /ws/meetings/:id
    const match = req.url?.match(/\/ws\/meetings\/([^/]+)/)
    if (!match) {
      ws.close(1008, 'invalid path')
      return
    }
    const meetingId = match[1]

    if (!clients.has(meetingId)) clients.set(meetingId, new Set())
    const emit = (event: MeetingEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    }
    clients.get(meetingId)!.add(emit)

    ws.on('close', () => {
      clients.get(meetingId)?.delete(emit)
    })

    ws.on('error', () => {
      clients.get(meetingId)?.delete(emit)
    })
  })

  return clients
}
