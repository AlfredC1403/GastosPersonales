// Permite abrir la app sin conexión. Los archivos propios se piden a la red primero
// (así siempre se ve la última versión) y, si no hay red, salen de la caché.
//
// La versión viene en la dirección con la que js/main.js registra este archivo
// (`sw.js?v=...`, tomada de js/version.js): así basta subir la versión en un solo sitio.
// Al cambiar, el navegador ve otro service worker, lo instala y `activate` borra las cachés viejas.
const VERSION = new URL(location.href).searchParams.get('v') || 'sin-version';
const CACHE = `gastos-${VERSION}`;
const BASICOS = ['./', './index.html', './css/app.css', './js/main.js', './js/version.js', './manifest.webmanifest', './icon.svg', './icon-maskable.svg'];
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

// ---------------------------------------------------------------- Avisos en el teléfono

// La app deja en IndexedDB lo que vence en los próximos días (js/notificaciones.js). Aquí solo se
// lee y se muestra: un service worker no puede recalcular el documento. Si el navegador guardó en
// localStorage (IndexedDB no disponible), no hay agenda y no se avisa: queda el aviso al abrir.
const ETIQUETA = 'gastos-avisos';

function leerAgenda() {
  return new Promise((listo) => {
    if (!('indexedDB' in self)) return listo(null);
    const pet = indexedDB.open('gastos-hogar', 1);
    pet.onerror = () => listo(null);
    pet.onblocked = () => listo(null);
    // Si la base no existe, no se crea desde aquí: la app es la dueña del esquema.
    pet.onupgradeneeded = () => pet.transaction?.abort();
    pet.onsuccess = () => {
      const bd = pet.result;
      try {
        const pedido = bd.transaction('datos', 'readonly').objectStore('datos').get('agenda');
        pedido.onsuccess = () => {
          try {
            listo(JSON.parse(pedido.result));
          } catch {
            listo(null);
          }
          bd.close();
        };
        pedido.onerror = () => {
          listo(null);
          bd.close();
        };
      } catch {
        listo(null);
        bd.close();
      }
    };
  });
}

const hoyTexto = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function avisarDeHoy() {
  const agenda = await leerAgenda();
  const dias = agenda?.dias;
  if (!Array.isArray(dias) || !dias.length) return;
  const hoy = hoyTexto();
  const vencen = dias.filter((x) => x && x.fecha <= hoy);
  if (!vencen.length) return;
  const uno = vencen.length === 1;
  await self.registration.showNotification(uno ? vencen[0].asunto : `${vencen.length} cosas vencen hoy`, {
    // Con un solo aviso, repetir el asunto en el cuerpo no aporta nada.
    body: uno ? (vencen[0].fecha < hoy ? `Venció el ${vencen[0].fecha}.` : 'Vence hoy.') : vencen.map((x) => x.asunto).join(' · '),
    tag: ETIQUETA, // una sola notificación: la nueva reemplaza la del día anterior
    data: { ruta: vencen.length === 1 ? vencen[0].ruta : '#/avisos' },
    badge: './icon.svg',
    icon: './icon.svg',
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'gastos-agenda') e.waitUntil(avisarDeHoy());
});

// Al tocar la notificación se abre la app donde toca; si ya estaba abierta, se le cambia la ruta.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ruta = e.notification.data?.ruta || '#/avisos';
  e.waitUntil((async () => {
    const base = new URL('./', self.registration.scope).href;
    for (const cliente of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (!cliente.url.startsWith(base)) continue;
      await cliente.navigate(`${base}${ruta}`).catch(() => {});
      return cliente.focus();
    }
    return self.clients.openWindow(`${base}${ruta}`);
  })());
});
