'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface RoomInfo { id: string; name: string; description?: string; memberCount: number }

export default function InvitePage() {
  const router = useRouter()
  const params = useParams()
  const code = params.code as string

  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      // ログイン後に戻ってこられるよう招待先を保存
      sessionStorage.setItem('invite_redirect', `/invite/${code}`)
      router.replace('/login')
      return
    }

    fetch(`/api/invite/${code}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        if (d.alreadyMember) { router.replace(`/chat/${d.room.id}`); return }
        setRoom(d.room)
      })
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [code, router])

  async function join() {
    setJoining(true)
    const token = localStorage.getItem('auth_token')
    const res = await fetch(`/api/invite/${code}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok) router.replace(`/chat/${data.roomId}`)
    else { setError(data.error || '参加に失敗しました'); setJoining(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
        {loading ? (
          <p className="text-gray-400 py-8">読み込み中...</p>
        ) : error ? (
          <>
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⚠️</span>
            </div>
            <p className="text-gray-700 mb-4">{error}</p>
            <button onClick={() => router.replace('/chat/welcome')} className="text-green-600 font-medium text-sm">チャットに戻る</button>
          </>
        ) : room ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">👥</span>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 mb-1">{room.name}</h1>
            {room.description && <p className="text-sm text-gray-500 mb-1">{room.description}</p>}
            <p className="text-xs text-gray-400 mb-6">{room.memberCount}人のメンバー</p>
            <button
              onClick={join}
              disabled={joining}
              className="w-full bg-green-500 text-white py-3 rounded-xl font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {joining ? '参加中...' : 'このグループに参加'}
            </button>
            <button onClick={() => router.replace('/chat/welcome')} className="w-full mt-2 text-gray-400 text-sm py-2">
              キャンセル
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
