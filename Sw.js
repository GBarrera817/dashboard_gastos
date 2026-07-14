/* ================================================================
 * SERVICE WORKER — Dashboard de Gastos
 * ----------------------------------------------------------------
 * Cachea el "shell" de la app (HTML/CSS/JS/íconos) para que abra
 * rápido y funcione offline en cuanto a la interfaz. Los datos
 * (llamadas POST al Apps Script) NUNCA se cachean acá: siempre van
 * directo a la red, porque son la fuente de verdad en Google Sheets.
 *
 * Sube el número de versión (CACHE_NAME) cada vez que cambies
 * index.html/style.css/app.js para forzar que los usuarios reciban
 * la versión nueva en su próxima visita.
 * ================================================================ */

const CACHE_NAME = 'dashboard-gastos-v1';
const APP_SHELL = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos peticiones GET de nuestro propio origen (el shell de la app).
  // Todo lo demás (POST al Apps Script, CDNs de Chart.js/SheetJS, etc.) pasa
  // directo a la red sin tocarlo.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // sin conexión: usa lo cacheado si existe
      return cached || network;
    })
  );
});