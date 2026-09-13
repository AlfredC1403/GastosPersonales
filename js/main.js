// Punto de entrada: si Vue no cargó (sin conexión la primera vez, CDN bloqueado),
// se muestra un mensaje en vez de dejar la pantalla en blanco.
if (window.Vue) {
  import('./app.js').catch((e) => {
    console.error(e);
    document.getElementById('app').innerHTML = '<p class="cargando">La app no pudo iniciar. Recarga la página.</p>';
  });
} else {
  document.getElementById('app').innerHTML = '<p class="cargando">No se pudo cargar la app. Revisa tu conexión y recarga la página.</p>';
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Cuando una versión nueva del service worker toma el control, la página sigue con el
  // código viejo en memoria: se avisa para recargar (js/store.js escucha el evento).
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControlador) return;
    window.__gastosActualizacion = true;
    window.dispatchEvent(new Event('gastos:actualizacion'));
  });
  navigator.serviceWorker.register('sw.js').then((registro) => {
    let ultimaRevision = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimaRevision < 30 * 60000) return;
      ultimaRevision = Date.now();
      registro.update().catch(() => {});
    });
  }).catch(() => {});
}
