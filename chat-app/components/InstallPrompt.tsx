'use client'
import { useState, useEffect } from 'react'

type Platform = 'ios' | 'android' | 'desktop' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIOS) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

function checkStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true
}

// PWA installのbeforeinstallpromptイベント型
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>('other')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(true) // 判定前はインストール済み扱いでチラ見え防止
  const [showBanner, setShowBanner] = useState(false)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
    const sa = checkStandalone()
    setStandalone(sa)

    const onBIP = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBIP)

    const onOpen = () => setShowModal(true)
    window.addEventListener('open-install-guide', onOpen)

    const onInstalled = () => { setStandalone(true); setShowBanner(false); setShowModal(false) }
    window.addEventListener('appinstalled', onInstalled)

    // 未インストール かつ 未却下 のとき、少し遅れてバナー表示
    if (!sa && localStorage.getItem('install_dismissed') !== '1') {
      const t = setTimeout(() => setShowBanner(true), 2000)
      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', onBIP)
        window.removeEventListener('open-install-guide', onOpen)
        window.removeEventListener('appinstalled', onInstalled)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('open-install-guide', onOpen)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (standalone) return null

  async function handlePrimary() {
    // Android/PC ChromeはネイティブのインストールUIを直接呼べる
    if (deferred) {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      setDeferred(null)
      if (outcome === 'accepted') { setShowBanner(false); setShowModal(false) }
    } else {
      // iOSやネイティブUI非対応 → 手順モーダルを表示
      setShowModal(true)
      setShowBanner(false)
    }
  }

  function dismissBanner() {
    setShowBanner(false)
    localStorage.setItem('install_dismissed', '1')
  }

  return (
    <>
      {/* 自動表示バナー */}
      {showBanner && !showModal && (
        <div className="fixed bottom-0 inset-x-0 z-[55] p-3 safe-bottom">
          <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-3 flex items-center gap-3">
            <div className="w-11 h-11 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xl">💬</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">アプリとして追加</p>
              <p className="text-xs text-gray-500">ホーム画面から素早く開けて通知も届きます</p>
            </div>
            <button
              onClick={handlePrimary}
              className="bg-green-500 text-white text-sm font-medium px-3 py-2 rounded-xl hover:bg-green-600 flex-shrink-0"
            >
              追加
            </button>
            <button onClick={dismissBanner} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1 flex-shrink-0" aria-label="閉じる">✕</button>
          </div>
        </div>
      )}

      {/* 手順モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-[56] flex items-end sm:items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">アプリのインストール方法</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
            </div>

            <div className="p-4">
              {platform === 'ios' && <IosSteps />}
              {platform === 'android' && <AndroidSteps hasNative={!!deferred} onInstall={handlePrimary} />}
              {platform === 'desktop' && <DesktopSteps hasNative={!!deferred} onInstall={handlePrimary} />}
              {platform === 'other' && <IosSteps />}
            </div>

            <div className="p-4 border-t">
              <button onClick={() => setShowModal(false)} className="w-full border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{n}</span>
      <div className="text-sm text-gray-700 flex-1">{children}</div>
    </div>
  )
}

function IosSteps() {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 text-blue-800 text-xs rounded-xl p-3">
        📱 iPhone / iPad は <strong>Safari</strong> で開いてください（Chrome等では追加できません）
      </div>
      <Step n={1}>
        画面下の<strong>共有ボタン</strong>をタップ
        <div className="mt-1 inline-flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1 text-xs text-gray-600">
          <span className="text-base">􀈂</span> 四角から矢印が出ているアイコン
        </div>
      </Step>
      <Step n={2}>
        メニューを下にスクロールして<br />
        <strong>「ホーム画面に追加」</strong>をタップ
        <div className="mt-1 inline-flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1 text-xs text-gray-600">
          <span className="text-base">➕</span> ホーム画面に追加
        </div>
      </Step>
      <Step n={3}>
        右上の<strong>「追加」</strong>をタップして完了 🎉
      </Step>
      <div className="bg-amber-50 text-amber-800 text-xs rounded-xl p-3">
        🔔 <strong>通知を受け取るには</strong>、追加後はホーム画面のアイコンから開いてください（iOS 16.4以上が必要です）
      </div>
    </div>
  )
}

function AndroidSteps({ hasNative, onInstall }: { hasNative: boolean; onInstall: () => void }) {
  return (
    <div className="space-y-4">
      {hasNative ? (
        <>
          <p className="text-sm text-gray-700">下のボタンを押すだけでインストールできます。</p>
          <button onClick={onInstall} className="w-full bg-green-500 text-white py-3 rounded-xl font-medium hover:bg-green-600">
            📲 アプリをインストール
          </button>
          <p className="text-xs text-gray-400 text-center">確認ダイアログが出たら「インストール」を選んでください</p>
        </>
      ) : (
        <>
          <div className="bg-blue-50 text-blue-800 text-xs rounded-xl p-3">
            🤖 Android は <strong>Chrome</strong> で開いてください
          </div>
          <Step n={1}>右上の<strong>メニュー（⋮）</strong>をタップ</Step>
          <Step n={2}><strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>をタップ</Step>
          <Step n={3}>確認画面で<strong>「インストール」</strong>をタップして完了 🎉</Step>
        </>
      )}
    </div>
  )
}

function DesktopSteps({ hasNative, onInstall }: { hasNative: boolean; onInstall: () => void }) {
  return (
    <div className="space-y-4">
      {hasNative ? (
        <>
          <p className="text-sm text-gray-700">下のボタンを押すとアプリとしてインストールできます。</p>
          <button onClick={onInstall} className="w-full bg-green-500 text-white py-3 rounded-xl font-medium hover:bg-green-600">
            🖥 アプリをインストール
          </button>
        </>
      ) : (
        <>
          <div className="bg-blue-50 text-blue-800 text-xs rounded-xl p-3">
            🖥 <strong>Chrome</strong> または <strong>Edge</strong> でご利用ください
          </div>
          <Step n={1}>アドレスバー右端の<strong>インストールアイコン</strong>（⊕／画面マーク）をクリック</Step>
          <Step n={2}><strong>「インストール」</strong>をクリックして完了 🎉</Step>
          <p className="text-xs text-gray-400">独立したウィンドウでアプリのように起動できます</p>
        </>
      )}
    </div>
  )
}
