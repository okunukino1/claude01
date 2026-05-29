import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// プッシュ購読を登録する
export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const sub = await request.json()
  const endpoint: string | undefined = sub?.endpoint
  const p256dh: string | undefined = sub?.keys?.p256dh
  const authKey: string | undefined = sub?.keys?.auth

  if (!endpoint || !p256dh || !authKey) {
    return Response.json({ error: '購読情報が不正です' }, { status: 400 })
  }

  // 同じendpointが既に存在する場合は所有ユーザーを更新（端末の使い回し対応）
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: auth.userId, endpoint, p256dh, auth: authKey },
    update: { userId: auth.userId, p256dh, auth: authKey },
  })

  return Response.json({ ok: true })
}

// プッシュ購読を解除する
export async function DELETE(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { endpoint } = await request.json().catch(() => ({ endpoint: null }))
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: auth.userId } })
  }
  return Response.json({ ok: true })
}
