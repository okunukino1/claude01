import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'
import jwt from 'jsonwebtoken'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)
const JWT_SECRET = process.env.JWT_SECRET || 'chat-app-secret-key-change-in-production'

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  })
  ;(global as any).__io = io

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }
      socket.data.userId = payload.userId
      socket.data.email = payload.email
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  // オンライン状態の管理（userId -> 接続数）。複数タブ・端末対応のためカウント方式。
  const onlineUsers = new Map<string, number>()

  io.on('connection', (socket) => {
    const userId = socket.data.userId

    // オンライン登録
    onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1)
    io.emit('presence_update', Array.from(onlineUsers.keys()))

    socket.on('join_room', (roomId: string) => {
      socket.join(`room:${roomId}`)
    })

    socket.on('leave_room', (roomId: string) => {
      socket.leave(`room:${roomId}`)
    })

    socket.on('send_message', (data: { roomId: string; messageId: string; content: string; type: string; userId: string; user: object; attachments: object[]; createdAt: string }) => {
      io.to(`room:${data.roomId}`).emit('new_message', data)
    })

    socket.on('add_reaction', (data: { roomId: string; messageId: string; emoji: string; userId: string }) => {
      io.to(`room:${data.roomId}`).emit('reaction_updated', data)
    })

    socket.on('delete_message', (data: { roomId: string; messageId: string }) => {
      io.to(`room:${data.roomId}`).emit('message_deleted', { messageId: data.messageId, roomId: data.roomId })
    })

    socket.on('mark_read', (data: { roomId: string; userId: string; lastReadAt: string }) => {
      socket.to(`room:${data.roomId}`).emit('room_read', data)
    })

    socket.on('typing', (data: { roomId: string; displayName: string }) => {
      socket.to(`room:${data.roomId}`).emit('user_typing', { userId, displayName: data.displayName })
    })

    socket.on('stop_typing', (data: { roomId: string }) => {
      socket.to(`room:${data.roomId}`).emit('user_stop_typing', { userId })
    })

    socket.on('disconnect', () => {
      const remaining = (onlineUsers.get(userId) || 1) - 1
      if (remaining <= 0) onlineUsers.delete(userId)
      else onlineUsers.set(userId, remaining)
      io.emit('presence_update', Array.from(onlineUsers.keys()))
    })
  })

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
