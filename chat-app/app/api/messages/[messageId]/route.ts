import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { messageId } = await params
  const { content, roomId } = await request.json()

  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message) return Response.json({ error: 'メッセージが見つかりません' }, { status: 404 })
  if (message.userId !== auth.userId) return Response.json({ error: '編集権限がありません' }, { status: 403 })

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content: content.trim() },
  })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${message.roomId}`).emit('message_edited', {
      messageId,
      content: updated.content,
      updatedAt: updated.updatedAt.toISOString(),
      roomId: message.roomId,
    })
  }

  return Response.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { messageId } = await params

  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message) return Response.json({ error: 'メッセージが見つかりません' }, { status: 404 })
  if (message.userId !== auth.userId) return Response.json({ error: '削除権限がありません' }, { status: 403 })

  await prisma.message.delete({ where: { id: messageId } })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${message.roomId}`).emit('message_deleted', { messageId, roomId: message.roomId })
  }

  return Response.json({ ok: true })
}
