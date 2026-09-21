// El estado de la app en un solo objeto reactivo: el documento de datos, quién está usando el
// dispositivo, la sincronización y lo que se está mostrando. Todo lo demás de js/store/ y de
// js/store.js lee y escribe aquí, y nada de aquí importa a los otros: así no hay vueltas.
import { docVacio } from '../core/modelo.js';
import { crearIndice } from '../core/asientos.js';
import { aperturaActiva } from '../core/cierres.js';
import { periodoActual, hoy } from '../core/util.js';
import { pinActivo, cifradoActivo } from '../bloqueo.js';

const { reactive, markRaw, computed, toRaw } = Vue;

export const CLAVES = { yo: 'gastos.yo', pinOlvidado: 'gastos.pinOlvidado', recordatorios: 'gastos.recordatorios' };

export function leerTexto(clave) {
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
  cifrado: cifradoActivo(),
  actualizacion: null, // 'app' | 'esquema': hay una versión nueva de la app
  // El documento guardado es de una versión más nueva de la app: no se puede escribir nada (ni en
  // este navegador ni en OneDrive) hasta actualizar, porque se pisarían datos que no sabemos leer.
  soloLectura: false,
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
  confirmacion: null, // pregunta de sí o no pendiente (ver confirmar)
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

// El documento sin la capa reactiva de Vue: lo que se guarda, se fusiona y se sube.
export const docCrudo = () => toRaw(store.doc);

// Índice con asientos, estados y totales. Se rehace solo cuando cambian los datos o el día. Si los
// años anteriores no están cargados, el más viejo empieza con su apertura.
const indiceActual = computed(() => {
  void store.rev;
  const doc = docCrudo();
  return markRaw(crearIndice(doc, { hoy: store.hoy, apertura: aperturaActiva(doc) }));
});
export const indice = () => indiceActual.value;
