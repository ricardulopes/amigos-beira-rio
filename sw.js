// Service worker: funciona offline (campo de futebol sem sinal).
// Estratégia: rede primeiro para o app (pega atualizações), cache como reserva.
const CACHE = 'pelada-v19';
const DOMAIN = [
  'index', 'constants', 'stars', 'players', 'tactics', 'rng', 'draw', 'setup', 'session',
  'tieRules', 'rotation', 'arrivals', 'removals', 'adjustments', 'balance', 'stats', 'share',
  'admin', 'roster', 'vests', 'finance',
];
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './src/ui/app.js', './src/ui/state.js', './src/ui/views.js', './src/ui/modals.js', './src/ui/dom.js',
  './src/storage/storage.js',
  ...DOMAIN.map((m) => `./src/domain/${m}.js`),
  './src/data/lista-oficial.js',
  './src/cloud/config.js', './src/cloud/diff.js', './src/cloud/sync.js', './vendor/supabase.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-180.png', './icons/favicon-32.png', './img/escudo-abr.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
