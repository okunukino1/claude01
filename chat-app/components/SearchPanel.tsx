'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SearchResult {
  id: string
  content: string
  createdAt: string
  user: { displayName: string; avatarColor: string }
  room: { id: string; name: string }
}

export function SearchPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setResults(data.results || [])
    } finally {
      setLoading(false)
    }
  }, [token])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') search(query)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b">
        <input
          autoFocus
          type="text"
          placeholder="メッセージを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm outline-none"
        />
        <button onClick={() => search(query)} className="text-green-600 text-sm font-medium px-2">検索</button>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-center text-gray-500 text-sm">検索中...</div>}
        {!loading && results.length === 0 && query && (
          <div className="p-4 text-center text-gray-500 text-sm">結果が見つかりません</div>
        )}
        {results.map((r) => (
          <button
            key={r.id}
            onClick={() => { router.push(`/chat/${r.room.id}`); onClose() }}
            className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100"
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: r.user.avatarColor }}
              >
                {r.user.displayName.charAt(0)}
              </div>
              <span className="text-xs font-medium text-gray-700">{r.user.displayName}</span>
              <span className="text-xs text-gray-400">in {r.room.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {new Date(r.createdAt).toLocaleDateString('ja-JP')}
              </span>
            </div>
            <p className="text-sm text-gray-800 line-clamp-2">{r.content}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
