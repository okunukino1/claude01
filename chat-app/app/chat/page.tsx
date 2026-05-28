'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ChatPage() {
  const router = useRouter()
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.replace('/login'); return }
    fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.rooms?.length > 0) {
          router.replace(`/chat/${d.rooms[0].id}`)
        } else {
          router.replace('/chat/welcome')
        }
      })
      .catch(() => router.replace('/chat/welcome'))
  }, [router])

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-white text-2xl">💬</span>
        </div>
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    </div>
  )
}
