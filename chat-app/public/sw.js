const CACHE_NAME = 'chat-v2'
const STATIC_ASSETS = ['/', '/login', '/register']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// プッシュ受信時に通知を表示する（アプリ最小化・終了時でもOSが起こしてくれる）
self.addEventListener('push', (event) => {
  let data = { title: '社内チャット', body: '新しいメッセージ', roomId: '', tag: 'chat' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || data.roomId || 'chat',
      renotify: true,
      data: { roomId: data.roomId },
    })
  )
})

// 通知タップ時にアプリを開く（Androidで必須）
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const roomId = event.notification.data && event.notification.data.roomId
  const targetUrl = roomId ? `/chat/${roomId}` : '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && roomId) client.navigate(targetUrl).catch(() => {})
          return client.focus()
        }
      }
      return clients.openWindow(targetUrl)
    })
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) return

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((r) => r || Response.error())
    )
  )
})
