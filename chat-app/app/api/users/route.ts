import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')?.trim()

  const users = await prisma.user.findMany({
    where: query
      ? { OR: [{ displayName: { contains: query } }, { email: { contains: query } }] }
      : undefined,
    select: { id: true, displayName: true, email: true, avatarColor: true },
    take: 20,
  })

  return Response.json({ users })
}
