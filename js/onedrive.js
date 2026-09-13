// Inicio de sesión con Microsoft (OAuth 2.0 con PKCE, sin librerías) y acceso al archivo
// de datos en OneDrive mediante Microsoft Graph.
import { CONFIG } from './config.js';
import { nombreArchivo, PRINCIPAL } from './core/anios.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ALCANCES = 'openid profile offline_access User.Read Files.ReadWrite.All';
const CLAVES = { auth: 'gastos.auth', pkce: 'gastos.pkce', clientId: 'gastos.clientId', intento: 'gastos.intentoSesion' };
const ARCHIVO = nombreArchivo(PRINCIPAL);
const RUTA_PROPIA = `/me/drive/root:/${CONFIG.carpeta}/${ARCHIVO}`;

export const clientId = () => localStorage.getItem(CLAVES.clientId) || CONFIG.clientId || '';
export const configurado = () => !!clientId();
export function guardarClientId(valor) {
  if (valor?.trim()) localStorage.setItem(CLAVES.clientId, valor.trim());
  else localStorage.removeItem(CLAVES.clientId);
}

const autoridad = () => `https://login.microsoftonline.com/${CONFIG.tenant}/oauth2/v2.0`;
// Debe coincidir exactamente con la URI registrada en Azure (con "/" final, sin index.html).
export const direccionRetorno = () => location.origin + location.pathname.replace(/index\.html$/, '');

function errorCon(mensaje, extra = {}) {
  return Object.assign(new Error(mensaje), extra);
}

// ---------------------------------------------------------------- Sesión

function base64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const aleatorio = (n) => base64url(crypto.getRandomValues(new Uint8Array(n)));

function leerAuth() {
  try {
    return JSON.parse(localStorage.getItem(CLAVES.auth));
  } catch {
    return null;
  }
}

export const tieneSesion = () => {
  const a = leerAuth();
  return !!(a?.refresh || a?.expira > Date.now());
};

export function cerrarSesion() {
  localStorage.removeItem(CLAVES.auth);
}

// Redirige a Microsoft. Con `silenciosa`, no muestra pantalla si ya hay una sesión abierta.
// Con `pedirClave`, Microsoft pide la contraseña aunque haya una sesión abierta.
export async function iniciarSesion({ silenciosa = false, pedirClave = false } = {}) {
  if (!configurado()) throw errorCon('Falta el ID de la aplicación de Azure (ver Datos y OneDrive).');
  const verificador = aleatorio(48);
  const reto = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador)));
  const estado = aleatorio(16);
  sessionStorage.setItem(CLAVES.pkce, JSON.stringify({ verificador, estado, silenciosa, volver: location.hash }));
  const q = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: direccionRetorno(), response_mode: 'query',
    scope: ALCANCES, code_challenge: reto, code_challenge_method: 'S256', state: estado,
  });
  if (silenciosa) q.set('prompt', 'none');
  else if (pedirClave) q.set('prompt', 'login');
  location.assign(`${autoridad()}/authorize?${q}`);
  return new Promise(() => {}); // la página se va a Microsoft
}

// Intenta reconectar sin molestar, como mucho una vez por minuto (evita bucles).
export function reconectarSinPreguntar() {
  const ultimo = Number(sessionStorage.getItem(CLAVES.intento)) || 0;
  if (!navigator.onLine || !configurado() || Date.now() - ultimo < 60000) return false;
  sessionStorage.setItem(CLAVES.intento, String(Date.now()));
  iniciarSesion({ silenciosa: true });
  return true;
}

// Al volver de Microsoft (?code=...), cambia el código por tokens.
export async function completarInicio() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const guardado = JSON.parse(sessionStorage.getItem(CLAVES.pkce) || 'null');
  sessionStorage.removeItem(CLAVES.pkce);
  history.replaceState(null, '', direccionRetorno() + (guardado?.volver || ''));
  window.dispatchEvent(new HashChangeEvent('hashchange')); // vuelve a la pestaña donde estaba
  if (!guardado || q.get('state') !== guardado.estado) {
    throw errorCon('La respuesta de Microsoft no coincide con la solicitud. Intenta conectar de nuevo.');
  }
  if (q.has('error')) {
    const codigo = q.get('error');
    if (guardado.silenciosa && ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'].includes(codigo)) {
      return iniciarSesion(); // hace falta que la persona elija su cuenta
    }
    throw errorCon(`Microsoft no permitió el inicio de sesión: ${explicar(q.get('error_description') || codigo)}`);
  }
  await pedirToken({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: direccionRetorno(), code_verifier: guardado.verificador });
  sessionStorage.removeItem(CLAVES.intento);
  return true;
}

function explicar(descripcion = '') {
  if (descripcion.includes('AADSTS9002326')) return 'la dirección de retorno está registrada como "Web"; debe ser "Aplicación de página única (SPA)".';
  if (descripcion.includes('AADSTS50011')) return `la dirección ${direccionRetorno()} no está registrada como URI de redirección en Azure.`;
  if (descripcion.includes('AADSTS700016')) return 'el ID de la aplicación no existe. Revisa el ID en Ajustes o en js/config.js.';
  if (descripcion.includes('AADSTS50020') || descripcion.includes('AADSTS50194')) return 'la cuenta no es compatible con el registro. Registra la app para "cuentas personales de Microsoft".';
  return descripcion.split(/\r?\n/)[0];
}

async function pedirToken(parametros) {
  const res = await fetch(`${autoridad()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), scope: ALCANCES, ...parametros }),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok) throw errorCon(explicar(t.error_description || t.error || `error ${res.status}`), { codigo: t.error });
  const auth = { access: t.access_token, expira: Date.now() + (Number(t.expires_in) - 120) * 1000, refresh: t.refresh_token || leerAuth()?.refresh };
  localStorage.setItem(CLAVES.auth, JSON.stringify(auth));
  return auth.access;
}

let renovando = null;
async function token() {
  const a = leerAuth();
  if (a?.access && a.expira > Date.now()) return a.access;
  if (a?.refresh) {
    renovando ??= pedirToken({ grant_type: 'refresh_token', refresh_token: a.refresh }).finally(() => { renovando = null; });
    try {
      return await renovando;
    } catch (e) {
      if (!['invalid_grant', 'interaction_required'].includes(e.codigo)) throw e;
      cerrarSesion(); // el permiso de 24 h para apps de página única venció
    }
  }
  throw errorCon('La sesión de Microsoft venció. Vuelve a conectar.', { necesitaSesion: true });
}

// ---------------------------------------------------------------- Graph

async function graph(ruta, opciones = {}, reintentar = true) {
  const t = await token();
  const res = await fetch(ruta.startsWith('http') ? ruta : GRAPH + ruta, {
    ...opciones,
    headers: { Authorization: `Bearer ${t}`, ...(opciones.headers || {}) },
  });
  if (res.status === 401 && reintentar) {
    const a = leerAuth();
    if (a) localStorage.setItem(CLAVES.auth, JSON.stringify({ ...a, expira: 0 }));
    return graph(ruta, opciones, false);
  }
  return res;
}

async function errorGraph(res) {
  const j = await res.json().catch(() => ({}));
  const detalle = j.error?.message ? ` (${j.error.message})` : '';
  const mensajes = {
    403: 'No tienes permiso para editar ese archivo. Pide que te lo compartan con permiso de edición.',
    404: 'No encontré el archivo en OneDrive. ¿Lo movieron o lo borraron?',
    412: 'Otra persona guardó al mismo tiempo.',
    429: 'OneDrive pidió esperar un momento; se reintentará solo.',
    503: 'OneDrive no está disponible ahora; se reintentará solo.',
  };
  return errorCon(mensajes[res.status] || `OneDrive respondió ${res.status}${detalle}`, { status: res.status });
}

async function graphJSON(ruta, opciones) {
  const res = await graph(ruta, opciones);
  if (!res.ok) throw await errorGraph(res);
  return res.json();
}

export async function perfil() {
  const yo = await graphJSON('/me');
  return { nombre: yo.displayName || '', email: yo.mail || yo.userPrincipalName || '' };
}

// `origen`: 'propio' (OneDrive de quien inicia sesión) o 'carpeta' (enlace compartido de la carpeta).
const ubicacionDe = (item, origen) => ({
  driveId: item.parentReference?.driveId,
  itemId: item.id,
  carpetaId: item.parentReference?.id || null,
  nombre: item.name,
  origen,
  propio: origen === 'propio',
  dueno: item.createdBy?.user?.displayName || '',
});

export async function buscarPropio() {
  const res = await graph(RUTA_PROPIA);
  if (res.status === 404) return null;
  if (!res.ok) throw await errorGraph(res);
  return ubicacionDe(await res.json(), 'propio');
}

// Crea la carpeta en el OneDrive de quien inicia sesión y el archivo principal con `contenido`.
export async function crearPropio(contenido) {
  const carpeta = await graph('/me/drive/root/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CONFIG.carpeta, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (!carpeta.ok && carpeta.status !== 409) throw await errorGraph(carpeta);
  const item = await graphJSON(`${RUTA_PROPIA}:/content?%40microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contenido),
  });
  return { ubicacion: ubicacionDe(item, 'propio'), itemId: item.id, eTag: item.eTag };
}

// Código que pide Graph para abrir un enlace compartido (`/shares/{codigo}`).
export const codificarEnlace = (url) =>
  'u!' + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

// Enlace de la carpeta GastosHogar que compartió la otra persona. Tiene que ser de la
// carpeta (no del archivo) para poder ver también los respaldos y los archivos por año.
export async function resolverEnlace(enlace) {
  const url = enlace.trim();
  if (!/^https:\/\//i.test(url)) throw errorCon('Pega el enlace completo, empieza con https://');
  const item = await graphJSON(`/shares/${codificarEnlace(url)}/driveItem`, { headers: { Prefer: 'redeemSharingLink' } });
  if (!item.folder) {
    throw errorCon(`Ese enlace es de un archivo. Pide el enlace de la carpeta ${CONFIG.carpeta} (compartida con permiso para editar).`);
  }
  const driveId = item.parentReference?.driveId;
  const res = await graph(`/drives/${driveId}/items/${item.id}:/${encodeURIComponent(ARCHIVO)}`);
  if (res.status === 404) throw errorCon(`En esa carpeta no está ${ARCHIVO}.`);
  if (!res.ok) throw await errorGraph(res);
  const hijo = await res.json();
  return ubicacionDe({ ...hijo, parentReference: { ...hijo.parentReference, driveId: hijo.parentReference?.driveId || driveId } }, 'carpeta');
}

export async function metadatos(ub) {
  const item = await graphJSON(`/drives/${ub.driveId}/items/${ub.itemId}`);
  return {
    eTag: item.eTag,
    url: item['@microsoft.graph.downloadUrl'],
    carpetaId: item.parentReference?.id || null,
    modificado: item.lastModifiedDateTime,
    modificadoPor: item.lastModifiedBy?.user?.displayName || '',
  };
}

// ---------------------------------------------------------------- Archivos de la carpeta

// Archivos de la carpeta de datos (sin subcarpetas). Si no hay acceso a la carpeta, la
// conexión se hizo con el enlace de un archivo suelto.
export async function listarCarpeta(ub) {
  const archivos = [];
  let ruta = `/drives/${ub.driveId}/items/${ub.carpetaId}/children?$top=200`;
  while (ruta) {
    const res = await graph(ruta);
    if (res.status === 403 || res.status === 404) {
      throw errorCon(`No tengo acceso a la carpeta ${CONFIG.carpeta}. Pide que te compartan la carpeta (no el archivo) con permiso para editar y vuelve a conectar en Datos y OneDrive.`, { status: res.status, codigo: 'sin_carpeta' });
    }
    if (!res.ok) throw await errorGraph(res);
    const pagina = await res.json();
    for (const it of pagina.value || []) {
      if (!it.file) continue;
      archivos.push({
        nombre: it.name, itemId: it.id, eTag: it.eTag, url: it['@microsoft.graph.downloadUrl'], tamano: it.size,
        modificado: it.lastModifiedDateTime, modificadoPor: it.lastModifiedBy?.user?.displayName || '',
      });
    }
    ruta = pagina['@odata.nextLink'] || null;
  }
  return archivos;
}

// Siempre con el enlace de descarga: pedir `/content` desde el navegador falla por CORS.
export async function descargarArchivo(ub, archivo) {
  let url = archivo.url;
  if (!url) url = (await graphJSON(`/drives/${ub.driveId}/items/${archivo.itemId}`))['@microsoft.graph.downloadUrl'];
  if (!url) throw errorCon('OneDrive no dio el enlace de descarga. Intenta sincronizar de nuevo.');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw errorCon(`No pude descargar ${archivo.nombre} de OneDrive (${res.status}).`);
  return res.json();
}

async function escribir(ruta, contenido, encabezados = {}) {
  const res = await graph(ruta, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...encabezados },
    body: JSON.stringify(contenido),
  });
  if (!res.ok) throw await errorGraph(res);
  const item = await res.json();
  return { itemId: item.id, eTag: item.eTag };
}

// Sube un archivo solo si nadie lo cambió desde `eTag` (si no, lanza status 412).
export const subirArchivo = (ub, archivo, contenido, eTag) =>
  escribir(`/drives/${ub.driveId}/items/${archivo.itemId}/content`, contenido, eTag ? { 'If-Match': eTag } : {});

// Crea un archivo nuevo en la carpeta; si ya existe, lanza status 409.
export const crearArchivo = (ub, nombre, contenido) =>
  escribir(`/drives/${ub.driveId}/items/${ub.carpetaId}:/${encodeURIComponent(nombre)}:/content?%40microsoft.graph.conflictBehavior=fail`, contenido);

// ---------------------------------------------------------------- Respaldos

const CARPETA_RESPALDOS = 'respaldos';
const MAX_RESPALDOS = 10;

export async function listarRespaldos(ub) {
  const res = await graph(`/drives/${ub.driveId}/items/${ub.carpetaId}:/${CARPETA_RESPALDOS}:/children?$top=200`);
  if (res.status === 404) return [];
  if (!res.ok) throw await errorGraph(res);
  const pagina = await res.json();
  return (pagina.value || [])
    .filter((it) => it.file)
    .map((it) => ({ nombre: it.name, itemId: it.id, tamano: it.size, modificado: it.lastModifiedDateTime }))
    .sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''));
}

// Guarda una copia en GastosHogar/respaldos y deja solo las más recientes.
export async function respaldar(ub, nombre, contenido) {
  const carpeta = await graph(`/drives/${ub.driveId}/items/${ub.carpetaId}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CARPETA_RESPALDOS, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (!carpeta.ok && carpeta.status !== 409) throw await errorGraph(carpeta);
  await escribir(`/drives/${ub.driveId}/items/${ub.carpetaId}:/${CARPETA_RESPALDOS}/${encodeURIComponent(nombre)}:/content`, contenido);
  try {
    for (const viejo of (await listarRespaldos(ub)).slice(MAX_RESPALDOS)) {
      await graph(`/drives/${ub.driveId}/items/${viejo.itemId}`, { method: 'DELETE' });
    }
  } catch {
    /* si no se pueden quitar los viejos, el respaldo nuevo igual quedó guardado */
  }
}
