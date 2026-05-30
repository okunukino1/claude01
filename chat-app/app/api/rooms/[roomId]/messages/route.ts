import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUsers } from '@/lib/push'

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { searchParams } = request.nextUrl
  const cursor = searchParams.get('cursor')
  const limit = 50

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const messages = await prisma.message.findMany({
    where: { roomId },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages

  // ピン留めメッセージ（最初のページ取得時のみ返す）
  const pinned = cursor ? [] : await prisma.message.findMany({
    where: { roomId, pinned: true },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({ messages: result.reverse(), hasMore, nextCursor: hasMore ? result[0].id : null, pinned })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { content, type = 'text', replyToId, attachments } = await request.json()

  if (!content && (!attachments || attachments.length === 0)) {
    return Response.json({ error: 'メッセージを入力してください' }, { status: 400 })
  }

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const message = await prisma.message.create({
    data: {
      content: content || '',
      type,
      userId: auth.userId,
      roomId,
      replyToId: replyToId || null,
      ...(attachments?.length ? { attachments: { create: attachments } } : {}),
    },
    include: {
      user: { select: { id: true, displayName: true, avatarColor: true } },
      attachments: true,
      reactions: true,
      replyTo: { include: { user: { select: { displayName: true } } } },
    },
  })

  await prisma.room.update({ where: { id: roomId }, data: { updatedAt: new Date() } })

  const io = (global as any).__io
  if (io) {
    io.to(`room:${roomId}`).emit('new_message', message)
  }

  // バックグラウンド（アプリ最小化/終了時）でも通知が届くようWeb Pushを送信。
  // 送信者以外のルームメンバー全員に送る。レスポンスはブロックしない。
  ;(async () => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: {
          name: true,
          isGroup: true,
          members: {
            select: {
              userId: true,
              muteNotifications: true,
              user: { select: { displayName: true } },
            },
          },
        },
      })
      if (!room) return

      const senderName = message.user?.displayName || '誰か'
      const roomLabel = room.isGroup ? room.name : senderName
      const bodyText = type === 'image' ? '画像を送信しました' : type === 'file' ? 'ファイルを送信しました' : (content || '')

      // @メンションされた表示名を抽出
      const mentionedNames = new Set(
        ((content || '').match(/@(\S+)/g) || []).map((m: string) => m.slice(1))
      )

      const allRecipients = room.members.filter((m) => m.userId !== auth.userId)

      // ミュートしていないユーザー、またはメンションされたユーザーに送信
      const recipientIds = allRecipients
        .filter((m) => !m.muteNotifications || mentionedNames.has(m.user?.displayName || ''))
        .map((m) => m.userId)

      if (recipientIds.length === 0) return

      const hasMention = mentionedNames.size > 0
      const title = hasMention
        ? `📣 ${senderName} があなたをメンションしました`
        : room.isGroup ? `${senderName} — ${roomLabel}` : senderName

      await sendPushToUsers(recipientIds, {
        title,
        body: bodyText.length > 80 ? bodyText.slice(0, 80) + '...' : bodyText,
        roomId,
        tag: roomId,
      })
    } catch {}
  })()

  return Response.json({ message }, { status: 201 })
}
