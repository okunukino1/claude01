import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params

  await prisma.roomMember.deleteMany({
    where: { userId: auth.userId, roomId },
  })

  return Response.json({ ok: true })
}
