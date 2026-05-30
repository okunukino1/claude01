'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { Avatar } from '@/components/Avatar'
import { CreateRoomModal } from '@/components/CreateRoomModal'
import { SearchPanel } from '@/components/SearchPanel'
import { AiAnalysisModal } from '@/components/AiAnalysisModal'
import { ManageMembersModal } from '@/components/ManageMembersModal'
import { RoomSettingsModal } from '@/components/RoomSettingsModal'
import { EmojiPicker } from '@/components/EmojiPicker'
import { ProfileModal } from '@/components/ProfileModal'
import { ToastNotification, type ToastData } from '@/components/ToastNotification'
import { NotificationPanel } from '@/components/NotificationPanel'
import { InstallPrompt } from '@/components/InstallPrompt'
import { useNotifications, subscribeToPush } from '@/hooks/useNotifications'

interface User { id: string; email: string; displayName: string; avatarColor: string }
interface Attachment { id: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string }
interface Reaction { id: string; userId: string; emoji: string }
interface Message {
  id: string; content: string; type: string; userId: string; roomId: string; replyToId?: string | null
  createdAt: string; updatedAt?: string; pinned?: boolean; user: User; attachments: Attachment[]; reactions: Reaction[]
  replyTo?: { id?: string; content: string; user: { displayName: string } } | null
}
interface RoomMember { userId: string; role?: string; lastReadAt?: string | null; muteNotifications?: boolean; user: User }
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
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showRoomSettings, setShowRoomSettings] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const oldestCursorRef = useRef<string | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prependingRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const [isStandalone, setIsStandalone] = useState(true)
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const mentionStartRef = useRef(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const sa = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
    setIsStandalone(sa)
  }, [])
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
        const myMembership = room?.members.find((m) => m.userId === userRef.current?.id)
        const isMuted = myMembership?.muteNotifications ?? false

        // メンションされているか確認
        const myName = userRef.current?.displayName || ''
        const isMentioned = myName ? (msg.content || '').includes(`@${myName}`) : false

        // ミュート中でもメンションされた場合は通知する
        if (!isMuted || isMentioned) {
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
                senderName: isMentioned ? `📣 ${msg.user?.displayName || '誰か'}` : (msg.user?.displayName || '誰か'),
                content: msg.content || 'ファイルを送信しました',
                roomId: msg.roomId,
                roomName,
                avatarColor: msg.user?.avatarColor || '#16a34a',
              },
            ])
          }
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

    sock.on('presence_update', (userIds: string[]) => {
      setOnlineUsers(new Set(userIds))
    })

    sock.on('message_pinned', ({ messageId, pinned, message }: { messageId: string; pinned: boolean; message: Message }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinned } : m))
      setPinnedMessages((prev) => {
        if (pinned) {
          if (prev.find((m) => m.id === messageId)) return prev
          return [message, ...prev]
        }
        return prev.filter((m) => m.id !== messageId)
      })
    })

    sock.on('room_updated', ({ roomId: rId, name, description }: { roomId: string; name: string; description: string }) => {
      setRooms((prev) => prev.map((r) => r.id === rId ? { ...r, name, description } : r))
      setCurrentRoom((prev) => prev && prev.id === rId ? { ...prev, name, description } : prev)
    })

    sock.on('member_joined', ({ roomId: rId, member }: { roomId: string; member: RoomMember }) => {
      setRooms((prev) => prev.map((r) => {
        if (r.id !== rId) return r
        if (r.members.find((m) => m.userId === member.userId)) return r
        return { ...r, members: [...r.members, member] }
      }))
      setCurrentRoom((prev) => {
        if (!prev || prev.id !== rId) return prev
        if (prev.members.find((m) => m.userId === member.userId)) return prev
        return { ...prev, members: [...prev.members, member] }
      })
    })

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
      .then((d) => {
        setMessages(d.messages || [])
        setPinnedMessages(d.pinned || [])
        oldestCursorRef.current = d.nextCursor || null
        setHasMoreOlder(!!d.hasMore)
      })
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
    // 過去ログを先頭に追加したときはスクロール位置を維持（下端に飛ばさない）
    if (prependingRef.current) {
      const c = messagesContainerRef.current
      if (c) c.scrollTop = c.scrollHeight - prevScrollHeightRef.current
      prependingRef.current = false
      return
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadOlderMessages() {
    if (loadingOlder || !hasMoreOlder || !oldestCursorRef.current) return
    setLoadingOlder(true)
    const c = messagesContainerRef.current
    prevScrollHeightRef.current = c?.scrollHeight || 0
    try {
      const res = await authFetch(`/api/rooms/${roomId}/messages?cursor=${oldestCursorRef.current}`)
      const data = await res.json()
      if (data.messages?.length) {
        prependingRef.current = true
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id))
          const older = data.messages.filter((m: Message) => !ids.has(m.id))
          return [...older, ...prev]
        })
        oldestCursorRef.current = data.nextCursor || null
        setHasMoreOlder(!!data.hasMore)
      } else {
        setHasMoreOlder(false)
      }
    } finally {
      setLoadingOlder(false)
    }
  }

  function handleMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop < 80 && hasMoreOlder && !loadingOlder) {
      loadOlderMessages()
    }
  }

  async function sendMessage() {
    if (!input.trim()) return
    const content = input.trim()
    setInput('')
    setShowMentionDropdown(false)
    const replyToId = replyTo?.id
    setReplyTo(null)
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); socket?.emit('stop_typing', { roomId }) }

    await authFetch(`/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, replyToId }),
    })
  }

  async function toggleMute() {
    setShowMenu(false)
    const res = await authFetch(`/api/rooms/${roomId}/mute`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      const update = (members: RoomMember[]) =>
        members.map((m) => m.userId === user!.id ? { ...m, muteNotifications: data.muteNotifications } : m)
      setCurrentRoom((prev) => prev ? { ...prev, members: update(prev.members) } : prev)
      setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, members: update(r.members) } : r))
    }
  }

  function insertMention(displayName: string) {
    const before = input.slice(0, mentionStartRef.current)
    const after = input.slice(mentionStartRef.current + 1 + mentionQuery.length)
    const newVal = `${before}@${displayName} ${after}`
    setInput(newVal)
    setShowMentionDropdown(false)
    setMentionQuery('')
    textareaRef.current?.focus()
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

  async function togglePin(messageId: string) {
    setContextMenu(null)
    const res = await authFetch(`/api/messages/${messageId}/pin`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinned: data.pinned } : m))
      setPinnedMessages((prev) => {
        if (data.pinned) {
          if (prev.find((m) => m.id === messageId)) return prev
          return [data.message, ...prev]
        }
        return prev.filter((m) => m.id !== messageId)
      })
    }
  }

  function insertEmoji(emoji: string) {
    setInput((prev) => prev + emoji)
  }

  function scrollToMessage(messageId: string) {
    const el = document.getElementById(`msg-${messageId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-yellow-300', 'rounded-2xl')
      setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-300', 'rounded-2xl'), 1500)
    }
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
    const val = e.target.value
    setInput(val)

    // メンション検出: カーソル位置より前の最後の @ を探す
    const cursor = e.target.selectionStart ?? val.length
    const textBefore = val.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')
    if (atIdx !== -1) {
      const query = textBefore.slice(atIdx + 1)
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query)
        setShowMentionDropdown(true)
        mentionStartRef.current = atIdx
      } else {
        setShowMentionDropdown(false)
      }
    } else {
      setShowMentionDropdown(false)
    }

    if (socket && user) {
      socket.emit('typing', { roomId, displayName: user.displayName })
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => socket.emit('stop_typing', { roomId }), 2000)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMentionDropdown && e.key === 'Escape') { e.preventDefault(); setShowMentionDropdown(false); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!showMentionDropdown) sendMessage() }
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
    if (msg.type === 'deleted') return
    const touch = e.touches[0]
    longPressTimerRef.current = setTimeout(() => {
      setContextMenu({ messageId: msg.id, x: touch.clientX, y: touch.clientY })
    }, 500)
  }

  function handleTouchEnd() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }

  function handleContextMenu(e: React.MouseEvent, msg: Message) {
    if (msg.type === 'deleted') return
    e.preventDefault()
    setContextMenu({ messageId: msg.id, x: e.clientX, y: e.clientY })
  }

  if (!user) return null

  const isMuted = currentRoom?.members.find((m) => m.userId === user.id)?.muteNotifications ?? false

  // メンションをハイライトしてレンダリング
  function renderContent(content: string, isOwn: boolean) {
    const parts = content.split(/(@\S+)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const name = part.slice(1)
        const isMe = name === user!.displayName
        const exists = currentRoom?.members.some((m) => m.user?.displayName === name)
        if (exists) {
          return (
            <span
              key={i}
              className={`font-semibold rounded px-0.5 ${isOwn
                ? (isMe ? 'bg-green-300 text-green-900' : 'bg-green-400 text-green-100')
                : (isMe ? 'bg-blue-100 text-blue-700' : 'text-green-700')}`}
            >
              {part}
            </span>
          )
        }
      }
      return <span key={i}>{part}</span>
    })
  }

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
            const dmOther = !room.isGroup ? room.members.find((m) => m.userId !== user.id) : null
            const dmOnline = dmOther ? onlineUsers.has(dmOther.userId) : false
            return (
              <button
                key={room.id}
                onClick={() => navigateToRoom(room.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-100 transition-colors ${isActive ? 'bg-green-50 border-l-4 border-green-500' : 'hover:bg-gray-50'}`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-xl">{room.isGroup ? '👥' : '👤'}</span>
                  </div>
                  {!room.isGroup && dmOnline && (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-medium truncate ${(room.unreadCount || 0) > 0 && room.id !== roomId ? 'text-gray-900 font-semibold' : 'text-gray-900'}`}>{displayName}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {room.members.find((m) => m.userId === user.id)?.muteNotifications && (
                        <span className="text-xs text-gray-300" title="通知オフ">🔕</span>
                      )}
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
              {!isStandalone && (
                <button
                  onClick={() => window.dispatchEvent(new Event('open-install-guide'))}
                  title="アプリをインストール"
                  className="text-lg px-1"
                >
                  📲
                </button>
              )}
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
              v0.1.0 ・ {process.env.NEXT_PUBLIC_BUILD_TIME
                ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '---'}
            </span>
            <span className="text-[10px] text-gray-300 font-mono">
              {process.env.NEXT_PUBLIC_COMMIT?.slice(0, 7) || '-------'}
            </span>
          </div>
        </>
      )}
    </div>
  )

  const otherMember = currentRoom && !currentRoom.isGroup ? currentRoom.members.find((m) => m.userId !== user.id) : null
  const otherOnline = otherMember ? onlineUsers.has(otherMember.userId) : false
  const groupOnlineCount = currentRoom ? currentRoom.members.filter((m) => m.userId !== user.id && onlineUsers.has(m.userId)).length : 0

  const chatContent = (
    <div className="flex flex-col h-full bg-white">
      {currentRoom ? (
        <>
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-200 bg-white safe-top">
            <button onClick={() => setShowSidebar(true)} className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex-shrink-0" aria-label="戻る">‹</button>
            <div className="relative flex-shrink-0">
              <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center">
                <span>{currentRoom.isGroup ? '👥' : '👤'}</span>
              </div>
              {!currentRoom.isGroup && otherOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="font-semibold text-gray-900 truncate">{getRoomDisplayName(currentRoom, user.id)}</h2>
                <span title={connected ? '接続中' : '接続待機中'} className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
              </div>
              {currentRoom.isGroup ? (
                <button onClick={() => setShowMembers(true)} className="text-xs text-green-600 hover:underline active:underline">
                  {currentRoom.members?.length}人{groupOnlineCount > 0 && ` ・ ${groupOnlineCount}人オンライン`}
                </button>
              ) : (
                <span className={`text-xs ${otherOnline ? 'text-green-600' : 'text-gray-400'}`}>
                  {otherOnline ? 'オンライン' : 'オフライン'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setShowAI(true)} className="hidden sm:flex px-2.5 py-1.5 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full font-medium items-center gap-1">✨ AI分析</button>
              <button onClick={() => setShowAI(true)} className="sm:hidden p-2 text-purple-600 hover:bg-purple-50 rounded-lg" aria-label="AI分析">✨</button>
              <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg text-lg leading-none">⋮</button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 min-w-[180px]">
                    {currentRoom.isGroup && (
                      <button onClick={() => { setShowRoomSettings(true); setShowMenu(false) }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">⚙️ グループ設定・招待</button>
                    )}
                    <button onClick={toggleMute} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
                      {isMuted ? '🔔 通知をオンにする' : '🔕 通知をオフにする'}
                    </button>
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

          {pinnedMessages.length > 0 && (
            <div className="bg-amber-50 border-b border-amber-100 px-3 py-2">
              {pinnedMessages.slice(0, 1).map((pm) => (
                <button
                  key={pm.id}
                  onClick={() => scrollToMessage(pm.id)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="text-amber-500 flex-shrink-0">📌</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-amber-700 font-medium truncate">
                      {pm.user?.displayName}: {pm.content || (pm.attachments?.length ? '添付ファイル' : '')}
                    </p>
                  </div>
                  {pinnedMessages.length > 1 && (
                    <span className="text-xs text-amber-500 flex-shrink-0">他{pinnedMessages.length - 1}件</span>
                  )}
                  <span className="text-xs text-amber-400 flex-shrink-0">タップで表示</span>
                </button>
              ))}
            </div>
          )}

          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 bg-gray-50"
            onClick={() => { setContextMenu(null); setShowMenu(false); setShowReactionPicker(null) }}
          >
            {loadingOlder && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-gray-400">過去のメッセージを読み込み中...</span>
              </div>
            )}
            {!hasMoreOlder && messages.length > 0 && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-gray-300">これより前のメッセージはありません</span>
              </div>
            )}
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
                      id={`msg-${msg.id}`}
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
                          <button
                            onClick={() => msg.replyToId && scrollToMessage(msg.replyToId)}
                            className={`text-xs bg-white border-l-2 border-green-500 px-2 py-1.5 rounded-lg mb-1 text-gray-500 max-w-full text-left hover:bg-gray-50 active:bg-gray-100 ${isOwn ? 'self-end' : ''}`}
                          >
                            <span className="font-medium text-green-700">↩ {msg.replyTo.user?.displayName}</span>
                            <span className="block truncate max-w-[200px]">{msg.replyTo.content.slice(0, 60)}</span>
                          </button>
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
                              {msg.pinned && <span className="text-[10px] mr-1" title="ピン留め">📌</span>}
                              {msg.content && <p className="whitespace-pre-wrap inline">{renderContent(msg.content, isOwn)}</p>}
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
            <div className="flex items-end gap-1.5 relative">
              {showEmojiPicker && (
                <EmojiPicker
                  onSelect={insertEmoji}
                  onClose={() => setShowEmojiPicker(false)}
                />
              )}
              {/* メンションドロップダウン */}
              {showMentionDropdown && currentRoom && (() => {
                const candidates = currentRoom.members
                  .filter((m) => m.userId !== user.id && m.user?.displayName.toLowerCase().includes(mentionQuery.toLowerCase()))
                  .slice(0, 5)
                if (candidates.length === 0) return null
                return (
                  <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-56 overflow-hidden">
                    <p className="text-xs text-gray-400 px-3 pt-2 pb-1">メンションする相手</p>
                    {candidates.map((m) => (
                      <button
                        key={m.userId}
                        onMouseDown={(e) => { e.preventDefault(); insertMention(m.user.displayName) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-green-50 active:bg-green-100 text-left"
                      >
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: m.user.avatarColor }}>
                          {m.user.displayName.charAt(0)}
                        </span>
                        <span className="truncate">{m.user.displayName}</span>
                      </button>
                    ))}
                  </div>
                )
              })()}
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="p-2.5 text-gray-400 hover:text-gray-600 active:text-gray-600 flex-shrink-0 rounded-full hover:bg-gray-100" aria-label="ファイル添付">
                {uploading ? '⏳' : '📎'}
              </button>
              <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2.5 text-gray-400 hover:text-gray-600 active:text-gray-600 flex-shrink-0 rounded-full hover:bg-gray-100" aria-label="絵文字">
                😊
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力... (@でメンション)"
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
      <InstallPrompt />
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
            {ctxMsg && ctxMsg.type !== 'deleted' && (
              <button
                onClick={() => togglePin(ctxMsg.id)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                {ctxMsg.pinned ? '📌 ピン留めを解除' : '📌 ピン留め'}
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
          onlineUserIds={onlineUsers}
          onClose={() => setShowMembers(false)}
          onStartDM={startDM}
        />
      )}
      {showRoomSettings && currentRoom && (
        <RoomSettingsModal
          room={{ id: currentRoom.id, name: currentRoom.name, description: currentRoom.description, isGroup: currentRoom.isGroup }}
          token={token}
          isAdmin={currentRoom.members.find((m) => m.userId === user.id)?.role === 'admin'}
          onClose={() => setShowRoomSettings(false)}
          onUpdated={(name, description) => {
            setRooms((prev) => prev.map((r) => r.id === currentRoom.id ? { ...r, name, description } : r))
            setCurrentRoom((prev) => prev ? { ...prev, name, description } : prev)
          }}
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
