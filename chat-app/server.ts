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

  io.on('connection', (socket) => {
    const userId = socket.data.userId

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

    socket.on('typing', (data: { roomId: string; displayName: string }) => {
      socket.to(`room:${data.roomId}`).emit('user_typing', { userId, displayName: data.displayName })
    })

    socket.on('stop_typing', (data: { roomId: string }) => {
      socket.to(`room:${data.roomId}`).emit('user_stop_typing', { userId })
    })
  })

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
