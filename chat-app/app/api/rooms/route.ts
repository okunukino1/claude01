import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const rooms = await prisma.room.findMany({
    where: { members: { some: { userId: auth.userId } } },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, avatarColor: true } } } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { user: { select: { displayName: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return Response.json({ rooms })
}

export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { name, description, memberIds } = await request.json()
  if (!name) return Response.json({ error: 'グループ名を入力してください' }, { status: 400 })

  const allMemberIds = Array.from(new Set([auth.userId, ...(memberIds || [])]))

  const room = await prisma.room.create({
    data: {
      name,
      description,
      isGroup: allMemberIds.length > 2,
      members: {
        create: allMemberIds.map((uid: string) => ({
          userId: uid,
          role: uid === auth.userId ? 'admin' : 'member',
        })),
      },
    },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, avatarColor: true } } } },
    },
  })

  return Response.json({ room }, { status: 201 })
}
