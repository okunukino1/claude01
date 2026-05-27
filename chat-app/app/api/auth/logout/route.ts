export async function POST() {
  return Response.json(
    { message: 'ログアウトしました' },
    { headers: { 'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Max-Age=0' } }
  )
}
