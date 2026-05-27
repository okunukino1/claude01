import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()
  const roomId = searchParams.get('roomId')

  if (!query) return Response.json({ results: [] })

  const userRooms = await prisma.roomMember.findMany({
    where: { userId: auth.userId },
    select: { roomId: true },
  })
  const accessibleRoomIds = userRooms.map((m) => m.roomId)

  const messages = await prisma.message.findMany({
    where: {
      roomId: roomId ? { equals: roomId } : { in: accessibleRoomIds },
      content: { contains: query },
    },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      room: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return Response.json({ results: messages, query })
}
