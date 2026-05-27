'use client'
import { useState } from 'react'

interface Props {
  roomId: string
  roomName: string
  token: string
  onClose: () => void
}

const TYPES = [
  { value: 'summary', label: '要約', icon: '📝' },
  { value: 'tasks', label: 'タスク抽出', icon: '✅' },
  { value: 'decisions', label: '決定事項', icon: '🎯' },
]

export function AiAnalysisModal({ roomId, roomName, token, onClose }: Props) {
  const [type, setType] = useState('summary')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    setLoading(true)
    setResult('')
    setError('')
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId, type }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'エラーが発生しました'); return }
      setResult(data.result)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-900">AI分析 — {roomName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  type === t.value ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-600 hover:border-green-300'
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="w-full bg-green-500 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 mb-4"
          >
            {loading ? '分析中...' : '分析する'}
          </button>
          {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-3">{error}</div>}
          {result && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap max-h-80 overflow-y-auto">
              {result}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
