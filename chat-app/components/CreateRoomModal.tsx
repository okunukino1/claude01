'use client'
import { useState, useEffect } from 'react'

interface User { id: string; displayName: string; email: string; avatarColor: string }

interface Props {
  onClose: () => void
  onCreated: (room: any) => void
  currentUserId: string
  token: string
}

export function CreateRoomModal({ onClose, onCreated, currentUserId, token }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setUsers(d.users.filter((u: User) => u.id !== currentUserId)))
  }, [token, currentUserId])

  const filtered = users.filter(
    (u) => u.displayName.includes(search) || u.email.includes(search)
  )

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleCreate() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, description, memberIds: selectedIds }),
      })
      const data = await res.json()
      if (res.ok) onCreated(data.room)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-900">グループを作成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            type="text"
            placeholder="グループ名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="text"
            placeholder="説明（任意）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="text"
            placeholder="メンバーを検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filtered.map((u) => (
              <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(u.id)}
                  onChange={() => toggle(u.id)}
                  className="accent-green-500"
                />
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                  style={{ backgroundColor: u.avatarColor }}
                >
                  {u.displayName.charAt(0)}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{u.displayName}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </div>
              </label>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <p className="text-xs text-gray-500">{selectedIds.length}人選択中</p>
          )}
        </div>
        <div className="flex gap-2 p-4 border-t">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">キャンセル</button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50"
          >
            {loading ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
