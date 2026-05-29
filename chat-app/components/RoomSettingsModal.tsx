'use client'
import { useState } from 'react'

interface Props {
  room: { id: string; name: string; description?: string; isGroup: boolean }
  token: string
  isAdmin: boolean
  onClose: () => void
  onUpdated: (name: string, description: string) => void
}

export function RoomSettingsModal({ room, token, isAdmin, onClose, onUpdated }: Props) {
  const [name, setName] = useState(room.name)
  const [description, setDescription] = useState(room.description || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [inviteUrl, setInviteUrl] = useState('')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [copied, setCopied] = useState(false)

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...(opts?.headers || {}), Authorization: `Bearer ${token}` } })

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    setMessage('')
    const res = await authFetch(`/api/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    })
    const data = await res.json()
    if (res.ok) {
      onUpdated(data.room.name, data.room.description || '')
      setMessage('保存しました')
      setTimeout(() => setMessage(''), 2000)
    } else {
      setMessage(data.error || 'エラーが発生しました')
    }
    setSaving(false)
  }

  async function generateInvite(regenerate = false) {
    setGeneratingInvite(true)
    const res = await authFetch(`/api/rooms/${room.id}/invite`, { method: regenerate ? 'PUT' : 'POST' })
    const data = await res.json()
    if (res.ok && data.code) {
      setInviteUrl(`${window.location.origin}/invite/${data.code}`)
    } else {
      setMessage(data.error || 'リンクの生成に失敗しました')
    }
    setGeneratingInvite(false)
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h2 className="font-semibold text-gray-900">グループ設定</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-5">
          {/* グループ名・説明 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">グループ情報</h3>
            {!isAdmin && (
              <p className="text-xs text-gray-400">※ 編集は管理者のみできます</p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">グループ名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明（任意）</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!isAdmin}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            {message && (
              <p className={`text-xs ${message === '保存しました' ? 'text-green-600' : 'text-red-500'}`}>{message}</p>
            )}
            {isAdmin && (
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="w-full bg-green-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            )}
          </div>

          {/* 招待リンク */}
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">招待リンク</h3>
            <p className="text-xs text-gray-400">このリンクを知っている人は誰でもグループに参加できます。</p>
            {inviteUrl ? (
              <>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs bg-gray-50 text-gray-600"
                  />
                  <button
                    onClick={copyInvite}
                    className="bg-green-500 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-600 flex-shrink-0"
                  >
                    {copied ? '✓ コピー済' : 'コピー'}
                  </button>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => generateInvite(true)}
                    disabled={generatingInvite}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    🔄 リンクを再発行（古いリンクは無効になります）
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => generateInvite(false)}
                disabled={generatingInvite}
                className="w-full border border-green-500 text-green-600 py-2 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50"
              >
                {generatingInvite ? '生成中...' : '🔗 招待リンクを作成'}
              </button>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex-shrink-0">
          <button onClick={onClose} className="w-full border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
