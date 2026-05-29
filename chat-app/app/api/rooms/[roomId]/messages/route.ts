import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { searchParams } = request.nextUrl
  const cursor = searchParams.get('cursor')
  const limit = 50

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const messages = await prisma.message.findMany({
    where: { roomId },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages

  return Response.json({ messages: result.reverse(), hasMore, nextCursor: hasMore ? result[0].id : null })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { content, type = 'text', replyToId, attachments } = await request.json()

  if (!content && (!attachments || attachments.length === 0)) {
    return Response.json({ error: 'メッセージを入力してください' }, { status: 400 })
  }

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const message = await prisma.message.create({
    data: {
      content: content || '',
      type,
      userId: auth.userId,
      roomId,
      replyToId: replyToId || null,
      ...(attachments?.length ? { attachments: { create: attachments } } : {}),
    },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
  })

  await prisma.room.update({ where: { id: roomId }, data: { updatedAt: new Date() } })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${roomId}`).emit('new_message', message)
  }

  return Response.json({ message }, { status: 201 })
}
