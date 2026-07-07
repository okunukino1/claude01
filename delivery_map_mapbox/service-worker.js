'use strict';

// ===== キャッシュ戦略 =====
// SHELL  : アプリ本体(index.html)。キャッシュから即表示し、裏で更新を取得
//          (stale-while-revalidate)。?refresh= 付きはネット優先で取得して
//          キャッシュも更新。?version_check= 付きは常にネット直行。
// STATIC : Mapboxライブラリ(バージョン付きURL)とアイコン。cache-first。
// それ以外(APIコール・地図タイル・外部データ)は一切キャッシュしない。
const SHELL_CACHE = 'rys-shell-v1';
const STATIC_CACHE = 'rys-static-v1';
const SHELL_KEY = 'app-shell';
const KNOWN_CACHES = [SHELL_CACHE, STATIC_CACHE];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => !KNOWN_CACHES.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isAppShellPath(url) {
  return url.pathname.endsWith('/delivery_map_mapbox/') ||
         url.pathname.endsWith('/delivery_map_mapbox/index.html');
}

function isStaticAsset(url) {
  // Mapbox GL JS 本体 (URLにバージョンが入っているため中身は不変)
  if (url.hostname === 'api.mapbox.com' && url.pathname.startsWith('/mapbox-gl-js/')) return true;
  // アプリアイコン (?v= で版管理されている)
  if (url.pathname.includes('/delivery_map_mapbox/app-icon-')) return true;
  return false;
}

async function shellStaleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(SHELL_KEY);
  const revalidate = fetch(request, { cache: 'no-store' })
    .then(res => {
      if (res && res.ok) cache.put(SHELL_KEY, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    // キャッシュを即返し、裏で更新しておく (更新の通知はアプリ内の版チェックが担う)
    return cached;
  }
  const fresh = await revalidate;
  if (fresh) return fresh;
  return Response.error();
}

async function shellNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res && res.ok) cache.put(SHELL_KEY, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(SHELL_KEY);
    if (cached) return cached;
    throw e;
  }
}

async function staticCacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  // アプリのAPI (../api/*.php) は常にネット直行 — 同期・検索・タイルの鮮度を守る
  if (url.pathname.includes('/delivery_map_mapbox/api/')) return;

  // バージョン確認は常にネット直行 (これを守らないと更新検知が壊れる)
  if (url.searchParams.has('version_check')) return;

  // アプリ本体
  if (url.origin === self.location.origin && isAppShellPath(url)) {
    if (url.searchParams.has('refresh')) {
      // 「アプリを更新」: ネット優先で取得し、キャッシュも新しくする
      event.respondWith(shellNetworkFirst(request));
    } else {
      event.respondWith(shellStaleWhileRevalidate(request));
    }
    return;
  }

  // Mapboxライブラリ・アイコン: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(staticCacheFirst(request));
    return;
  }

  // その他 (地図タイル・スタイル・外部API等) はブラウザ標準に任せる
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
    icon: new URL('./app-icon-192.png?v=20260707-1', self.registration.scope).href,
    badge: new URL('./app-icon-192.png?v=20260707-1', self.registration.scope).href,
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
