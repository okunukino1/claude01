'use client'
import { useState, useEffect } from 'react'
import { sendNotification } from '@/hooks/useNotifications'

interface Check { label: string; status: 'ok' | 'ng' | 'warn' | 'pending'; detail: string }

export function NotificationPanel({ onClose, onPermissionGranted }: { onClose: () => void; onPermissionGranted: () => void }) {
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
    if ('serviceWorker' in navigator) {
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 4000)),
        ])
        swDetail = reg.active ? `有効 (scope: ${reg.scope})` : '登録済み（未アクティブ）'
        swStatus = reg.active ? 'ok' : 'warn'
      } catch (e) {
        swDetail = 'タイムアウト or エラー: ' + String(e)
        swStatus = 'ng'
      }
    }
    result.push({ label: 'Service Worker', status: swStatus, detail: swDetail })

    setChecks(result)
  }

  async function requestAndCheck() {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    if (perm === 'granted') onPermissionGranted()
    await runChecks()
  }

  async function sendTestNotification() {
    setTesting(true)
    setTestResult('')

    if (Notification.permission !== 'granted') {
      await requestAndCheck()
    }

    const result = await sendNotification('テスト通知', {
      body: 'このスマホに通知が届いていれば設定完了です！',
      icon: '/icon-192.png',
      tag: 'test',
    })

    const messages: Record<string, string> = {
      sw: '✅ 通知を送信しました（Service Worker経由）\nこの画面を閉じてホーム画面に戻り、通知が届いているか確認してください。',
      api: '✅ 通知を送信しました（API直接）',
      denied: '❌ 通知がブロックされています\nブラウザのアドレスバー横の🔒→「通知」→「許可」に変更してください。',
      unsupported: '❌ このブラウザは通知に非対応です',
      error: '❌ 通知の送信に失敗しました\nブラウザの通知設定を確認してください。',
    }
    setTestResult(messages[result] || '不明なエラー')
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
            {testing ? '送信中...' : 'テスト通知を送る'}
          </button>
          <button onClick={onClose} className="w-full border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
