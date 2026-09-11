// Permite abrir la app sin conexión. Los archivos propios se piden a la red primero
// (así siempre se ve la última versión) y, si no hay red, salen de la caché.
const CACHE = 'gastos-v1';
const BASICOS = ['./', './index.html', './css/app.css', './js/main.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function guardarEnCache(peticion, respuesta) {
  if (respuesta.ok) {
    const copia = respuesta.clone();
    caches.open(CACHE).then((c) => c.put(peticion, copia));
  }
  return respuesta;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(request).then((r) => guardarEnCache(request, r)).catch(() => caches.match(request, { ignoreSearch: true })));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Librerías con versión fija: nunca cambian.
    e.respondWith(caches.match(request).then((c) => c || fetch(request).then((r) => guardarEnCache(request, r))));
  }
  // Microsoft (inicio de sesión, Graph, OneDrive) nunca pasa por la caché.
});
