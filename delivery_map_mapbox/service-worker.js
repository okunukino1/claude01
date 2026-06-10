'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request));
  }
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'RYS配送マップ', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'RYS配送マップ';
  const options = {
    body: data.body || '',
    icon: './app-icon-192.png?v=20260610-3',
    badge: './app-icon-192.png?v=20260610-3',
    tag: data.tag || 'spot-pickup',
    renotify: true,
    data: {
      url: data.url || './',
      course: data.course || ''
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('navigate' in client) return client.navigate(target).then(() => client.focus());
      }
      return self.clients.openWindow(target);
    })
  );
});
