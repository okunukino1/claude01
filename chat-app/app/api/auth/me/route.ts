import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, displayName: true, avatarColor: true },
  })

  if (!user) return Response.json({ error: 'ユーザーが見つかりません' }, { status: 404 })
  return Response.json({ user })
}
