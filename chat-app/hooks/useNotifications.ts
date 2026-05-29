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
  // PC fallback
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

  useEffect(() => {
    if ('Notification' in window) {
      permissionRef.current = Notification.permission
    }
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

    if (permissionRef.current === 'granted') {
      const body = content.length > 60 ? content.slice(0, 60) + '...' : content
      await sendNotification(`${senderName} — ${roomName}`, {
        body,
        icon: '/icon-192.png',
        tag: roomId,
        badge: '/icon-192.png',
      })
    }

    // 通知音
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
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

  return { requestPermission, notify, permission: permissionRef }
}
