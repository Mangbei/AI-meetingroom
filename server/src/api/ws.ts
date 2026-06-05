import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server } from 'http'
import type { WSEvent } from '../orchestrator/debate.js'
import type { MeetingEvent } from '../meeting/meeting.js'

export type WsEvent = WSEvent | MeetingEvent
export type WsClients = Map<string, Set<(event: WsEvent) => void>>

export function attachWebSocket(server: Server): WsClients {
  // No `path` option: ws's path option is a strict match, but we want to
  // accept any /ws/debates/:id path. The regex below does the routing.
  const wss = new WebSocketServer({ server })
  const clients: WsClients = new Map()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // expect path like /ws/debates/:id or /ws/meetings/:id
    const match = req.url?.match(/\/ws\/(?:debates|meetings)\/([^/]+)/)
    if (!match) {
      ws.close(1008, 'invalid path')
      return
    }
    const debateId = match[1]

    if (!clients.has(debateId)) clients.set(debateId, new Set())
    const emit = (event: WsEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    }
    clients.get(debateId)!.add(emit)

    ws.on('close', () => {
      clients.get(debateId)?.delete(emit)
    })

    ws.on('error', () => {
      clients.get(debateId)?.delete(emit)
    })
  })

  return clients
}
