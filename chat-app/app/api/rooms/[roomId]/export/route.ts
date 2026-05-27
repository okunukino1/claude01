import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const { roomId } = await params
  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') || 'json'

  const member = await prisma.roomMember.findUnique({ where: { userId_roomId: { userId: auth.userId, roomId } } })
  if (!member) return Response.json({ error: 'アクセス権限がありません' }, { status: 403 })

  const room = await prisma.room.findUnique({ where: { id: roomId } })
  const messages = await prisma.message.findMany({
    where: { roomId },
    include: {
      user: { select: { displayName: true, email: true } },
      attachments: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (format === 'csv') {
    const header = 'datetime,sender,email,content,attachments\n'
    const rows = messages.map((m) => {
      const dt = m.createdAt.toISOString()
      const name = m.user.displayName.replace(/"/g, '""')
      const email = m.user.email
      const content = m.content.replace(/"/g, '""')
      const files = m.attachments.map((a) => a.fileName).join(';')
      return `"${dt}","${name}","${email}","${content}","${files}"`
    })
    const csv = header + rows.join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${room?.name || roomId}.csv"`,
      },
    })
  }

  const data = {
    room: { id: room?.id, name: room?.name, description: room?.description },
    exportedAt: new Date().toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      datetime: m.createdAt,
      sender: m.user.displayName,
      email: m.user.email,
      content: m.content,
      type: m.type,
      attachments: m.attachments,
    })),
  }

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${room?.name || roomId}.json"`,
    },
  })
}
