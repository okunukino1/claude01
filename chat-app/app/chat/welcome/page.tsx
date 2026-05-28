'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface User { id: string; displayName: string; avatarColor: string; email: string }

export default function WelcomePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.replace('/login'); return }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setUser(d.user))
      .catch(() => router.replace('/login'))
  }, [router])

  async function createRoom() {
    if (!name.trim()) return
    setLoading(true)
    const token = localStorage.getItem('auth_token') || ''
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: name.trim(), memberIds: [] }),
    })
    const data = await res.json()
    if (data.room) router.push(`/chat/${data.room.id}`)
    else setLoading(false)
  }

  if (!user) return null

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8 text-center">
        <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-white text-2xl">💬</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">
          ようこそ、{user.displayName}さん！
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          最初のグループを作成して始めましょう
        </p>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="グループ名（例：営業チーム）"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createRoom()}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            autoFocus
          />
          <button
            onClick={createRoom}
            disabled={!name.trim() || loading}
            className="w-full bg-green-500 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            {loading ? '作成中...' : 'グループを作成して始める'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-4">
          後からメンバーを追加できます
        </p>
      </div>
    </div>
  )
}
