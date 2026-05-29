'use client'
import { useEffect, useRef, useCallback } from 'react'

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 4000)),
    ])
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Web Pushの購読を登録する。アプリを閉じていても通知が届くようになる。
// 戻り値: 成功時 true
export async function subscribeToPush(token: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    if (Notification.permission !== 'granted') return false

    const reg = await getSwRegistration()
    if (!reg) return false

    // サーバーからVAPID公開鍵を取得
    const keyRes = await fetch('/api/push/vapid-key')
    if (!keyRes.ok) return false
    const { publicKey } = await keyRes.json()
    if (!publicKey) return false

    // 既存の購読があれば再利用、なければ新規作成
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
    }

    // サーバーに購読情報を送信
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(sub),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function sendNotification(title: string, options: NotificationOptions): Promise<'sw' | 'api' | 'denied' | 'unsupported' | 'error'> {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'granted') return 'denied'

  const reg = await getSwRegistration()
  if (reg) {
    try {
      await reg.showNotification(title, options)
      return 'sw'
    } catch {}
  }
  try {
    const n = new Notification(title, options)
    n.onclick = () => { window.focus(); n.close() }
    return 'api'
  } catch {
    return 'error'
  }
}

export function useNotifications(currentRoomId: string) {
  const permissionRef = useRef<NotificationPermission>('default')
  const unreadRef = useRef(0)
  const originalTitleRef = useRef('社内チャット')
  // ユーザー操作後に解放されたAudioContext を保持する
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission
    }
  }, [])

  // ユーザー操作時に呼び出してAudioContextを事前に解放する
  // Android Chromeはユーザー操作なしに音を鳴らせないため必須
  const unlockAudio = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx()
      }
      // suspended状態なら resume（ユーザー操作コンテキストで呼ぶ必要がある）
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      // 無音を再生してブラウザの自動再生ブロックを解除
      const buf = audioCtxRef.current.createBuffer(1, 1, 22050)
      const src = audioCtxRef.current.createBufferSource()
      src.buffer = buf
      src.connect(audioCtxRef.current.destination)
      src.start(0)
    } catch {}
  }, [])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false
    const permission = await Notification.requestPermission()
    permissionRef.current = permission
    return permission === 'granted'
  }, [])

  const notify = useCallback(async (senderName: string, content: string, roomId: string, roomName: string) => {
    const isCurrentRoom = roomId === currentRoomId
    const isVisible = document.visibilityState === 'visible'
    if (isCurrentRoom && isVisible) return

    unreadRef.current += 1
    document.title = `(${unreadRef.current}) 社内チャット`

    if ('Notification' in window && Notification.permission === 'granted') {
      const body = content.length > 60 ? content.slice(0, 60) + '...' : content
      await sendNotification(`${senderName} — ${roomName}`, {
        body,
        icon: '/icon-192.png',
        tag: roomId,
        badge: '/icon-192.png',
      })
    }

    // 通知音：解放済みのAudioContextがあれば使う
    try {
      const ctx = audioCtxRef.current
      if (!ctx) return
      if (ctx.state === 'suspended') {
        // resumeはユーザー操作コンテキスト外では失敗することがあるが試みる
        await ctx.resume()
      }
      if (ctx.state !== 'running') return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } catch {}
  }, [currentRoomId])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        unreadRef.current = 0
        document.title = originalTitleRef.current
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  return { requestPermission, notify, unlockAudio, permission: permissionRef }
}
