'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'RYS集荷ライト', body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: data.body || '',
    icon: new URL('../app-icon-192.png?v=20260616-light-1', self.registration.scope).href,
    badge: new URL('../app-icon-192.png?v=20260616-light-1', self.registration.scope).href,
    tag: data.tag || 'pickup-light',
    renotify: true,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(data.title || 'RYS集荷ライト', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if ('navigate' in client) return client.navigate(target).then(() => client.focus());
    }
    return self.clients.openWindow(target);
  }));
});
