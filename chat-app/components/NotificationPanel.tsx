'use client'
import { useState, useEffect } from 'react'
import { subscribeToPush } from '@/hooks/useNotifications'

interface Check { label: string; status: 'ok' | 'ng' | 'warn' | 'pending'; detail: string }

export function NotificationPanel({ onClose, onPermissionGranted, token }: { onClose: () => void; onPermissionGranted: () => void; token: string }) {
  const [checks, setChecks] = useState<Check[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  useEffect(() => { runChecks() }, [])

  async function runChecks() {
    const result: Check[] = []

    // 1. Notification API
    const hasApi = 'Notification' in window
    result.push({ label: 'Notification API', status: hasApi ? 'ok' : 'ng', detail: hasApi ? '対応しています' : '非対応（このブラウザでは通知できません）' })

    // 2. Permission
    const perm = hasApi ? Notification.permission : 'denied'
    result.push({
      label: '通知の権限',
      status: perm === 'granted' ? 'ok' : perm === 'denied' ? 'ng' : 'warn',
      detail: perm === 'granted' ? '許可済み ✓' : perm === 'denied' ? 'ブロックされています（ブラウザ設定で変更してください）' : '未設定（下のボタンで許可してください）',
    })

    // 3. Service Worker
    let swDetail = '非対応'
    let swStatus: Check['status'] = 'ng'
    let swReady = false
    if ('serviceWorker' in navigator) {
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 4000)),
        ])
        swDetail = reg.active ? `有効 (scope: ${reg.scope})` : '登録済み（未アクティブ）'
        swStatus = reg.active ? 'ok' : 'warn'
        swReady = !!reg.active
      } catch (e) {
        swDetail = 'タイムアウト or エラー: ' + String(e)
        swStatus = 'ng'
      }
    }
    result.push({ label: 'Service Worker', status: swStatus, detail: swDetail })

    // 4. プッシュ購読（バックグラウンド通知の鍵）
    let pushStatus: Check['status'] = 'ng'
    let pushDetail = '非対応'
    if (!('PushManager' in window)) {
      pushDetail = 'このブラウザはバックグラウンド通知に非対応です（iOSの場合はホーム画面に追加してください）'
    } else if (perm !== 'granted') {
      pushStatus = 'warn'
      pushDetail = '通知を許可すると自動で登録されます'
    } else if (swReady) {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) { pushStatus = 'ok'; pushDetail = '登録済み ✓ アプリを閉じていても通知が届きます' }
        else { pushStatus = 'warn'; pushDetail = '未登録（下のボタンで登録してください）' }
      } catch {
        pushDetail = '状態の取得に失敗しました'
      }
    }
    result.push({ label: 'バックグラウンド通知', status: pushStatus, detail: pushDetail })

    setChecks(result)
  }

  async function requestAndCheck() {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    if (perm === 'granted') {
      onPermissionGranted()
      await subscribeToPush(token)
    }
    await runChecks()
  }

  async function sendTestNotification() {
    setTesting(true)
    setTestResult('')

    if (Notification.permission !== 'granted') {
      await requestAndCheck()
    }
    if (Notification.permission !== 'granted') {
      setTestResult('❌ 通知がブロックされています\nブラウザのアドレスバー横の🔒→「通知」→「許可」に変更してください。')
      setTesting(false)
      return
    }

    // プッシュ購読を確実に登録してから、サーバー経由で実際のプッシュをテスト送信する。
    // これがアプリ最小化中でも届く「本物の」通知経路。
    const subscribed = await subscribeToPush(token)
    if (!subscribed) {
      setTestResult('❌ プッシュ通知の登録に失敗しました\nService Workerが有効か確認してください。')
      await runChecks()
      setTesting(false)
      return
    }

    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTestResult(`✅ サーバーからテスト通知を送信しました（${data.devices}台の端末へ）\n\nこの画面を閉じてホーム画面に戻り、数秒待って通知が届くか確認してください。アプリを最小化しても届けば成功です。`)
      } else {
        const data = await res.json().catch(() => ({}))
        setTestResult(`❌ 送信に失敗しました\n${data.error || 'サーバーエラー'}`)
      }
    } catch {
      setTestResult('❌ 送信に失敗しました（ネットワークエラー）')
    }
    await runChecks()
    setTesting(false)
  }

  const needsPermission = checks.some((c) => c.label === '通知の権限' && c.status !== 'ok')

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 sm:items-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-900">通知の診断</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {checks.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">確認中...</p>
          )}
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-3">
              <span className={`text-lg flex-shrink-0 mt-0.5 ${c.status === 'ok' ? 'text-green-500' : c.status === 'ng' ? 'text-red-500' : 'text-yellow-500'}`}>
                {c.status === 'ok' ? '✓' : c.status === 'ng' ? '✗' : '!'}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-800">{c.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>
              </div>
            </div>
          ))}

          {testResult && (
            <div className={`rounded-xl p-3 text-sm whitespace-pre-line ${testResult.startsWith('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {testResult}
            </div>
          )}

          <div className="pt-2 border-t text-xs text-gray-400 space-y-1">
            <p>📱 通知が届くタイミング:</p>
            <p>・ 別のルームを見ているとき</p>
            <p>・ ホーム画面やほかのアプリを開いているとき</p>
            <p className="text-gray-300">※ 同じルームを見ているときは通知なし（LINEと同じ）</p>
          </div>
        </div>

        <div className="p-4 border-t space-y-2">
          {needsPermission && (
            <button
              onClick={requestAndCheck}
              className="w-full bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-green-600"
            >
              通知を許可する
            </button>
          )}
          <button
            onClick={sendTestNotification}
            disabled={testing}
            className="w-full bg-blue-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {testing ? '送信中...' : 'バックグラウンド通知をテスト'}
          </button>
          <button onClick={onClose} className="w-full border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
