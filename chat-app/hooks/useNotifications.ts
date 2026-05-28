'use client'
import { useEffect, useRef, useCallback } from 'react'

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

  const notify = useCallback((senderName: string, content: string, roomId: string, roomName: string) => {
    // 同じルームを見ているかつタブがアクティブなら通知しない
    const isCurrentRoom = roomId === currentRoomId
    const isVisible = document.visibilityState === 'visible'
    if (isCurrentRoom && isVisible) return

    // 未読カウントを増やしてタイトルに表示
    unreadRef.current += 1
    document.title = `(${unreadRef.current}) 社内チャット`

    // ブラウザ通知
    if (permissionRef.current === 'granted') {
      const body = content.length > 60 ? content.slice(0, 60) + '...' : content
      const notification = new Notification(`${senderName} — ${roomName}`, {
        body,
        icon: '/icon-192.png',
        tag: roomId,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    }

    // 通知音（短いビープ）
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
    } catch {
      // 音声API非対応の場合は無視
    }
  }, [currentRoomId])

  // タブがアクティブになったら未読リセット
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
