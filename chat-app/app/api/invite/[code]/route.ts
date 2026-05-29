import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 招待コードからルーム情報を取得（参加前のプレビュー用）
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { code } = await params

  const room = await prisma.room.findUnique({
    where: { inviteCode: code },
    include: { _count: { select: { members: true } } },
  })
  if (!room) return Response.json({ error: '招待リンクが無効です' }, { status: 404 })

  const alreadyMember = await prisma.roomMember.findUnique({
    where: { userId_roomId: { userId: auth.userId, roomId: room.id } },
  })

  return Response.json({
    room: { id: room.id, name: room.name, description: room.description, memberCount: room._count.members },
    alreadyMember: !!alreadyMember,
  })
}

// 招待コードを使ってルームに参加
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { code } = await params

  const room = await prisma.room.findUnique({ where: { inviteCode: code } })
  if (!room) return Response.json({ error: '招待リンクが無効です' }, { status: 404 })

  const existing = await prisma.roomMember.findUnique({
    where: { userId_roomId: { userId: auth.userId, roomId: room.id } },
  })
  if (existing) return Response.json({ roomId: room.id, alreadyMember: true })

  await prisma.roomMember.create({ data: { userId: auth.userId, roomId: room.id, role: 'member' } })

  // 参加したことを既存メンバーに通知（メンバーリスト更新用）
  const io = (global as any).__io
  if (io) {
    const newMember = await prisma.roomMember.findUnique({
      where: { userId_roomId: { userId: auth.userId, roomId: room.id } },
      include: { user: { select: { id: true, displayName: true, avatarColor: true } } },
    })
    io.to(`room:${room.id}`).emit('member_joined', { roomId: room.id, member: newMember })
  }

  return Response.json({ roomId: room.id, alreadyMember: false })
}
