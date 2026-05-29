import webpush from 'web-push'
import { prisma } from '@/lib/prisma'

// VAPIDキーをDBに保存して自動生成する。
// これにより Render の環境変数を手動設定しなくてもプッシュ通知が動作する。
let configured = false
let cachedPublicKey: string | null = null

async function ensureVapid(): Promise<string> {
  if (configured && cachedPublicKey) return cachedPublicKey

  // 環境変数が設定されていればそれを優先（任意）
  let publicKey = process.env.VAPID_PUBLIC_KEY || null
  let privateKey = process.env.VAPID_PRIVATE_KEY || null

  if (!publicKey || !privateKey) {
    // DBから取得、なければ生成して保存
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ['vapid_public_key', 'vapid_private_key'] } },
    })
    publicKey = rows.find((r) => r.key === 'vapid_public_key')?.value || null
    privateKey = rows.find((r) => r.key === 'vapid_private_key')?.value || null

    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys()
      publicKey = keys.publicKey
      privateKey = keys.privateKey
      await prisma.appSetting.upsert({
        where: { key: 'vapid_public_key' },
        create: { key: 'vapid_public_key', value: publicKey },
        update: { value: publicKey },
      })
      await prisma.appSetting.upsert({
        where: { key: 'vapid_private_key' },
        create: { key: 'vapid_private_key', value: privateKey },
        update: { value: privateKey },
      })
    }
  }

  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  cachedPublicKey = publicKey
  return publicKey
}

export async function getVapidPublicKey(): Promise<string> {
  return ensureVapid()
}

interface PushPayload {
  title: string
  body: string
  roomId: string
  tag?: string
}

// 指定ユーザー全員（の全デバイス）にプッシュ送信する。
// 失効した購読は自動削除する。
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return
  await ensureVapid()

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  })
  if (subs.length === 0) return

  const data = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data
        )
      } catch (err: any) {
        // 404/410 は購読が失効しているので削除
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
      }
    })
  )
}
