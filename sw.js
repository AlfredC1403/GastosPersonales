// Permite abrir la app sin conexión. Los archivos propios se piden a la red primero
// (así siempre se ve la última versión) y, si no hay red, salen de la caché.
const CACHE = 'gastos-v7';
const BASICOS = ['./', './index.html', './css/app.css', './js/main.js', './manifest.webmanifest', './icon.svg'];
const FIJOS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']; // versiones fijas: no cambian

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
  if (respuesta.ok || respuesta.type === 'opaque') {
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
    // `no-cache` pregunta siempre al servidor (responde 304 si no cambió): así, al tocar
    // "Actualizar" no se usa un archivo viejo guardado por el navegador.
    e.respondWith(fetch(request, { cache: 'no-cache' }).then((r) => guardarEnCache(request, r)).catch(() => caches.match(request, { ignoreSearch: true })));
  } else if (FIJOS.includes(url.hostname)) {
    e.respondWith(caches.match(request).then((c) => c || fetch(request).then((r) => guardarEnCache(request, r))));
  }
  // Microsoft (inicio de sesión, Graph, OneDrive) nunca pasa por la caché.
});
