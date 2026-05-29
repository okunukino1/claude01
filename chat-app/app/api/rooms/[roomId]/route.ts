import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, avatarColor: true } } } },
    },
  })
  if (!room) return Response.json({ error: 'ルームが見つかりません' }, { status: 404 })

  return Response.json({ room })
}

// グループ名・説明の編集（管理者のみ）
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params
  const { name, description } = await request.json()

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })
  if (member.role !== 'admin') return Response.json({ error: 'グループ情報の編集は管理者のみできます' }, { status: 403 })

  if (!name || !name.trim()) return Response.json({ error: 'グループ名を入力してください' }, { status: 400 })

  const room = await prisma.room.update({
    where: { id: roomId },
    data: { name: name.trim(), description: description?.trim() || null },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, avatarColor: true } } } },
    },
  })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${roomId}`).emit('room_updated', { roomId, name: room.name, description: room.description })
  }

  return Response.json({ room })
}
