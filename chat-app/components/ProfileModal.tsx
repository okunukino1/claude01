'use client'
import { useState } from 'react'
import { Avatar } from './Avatar'

interface User { id: string; email: string; displayName: string; avatarColor: string }

interface Props {
  user: User
  token: string
  onClose: () => void
  onUpdated: (user: User) => void
}

const AVATAR_COLORS = [
  '#4F46E5', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#059669', '#65a30d', '#9333ea',
]

export function ProfileModal({ user, token, onClose, onUpdated }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [avatarColor, setAvatarColor] = useState(user.avatarColor)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!displayName.trim()) { setError('名前を入力してください'); return }
    setSaving(true)
    setError('')
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: displayName.trim(), avatarColor }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      onUpdated(data.user)
    } else {
      setError(data.error || 'エラーが発生しました')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-900">プロフィール編集</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: avatarColor }}>
              {(displayName || user.displayName).charAt(0).toUpperCase()}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">表示名</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="表示名を入力..."
              maxLength={30}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">アバターカラー</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setAvatarColor(color)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${avatarColor === color ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-500">メール: {user.email}</div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="p-4 border-t flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
