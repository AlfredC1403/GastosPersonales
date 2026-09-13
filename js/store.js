// Estado de la app: el documento de datos, quién está usando el dispositivo y la
// sincronización con OneDrive. Todo cambio se guarda al instante en el navegador y se
// sube a OneDrive unos segundos después, al archivo que le toca (principal o del año).
import { ESQUEMA, docVacio, sellar, fusionar, esPristino, vivo } from './core/modelo.js';
import { normalizar } from './core/migraciones.js';
import { crearIndice } from './core/asientos.js';
import { PRINCIPAL, archivoDe, aniosDelDoc, contenidoArchivo } from './core/anios.js';
import { periodoActual, hoy, dinero, dineroCorto } from './core/util.js';
import { sincronizarCarpeta, marcarPendiente } from './sincronizacion.js';
import { calcularAvisos, avisosVisibles } from './core/avisos.js';
import { coincidePersona } from './core/filtro.js';
import * as od from './onedrive.js';
import * as almacen from './almacen.js';
import { pinActivo, quitarPin } from './bloqueo.js';
import { prefs } from './tema.js';

const { reactive, markRaw, computed, toRaw } = Vue;

const CLAVES = { yo: 'gastos.yo', pinOlvidado: 'gastos.pinOlvidado' };

function leerTexto(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export const store = reactive({
  listo: false, // true cuando ya se cargaron los datos guardados en el navegador
  conPin: pinActivo(),
  bloqueada: pinActivo(),
  actualizacion: null, // 'app' | 'esquema': hay una versión nueva de la app
  doc: docVacio(),
  rev: 0, // cambia con cada edición: el índice se rehace
  hoy: hoy(),
  yo: leerTexto(CLAVES.yo),
  periodo: periodoActual(),
  usuario: null, // cuenta de Microsoft conectada: { nombre, email }
  // archivos: { [clave]: { itemId, eTag, esquema } }; pendientes: claves con cambios por subir
  sync: { estado: 'local', mensaje: '', codigo: '', ultima: null, ubicacion: null, archivos: {}, pendientes: [] },
  carpeta: [], // archivos de la carpeta de OneDrive en la última sincronización
  modal: null,
  avisos: [],
});

const docCrudo = () => toRaw(store.doc);

// Índice con asientos, estados y totales. Se rehace solo cuando cambian los datos o el día.
const indiceActual = computed(() => {
  void store.rev;
  return markRaw(crearIndice(docCrudo(), { hoy: store.hoy }));
});
export const indice = () => indiceActual.value;

// Avisos visibles en este dispositivo (sin los pospuestos ni los descartados), de todo el hogar.
const avisosActuales = computed(() => avisosVisibles(calcularAvisos(indice(), { hoy: store.hoy, sync: store.sync }), prefs.avisosOcultos, store.hoy));
// Con filtro de persona: los de esa persona y los que no son de nadie.
export const avisos = () => avisosActuales.value.filter((a) => !a.personaId || coincidePersona(a.personaId, filtro()));

// ---------------------------------------------------------------- Consultas

export const vivos = (coleccion) => store.doc[coleccion].filter(vivo);
export const buscar = (coleccion, id) => (id ? store.doc[coleccion].find((r) => r.id === id) : undefined);
export const nombrePersona = (id) => buscar('personas', id)?.nombre || 'Hogar';
export const nombreCuenta = (id) => buscar('cuentas', id)?.nombre || '—';
export const nombreCategoria = (id) => buscar('categorias', id)?.nombre || 'Sin categoría';
export const nombreGrupo = (id) => buscar('grupos', id)?.nombre || 'Sin grupo';
export const nombrePartida = (id) => buscar('partidas', id)?.nombre || '';
export const simbolo = () => store.doc.config.moneda || 'L';
export const simboloDe = (moneda) => (moneda === 'USD' ? store.doc.config.simboloExt || 'US$' : simbolo());
export const monedaDeCuenta = (id) => buscar('cuentas', id)?.moneda || 'L';
export const fmt = (n) => dinero(n, { simbolo: simbolo() });
export const fmtEntero = (n) => dinero(n, { simbolo: simbolo(), decimales: false });
export const fmtCorto = (n) => dineroCorto(n, simbolo());
export const fmtMoneda = (n, moneda) => dinero(n, { simbolo: simboloDe(moneda) });
export const personas = () => vivos('personas').sort((a, b) => a.nombre.localeCompare(b.nombre));
export const cuentas = () => vivos('cuentas');
export const categorias = () => vivos('categorias').sort((a, b) => a.nombre.localeCompare(b.nombre));
export const grupos = () => vivos('grupos').sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99) || a.nombre.localeCompare(b.nombre));
export const partidas = () => vivos('partidas').sort((a, b) => a.nombre.localeCompare(b.nombre));

// Categorías agrupadas para los selectores: [{ grupo, categorias }], en el orden de los grupos.
export function categoriasPorGrupo(tipo = 'gasto') {
  const lista = categorias().filter((c) => (c.tipo || 'gasto') === tipo);
  const out = grupos().map((g) => ({ grupo: g, categorias: lista.filter((c) => c.grupoId === g.id) })).filter((x) => x.categorias.length);
  const sueltas = lista.filter((c) => !grupos().some((g) => g.id === c.grupoId));
  if (sueltas.length) out.push({ grupo: { id: 'sin-grupo', nombre: 'Sin grupo' }, categorias: sueltas });
  return out;
}

// Persona elegida en el filtro de este dispositivo (null = todo el hogar).
export const personaFiltro = () => (prefs.persona && vivo(buscar('personas', prefs.persona)) ? prefs.persona : null);
export const filtro = () => (personaFiltro() ? { personaId: personaFiltro() } : null);

// Orden fijo de las personas (por fecha de creación y nombre) para darles siempre el mismo color.
export function colorPersona(id) {
  const orden = vivos('personas').sort((a, b) => (a.creado || '').localeCompare(b.creado || '') || a.nombre.localeCompare(b.nombre));
  const i = orden.findIndex((p) => p.id === id);
  return i < 0 ? 'var(--tinta3)' : ['var(--s2)', 'var(--s5)', 'var(--s4)', 'var(--s1)'][i % 4];
}

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

// ---------------------------------------------------------------- Guardado local

const contadores = new Map(); // cambios locales por archivo
let escrituraBloqueada = false; // el documento guardado es de una versión más nueva: no se pisa
let avisoGuardadoMostrado = false;

function errorGuardado(e) {
  if (avisoGuardadoMostrado) return;
  avisoGuardadoMostrado = true;
  aviso(`No se pudo guardar en este navegador (${e?.name || 'error'}). Los cambios siguen en OneDrive si está conectado.`, 'error', 9000);
}

function persistirLocal() {
  if (escrituraBloqueada) return;
  almacen.guardarDoc(docCrudo()).catch(errorGuardado);
}

function persistirSync() {
  const { ubicacion, archivos, pendientes, ultima } = toRaw(store.sync);
  almacen.guardarSync({ ubicacion, archivos, pendientes, ultima }).catch(errorGuardado);
}

async function cargarLocal() {
  const { doc, sync, perdido } = await almacen.cargar();
  if (doc) {
    try {
      store.doc = normalizar(doc);
      if ((Number(doc.esquema) || 1) < ESQUEMA) {
        // Copia del documento anterior antes de guardarlo con el esquema nuevo.
        await almacen.guardarRespaldo(`e${Number(doc.esquema) || 1}`, JSON.stringify(doc));
        persistirLocal();
      }
    } catch (e) {
      if (e.codigo === 'esquema_nuevo') {
        store.actualizacion = 'esquema';
        escrituraBloqueada = true;
      }
    }
  }
  if (sync?.ubicacion) {
    // La versión anterior guardaba un solo eTag: se vuelve a leer todo y, si había cambios
    // sin subir, se suben todos los archivos.
    const anterior = !('archivos' in sync);
    Object.assign(store.sync, {
      ubicacion: sync.ubicacion,
      archivos: anterior ? {} : sync.archivos || {},
      pendientes: anterior ? (sync.pendiente ? [PRINCIPAL, ...aniosDelDoc(docCrudo())] : []) : sync.pendientes || [],
      ultima: sync.ultima || null,
      estado: 'pendiente',
    });
  }
  store.listo = true;
  if (perdido) {
    aviso('El navegador borró los datos guardados en este dispositivo. Vuelve a conectar OneDrive en Datos y OneDrive.', 'error', 12000);
  }
}

function cambio(claves) {
  store.rev++;
  persistirLocal();
  for (const clave of new Set(claves.filter(Boolean))) {
    contadores.set(clave, (contadores.get(clave) || 0) + 1);
    if (store.sync.ubicacion) marcarPendiente(store.sync, clave);
  }
  if (store.sync.ubicacion) {
    persistirSync();
    programarSync();
  }
}

export function guardar(coleccion, registro) {
  const limpio = sellar(JSON.parse(JSON.stringify(registro)), store.yo);
  const lista = store.doc[coleccion];
  const i = lista.findIndex((r) => r.id === limpio.id);
  const antes = i >= 0 ? toRaw(lista[i]) : null;
  if (i >= 0) lista.splice(i, 1, limpio);
  else lista.push(limpio);
  // Si cambió de año, se suben los dos archivos: el nuevo con el registro y el viejo sin él.
  cambio([antes && archivoDe(docCrudo(), coleccion, antes), archivoDe(docCrudo(), coleccion, limpio)]);
  return limpio;
}

export function borrar(coleccion, id) {
  const r = buscar(coleccion, id);
  if (r) guardar(coleccion, { ...r, borrado: true });
}

export function guardarConfig(cambios) {
  store.doc.config = { ...store.doc.config, ...JSON.parse(JSON.stringify(cambios)), actualizado: new Date().toISOString() };
  cambio([PRINCIPAL]);
}

export function importar(texto) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  store.doc = fusionar(docCrudo(), normalizar(datos));
  cambio([PRINCIPAL, ...aniosDelDoc(docCrudo())]);
  identificarPorCorreo();
}

export const exportar = () => JSON.stringify(docCrudo(), null, 2);

export async function borrarDatosLocales() {
  await almacen.borrarTodo();
  try {
    localStorage.removeItem(CLAVES.yo);
  } catch {
    /* sin acceso a localStorage */
  }
  quitarPin();
  od.cerrarSesion();
  location.reload();
}

export async function infoAlmacen() {
  return { tipo: almacen.tipo(), usado: await almacen.espacioUsado(), tamanoDoc: new Blob([JSON.stringify(docCrudo())]).size };
}

// ---------------------------------------------------------------- Identidad

export function definirYo(personaId) {
  store.yo = personaId || null;
  try {
    if (personaId) localStorage.setItem(CLAVES.yo, personaId);
    else localStorage.removeItem(CLAVES.yo);
  } catch {
    /* sin acceso a localStorage */
  }
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

// ---------------------------------------------------------------- PIN

export const bloquear = () => {
  if (pinActivo()) store.bloqueada = true;
};

// Después de activar, cambiar o quitar el PIN.
export const actualizarEstadoPin = () => {
  store.conPin = pinActivo();
};

// "Olvidé mi PIN": con OneDrive, se vuelve a iniciar sesión con Microsoft (pidiendo la
// contraseña). Sin OneDrive, la única salida es borrar los datos de este navegador.
export async function recuperarPin() {
  if (store.sync.ubicacion && od.configurado()) {
    sessionStorage.setItem(CLAVES.pinOlvidado, '1');
    await od.iniciarSesion({ pedirClave: true });
    return;
  }
  await borrarDatosLocales();
}

// El PIN se quita solo si la cuenta con la que se inició sesión es de alguien del hogar.
function cuentaDelHogar(email) {
  const correos = vivos('personas').map((p) => (p.email || '').toLowerCase()).filter(Boolean);
  return !correos.length || correos.includes((email || '').toLowerCase());
}

// ---------------------------------------------------------------- OneDrive

let temporizador = null;
let enCurso = null;

function programarSync(ms = 1500) {
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, ms);
}

const libro = {
  doc: docCrudo,
  adoptar(doc) {
    store.doc = doc;
    store.rev++;
    persistirLocal();
  },
  cambios: (clave) => contadores.get(clave) || 0,
};

// Las ubicaciones guardadas por versiones anteriores no tienen la carpeta.
async function conCarpeta() {
  const ub = store.sync.ubicacion;
  if (ub.carpetaId) return ub;
  const meta = await od.metadatos(ub);
  store.sync.ubicacion = { ...ub, carpetaId: meta.carpetaId };
  return store.sync.ubicacion;
}

function operaciones(ub) {
  return {
    listar: async () => {
      const archivos = await od.listarCarpeta(ub);
      store.carpeta = archivos.map(({ nombre, tamano, modificado, modificadoPor }) => ({ nombre, tamano, modificado, modificadoPor }));
      return archivos;
    },
    descargar: (archivo) => od.descargarArchivo(ub, archivo),
    subir: (archivo, contenido, eTag) => od.subirArchivo(ub, archivo, contenido, eTag),
    crear: (nombre, contenido) => od.crearArchivo(ub, nombre, contenido),
    respaldar: (nombre, contenido) => od.respaldar(ub, nombre, contenido),
  };
}

const selloRespaldo = (d = new Date()) => `${hoy(d)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

export function sincronizar() {
  if (!store.sync.ubicacion || escrituraBloqueada) return Promise.resolve();
  if (enCurso) return enCurso;
  enCurso = (async () => {
    if (!navigator.onLine) {
      store.sync.estado = 'offline';
      return;
    }
    store.sync.estado = 'sincronizando';
    try {
      const ub = await conCarpeta();
      await sincronizarCarpeta({ libro, estado: store.sync, ops: operaciones(ub), sello: selloRespaldo() });
      store.sync.estado = store.sync.pendientes.length ? 'pendiente' : 'ok';
      store.sync.mensaje = '';
      store.sync.codigo = '';
      store.sync.ultima = new Date().toISOString();
      identificarPorCorreo();
    } catch (e) {
      if (e.codigo === 'esquema_nuevo') store.actualizacion = 'esquema';
      store.sync.estado = e.necesitaSesion ? 'sesion' : 'error';
      store.sync.mensaje = e.message;
      store.sync.codigo = e.codigo || '';
      if (e.status === 429 || e.status === 503 || e.status === 412) programarSync(30000);
    } finally {
      persistirSync();
      enCurso = null;
    }
    // Hubo cambios mientras se subía: otra pasada.
    if (store.sync.estado === 'pendiente') programarSync();
  })();
  return enCurso;
}

async function vincular(ubicacion, archivos = {}) {
  const habiaDatos = !esPristino(docCrudo());
  Object.assign(store.sync, {
    ubicacion, archivos, pendientes: habiaDatos ? [PRINCIPAL, ...aniosDelDoc(docCrudo())] : [], estado: 'pendiente', mensaje: '', codigo: '',
  });
  persistirSync();
  await sincronizar();
  if (store.sync.estado === 'error') throw new Error(store.sync.mensaje);
}

// Dueño de los datos: usa la carpeta de su OneDrive o la crea con los datos de este dispositivo.
export async function usarMiOneDrive() {
  const existente = await od.buscarPropio();
  if (existente) {
    await vincular(existente);
    aviso('Conectado a tu carpeta de OneDrive.', 'ok');
    return;
  }
  const r = await od.crearPropio(contenidoArchivo(docCrudo(), PRINCIPAL));
  await vincular(r.ubicacion, { [PRINCIPAL]: { itemId: r.itemId, eTag: r.eTag, esquema: ESQUEMA } });
  aviso('Creé la carpeta GastosHogar en tu OneDrive.', 'ok');
}

// Otra persona del hogar: abre los datos con el enlace de la carpeta que le compartieron.
export async function usarEnlace(enlace) {
  await vincular(await od.resolverEnlace(enlace));
  aviso('Conectado a la carpeta compartida.', 'ok');
}

export function desconectar() {
  Object.assign(store.sync, { ubicacion: null, archivos: {}, pendientes: [], estado: 'local', mensaje: '', codigo: '' });
  store.carpeta = [];
  persistirSync();
  od.cerrarSesion();
  store.usuario = null;
}

export async function respaldarAhora() {
  const ub = await conCarpeta();
  const nombre = `finanzas-respaldo-${selloRespaldo()}.json`;
  await od.respaldar(ub, nombre, docCrudo());
  return nombre;
}

export const listarRespaldos = async () => od.listarRespaldos(await conCarpeta());

// ---------------------------------------------------------------- Inicio

function marcarActualizacion() {
  store.actualizacion ??= 'app';
}

export async function iniciar() {
  await cargarLocal();
  almacen.pedirPersistencia();

  if (window.__gastosActualizacion) marcarActualizacion();
  window.addEventListener('gastos:actualizacion', marcarActualizacion);

  let volvio = false;
  try {
    volvio = await od.completarInicio();
    if (volvio) aviso('Conectado con Microsoft.', 'ok');
  } catch (e) {
    aviso(e.message, 'error', 9000);
  }
  const pinOlvidado = sessionStorage.getItem(CLAVES.pinOlvidado) === '1';
  sessionStorage.removeItem(CLAVES.pinOlvidado);

  if (od.tieneSesion()) {
    try {
      store.usuario = await od.perfil();
      identificarPorCorreo();
    } catch (e) {
      if (!e.necesitaSesion) aviso(e.message, 'error', 6000);
    }
  }

  if (pinOlvidado && volvio && store.usuario) {
    if (cuentaDelHogar(store.usuario.email)) {
      quitarPin();
      actualizarEstadoPin();
      store.bloqueada = false;
      location.hash = '#/seguridad';
      aviso('Iniciaste sesión con Microsoft y se quitó el PIN. Puedes crear uno nuevo.', 'ok', 9000);
    } else {
      aviso(`La cuenta ${store.usuario.email} no es de ninguna persona del hogar. El PIN sigue activo.`, 'error', 10000);
    }
  }

  // El día cambia a medianoche aunque la app siga abierta.
  setInterval(() => {
    const h = hoy();
    if (h !== store.hoy) store.hoy = h;
  }, 60000);

  if (store.sync.ubicacion) {
    if (!od.tieneSesion() && od.reconectarSinPreguntar()) return; // la página va a Microsoft y vuelve
    await sincronizar();
  }
  setInterval(() => document.visibilityState === 'visible' && sincronizar(), 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sincronizar());
  window.addEventListener('online', () => sincronizar());
}
