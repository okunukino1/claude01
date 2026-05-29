// サーバー（=最新デプロイ）のビルド情報を返す。
// クライアントは自分に焼き込まれた値と比較し、古ければ更新を促す。
// 必ず最新を返すためキャッシュ無効。
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    {
      commit: process.env.NEXT_PUBLIC_COMMIT || 'dev',
      buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || '',
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
