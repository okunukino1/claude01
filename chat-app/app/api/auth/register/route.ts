import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const { email, password, displayName } = await request.json()

  if (!email || !password || !displayName) {
    return Response.json({ error: '全項目を入力してください' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return Response.json({ error: 'このメールアドレスは既に使用されています' }, { status: 409 })
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const colors = ['#4F46E5', '#7C3AED', '#DB2777', '#D97706', '#059669', '#0284C7']
  const avatarColor = colors[Math.floor(Math.random() * colors.length)]

  const user = await prisma.user.create({
    data: { email, password: hashedPassword, displayName, avatarColor },
  })

  const token = signToken({ userId: user.id, email: user.email })

  return Response.json(
    { user: { id: user.id, email: user.email, displayName: user.displayName, avatarColor: user.avatarColor } },
    {
      status: 201,
      headers: { 'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}` },
    }
  )
}
