import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ピン留めをトグルする（ルームメンバーなら誰でも可）
export async function POST(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { messageId } = await params

  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message) return Response.json({ error: 'メッセージが見つかりません' }, { status: 404 })

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId: message.roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { pinned: !message.pinned },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
  })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${message.roomId}`).emit('message_pinned', { messageId, pinned: updated.pinned, message: updated, roomId: message.roomId })
  }

  return Response.json({ pinned: updated.pinned, message: updated })
}
