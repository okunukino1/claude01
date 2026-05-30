import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params

  const member = await prisma.roomMember.findUnique({
    where: { userId_roomId: { userId: auth.userId, roomId } },
  })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const updated = await prisma.roomMember.update({
    where: { userId_roomId: { userId: auth.userId, roomId } },
    data: { muteNotifications: !member.muteNotifications },
  })

  return Response.json({ muteNotifications: updated.muteNotifications })
}
