'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { Avatar } from '@/components/Avatar'
import { CreateRoomModal } from '@/components/CreateRoomModal'
import { SearchPanel } from '@/components/SearchPanel'
import { AiAnalysisModal } from '@/components/AiAnalysisModal'

interface User { id: string; email: string; displayName: string; avatarColor: string }
interface Attachment { id: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string }
interface Reaction { id: string; userId: string; emoji: string }
interface Message {
  id: string; content: string; type: string; userId: string; roomId: string
  createdAt: string; user: User; attachments: Attachment[]; reactions: Reaction[]
  replyTo?: { content: string; user: { displayName: string } } | null
}
interface Room {
  id: string; name: string; description?: string; isGroup: boolean
  members: { userId: string; user: User }[]
  messages: Message[]
  updatedAt: string
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  if (diff < 7 * 86400000) return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function ChatRoomPage() {
  const router = useRouter()
  const params = useParams()
  const roomId = params.roomId as string

  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState('')
  const [rooms, setRooms] = useState<Room[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null)
  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authFetch = useCallback((url: string, opts?: RequestInit) => {
    const t = localStorage.getItem('auth_token') || token
    return fetch(url, { ...opts, headers: { ...(opts?.headers || {}), Authorization: `Bearer ${t}` } })
  }, [token])

  useEffect(() => {
    const t = localStorage.getItem('auth_token') || ''
    if (!t) { router.replace('/login'); return }
    setToken(t)

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setUser(d.user))
      .catch(() => router.replace('/login'))

    fetch('/api/rooms', { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => r.json())
      .then((d) => setRooms(d.rooms || []))
  }, [router])

  useEffect(() => {
    if (!token) return
    const sock = io({ auth: { token } })
    setSocket(sock)
    sock.on('new_message', (msg: Message) => {
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      setRooms((prev) => prev.map((r) => r.id === msg.roomId ? { ...r, messages: [msg], updatedAt: msg.createdAt } : r).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
    })
    sock.on('user_typing', ({ userId: uid, displayName }: { userId: string; displayName: string }) => {
      setTypingUsers((prev) => new Set([...prev, displayName]))
    })
    sock.on('user_stop_typing', () => setTypingUsers(new Set()))
    return () => { sock.disconnect() }
  }, [token])

  useEffect(() => {
    if (!socket || !roomId) return
    socket.emit('join_room', roomId)
    return () => { socket.emit('leave_room', roomId) }
  }, [socket, roomId])

  useEffect(() => {
    if (!token || !roomId) return
    authFetch(`/api/rooms/${roomId}/messages`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => {})
    const room = rooms.find((r) => r.id === roomId)
    if (room) setCurrentRoom(room)
  }, [roomId, token, rooms])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() && !replyTo) return
    const content = input.trim()
    setInput('')
    const replyToId = replyTo?.id
    setReplyTo(null)
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); socket?.emit('stop_typing', { roomId }) }

    const res = await authFetch(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, replyToId }),
    })
    const data = await res.json()
    if (data.message && socket) {
      socket.emit('send_message', { ...data.message, roomId })
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const upRes = await authFetch('/api/upload', { method: 'POST', body: formData })
      const upData = await upRes.json()
      if (!upRes.ok) return

      const isImage = file.type.startsWith('image/')
      const res = await authFetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: isImage ? '画像を送信しました' : `ファイル: ${file.name}`,
          type: isImage ? 'image' : 'file',
          attachments: [upData],
        }),
      })
      const data = await res.json()
      if (data.message && socket) socket.emit('send_message', { ...data.message, roomId })
    } finally {
      setUploading(false)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    if (socket && user) {
      socket.emit('typing', { roomId, displayName: user.displayName })
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => socket.emit('stop_typing', { roomId }), 2000)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  async function exportChat(format: 'csv' | 'json') {
    const res = await authFetch(`/api/rooms/${roomId}/export?format=${format}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentRoom?.name || roomId}.${format}`
    a.click()
    URL.revokeObjectURL(url)
    setShowMenu(false)
  }

  if (!user) return null

  const groupedMessages: { date: string; messages: Message[] }[] = []
  messages.forEach((msg) => {
    const date = new Date(msg.createdAt).toLocaleDateString('ja-JP')
    const last = groupedMessages[groupedMessages.length - 1]
    if (last?.date === date) last.messages.push(msg)
    else groupedMessages.push({ date, messages: [msg] })
  })

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* サイドバー */}
      <div className={`${showSearch ? 'w-80' : 'w-72'} flex-shrink-0 bg-white border-r border-gray-200 flex flex-col`}>
        {/* ヘッダー */}
        <div className="p-3 border-b border-gray-200">
          {showSearch ? (
            <SearchPanel token={token} onClose={() => setShowSearch(false)} />
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm">💬</span>
                </div>
                <span className="font-semibold text-gray-900 text-sm">社内チャット</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowSearch(true)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="検索">
                  🔍
                </button>
                <button onClick={() => setShowCreateRoom(true)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="グループ作成">
                  ✏️
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ルーム一覧 */}
        {!showSearch && (
          <div className="flex-1 overflow-y-auto">
            {rooms.length === 0 && (
              <div className="p-4 text-center text-gray-400 text-sm">
                グループがありません<br />
                <button onClick={() => setShowCreateRoom(true)} className="mt-2 text-green-600 font-medium">作成する</button>
              </div>
            )}
            {rooms.map((room) => {
              const lastMsg = room.messages?.[0]
              const isActive = room.id === roomId
              return (
                <button
                  key={room.id}
                  onClick={() => router.push(`/chat/${room.id}`)}
                  className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-gray-50 transition-colors ${isActive ? 'bg-green-50 border-l-2 border-green-500' : ''}`}
                >
                  <div className="w-11 h-11 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">{room.isGroup ? '👥' : '👤'}</span>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900 truncate">{room.name}</span>
                      {lastMsg && <span className="text-xs text-gray-400 flex-shrink-0 ml-1">{formatTime(lastMsg.createdAt)}</span>}
                    </div>
                    {lastMsg && (
                      <p className="text-xs text-gray-500 truncate">
                        {lastMsg.user?.displayName}: {lastMsg.content}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* ユーザー情報 */}
        {!showSearch && (
          <div className="p-3 border-t border-gray-200 flex items-center gap-2">
            <Avatar displayName={user.displayName} avatarColor={user.avatarColor} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{user.displayName}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                localStorage.removeItem('auth_token')
                router.replace('/login')
              }}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              ログアウト
            </button>
          </div>
        )}
      </div>

      {/* メインチャット */}
      <div className="flex-1 flex flex-col min-w-0">
        {currentRoom ? (
          <>
            {/* チャットヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center">
                  <span>{currentRoom.isGroup ? '👥' : '👤'}</span>
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">{currentRoom.name}</h2>
                  <p className="text-xs text-gray-500">{currentRoom.members?.length}人のメンバー</p>
                </div>
              </div>
              <div className="flex items-center gap-1 relative">
                <button onClick={() => setShowAI(true)} className="px-3 py-1.5 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full font-medium" title="AI分析">
                  ✨ AI分析
                </button>
                <div className="relative">
                  <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                    ⋮
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 min-w-[160px]">
                      <button onClick={() => exportChat('csv')} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">📊 CSVエクスポート</button>
                      <button onClick={() => exportChat('json')} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">📄 JSONエクスポート</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* メッセージエリア */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gray-50">
              {groupedMessages.map(({ date, messages: msgs }) => (
                <div key={date}>
                  <div className="flex items-center justify-center my-3">
                    <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-200">{date}</span>
                  </div>
                  {msgs.map((msg) => {
                    const isOwn = msg.userId === user.id
                    return (
                      <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} gap-2 mb-1`}>
                        {!isOwn && <Avatar displayName={msg.user?.displayName || '?'} avatarColor={msg.user?.avatarColor || '#999'} size="sm" />}
                        <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                          {!isOwn && <span className="text-xs text-gray-500 mb-0.5 ml-1">{msg.user?.displayName}</span>}
                          {msg.replyTo && (
                            <div className={`text-xs bg-gray-100 border-l-2 border-green-500 px-2 py-1 rounded mb-1 text-gray-500 ${isOwn ? 'self-end' : ''}`}>
                              {msg.replyTo.user?.displayName}: {msg.replyTo.content.slice(0, 50)}
                            </div>
                          )}
                          <div
                            className={`relative group px-3 py-2 rounded-2xl text-sm ${
                              isOwn
                                ? 'bg-green-500 text-white rounded-br-sm'
                                : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-sm'
                            }`}
                          >
                            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                            {msg.attachments?.map((att) => (
                              <div key={att.id} className="mt-1">
                                {att.mimeType?.startsWith('image/') ? (
                                  <img src={att.fileUrl} alt={att.fileName} className="max-w-xs rounded-lg cursor-pointer" onClick={() => window.open(att.fileUrl)} />
                                ) : (
                                  <a href={att.fileUrl} download={att.fileName} className={`flex items-center gap-2 text-xs ${isOwn ? 'text-green-100' : 'text-blue-600'} hover:underline`}>
                                    📎 {att.fileName} ({formatFileSize(att.fileSize)})
                                  </a>
                                )}
                              </div>
                            ))}
                            <div className="absolute hidden group-hover:flex items-center gap-1 -top-6 right-0 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 shadow-sm">
                              {['👍', '❤️', '😂', '🙏'].map((emoji) => (
                                <button key={emoji} onClick={() => {}} className="text-xs hover:scale-125 transition-transform">{emoji}</button>
                              ))}
                              <button onClick={() => setReplyTo(msg)} className="text-xs text-gray-500 hover:text-gray-700 px-1">返信</button>
                            </div>
                          </div>
                          <span className={`text-xs text-gray-400 mt-0.5 ${isOwn ? 'text-right' : ''}`}>
                            {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {isOwn && <Avatar displayName={user.displayName} avatarColor={user.avatarColor} size="sm" />}
                      </div>
                    )
                  })}
                </div>
              ))}
              {typingUsers.size > 0 && (
                <div className="flex items-center gap-2 pl-2">
                  <span className="text-xs text-gray-500">{[...typingUsers].join(', ')} が入力中...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 入力エリア */}
            <div className="bg-white border-t border-gray-200 px-3 py-2">
              {replyTo && (
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-2 text-xs text-gray-600 border-l-2 border-green-500">
                  <span className="font-medium">返信: {replyTo.user?.displayName}</span>
                  <span className="truncate">{replyTo.content.slice(0, 60)}</span>
                  <button onClick={() => setReplyTo(null)} className="ml-auto text-gray-400 hover:text-gray-600">✕</button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {uploading ? '⏳' : '📎'}
                </button>
                <textarea
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="メッセージを入力... (Shift+Enterで改行)"
                  rows={1}
                  className="flex-1 bg-gray-100 rounded-2xl px-4 py-2.5 text-sm resize-none outline-none max-h-32 overflow-y-auto"
                  style={{ minHeight: '40px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="w-9 h-9 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 disabled:opacity-40 flex-shrink-0"
                >
                  ➤
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <p className="text-gray-500">チャットを選択してください</p>
              <button onClick={() => setShowCreateRoom(true)} className="mt-3 text-green-600 font-medium text-sm hover:underline">グループを作成する</button>
            </div>
          </div>
        )}
      </div>

      {/* モーダル */}
      {showCreateRoom && (
        <CreateRoomModal
          token={token}
          currentUserId={user.id}
          onClose={() => setShowCreateRoom(false)}
          onCreated={(room) => {
            setRooms((prev) => [room, ...prev])
            setShowCreateRoom(false)
            router.push(`/chat/${room.id}`)
          }}
        />
      )}
      {showAI && currentRoom && (
        <AiAnalysisModal roomId={roomId} roomName={currentRoom.name} token={token} onClose={() => setShowAI(false)} />
      )}

      {showMenu && <div className="fixed inset-0 z-0" onClick={() => setShowMenu(false)} />}
    </div>
  )
}
