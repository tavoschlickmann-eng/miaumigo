/* Service worker do Miaumigo: funciona offline, atualiza rápido e mostra notificações. */
const CACHE = 'miaumigo-v10';
const ASSETS = ['./', 'index.html', 'styles.css', 'icons.js', 'config.js', 'vendor/supabase.js', 'app.js', 'sync.js', 'familia.js', 'install.js', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest', 'privacidade.html'];

self.addEventListener('install', (e) => {
  // cache: 'reload' = baixa do servidor, ignorando o cache do navegador
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro, SEMPRE conferindo com o servidor (cache: 'no-cache'): o GitHub Pages
// manda guardar os arquivos por 10 minutos, o que atrasava as atualizações.
// Se o arquivo não mudou, o servidor responde "304" na hora; sem internet, usa o cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/agenda', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
