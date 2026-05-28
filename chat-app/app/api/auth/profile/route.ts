import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { displayName, avatarColor } = await request.json()
  if (!displayName?.trim()) return Response.json({ error: '名前を入力してください' }, { status: 400 })

  const user = await prisma.user.update({
    where: { id: auth.userId },
    data: { displayName: displayName.trim(), ...(avatarColor ? { avatarColor } : {}) },
    select: { id: true, email: true, displayName: true, avatarColor: true },
  })

  return Response.json({ user })
}
