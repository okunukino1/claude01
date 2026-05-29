'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { Avatar } from '@/components/Avatar'
import { CreateRoomModal } from '@/components/CreateRoomModal'
import { SearchPanel } from '@/components/SearchPanel'
import { AiAnalysisModal } from '@/components/AiAnalysisModal'
import { ManageMembersModal } from '@/components/ManageMembersModal'
import { ProfileModal } from '@/components/ProfileModal'
import { ToastNotification, type ToastData } from '@/components/ToastNotification'
import { NotificationPanel } from '@/components/NotificationPanel'
import { useNotifications, subscribeToPush } from '@/hooks/useNotifications'

interface User { id: string; email: string; displayName: string; avatarColor: string }
interface Attachment { id: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string }
interface Reaction { id: string; userId: string; emoji: string }
interface Message {
  id: string; content: string; type: string; userId: string; roomId: string
  createdAt: string; updatedAt?: string; user: User; attachments: Attachment[]; reactions: Reaction[]
  replyTo?: { content: string; user: { displayName: string } } | null
}
interface RoomMember { userId: string; lastReadAt?: string | null; user: User }
interface Room {
  id: string; name: string; description?: string; isGroup: boolean
  members: RoomMember[]
  messages: Message[]
  updatedAt: string
  unreadCount?: number
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

function getRoomDisplayName(room: Room, currentUserId: string): string {
  if (room.isGroup) return room.name
  const other = room.members.find((m) => m.userId !== currentUserId)
  return other?.user?.displayName || room.name
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
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [imageViewer, setImageViewer] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const { requestPermission, notify, unlockAudio, permission } = useNotifications(roomId)
  const notifyRef = useRef(notify)
  useEffect(() => { notifyRef.current = notify }, [notify])

  // 通知許可済みなら起動時にWeb Push購読を登録（アプリ最小化中でも通知が届く）
  useEffect(() => {
    if (!token) return
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'granted') {
      subscribeToPush(token)
    }
  }, [token])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentRoomIdRef = useRef(roomId)
  const tokenRef = useRef(token)
  const userRef = useRef<User | null>(null)
  const roomsRef = useRef<Room[]>([])

  useEffect(() => { currentRoomIdRef.current = roomId }, [roomId])
  useEffect(() => { tokenRef.current = token }, [token])
  useEffect(() => { userRef.current = user }, [user])
  useEffect(() => { roomsRef.current = rooms }, [rooms])

  const authFetch = useCallback((url: string, opts?: RequestInit) => {
    const t = localStorage.getItem('auth_token') || token
    return fetch(url, { ...opts, headers: { ...(opts?.headers || {}), Authorization: `Bearer ${t}` } })
  }, [token])

  useEffect(() => {
    const t = localStorage.getItem('auth_token') || ''
    if (!t) { router.replace('/login'); return }
    setToken(t)
    tokenRef.current = t

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
    const sock = io({ auth: { token }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000 })
    setSocket(sock)
    socketRef.current = sock

    sock.on('connect', () => {
      setConnected(true)
      roomsRef.current.forEach((room) => sock.emit('join_room', room.id))
    })
    sock.on('disconnect', () => setConnected(false))

    sock.on('new_message', (msg: Message) => {
      // ① メッセージリスト更新
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })

      // ② ルーム一覧更新（pure updater — 副作用なし）
      setRooms((prev) =>
        prev
          .map((r) => {
            if (r.id !== msg.roomId) return r
            const isActiveRoom = msg.roomId === currentRoomIdRef.current
            const isOwnMsg = msg.userId === userRef.current?.id
            return {
              ...r,
              messages: [msg],
              updatedAt: msg.createdAt,
              unreadCount: (!isActiveRoom && !isOwnMsg) ? (r.unreadCount || 0) + 1 : r.unreadCount,
            }
          })
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      )

      // ③ 通知処理（updater の外で実行 — 副作用OK）
      const isOwnMessage = msg.userId === userRef.current?.id
      if (!isOwnMessage) {
        const room = roomsRef.current.find((r) => r.id === msg.roomId)
        const roomName = room ? getRoomDisplayName(room, userRef.current?.id || '') : 'チャット'

        // ブラウザ通知（Android Chrome でバックグラウンド時に機能）
        notifyRef.current(msg.user?.displayName || '誰か', msg.content || 'ファイルを送信しました', msg.roomId, roomName)

        // インアプリ トースト通知（iOS含む全プラットフォーム対応）
        const isCurrentRoom = msg.roomId === currentRoomIdRef.current
        const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
        if (!isCurrentRoom || !isVisible) {
          setToasts((prev) => [
            ...prev.slice(-2),
            {
              id: `${msg.id}-${Date.now()}`,
              senderName: msg.user?.displayName || '誰か',
              content: msg.content || 'ファイルを送信しました',
              roomId: msg.roomId,
              roomName,
              avatarColor: msg.user?.avatarColor || '#16a34a',
            },
          ])
        }

        // 初回メッセージ受信時にブラウザ通知権限を自動リクエスト（iOS以外）
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          requestPermission().then((granted) => {
            if (granted) subscribeToPush(localStorage.getItem('auth_token') || tokenRef.current)
          })
        }
      }

      // ④ 既読マーク（サーバー側で room_read をブロードキャスト）
      if (msg.roomId === currentRoomIdRef.current) {
        const t = localStorage.getItem('auth_token') || tokenRef.current
        fetch(`/api/rooms/${msg.roomId}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${t}` } })
      }
    })

    sock.on('message_deleted', ({ messageId }: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: 'このメッセージは削除されました', type: 'deleted' } : m
        )
      )
    })

    sock.on('reaction_updated', ({ messageId, reactions }: { messageId: string; reactions: Reaction[] }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m))
    })

    sock.on('message_edited', ({ messageId, content, updatedAt }: { messageId: string; content: string; updatedAt: string }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content, updatedAt } : m))
    })

    sock.on('room_read', ({ userId: readerId, roomId: rId, lastReadAt }: { userId: string; roomId: string; lastReadAt: string }) => {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== rId) return r
          return { ...r, members: r.members.map((m) => m.userId === readerId ? { ...m, lastReadAt } : m) }
        })
      )
    })

    sock.on('user_typing', ({ displayName }: { userId: string; displayName: string }) => {
      setTypingUsers((prev) => new Set([...prev, displayName]))
    })
    sock.on('user_stop_typing', () => setTypingUsers(new Set()))
    return () => { sock.disconnect() }
  }, [token])

  // 全ルームに参加してクロスルーム通知を受け取る
  // （現在表示中のルームだけに参加すると他ルームのメッセージが届かない）
  useEffect(() => {
    if (!socket || rooms.length === 0) return
    rooms.forEach((room) => socket.emit('join_room', room.id))
  }, [socket, rooms])

  useEffect(() => {
    if (!token || !roomId) return
    authFetch(`/api/rooms/${roomId}/messages`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => {})
    const room = rooms.find((r) => r.id === roomId)
    if (room) setCurrentRoom(room)
    setShowSidebar(false)
    setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, unreadCount: 0 } : r))

    authFetch(`/api/rooms/${roomId}/read`, { method: 'PUT' }).then(() => {
      const now = new Date().toISOString()
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== roomId || !userRef.current) return r
          return { ...r, members: r.members.map((m) => m.userId === userRef.current!.id ? { ...m, lastReadAt: now } : m) }
        })
      )
    })
  }, [roomId, token])

  useEffect(() => {
    const room = rooms.find((r) => r.id === roomId)
    if (room) setCurrentRoom(room)
  }, [rooms, roomId])

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

    await authFetch(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, replyToId }),
    })
  }

  async function deleteMessage(messageId: string) {
    setContextMenu(null)
    const res = await authFetch(`/api/messages/${messageId}`, { method: 'DELETE' })
    if (res.ok && socket) {
      socket.emit('delete_message', { roomId, messageId })
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, content: 'このメッセージは削除されました', type: 'deleted' } : m)
      )
    }
  }

  async function addReaction(messageId: string, emoji: string) {
    setShowReactionPicker(null)
    const res = await authFetch(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
    if (res.ok) {
      const data = await res.json()
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: data.reactions } : m))
    }
  }

  function startEditMessage(msg: Message) {
    setContextMenu(null)
    setEditingMessageId(msg.id)
    setEditingContent(msg.content)
  }

  async function saveEditMessage() {
    if (!editingMessageId) return
    const content = editingContent.trim()
    if (!content) return
    const res = await authFetch(`/api/messages/${editingMessageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (res.ok) {
      setMessages((prev) => prev.map((m) =>
        m.id === editingMessageId ? { ...m, content, updatedAt: new Date().toISOString() } : m
      ))
      setEditingMessageId(null)
      setEditingContent('')
    }
  }

  function copyMessage(content: string) {
    setContextMenu(null)
    navigator.clipboard.writeText(content).catch(() => {})
  }

  async function leaveRoom() {
    if (!confirm('このグループを退出しますか？')) return
    setShowMenu(false)
    const res = await authFetch(`/api/rooms/${roomId}/leave`, { method: 'DELETE' })
    if (res.ok) {
      setRooms((prev) => prev.filter((r) => r.id !== roomId))
      router.replace('/chat/welcome')
    }
  }

  async function startDM(otherUser: User) {
    setShowMembers(false)
    const existing = rooms.find((r) => !r.isGroup && r.members.some((m) => m.userId === otherUser.id))
    if (existing) { router.push(`/chat/${existing.id}`); return }
    const res = await authFetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: otherUser.displayName, memberIds: [otherUser.id] }),
    })
    const data = await res.json()
    if (data.room) {
      setRooms((prev) => [data.room, ...prev])
      router.push(`/chat/${data.room.id}`)
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
      await res.json()
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

  function navigateToRoom(id: string) {
    router.push(`/chat/${id}`)
    setShowSidebar(false)
  }

  function getReadCount(msg: Message): number {
    if (!currentRoom || !user) return 0
    return currentRoom.members.filter(
      (m) => m.userId !== user.id && m.lastReadAt && new Date(m.lastReadAt) >= new Date(msg.createdAt)
    ).length
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  function navigateFromToast(targetRoomId: string) {
    router.push(`/chat/${targetRoomId}`)
    setShowSidebar(false)
  }

  function handleTouchStart(e: React.TouchEvent, msg: Message) {
    if (msg.userId !== user?.id || msg.type === 'deleted') return
    const touch = e.touches[0]
    longPressTimerRef.current = setTimeout(() => {
      setContextMenu({ messageId: msg.id, x: touch.clientX, y: touch.clientY })
    }, 500)
  }

  function handleTouchEnd() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }

  function handleContextMenu(e: React.MouseEvent, msg: Message) {
    if (msg.userId !== user?.id || msg.type === 'deleted') return
    e.preventDefault()
    setContextMenu({ messageId: msg.id, x: e.clientX, y: e.clientY })
  }

  if (!user) return null

  const groupedMessages: { date: string; messages: Message[] }[] = []
  messages.forEach((msg) => {
    const date = new Date(msg.createdAt).toLocaleDateString('ja-JP')
    const last = groupedMessages[groupedMessages.length - 1]
    if (last?.date === date) last.messages.push(msg)
    else groupedMessages.push({ date, messages: [msg] })
  })

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white">
      <div className="p-3 border-b border-gray-200 safe-top">
        {showSearch ? (
          <SearchPanel token={token} onClose={() => setShowSearch(false)} />
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm">💬</span>
              </div>
              <span className="font-semibold text-gray-900">社内チャット</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSearch(true)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="検索">🔍</button>
              <button onClick={() => setShowCreateRoom(true)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="グループ作成">✏️</button>
            </div>
          </div>
        )}
      </div>

      {!showSearch && (
        <div className="flex-1 overflow-y-auto">
          {rooms.length === 0 && (
            <div className="p-6 text-center text-gray-400 text-sm">
              チャットがありません<br />
              <button onClick={() => setShowCreateRoom(true)} className="mt-2 text-green-600 font-medium">作成する</button>
            </div>
          )}
          {rooms.map((room) => {
            const lastMsg = room.messages?.[0]
            const isActive = room.id === roomId
            const displayName = getRoomDisplayName(room, user.id)
            return (
              <button
                key={room.id}
                onClick={() => navigateToRoom(room.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-100 transition-colors ${isActive ? 'bg-green-50 border-l-4 border-green-500' : 'hover:bg-gray-50'}`}
              >
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-xl">{room.isGroup ? '👥' : '👤'}</span>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-medium truncate ${(room.unreadCount || 0) > 0 && room.id !== roomId ? 'text-gray-900 font-semibold' : 'text-gray-900'}`}>{displayName}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {lastMsg && <span className="text-xs text-gray-400">{formatTime(lastMsg.createdAt)}</span>}
                      {(room.unreadCount || 0) > 0 && room.id !== roomId && (
                        <span className="bg-green-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold leading-none">
                          {(room.unreadCount || 0) > 99 ? '99+' : room.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {lastMsg && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {lastMsg.user?.displayName}: {lastMsg.content}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {!showSearch && (
        <>
          <div className="p-3 border-t border-gray-200 flex items-center gap-2 safe-bottom">
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2 flex-1 min-w-0 hover:bg-gray-50 rounded-lg p-1 -ml-1 text-left"
            >
              <Avatar displayName={user.displayName} avatarColor={user.avatarColor} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{user.displayName}</p>
                <p className="text-xs text-gray-400 truncate">タップして編集</p>
              </div>
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowNotifPanel(true)}
                title="通知の設定・診断"
                className="relative text-lg px-1"
              >
                🔔
                {permission.current !== 'granted' && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                )}
              </button>
              <button
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' })
                  localStorage.removeItem('auth_token')
                  router.replace('/login')
                }}
                className="text-xs text-gray-400 hover:text-red-500 px-1 py-1"
              >
                ログアウト
              </button>
            </div>
          </div>
          <div className="px-4 pb-1 flex items-center justify-between border-t border-gray-100">
            <span className="text-[10px] text-gray-300">
              {process.env.NEXT_PUBLIC_BUILD_TIME
                ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : 'build: ---'}
            </span>
            <span className="text-[10px] text-gray-300 font-mono">
              {process.env.NEXT_PUBLIC_COMMIT?.slice(0, 7) || '-------'}
            </span>
          </div>
        </>
      )}
    </div>
  )

  const chatContent = (
    <div className="flex flex-col h-full bg-white">
      {currentRoom ? (
        <>
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-200 bg-white safe-top">
            <button onClick={() => setShowSidebar(true)} className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex-shrink-0" aria-label="戻る">‹</button>
            <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span>{currentRoom.isGroup ? '👥' : '👤'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="font-semibold text-gray-900 truncate">{getRoomDisplayName(currentRoom, user.id)}</h2>
                <span title={connected ? '接続中' : '接続待機中'} className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
              </div>
              {currentRoom.isGroup && (
                <button onClick={() => setShowMembers(true)} className="text-xs text-green-600 hover:underline active:underline">
                  {currentRoom.members?.length}人のメンバー
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setShowAI(true)} className="hidden sm:flex px-2.5 py-1.5 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full font-medium items-center gap-1">✨ AI分析</button>
              <button onClick={() => setShowAI(true)} className="sm:hidden p-2 text-purple-600 hover:bg-purple-50 rounded-lg" aria-label="AI分析">✨</button>
              <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg text-lg leading-none">⋮</button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 min-w-[170px]">
                    <button onClick={() => exportChat('csv')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">📊 CSVエクスポート</button>
                    <button onClick={() => exportChat('json')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">📄 JSONエクスポート</button>
                    {currentRoom.isGroup && (
                      <button onClick={leaveRoom} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 active:bg-red-100">🚪 グループを退出</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 bg-gray-50"
            onClick={() => { setContextMenu(null); setShowMenu(false); setShowReactionPicker(null) }}
          >
            {groupedMessages.map(({ date, messages: msgs }) => (
              <div key={date}>
                <div className="flex items-center justify-center my-4">
                  <span className="text-xs text-gray-400 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">{date}</span>
                </div>
                {msgs.map((msg) => {
                  const isOwn = msg.userId === user.id
                  const isDeleted = msg.type === 'deleted'
                  const isEditing = editingMessageId === msg.id
                  const isEdited = !isDeleted && msg.updatedAt && Math.abs(new Date(msg.updatedAt).getTime() - new Date(msg.createdAt).getTime()) > 2000
                  const readCount = isOwn ? getReadCount(msg) : 0
                  // リアクションを絵文字ごとにまとめる
                  const reactionGroups = msg.reactions?.reduce((acc, r) => {
                    if (!acc[r.emoji]) acc[r.emoji] = []
                    acc[r.emoji].push(r.userId)
                    return acc
                  }, {} as Record<string, string[]>) || {}
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} gap-2 mb-1`}
                      onTouchStart={(e) => handleTouchStart(e, msg)}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchEnd}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                    >
                      {!isOwn && (
                        <Avatar displayName={msg.user?.displayName || '?'} avatarColor={msg.user?.avatarColor || '#999'} size="sm" />
                      )}
                      <div className={`max-w-[75%] sm:max-w-[65%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                        {!isOwn && (
                          <span className="text-xs text-gray-500 mb-0.5 ml-1">{msg.user?.displayName}</span>
                        )}
                        {msg.replyTo && (
                          <div className={`text-xs bg-white border-l-2 border-green-500 px-2 py-1.5 rounded-lg mb-1 text-gray-500 max-w-full ${isOwn ? 'self-end' : ''}`}>
                            <span className="font-medium">{msg.replyTo.user?.displayName}</span>: {msg.replyTo.content.slice(0, 50)}
                          </div>
                        )}
                        <div
                          className={`relative px-3 py-2 rounded-2xl text-sm break-words group ${
                            isDeleted
                              ? 'bg-gray-100 text-gray-400 italic border border-gray-200'
                              : isOwn
                                ? 'bg-green-500 text-white rounded-br-sm'
                                : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-sm'
                          }`}
                        >
                          {/* リアクションピッカー */}
                          {showReactionPicker === msg.id && (
                            <div
                              className={`absolute ${isOwn ? 'right-0' : 'left-0'} -top-11 bg-white border border-gray-200 rounded-2xl shadow-lg flex gap-1 px-2 py-1.5 z-20`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {['👍','❤️','😂','😮','😢','🙏'].map((emoji) => (
                                <button key={emoji} onClick={() => addReaction(msg.id, emoji)} className="text-xl hover:scale-125 transition-transform active:scale-110">
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                          {isDeleted ? (
                            <p className="text-xs">このメッセージは削除されました</p>
                          ) : isEditing ? (
                            <div className="flex flex-col gap-1 min-w-[180px]">
                              <textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className={`text-sm rounded-lg px-2 py-1 resize-none outline-none border ${isOwn ? 'bg-green-400 text-white border-green-300 placeholder-green-200' : 'bg-gray-50 text-gray-900 border-gray-300'}`}
                                rows={2}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMessage() }
                                  if (e.key === 'Escape') { setEditingMessageId(null); setEditingContent('') }
                                }}
                              />
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => { setEditingMessageId(null); setEditingContent('') }} className={`text-xs px-2 py-0.5 rounded ${isOwn ? 'text-green-100 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}>キャンセル</button>
                                <button onClick={saveEditMessage} className={`text-xs px-2 py-0.5 rounded-lg font-medium ${isOwn ? 'bg-white text-green-700' : 'bg-green-500 text-white'}`}>保存</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                              {isEdited && <span className={`text-[10px] ${isOwn ? 'text-green-200' : 'text-gray-400'}`}> 編集済み</span>}
                              {msg.attachments?.map((att) => (
                                <div key={att.id} className="mt-1">
                                  {att.mimeType?.startsWith('image/') ? (
                                    <img
                                      src={att.fileUrl}
                                      alt={att.fileName}
                                      className="max-w-full rounded-xl cursor-pointer"
                                      style={{ maxHeight: '240px', objectFit: 'cover' }}
                                      onClick={(e) => { e.stopPropagation(); setImageViewer(att.fileUrl) }}
                                    />
                                  ) : (
                                    <a href={att.fileUrl} download={att.fileName} className={`flex items-center gap-2 text-xs ${isOwn ? 'text-green-100' : 'text-blue-600'} hover:underline`}>
                                      📎 {att.fileName} ({formatFileSize(att.fileSize)})
                                    </a>
                                  )}
                                </div>
                              ))}
                              <button
                                onClick={(e) => { e.stopPropagation(); setContextMenu({ messageId: msg.id, x: e.clientX, y: e.clientY }) }}
                                className={`absolute -top-2 opacity-0 group-hover:opacity-100 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-xs text-gray-400 shadow-sm hidden sm:block ${isOwn ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'}`}
                              >
                                ⋮
                              </button>
                            </>
                          )}
                        </div>
                        {/* リアクション表示 */}
                        {Object.keys(reactionGroups).length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                            {Object.entries(reactionGroups).map(([emoji, userIds]) => (
                              <button
                                key={emoji}
                                onClick={() => addReaction(msg.id, emoji)}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                  userIds.includes(user.id)
                                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {emoji} <span className="font-medium">{userIds.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <div className={`flex items-center gap-1.5 mt-0.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <span className="text-xs text-gray-400">
                            {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {!isDeleted && (
                            <>
                              <button onClick={() => setReplyTo(msg)} className="text-xs text-gray-300 hover:text-gray-500 active:text-gray-500" aria-label="返信">↩</button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id) }}
                                className="text-xs text-gray-300 hover:text-gray-500 active:text-gray-500"
                                aria-label="リアクション"
                              >
                                😊
                              </button>
                            </>
                          )}
                          {isOwn && readCount > 0 && (
                            <span className="text-xs text-blue-400 font-medium">
                              既読{currentRoom.members.length > 2 ? readCount : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      {isOwn && (
                        <Avatar displayName={user.displayName} avatarColor={user.avatarColor} size="sm" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {typingUsers.size > 0 && (
              <div className="flex items-center gap-1 pl-2 py-1">
                <span className="text-xs text-gray-500">{[...typingUsers].join(', ')} が入力中...</span>
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="bg-white border-t border-gray-200 px-2 py-2 safe-bottom">
            {replyTo && (
              <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2 mb-2 border-l-2 border-green-500">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-green-700">{replyTo.user?.displayName} へ返信</span>
                  <p className="text-xs text-gray-600 truncate">{replyTo.content.slice(0, 60)}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">✕</button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="p-2.5 text-gray-400 hover:text-gray-600 active:text-gray-600 flex-shrink-0 rounded-full hover:bg-gray-100" aria-label="ファイル添付">
                {uploading ? '⏳' : '📎'}
              </button>
              <textarea
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力..."
                rows={1}
                className="flex-1 bg-gray-100 rounded-2xl px-4 py-2.5 text-sm resize-none outline-none max-h-32 overflow-y-auto leading-5"
                style={{ minHeight: '42px' }}
              />
              <button onClick={sendMessage} disabled={!input.trim()} className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 active:bg-green-700 disabled:opacity-40 flex-shrink-0 transition-colors" aria-label="送信">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center px-4">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-gray-500">チャットを選択してください</p>
            <button onClick={() => setShowCreateRoom(true)} className="mt-3 text-green-600 font-medium text-sm">グループを作成する</button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      <ToastNotification toasts={toasts} onDismiss={dismissToast} onNavigate={navigateFromToast} />

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div className="hidden md:flex h-screen bg-white overflow-hidden" onClick={unlockAudio}>
        <div className="w-72 flex-shrink-0 border-r border-gray-200">{sidebarContent}</div>
        <div className="flex-1 min-w-0">{chatContent}</div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div className="md:hidden h-screen overflow-hidden" onClick={unlockAudio}>
        <div style={{ display: showSidebar || !currentRoom ? 'block' : 'none' }} className="h-full absolute inset-0 z-10">
          {sidebarContent}
        </div>
        <div style={{ display: !showSidebar && currentRoom ? 'block' : 'none' }} className="h-full">
          {chatContent}
        </div>
        {!currentRoom && <div className="h-full">{sidebarContent}</div>}
      </div>

      {contextMenu && (() => {
        const ctxMsg = messages.find((m) => m.id === contextMenu.messageId)
        const isOwnMsg = ctxMsg?.userId === user.id
        return (
          <div
            className="fixed bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 min-w-[150px]"
            style={{ top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 200), left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 170) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { if (ctxMsg) setReplyTo(ctxMsg); setContextMenu(null) }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              ↩ 返信
            </button>
            {ctxMsg && ctxMsg.type !== 'deleted' && ctxMsg.content && (
              <button
                onClick={() => copyMessage(ctxMsg.content)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                📋 コピー
              </button>
            )}
            {isOwnMsg && ctxMsg?.type !== 'deleted' && (
              <button
                onClick={() => { if (ctxMsg) startEditMessage(ctxMsg) }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                ✏️ 編集
              </button>
            )}
            {isOwnMsg && (
              <button
                onClick={() => deleteMessage(contextMenu.messageId)}
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50"
              >
                🗑 削除
              </button>
            )}
          </div>
        )
      })()}

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
      {showMembers && currentRoom && (
        <ManageMembersModal
          roomId={roomId}
          roomName={getRoomDisplayName(currentRoom, user.id)}
          token={token}
          currentUserId={user.id}
          onClose={() => setShowMembers(false)}
          onStartDM={startDM}
        />
      )}
      {showAI && currentRoom && (
        <AiAnalysisModal
          roomId={roomId}
          roomName={currentRoom.name}
          token={token}
          onClose={() => setShowAI(false)}
        />
      )}
      {showNotifPanel && (
        <NotificationPanel
          token={localStorage.getItem('auth_token') || token}
          onClose={() => setShowNotifPanel(false)}
          onPermissionGranted={() => {
            permission.current = 'granted'
            subscribeToPush(localStorage.getItem('auth_token') || tokenRef.current)
          }}
        />
      )}
      {showProfile && (
        <ProfileModal
          user={user}
          token={token}
          onClose={() => setShowProfile(false)}
          onUpdated={(updatedUser) => {
            setUser(updatedUser)
            setShowProfile(false)
          }}
        />
      )}
      {(showMenu || contextMenu || showReactionPicker) && (
        <div className="fixed inset-0 z-0" onClick={() => { setShowMenu(false); setContextMenu(null); setShowReactionPicker(null) }} />
      )}

      {/* 画像ライトボックス */}
      {imageViewer && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setImageViewer(null)}
        >
          <img
            src={imageViewer}
            alt="拡大表示"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none"
            onClick={() => setImageViewer(null)}
          >
            ✕
          </button>
          <a
            href={imageViewer}
            download
            className="absolute bottom-4 right-4 bg-white/20 hover:bg-white/30 text-white text-sm px-3 py-1.5 rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            ⬇ ダウンロード
          </a>
        </div>
      )}
    </>
  )
}
