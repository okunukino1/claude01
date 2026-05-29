'use client'
import { useState, useEffect, useCallback } from 'react'

// 自分（このJSバンドル）に焼き込まれたバージョン
const MY_COMMIT = process.env.NEXT_PUBLIC_COMMIT || 'dev'

export function VersionChecker() {
  const [latestCommit, setLatestCommit] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (data.commit) setLatestCommit(data.commit)
    } catch {}
  }, [])

  useEffect(() => {
    check()
    // タブに戻ってきたとき＆定期的に再チェック
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    const interval = setInterval(check, 5 * 60 * 1000) // 5分ごと
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [check])

  // サーバーが別バージョン（= 端末が古い）かどうか
  const updateAvailable = latestCommit !== null && MY_COMMIT !== 'dev' && latestCommit !== 'dev' && latestCommit !== MY_COMMIT

  async function forceUpdate() {
    setUpdating(true)
    try {
      // Service Worker のキャッシュを全消去して最新を取得させる
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.update().catch(() => {})))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {}
    // キャッシュ回避のためクエリ付きでリロード
    const url = new URL(window.location.href)
    url.searchParams.set('v', Date.now().toString())
    window.location.replace(url.toString())
  }

  if (!updateAvailable) return null

  return (
    <div className="fixed top-0 inset-x-0 z-[60] bg-green-600 text-white px-4 py-2 flex items-center justify-between gap-3 shadow-lg safe-top">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg flex-shrink-0">🔄</span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">新しいバージョンがあります</p>
          <p className="text-[10px] text-green-100 font-mono truncate">
            {MY_COMMIT.slice(0, 7)} → {latestCommit?.slice(0, 7)}
          </p>
        </div>
      </div>
      <button
        onClick={forceUpdate}
        disabled={updating}
        className="bg-white text-green-700 text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-green-50 disabled:opacity-60 flex-shrink-0"
      >
        {updating ? '更新中...' : '今すぐ更新'}
      </button>
    </div>
  )
}
