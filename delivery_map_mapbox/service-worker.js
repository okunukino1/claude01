'use strict';

const STABLE_SUSPENSION_ID = 'stable-suspended-v1';

function isStableShellUrl(value) {
  try {
    const url = new URL(value);
    const scope = new URL(self.registration.scope);
    return url.origin === scope.origin &&
      (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  } catch (error) {
    return false;
  }
}

function suspendedOfflineResponse() {
  return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RYS配送マップ | 通常版は一時停止中</title><body><h1>通常版は一時停止中です</h1><p>通常版の地図・配送操作は現在利用できません。</p></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function stableShellNetworkOnly(request) {
  try {
    return await fetch(request, { cache: 'no-store' });
  } catch (error) {
    return suspendedOfflineResponse();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  // Refresh only stable windows; do not claim test/other scopes or touch stored data.
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Navigation can wait for activation; awaiting it here would keep activation pending.
    for (const client of windows.filter(client => isStableShellUrl(client.url))) {
      client.navigate(new URL('./?stable_suspended=1', self.registration.scope).href).catch(() => {});
    }
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && isStableShellUrl(event.request.url)) {
    event.respondWith(stableShellNetworkOnly(event.request));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL('./', self.registration.scope).href));
});
