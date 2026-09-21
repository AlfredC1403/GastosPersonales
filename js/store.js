// Guardar, sincronizar con OneDrive y abrir años anteriores. Es la puerta de todo esto: cada
// pantalla importa './store.js' y de aquí salen también las otras partes, que son
//   js/store/estado.js     el objeto reactivo con el documento y lo demás
//   js/store/consultas.js  preguntas cortas sobre el documento y el formato del dinero
//   js/store/dialogos.js   el aviso de abajo, el diálogo y la pregunta de sí o no
// La cadena de importaciones va en un solo sentido (estado ← consultas y diálogos ← esto), así
// que no hay vueltas. Lo que quedó aquí no se pudo separar sin hacerlas: guardar, sincronizar,
// el PIN y los años se llaman entre sí.
//
// Todo cambio se guarda al instante en el navegador y se sube a OneDrive unos segundos después,
// al archivo que le toca (principal o del año).
import { ESQUEMA, COLECCIONES_ANIO, sellar, fusionar, esPristino, vivo } from './core/modelo.js';
import { normalizar } from './core/migraciones.js';
import { resumenDelAnio } from './core/reportes.js';
import { PRINCIPAL, archivoDe, aniosDelDoc, contenidoArchivo, claveDeNombre } from './core/anios.js';
import {
  aniosCargados, quitarAnios, cierresPendientes, anioMasViejoNecesario, aniosParaSoltar, bloqueoDeAnio,
} from './core/cierres.js';
import { hoy } from './core/util.js';
import { sincronizarCarpeta, marcarPendiente } from './sincronizacion.js';
import * as od from './onedrive.js';
import * as almacen from './almacen.js';
import { pinActivo, quitarPin, cifradoActivo, claveDeCifrado, definirCifrado } from './bloqueo.js';
import { store, CLAVES, docCrudo, indice } from './store/estado.js';

const { toRaw } = Vue;
import { vivos, buscar } from './store/consultas.js';
import { aviso } from './store/dialogos.js';

export * from './store/estado.js';
export * from './store/consultas.js';
export * from './store/dialogos.js';



// ---------------------------------------------------------------- Guardado local

const contadores = new Map(); // cambios locales por archivo
let avisoGuardadoMostrado = false;

const TEXTO_SOLO_LECTURA = 'Los datos son de una versión más nueva de la app. Actualiza para poder guardar.';

// Con el documento en solo lectura no se guarda nada: antes, los cambios se quedaban en memoria y
// se perdían al recargar, con el aviso "Guardado." de por medio.
function revisarEscritura() {
  if (!store.soloLectura) return;
  aviso(TEXTO_SOLO_LECTURA, 'error', 9000);
  throw Object.assign(new Error(TEXTO_SOLO_LECTURA), { codigo: 'solo_lectura' });
}

function errorGuardado(e) {
  if (avisoGuardadoMostrado) return;
  avisoGuardadoMostrado = true;
  aviso(`No se pudo guardar en este navegador (${e?.name || 'error'}). Los cambios siguen en OneDrive si está conectado.`, 'error', 9000);
}

function persistirLocal() {
  if (store.soloLectura) return;
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
        store.soloLectura = true;
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

const TEXTO_BLOQUEO = {
  solo_ver: (a) => `${a} está abierto solo para ver. Toca «Editar este año» para cambiarlo.`,
  no_cargado: (a) => `Para registrar algo de ${a}, abre ese año en Años anteriores y toca «Editar este año».`,
};

// Con OneDrive, lo de un año anterior al pasado solo se cambia con ese año abierto en Años
// anteriores y en modo edición: así no se sube un archivo de año que no está cargado y nadie
// cambia un año viejo sin querer (ver bloqueoDeAnio en core/cierres.js).
function revisarAnios(coleccion, anios) {
  if (!COLECCIONES_ANIO.includes(coleccion) || !store.sync.ubicacion) return;
  const cargados = aniosCargados(docCrudo());
  for (const a of new Set(anios)) {
    const motivo = bloqueoDeAnio({ anio: a, hoy: store.hoy, cargados, editar: store.anios.editar });
    if (!motivo) continue;
    const texto = TEXTO_BLOQUEO[motivo](a);
    aviso(texto, 'error', 7000);
    throw Object.assign(new Error(texto), { codigo: 'anio_cerrado' });
  }
}

export function guardar(coleccion, registro) {
  revisarEscritura();
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
  revisarEscritura();
  store.doc.config = { ...store.doc.config, ...JSON.parse(JSON.stringify(cambios)), actualizado: new Date().toISOString() };
  cambio([PRINCIPAL]);
}

export function importar(texto) {
  revisarEscritura();
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
  almacen.definirClave(null);
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

// La pantalla de bloqueo, al acertar el PIN, entrega la clave con la que se abre lo guardado
// aquí. Sin cifrado no hay nada que hacer: el documento ya se cargó al iniciar.
export async function abrirConPin(pin) {
  if (!cifradoActivo()) return;
  almacen.definirClave(await claveDeCifrado(pin));
  if (store.listo) return;
  await cargarLocal();
  // La sincronización no pudo arrancar al iniciar porque no había documento con qué comparar.
  if (store.sync.ubicacion) sincronizar();
}

// Activa el cifrado del documento local y lo vuelve a guardar cifrado. `pin` es el que ya se
// verificó. Al desactivarlo, se guarda en claro otra vez.
export async function cambiarCifrado(activar, pin) {
  await definirCifrado(activar);
  almacen.definirClave(activar ? await claveDeCifrado(pin) : null);
  await almacen.guardarDoc(docCrudo());
  persistirSync();
  // La agenda de avisos no se puede cifrar (ver almacen.js): al activar el cifrado se borra.
  if (activar) await almacen.borrarAgenda();
  store.cifrado = cifradoActivo();
}

// Después de cambiar el PIN con el cifrado puesto, la clave es otra y hay que volver a guardar.
export async function reCifrarCon(clave) {
  almacen.definirClave(clave);
  await almacen.guardarDoc(docCrudo());
}

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

// Año más viejo que se carga de OneDrive (ver anioMasViejoNecesario).
const desdeDeseado = () => anioMasViejoNecesario({ actual: anioActual(), abiertos: store.anios.abiertos, pendientes: store.sync.pendientes });

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
  if (!store.sync.ubicacion || store.soloLectura) return;
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
  const sobran = aniosParaSoltar({
    cargados: aniosCargados(docCrudo()), desde, abiertos: store.anios.abiertos, pendientes: store.sync.pendientes,
  });
  if (!sobran.length) return;
  libro.adoptar(quitarAnios(docCrudo(), sobran));
  store.sync.cargados = (store.sync.cargados || []).filter((a) => !sobran.includes(a));
  for (const a of sobran) delete store.sync.archivos[a];
  store.anios.editar = store.anios.editar.filter((a) => !sobran.includes(a));
}

export function sincronizar() {
  if (!store.sync.ubicacion || store.soloLectura) return Promise.resolve();
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
      if (e.codigo === 'esquema_nuevo') {
        store.actualizacion = 'esquema';
        store.soloLectura = true;
      }
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

// Lee un respaldo sin tocar nada: la pantalla lo compara con lo de hoy y trae solo lo que falte.
export const leerRespaldo = async (r) => normalizar(await od.descargarArchivo(await conCarpeta(), r));

// ---------------------------------------------------------------- Inicio

function marcarActualizacion() {
  store.actualizacion ??= 'app';
}

export async function iniciar() {
  // Con el cifrado activado, lo guardado aquí no se puede leer hasta que se escriba el PIN:
  // la pantalla de bloqueo llama a `abrirConPin` y ahí se carga (ver js/ui/bloqueo.js).
  if (!cifradoActivo()) await cargarLocal();
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
      // Con el cifrado puesto, lo guardado aquí ya no se puede abrir: se borra y OneDrive lo
      // vuelve a bajar. El estado de sincronización se guarda en claro justamente para esto.
      if (cifradoActivo()) await almacen.borrarCifrado();
      quitarPin();
      actualizarEstadoPin();
      store.cifrado = false;
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
