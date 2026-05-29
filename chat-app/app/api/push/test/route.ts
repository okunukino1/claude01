import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUsers } from '@/lib/push'

// 自分自身にテストプッシュを送る（バックグラウンド通知の動作確認用）
export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const count = await prisma.pushSubscription.count({ where: { userId: auth.userId } })
  if (count === 0) {
    return Response.json({ error: 'この端末はまだプッシュ通知に登録されていません' }, { status: 400 })
  }

  await sendPushToUsers([auth.userId], {
    title: 'テスト通知 ✅',
    body: 'バックグラウンド通知が届いています！設定完了です。',
    roomId: '',
    tag: 'push-test',
  })

  return Response.json({ ok: true, devices: count })
}
