// Estado de la app: el documento de datos, quién está usando el dispositivo y la
// sincronización con OneDrive. Todo cambio se guarda al instante en el navegador y se
// sube a OneDrive unos segundos después, al archivo que le toca (principal o del año).
import { ESQUEMA, COLECCIONES_ANIO, docVacio, sellar, fusionar, esPristino, vivo } from './core/modelo.js';
import { normalizar } from './core/migraciones.js';
import { crearIndice } from './core/asientos.js';
import { resumenDelAnio } from './core/reportes.js';
import { PRINCIPAL, archivoDe, aniosDelDoc, contenidoArchivo, claveDeNombre } from './core/anios.js';
import { aniosCargados, aperturaActiva, quitarAnios, cierresPendientes } from './core/cierres.js';
import { periodoActual, hoy, dinero, dineroCorto } from './core/util.js';
import { sincronizarCarpeta, marcarPendiente } from './sincronizacion.js';
import { calcularAvisos, avisosVisibles } from './core/avisos.js';
import { coincidePersona } from './core/filtro.js';
import * as od from './onedrive.js';
import * as almacen from './almacen.js';
import { pinActivo, quitarPin } from './bloqueo.js';
import { prefs } from './tema.js';

const { reactive, markRaw, computed, toRaw } = Vue;

const CLAVES = { yo: 'gastos.yo', pinOlvidado: 'gastos.pinOlvidado', recordatorios: 'gastos.recordatorios' };

function leerTexto(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function leerRecordatorios() {
  try {
    const { ultima = null, dia = '', huella = '', error = '', resultado = null } = JSON.parse(leerTexto(CLAVES.recordatorios) || '{}');
    return { ultima, dia, huella, error, resultado };
  } catch {
    return { ultima: null, dia: '', huella: '', error: '', resultado: null };
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
  anio: periodoActual().slice(0, 4), // año que se ve en el resumen anual
  usuario: null, // cuenta de Microsoft conectada: { nombre, email }
  // archivos: { [clave]: { itemId, eTag, esquema } }; pendientes: claves con cambios por subir;
  // cargados: años cuyo archivo está en el documento (con OneDrive se cargan el año actual y el anterior)
  sync: { estado: 'local', mensaje: '', codigo: '', ultima: null, ubicacion: null, archivos: {}, pendientes: [], cargados: undefined },
  carpeta: [], // archivos de la carpeta de OneDrive en la última sincronización
  // Años anteriores abiertos en esta sesión (se cargan de OneDrive) y los que se pueden editar.
  anios: { abiertos: [], editar: [], cargando: '' },
  modal: null,
  avisos: [],
  // Recordatorios en Outlook de este dispositivo: la última pasada y su resultado (ver js/recordatorios.js).
  recordatorios: { ...leerRecordatorios(), trabajando: false, prueba: null },
});

export function guardarEstadoRecordatorios() {
  const { ultima, dia, huella, error, resultado } = store.recordatorios;
  try {
    localStorage.setItem(CLAVES.recordatorios, JSON.stringify({ ultima, dia, huella, error, resultado }));
  } catch {
    /* sin almacenamiento: se revisa de nuevo en la próxima apertura */
  }
}

const docCrudo = () => toRaw(store.doc);

// Índice con asientos, estados y totales. Se rehace solo cuando cambian los datos o el día. Si los
// años anteriores no están cargados, el más viejo empieza con su apertura.
const indiceActual = computed(() => {
  void store.rev;
  const doc = docCrudo();
  return markRaw(crearIndice(doc, { hoy: store.hoy, apertura: aperturaActiva(doc) }));
});
export const indice = () => indiceActual.value;

// Avisos visibles en este dispositivo (sin los pospuestos ni los descartados), de todo el hogar.
const avisosActuales = computed(() => avisosVisibles(calcularAvisos(indice(), { hoy: store.hoy, sync: store.sync, recordatorios: store.recordatorios }), prefs.avisosOcultos, store.hoy));
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
// Cuentas con saldo (sin las tarjetas de crédito, que tienen deuda) y tarjetas.
export const cuentasDinero = () => cuentas().filter((c) => c.tipo !== 'tarjeta');
export const tarjetas = () => cuentas().filter((c) => c.tipo === 'tarjeta');
// Comercios, del más usado al menos usado.
export const comercios = () => {
  const uso = indice().usoComercios;
  return vivos('comercios').sort((a, b) => (uso.get(b.id) || 0) - (uso.get(a.id) || 0) || a.nombre.localeCompare(b.nombre));
};
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
  const { ubicacion, archivos, pendientes, ultima, cargados } = toRaw(store.sync);
  almacen.guardarSync({ ubicacion, archivos, pendientes, ultima, cargados }).catch(errorGuardado);
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
      cargados: anterior ? undefined : sync.cargados,
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

// Con OneDrive, lo de un año anterior al pasado solo se cambia con ese año abierto en Años
// anteriores y en modo edición: así no se sube un archivo de año que no está cargado y nadie
// cambia un año viejo sin querer.
function revisarAnios(coleccion, anios) {
  if (!COLECCIONES_ANIO.includes(coleccion) || !store.sync.ubicacion) return;
  const anterior = Number(store.hoy.slice(0, 4)) - 1;
  for (const a of new Set(anios)) {
    if (Number(a) >= anterior || store.anios.editar.includes(a)) continue;
    const texto = aniosCargados(docCrudo()).includes(a)
      ? `${a} está abierto solo para ver. Toca «Editar este año» para cambiarlo.`
      : `Para registrar algo de ${a}, abre ese año en Años anteriores y toca «Editar este año».`;
    aviso(texto, 'error', 7000);
    throw Object.assign(new Error(texto), { codigo: 'anio_cerrado' });
  }
}

export function guardar(coleccion, registro) {
  const limpio = sellar(JSON.parse(JSON.stringify(registro)), store.yo);
  const lista = store.doc[coleccion];
  const i = lista.findIndex((r) => r.id === limpio.id);
  const antes = i >= 0 ? toRaw(lista[i]) : null;
  // Si cambia de año, se suben los dos archivos: el nuevo con el registro y el viejo sin él.
  const claves = [antes && archivoDe(docCrudo(), coleccion, antes), archivoDe(docCrudo(), coleccion, limpio)].filter(Boolean);
  revisarAnios(coleccion, claves);
  if (i >= 0) lista.splice(i, 1, limpio);
  else lista.push(limpio);
  cambio(claves);
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

// ---------------------------------------------------------------- Años cargados

const esAnio = (x) => /^\d{4}$/.test(String(x || ''));
export const anioActual = () => store.hoy.slice(0, 4);

// Año más viejo que se carga de OneDrive: el anterior al actual, o uno más viejo si se abrió en
// Años anteriores o tiene cambios por subir.
const desdeDeseado = () => [String(Number(anioActual()) - 1), ...store.anios.abiertos, ...store.sync.pendientes.filter(esAnio)].sort()[0];

// Años que hay en la carpeta de OneDrive (según la última sincronización) o en este dispositivo.
export const aniosDeLaCarpeta = () => [...new Set(store.carpeta.map((a) => claveDeNombre(a.nombre)).filter(esAnio))].sort();
export const anioCargado = (anio) => aniosCargados(docCrudo()).includes(String(anio)) || !store.sync.ubicacion;
export const resumenGuardado = (anio) => {
  const r = buscar('resumenes', String(anio));
  return vivo(r) ? toRaw(r) : null;
};

// Vuelve a calcular las aperturas de los años cargados (después del primero) y los resúmenes de
// los años pasados; lo que cambió se guarda y se sube con su archivo. Sin OneDrive no hace falta:
// todos los años están en el dispositivo.
function actualizarCierres({ forzarResumen = '' } = {}) {
  if (!store.sync.ubicacion || escrituraBloqueada) return;
  const doc = docCrudo();
  const { aperturas, resumenes } = cierresPendientes(doc, indice(), { actual: anioActual() });
  // "Generar resumen": se guarda de nuevo aunque no haya cambiado.
  if (forzarResumen && !resumenes[forzarResumen] && anioCargado(forzarResumen) && forzarResumen < anioActual()) {
    resumenes[forzarResumen] = resumenDelAnio(indice(), forzarResumen, (doc.personas || []).filter(vivo).map((p) => p.id));
  }
  const ahora = new Date().toISOString();
  const anios = Object.keys(aperturas);
  if (anios.length) {
    store.doc.aperturas = { ...(doc.aperturas || {}), ...Object.fromEntries(anios.map((a) => [a, { ...aperturas[a], actualizado: ahora }])) };
    for (const a of anios) {
      contadores.set(a, (contadores.get(a) || 0) + 1);
      marcarPendiente(store.sync, a);
    }
  }
  for (const [anio, resumen] of Object.entries(resumenes)) {
    const limpio = sellar({ ...(resumenGuardado(anio) || {}), ...resumen, id: anio, borrado: false }, store.yo);
    const lista = store.doc.resumenes;
    const i = lista.findIndex((r) => r.id === anio);
    if (i >= 0) lista.splice(i, 1, limpio);
    else lista.push(limpio);
    contadores.set(PRINCIPAL, (contadores.get(PRINCIPAL) || 0) + 1);
    marcarPendiente(store.sync, PRINCIPAL);
  }
  if (anios.length || Object.keys(resumenes).length) {
    persistirLocal();
    persistirSync();
  }
}

// Quita de este dispositivo los años más viejos que `desde` que ya no hacen falta (están en
// OneDrive, sin cambios por subir y sin abrir).
function descargarAniosViejos(desde) {
  if (!desde || store.sync.pendientes.length) return;
  const sobran = aniosCargados(docCrudo()).filter((a) => a < desde && !store.anios.abiertos.includes(a));
  if (!sobran.length) return;
  libro.adoptar(quitarAnios(docCrudo(), sobran));
  store.sync.cargados = (store.sync.cargados || []).filter((a) => !sobran.includes(a));
  for (const a of sobran) delete store.sync.archivos[a];
  store.anios.editar = store.anios.editar.filter((a) => !sobran.includes(a));
}

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
      actualizarCierres();
      const r = await sincronizarCarpeta({ libro, estado: store.sync, ops: operaciones(ub), sello: selloRespaldo(), desde: desdeDeseado() });
      actualizarCierres();
      descargarAniosViejos(r.desde);
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

// Abre un año anterior: lo baja de OneDrive (con los años que falten hasta el actual) para verlo.
// Se abre uno a la vez; los de en medio se cargan, pero solo el abierto se puede editar.
export async function abrirAnio(anio) {
  const a = String(anio);
  // Sin OneDrive todos los años están en el dispositivo y se editan como siempre.
  if (Number(a) >= Number(anioActual()) - 1 || !store.sync.ubicacion) return;
  if (store.anios.abiertos[0] !== a) {
    store.anios.abiertos = [a];
    store.anios.editar = store.anios.editar.filter((x) => x === a);
  }
  if (anioCargado(a)) return;
  store.anios.cargando = a;
  try {
    await sincronizar();
    if (!anioCargado(a)) await sincronizar(); // había una pasada en curso con los años de antes
  } finally {
    store.anios.cargando = '';
  }
  if (!anioCargado(a) && aniosDeLaCarpeta().includes(a)) {
    throw new Error(store.sync.estado === 'offline' ? `Sin conexión: no se pudo bajar ${a}.` : store.sync.mensaje || `No se pudo bajar ${a}.`);
  }
}

// Permite cambiar lo de un año anterior abierto. Al guardar, se recalculan las aperturas siguientes.
export function editarAnio(anio) {
  if (!store.anios.editar.includes(String(anio))) store.anios.editar = [...store.anios.editar, String(anio)];
}

// Cierra los años abiertos: dejan de estar en este dispositivo cuando no tengan cambios por subir.
export function cerrarAniosAbiertos() {
  store.anios.abiertos = [];
  store.anios.editar = [];
  if (store.sync.ubicacion) sincronizar();
}

// Vuelve a generar el resumen guardado de un año pasado (baja el año si no está cargado).
export async function generarResumen(anio) {
  const a = String(anio);
  await abrirAnio(a);
  if (!anioCargado(a)) throw new Error(`No se pudo bajar ${a}.`);
  actualizarCierres({ forzarResumen: a });
  if (store.sync.ubicacion) programarSync(500);
}

async function vincular(ubicacion, archivos = {}) {
  const habiaDatos = !esPristino(docCrudo());
  Object.assign(store.sync, {
    ubicacion, archivos, pendientes: habiaDatos ? [PRINCIPAL, ...aniosDelDoc(docCrudo())] : [], cargados: undefined, estado: 'pendiente', mensaje: '', codigo: '',
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
  Object.assign(store.sync, { ubicacion: null, archivos: {}, pendientes: [], cargados: undefined, estado: 'local', mensaje: '', codigo: '' });
  store.carpeta = [];
  persistirSync();
  od.cerrarSesion();
  od.quitarPermisoCalendario();
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
