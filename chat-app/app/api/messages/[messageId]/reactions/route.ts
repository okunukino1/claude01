import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// リアクションをトグル（押したら追加、もう一度押したら削除）
export async function POST(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { messageId } = await params
  const { emoji } = await request.json()

  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message) return Response.json({ error: 'メッセージが見つかりません' }, { status: 404 })

  const existing = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: auth.userId, emoji } },
  })

  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.reaction.create({ data: { messageId, userId: auth.userId, emoji } })
  }

  const reactions = await prisma.reaction.findMany({ where: { messageId } })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${message.roomId}`).emit('reaction_updated', { messageId, reactions, roomId: message.roomId })
  }

  return Response.json({ reactions })
}
