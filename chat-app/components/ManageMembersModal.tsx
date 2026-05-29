'use client'
import { useState, useEffect } from 'react'
import { Avatar } from '@/components/Avatar'

interface User { id: string; displayName: string; email: string; avatarColor: string }
interface Member { id: string; userId: string; role: string; user: User }

interface Props {
  roomId: string
  roomName: string
  token: string
  currentUserId: string
  onlineUserIds?: Set<string>
  onClose: () => void
  onStartDM?: (user: User) => void
}

export function ManageMembersModal({ roomId, roomName, token, currentUserId, onlineUserIds, onClose, onStartDM }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...(opts?.headers || {}), Authorization: `Bearer ${token}` } })

  useEffect(() => {
    authFetch(`/api/rooms/${roomId}/members`)
      .then(r => r.json())
      .then(d => setMembers(d.members || []))

    authFetch('/api/users')
      .then(r => r.json())
      .then(d => setAllUsers(d.users || []))
  }, [roomId])

  const memberUserIds = new Set(members.map(m => m.userId))
  const filtered = allUsers.filter(u =>
    !memberUserIds.has(u.id) &&
    (u.displayName.includes(search) || u.email.includes(search))
  )

  async function addMember(userId: string) {
    setAdding(true)
    setMessage('')
    const res = await authFetch(`/api/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    if (res.ok) {
      setMembers(prev => [...prev, data.member])
      setMessage('追加しました')
      setTimeout(() => setMessage(''), 2000)
    } else {
      setMessage(data.error || 'エラーが発生しました')
    }
    setAdding(false)
  }

  const myRole = members.find(m => m.userId === currentUserId)?.role
  const isAdmin = myRole === 'admin'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h2 className="font-semibold text-gray-900">メンバー管理 — {roomName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* 現在のメンバー */}
          <div className="p-4 border-b">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">現在のメンバー（{members.length}人）</h3>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <Avatar displayName={m.user.displayName} avatarColor={m.user.avatarColor} size="sm" />
                    {onlineUserIds?.has(m.userId) && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {m.user.displayName}
                      {onlineUserIds?.has(m.userId) && <span className="text-[10px] text-green-600 ml-1">●オンライン</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                  </div>
                  {m.role === 'admin' && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex-shrink-0">管理者</span>
                  )}
                  {m.userId !== currentUserId && onStartDM && (
                    <button
                      onClick={() => onStartDM(m.user)}
                      className="text-xs bg-blue-500 text-white px-2.5 py-1 rounded-full hover:bg-blue-600 flex-shrink-0"
                    >
                      DM
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* メンバー追加（管理者のみ） */}
          {isAdmin && (
            <div className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">メンバーを追加</h3>
              <input
                type="text"
                placeholder="名前またはメールで検索..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-2"
              />
              {message && (
                <p className={`text-xs mb-2 ${message === '追加しました' ? 'text-green-600' : 'text-red-500'}`}>{message}</p>
              )}
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filtered.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {search ? '該当するユーザーがいません' : '追加できるユーザーがいません'}
                  </p>
                )}
                {filtered.map(u => (
                  <div key={u.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                    <Avatar displayName={u.displayName} avatarColor={u.avatarColor} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{u.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    <button
                      onClick={() => addMember(u.id)}
                      disabled={adding}
                      className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-full hover:bg-green-600 disabled:opacity-50 flex-shrink-0"
                    >
                      追加
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isAdmin && (
            <p className="p-4 text-sm text-gray-500 text-center">メンバーの追加は管理者のみできます</p>
          )}
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
