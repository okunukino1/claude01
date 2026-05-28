const CACHE_NAME = 'chat-v1'
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

self.addEventListener('fetch', (event) => {
  // Only cache GET requests for same-origin navigation
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) return

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
