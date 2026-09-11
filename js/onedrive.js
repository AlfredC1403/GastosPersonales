// Inicio de sesión con Microsoft (OAuth 2.0 con PKCE, sin librerías) y acceso al archivo
// de datos en OneDrive mediante Microsoft Graph.
import { CONFIG } from './config.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ALCANCES = 'openid profile offline_access User.Read Files.ReadWrite.All';
const CLAVES = { auth: 'gastos.auth', pkce: 'gastos.pkce', clientId: 'gastos.clientId', intento: 'gastos.intentoSesion' };
const RUTA_PROPIA = `/me/drive/root:/${CONFIG.carpeta}/${CONFIG.archivo}`;

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
export async function iniciarSesion({ silenciosa = false } = {}) {
  if (!configurado()) throw errorCon('Falta el ID de la aplicación de Azure (ver Ajustes).');
  const verificador = aleatorio(48);
  const reto = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador)));
  const estado = aleatorio(16);
  sessionStorage.setItem(CLAVES.pkce, JSON.stringify({ verificador, estado, silenciosa, volver: location.hash }));
  const q = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: direccionRetorno(), response_mode: 'query',
    scope: ALCANCES, code_challenge: reto, code_challenge_method: 'S256', state: estado,
  });
  if (silenciosa) q.set('prompt', 'none');
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

const ubicacionDe = (item, propio) => ({
  driveId: item.parentReference?.driveId,
  itemId: item.id,
  nombre: item.name,
  propio,
  dueno: item.createdBy?.user?.displayName || '',
});

export async function buscarPropio() {
  const res = await graph(RUTA_PROPIA);
  if (res.status === 404) return null;
  if (!res.ok) throw await errorGraph(res);
  return ubicacionDe(await res.json(), true);
}

export async function crearPropio(doc) {
  const carpeta = await graph('/me/drive/root/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CONFIG.carpeta, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (!carpeta.ok && carpeta.status !== 409) throw await errorGraph(carpeta);
  const item = await graphJSON(`${RUTA_PROPIA}:/content?%40microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  return { ubicacion: ubicacionDe(item, true), eTag: item.eTag };
}

// Enlace que compartió la otra persona (de la carpeta GastosHogar o del archivo).
export async function resolverEnlace(enlace) {
  const url = enlace.trim();
  if (!/^https:\/\//i.test(url)) throw errorCon('Pega el enlace completo, empieza con https://');
  const codigo = 'u!' + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  const item = await graphJSON(`/shares/${codigo}/driveItem?$expand=children`);
  if (item.folder) {
    const hijo = (item.children || []).find((c) => c.name.toLowerCase() === CONFIG.archivo);
    if (!hijo) throw errorCon(`En esa carpeta no está ${CONFIG.archivo}.`);
    const driveId = hijo.parentReference?.driveId || item.parentReference?.driveId;
    return ubicacionDe({ ...hijo, parentReference: { ...hijo.parentReference, driveId } }, false);
  }
  return ubicacionDe(item, false);
}

export async function metadatos(ub) {
  const item = await graphJSON(`/drives/${ub.driveId}/items/${ub.itemId}`);
  return {
    eTag: item.eTag,
    url: item['@microsoft.graph.downloadUrl'],
    modificado: item.lastModifiedDateTime,
    modificadoPor: item.lastModifiedBy?.user?.displayName || '',
  };
}

export async function descargar(ub, meta) {
  const res = meta?.url
    ? await fetch(meta.url, { cache: 'no-store' })
    : await graph(`/drives/${ub.driveId}/items/${ub.itemId}/content`, { cache: 'no-store' });
  if (!res.ok) throw errorCon(`No pude descargar el archivo de OneDrive (${res.status}).`);
  return res.json();
}

// Sube el documento solo si nadie lo cambió desde `eTag` (si no, lanza status 412).
export async function subir(ub, doc, eTag) {
  const res = await graph(`/drives/${ub.driveId}/items/${ub.itemId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(eTag ? { 'If-Match': eTag } : {}) },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw await errorGraph(res);
  const item = await res.json();
  return { eTag: item.eTag };
}
