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
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
