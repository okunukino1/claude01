import { getVapidPublicKey } from '@/lib/push'

export async function GET() {
  try {
    const publicKey = await getVapidPublicKey()
    return Response.json({ publicKey })
  } catch {
    return Response.json({ error: 'プッシュ通知の設定に失敗しました' }, { status: 500 })
  }
}
