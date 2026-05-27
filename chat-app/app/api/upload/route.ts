import { NextRequest } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: NextRequest) {
  const auth = getUserFromRequest(request)
  if (!auth) return Response.json({ error: '認証が必要です' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return Response.json({ error: 'ファイルが見つかりません' }, { status: 400 })

  const maxSize = 20 * 1024 * 1024
  if (file.size > maxSize) {
    return Response.json({ error: 'ファイルサイズは20MB以下にしてください' }, { status: 400 })
  }

  const ext = path.extname(file.name)
  const fileName = `${uuidv4()}${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads')

  await mkdir(uploadDir, { recursive: true })
  const bytes = await file.arrayBuffer()
  await writeFile(path.join(uploadDir, fileName), Buffer.from(bytes))

  return Response.json({
    fileName: file.name,
    fileUrl: `/uploads/${fileName}`,
    fileSize: file.size,
    mimeType: file.type,
  })
}
