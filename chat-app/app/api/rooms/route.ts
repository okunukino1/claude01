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

  // 各ルームの未読メッセージ数を1クエリで取得
  type UnreadRow = { roomId: string; count: bigint }
  const unreadRows = await prisma.$queryRaw<UnreadRow[]>`
    SELECT m."roomId", COUNT(*) as count
    FROM "Message" m
    JOIN "RoomMember" rm ON rm."roomId" = m."roomId" AND rm."userId" = ${auth.userId}
    WHERE m."userId" != ${auth.userId}
      AND (rm."lastReadAt" IS NULL OR m."createdAt" > rm."lastReadAt")
    GROUP BY m."roomId"
  `
  const unreadMap: Record<string, number> = {}
  for (const row of unreadRows) unreadMap[row.roomId] = Number(row.count)

  const roomsWithUnread = rooms.map((r) => ({ ...r, unreadCount: unreadMap[r.id] || 0 }))

  return Response.json({ rooms: roomsWithUnread })
}

export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { name, description, memberIds, isGroup: explicitIsGroup } = await request.json()
  if (!name) return Response.json({ error: 'グループ名を入力してください' }, { status: 400 })

  const allMemberIds = Array.from(new Set([auth.userId, ...(memberIds || [])]))
  // 明示的に指定がある場合はそれを使う。なければ「2人ちょうど」のみDM扱い
  const isGroup = explicitIsGroup !== undefined ? Boolean(explicitIsGroup) : allMemberIds.length !== 2

  const room = await prisma.room.create({
    data: {
      name,
      description,
      isGroup,
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
