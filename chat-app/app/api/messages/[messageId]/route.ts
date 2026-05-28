import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { messageId } = await params

  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message) return Response.json({ error: 'メッセージが見つかりません' }, { status: 404 })
  if (message.userId !== auth.userId) return Response.json({ error: '削除権限がありません' }, { status: 403 })

  await prisma.message.delete({ where: { id: messageId } })
  return Response.json({ ok: true })
}
