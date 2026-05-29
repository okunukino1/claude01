import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params

  const now = new Date()
  await prisma.roomMember.updateMany({
    where: { userId: auth.userId, roomId },
    data: { lastReadAt: now },
  })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${roomId}`).emit('room_read', {
      userId: auth.userId,
      roomId,
      lastReadAt: now.toISOString(),
    })
  }

  return Response.json({ ok: true })
}

