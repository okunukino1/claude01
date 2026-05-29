import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 招待コードを取得（なければ生成）
export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const room = await prisma.room.findUnique({ where: { id: roomId } })
  if (!room) return Response.json({ error: 'ルームが見つかりません' }, { status: 404 })
  if (!room.isGroup) return Response.json({ error: 'DMには招待リンクを作成できません' }, { status: 400 })

  let code = room.inviteCode
  if (!code) {
    code = randomBytes(9).toString('base64url')
    await prisma.room.update({ where: { id: roomId }, data: { inviteCode: code } })
  }

  return Response.json({ code })
}

// 招待コードを無効化して新しいものを生成（管理者のみ）
export async function PUT(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })
  const { roomId } = await params

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member || member.role !== 'admin') {
    return Response.json({ error: 'リンクの再発行は管理者のみできます' }, { status: 403 })
  }

  const code = randomBytes(9).toString('base64url')
  await prisma.room.update({ where: { id: roomId }, data: { inviteCode: code } })

  return Response.json({ code })
}
