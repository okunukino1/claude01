import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId, type = 'summary' } = await request.json()

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const room = await prisma.room.findUnique({ where: { id: roomId } })
  const messages = await prisma.message.findMany({
    where: { roomId },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  if (messages.length === 0) {
    return Response.json({ result: 'メッセージがありません' })
  }

  const transcript = messages
    .map((m) => `[${m.createdAt.toLocaleString('ja-JP')}] ${m.user.displayName}: ${m.content}`)
    .join('\n')

  const prompts: Record<string, string> = {
    summary: `以下の「${room?.name}」グループのチャット履歴を要約してください。\n\n主なトピック、決定事項、アクションアイテムを箇条書きでまとめてください。\n\n---\n${transcript}`,
    tasks: `以下のチャット履歴から、タスク・TODO・アクションアイテムを抽出してください。\n担当者と期限が明記されているものは含めてください。箇条書きで出力してください。\n\n---\n${transcript}`,
    decisions: `以下のチャット履歴から、意思決定事項・合意事項を抽出してください。箇条書きで出力してください。\n\n---\n${transcript}`,
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 })
  }

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompts[type] || prompts.summary }],
  })

  const result = response.content[0].type === 'text' ? response.content[0].text : ''

  return Response.json({ result, type, roomName: room?.name })
}
