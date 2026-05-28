import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, displayName: true, avatarColor: true, email: true } } },
  })

  return Response.json({ members })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { userId } = await request.json()

  const requester = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!requester) {
    return Response.json({ error: 'このグループのメンバーではありません' }, { status: 403 })
  }

  const member = await prisma.roomMember.create({
    data: { userId, roomId },
    include: { user: { select: { id: true, displayName: true, avatarColor: true } } },
  })

  return Response.json({ member }, { status: 201 })
}
