'use client'
import { useEffect } from 'react'

export interface ToastData {
  id: string
  senderName: string
  content: string
  roomId: string
  roomName: string
  avatarColor: string
}

interface Props {
  toasts: ToastData[]
  onDismiss: (id: string) => void
  onNavigate: (roomId: string) => void
}

export function ToastNotification({ toasts, onDismiss, onNavigate }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[200] flex flex-col items-center gap-2 p-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function ToastItem({
  toast,
  onDismiss,
  onNavigate,
}: {
  toast: ToastData
  onDismiss: (id: string) => void
  onNavigate: (roomId: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const preview = toast.content.length > 60 ? toast.content.slice(0, 60) + '…' : toast.content

  return (
    <button
      className="pointer-events-auto w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden text-left toast-enter"
      onClick={() => { onNavigate(toast.roomId); onDismiss(toast.id) }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 text-sm"
          style={{ backgroundColor: toast.avatarColor }}
        >
          {toast.senderName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 justify-between">
            <span className="text-sm font-semibold text-gray-900 truncate">{toast.senderName}</span>
            <span className="text-xs text-gray-400 flex-shrink-0 truncate max-w-[100px]">{toast.roomName}</span>
          </div>
          <p className="text-sm text-gray-600 truncate mt-0.5">{preview}</p>
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDismiss(toast.id) }}
          className="text-gray-300 hover:text-gray-500 p-1 flex-shrink-0 text-lg leading-none"
        >
          ✕
        </div>
      </div>
      <div className="h-1 bg-green-500 toast-progress" />
    </button>
  )
}
