// Estado de la app: el documento de datos, quién está usando el dispositivo y la
// sincronización con OneDrive. Todo cambio se guarda al instante en el navegador y se
// sube a OneDrive unos segundos después.
import { docVacio, normalizar, sellar, fusionar, esPristino, vivo } from './core/modelo.js';
import { periodoActual, dinero, dineroCorto } from './core/util.js';
import * as od from './onedrive.js';

const { reactive, markRaw } = Vue;

const CLAVES = { doc: 'gastos.doc', yo: 'gastos.yo', sync: 'gastos.sync' };

function leer(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave));
  } catch {
    return null;
  }
}

function escribir(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    aviso(`No se pudo guardar en este navegador (${e.name}).`, 'error');
  }
}

function docGuardado() {
  const d = leer(CLAVES.doc);
  if (!d) return docVacio();
  try {
    return normalizar(d);
  } catch {
    return docVacio();
  }
}

const syncGuardado = leer(CLAVES.sync) || {};

export const store = reactive({
  doc: docGuardado(),
  yo: localStorage.getItem(CLAVES.yo) || null,
  periodo: periodoActual(),
  usuario: null, // cuenta de Microsoft conectada: { nombre, email }
  sync: {
    estado: syncGuardado.ubicacion ? 'pendiente' : 'local',
    mensaje: '',
    ultima: syncGuardado.ultima || null,
    ubicacion: syncGuardado.ubicacion || null,
    eTag: syncGuardado.eTag || null,
    pendiente: !!syncGuardado.pendiente,
  },
  modal: null,
  avisos: [],
});

// ---------------------------------------------------------------- Consultas

export const vivos = (coleccion) => store.doc[coleccion].filter(vivo);
export const buscar = (coleccion, id) => (id ? store.doc[coleccion].find((r) => r.id === id) : undefined);
export const nombrePersona = (id) => buscar('personas', id)?.nombre || 'Hogar';
export const nombreCuenta = (id) => buscar('cuentas', id)?.nombre || '—';
export const nombreCategoria = (id) => buscar('categorias', id)?.nombre || 'Sin categoría';
export const simbolo = () => store.doc.config.moneda || 'L';
export const fmt = (n) => dinero(n, { simbolo: simbolo() });
export const fmtEntero = (n) => dinero(n, { simbolo: simbolo(), decimales: false });
export const fmtCorto = (n) => dineroCorto(n, simbolo());
export const personas = () => vivos('personas').sort((a, b) => a.nombre.localeCompare(b.nombre));
export const cuentas = () => vivos('cuentas');
export const categorias = () => vivos('categorias').sort((a, b) => a.nombre.localeCompare(b.nombre));

// ---------------------------------------------------------------- Avisos y modal

let siguienteAviso = 1;
export function aviso(texto, tipo = 'info', ms = 3500, accion = null) {
  const id = siguienteAviso++;
  store.avisos.push({ id, texto, tipo, accion });
  setTimeout(() => cerrarAviso(id), ms);
}
export function cerrarAviso(id) {
  const i = store.avisos.findIndex((a) => a.id === id);
  if (i >= 0) store.avisos.splice(i, 1);
}

let siguienteModal = 1;
export function abrirModal(titulo, componente, props = {}) {
  store.modal = { id: siguienteModal++, titulo, componente: markRaw(componente), props };
}
export function cerrarModal() {
  store.modal = null;
}

// ---------------------------------------------------------------- Cambios

let cambiosLocales = 0;

function persistirLocal() {
  escribir(CLAVES.doc, store.doc);
}

function persistirSync() {
  const { ubicacion, eTag, pendiente, ultima } = store.sync;
  escribir(CLAVES.sync, { ubicacion, eTag, pendiente, ultima });
}

function cambio() {
  cambiosLocales++;
  persistirLocal();
  if (store.sync.ubicacion) {
    store.sync.pendiente = true;
    persistirSync();
    programarSync();
  }
}

export function guardar(coleccion, registro) {
  const limpio = sellar(JSON.parse(JSON.stringify(registro)), store.yo);
  const lista = store.doc[coleccion];
  const i = lista.findIndex((r) => r.id === limpio.id);
  if (i >= 0) lista.splice(i, 1, limpio);
  else lista.push(limpio);
  cambio();
  return limpio;
}

export function borrar(coleccion, id) {
  const r = buscar(coleccion, id);
  if (r) guardar(coleccion, { ...r, borrado: true });
}

export function guardarConfig(cambios) {
  store.doc.config = { ...store.doc.config, ...JSON.parse(JSON.stringify(cambios)), actualizado: new Date().toISOString() };
  cambio();
}

export function importar(texto) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  store.doc = fusionar(store.doc, normalizar(datos));
  cambio();
  identificarPorCorreo();
}

export const exportar = () => JSON.stringify(store.doc, null, 2);

export function borrarDatosLocales() {
  localStorage.removeItem(CLAVES.doc);
  localStorage.removeItem(CLAVES.sync);
  localStorage.removeItem(CLAVES.yo);
  od.cerrarSesion();
  location.reload();
}

// ---------------------------------------------------------------- Identidad

export function definirYo(personaId) {
  store.yo = personaId || null;
  if (personaId) localStorage.setItem(CLAVES.yo, personaId);
  else localStorage.removeItem(CLAVES.yo);
}

function identificarPorCorreo() {
  const email = store.usuario?.email?.toLowerCase();
  if (!email) return;
  const p = vivos('personas').find((x) => (x.email || '').toLowerCase() === email);
  if (p && store.yo !== p.id) definirYo(p.id);
}

// La persona elige quién es; si está conectada a Microsoft, se recuerda su correo.
export function soyYo(personaId) {
  definirYo(personaId);
  const p = buscar('personas', personaId);
  const email = store.usuario?.email;
  if (p && email && (p.email || '').toLowerCase() !== email.toLowerCase()) guardar('personas', { ...p, email });
}

// ---------------------------------------------------------------- OneDrive

let temporizador = null;
let enCurso = null;

function programarSync(ms = 1500) {
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, ms);
}

function adoptarRemoto(remoto) {
  store.doc = fusionar(store.doc, normalizar(remoto));
  persistirLocal();
  identificarPorCorreo();
}

export function sincronizar() {
  if (!store.sync.ubicacion) return Promise.resolve();
  if (enCurso) return enCurso;
  enCurso = (async () => {
    if (!navigator.onLine) {
      store.sync.estado = 'offline';
      return;
    }
    store.sync.estado = 'sincronizando';
    try {
      for (let intento = 0; intento < 4; intento++) {
        const meta = await od.metadatos(store.sync.ubicacion);
        if (meta.eTag !== store.sync.eTag) {
          adoptarRemoto(await od.descargar(store.sync.ubicacion, meta));
          store.sync.eTag = meta.eTag;
        }
        if (!store.sync.pendiente) break;
        const version = cambiosLocales;
        try {
          const r = await od.subir(store.sync.ubicacion, store.doc, store.sync.eTag);
          store.sync.eTag = r.eTag;
          if (version === cambiosLocales) store.sync.pendiente = false;
          else programarSync();
          break;
        } catch (e) {
          if (e.status !== 412) throw e; // 412: alguien guardó justo antes; se fusiona y se reintenta
        }
      }
      store.sync.estado = store.sync.pendiente ? 'pendiente' : 'ok';
      store.sync.mensaje = '';
      store.sync.ultima = new Date().toISOString();
    } catch (e) {
      store.sync.estado = e.necesitaSesion ? 'sesion' : 'error';
      store.sync.mensaje = e.message;
      if (e.status === 429 || e.status === 503) programarSync(30000);
    } finally {
      persistirSync();
      enCurso = null;
    }
  })();
  return enCurso;
}

async function vincular(ubicacion) {
  const meta = await od.metadatos(ubicacion);
  const remoto = normalizar(await od.descargar(ubicacion, meta));
  const habiaDatos = !esPristino(store.doc);
  store.doc = habiaDatos ? fusionar(store.doc, remoto) : remoto;
  Object.assign(store.sync, { ubicacion, eTag: meta.eTag, pendiente: habiaDatos, estado: 'ok', mensaje: '', ultima: new Date().toISOString() });
  persistirLocal();
  persistirSync();
  identificarPorCorreo();
  if (habiaDatos) await sincronizar();
}

// Dueño del archivo: lo busca en su OneDrive o lo crea con los datos de este dispositivo.
export async function usarMiOneDrive() {
  const existente = await od.buscarPropio();
  if (existente) {
    await vincular(existente);
    aviso('Conectado a tu archivo de OneDrive.', 'ok');
    return;
  }
  const r = await od.crearPropio(store.doc);
  Object.assign(store.sync, { ubicacion: r.ubicacion, eTag: r.eTag, pendiente: false, estado: 'ok', mensaje: '', ultima: new Date().toISOString() });
  persistirSync();
  aviso('Creé GastosHogar/finanzas.json en tu OneDrive.', 'ok');
}

// Otra persona del hogar: abre el archivo con el enlace que le compartieron.
export async function usarEnlace(enlace) {
  await vincular(await od.resolverEnlace(enlace));
  aviso('Conectado al archivo compartido.', 'ok');
}

export function desconectar() {
  Object.assign(store.sync, { ubicacion: null, eTag: null, pendiente: false, estado: 'local', mensaje: '' });
  persistirSync();
  od.cerrarSesion();
  store.usuario = null;
}

export async function iniciar() {
  try {
    if (await od.completarInicio()) aviso('Conectado con Microsoft.', 'ok');
  } catch (e) {
    aviso(e.message, 'error', 9000);
  }
  if (od.tieneSesion()) {
    try {
      store.usuario = await od.perfil();
      identificarPorCorreo();
    } catch (e) {
      if (!e.necesitaSesion) aviso(e.message, 'error', 6000);
    }
  }
  if (store.sync.ubicacion) {
    if (!od.tieneSesion() && od.reconectarSinPreguntar()) return; // la página va a Microsoft y vuelve
    await sincronizar();
  }
  setInterval(() => document.visibilityState === 'visible' && sincronizar(), 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sincronizar());
  window.addEventListener('online', () => sincronizar());
}
