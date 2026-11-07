// 서비스 워커: 오프라인 실행 + 하루 한 번 새 데이터 확인(지원 브라우저)
const VERSION = 'hyodo-v2';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/engine.js',
  'js/store.js',
  'js/needs.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'hyodo-state').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 데이터는 네트워크 우선(최신), 실패하면 캐시
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
    return;
  }
  // 앱 화면은 캐시 우선 + 뒤에서 갱신
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});

// 하루 한 번(안드로이드 크롬에 설치한 경우) 데이터 갱신 여부를 확인해 알림
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'welfare-check') return;
  e.waitUntil(
    (async () => {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      const meta = await res.json();
      const state = await caches.open('hyodo-state');
      const prev = await state.match('last-meta').then((r) => (r ? r.json() : null));
      await state.put('last-meta', new Response(JSON.stringify({ updatedAt: meta.updatedAt })));
      if (prev && prev.updatedAt !== meta.updatedAt) {
        await self.registration.showNotification('효도알림: 복지 정보가 새로 갱신됐어요', {
          body: '부모님께 해당되는 새 복지가 있는지 확인해 보세요.',
          icon: 'icons/icon-192.png',
          tag: 'welfare-update',
          data: { url: './' },
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
