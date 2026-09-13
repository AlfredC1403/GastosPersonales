// Guardado local del documento y de su estado de sincronización.
// Usa IndexedDB (sin el límite de ~5 MB de localStorage); si el navegador no lo permite,
// sigue con localStorage como antes.
const BD = 'gastos-hogar';
const TABLA = 'datos';
const CLAVES_LOCALES = { doc: 'gastos.doc', sync: 'gastos.sync', agenda: 'gastos.agenda' };
const CLAVE_MODO = 'gastos.almacen'; // 'local' si IndexedDB falló alguna vez en este navegador
const CLAVE_MIGRADO = 'gastos.almacen.desde'; // fecha en que se pasó de localStorage a IndexedDB

let promesaBD = null;
let soloLocal = !('indexedDB' in globalThis) || leerLocal(CLAVE_MODO) === 'local';

// Si IndexedDB falla, se sigue con localStorage también en las próximas visitas, para
// no volver a leer una copia más vieja.
function pasarALocal() {
  soloLocal = true;
  try {
    localStorage.setItem(CLAVE_MODO, 'local');
  } catch {
    /* sin acceso a localStorage */
  }
}

function abrir() {
  promesaBD ??= new Promise((ok, mal) => {
    const pet = indexedDB.open(BD, 1);
    pet.onupgradeneeded = () => pet.result.createObjectStore(TABLA);
    pet.onsuccess = () => ok(pet.result);
    pet.onerror = () => mal(pet.error);
    pet.onblocked = () => mal(new Error('IndexedDB bloqueado'));
  }).catch((e) => {
    promesaBD = null;
    throw e;
  });
  return promesaBD;
}

async function operar(modo, accion) {
  const bd = await abrir();
  return new Promise((ok, mal) => {
    const tx = bd.transaction(TABLA, modo);
    const pet = accion(tx.objectStore(TABLA));
    tx.oncomplete = () => ok(pet?.result);
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error);
  });
}

function leerLocal(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirLocal(clave, texto) {
  localStorage.setItem(clave, texto); // si no hay espacio, lanza y lo informa quien llama
}

const claveLocal = (clave) => CLAVES_LOCALES[clave] || `gastos.${clave}`;

const parsear = (texto) => {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
};

// Las escrituras se encadenan para que la última siempre quede guardada.
let cola = Promise.resolve();
function enCola(tarea) {
  cola = cola.then(tarea, tarea);
  return cola;
}

async function leer(clave) {
  if (!soloLocal) {
    try {
      return await operar('readonly', (t) => t.get(clave));
    } catch {
      pasarALocal();
    }
  }
  return leerLocal(claveLocal(clave));
}

function escribir(clave, texto) {
  return enCola(async () => {
    if (!soloLocal) {
      try {
        await operar('readwrite', (t) => t.put(texto, clave));
        return;
      } catch {
        pasarALocal();
      }
    }
    escribirLocal(claveLocal(clave), texto);
  });
}

// Carga el documento y la sincronización. La primera vez copia lo que había en
// localStorage. El documento viejo queda ahí como respaldo, pero la sincronización se
// quita: así una versión vieja de la app no puede subir datos desactualizados.
// `perdido` indica que IndexedDB estaba vacío aunque ya se había usado (el navegador lo borró).
export async function cargar() {
  let doc = await leer('doc');
  let sync = await leer('sync');
  let copiado = false;
  let perdido = false;
  if (!soloLocal && doc == null) {
    perdido = !!leerLocal(CLAVE_MIGRADO);
    const docLocal = leerLocal(CLAVES_LOCALES.doc);
    const syncLocal = leerLocal(CLAVES_LOCALES.sync);
    if (docLocal != null) {
      await escribir('doc', docLocal);
      if (syncLocal != null) await escribir('sync', syncLocal);
      doc = docLocal;
      sync = syncLocal;
      copiado = true;
    }
  }
  if (!soloLocal && doc != null) {
    try {
      localStorage.removeItem(CLAVES_LOCALES.sync);
      if (!leerLocal(CLAVE_MIGRADO)) localStorage.setItem(CLAVE_MIGRADO, new Date().toISOString());
    } catch {
      /* sin acceso a localStorage */
    }
  }
  return { doc: parsear(doc), sync: parsear(sync), copiado, perdido };
}

export const guardarDoc = (doc) => escribir('doc', JSON.stringify(doc));
export const guardarSync = (sync) => escribir('sync', JSON.stringify(sync));
// Lo que vence en los próximos días, ya calculado, para que sw.js pueda avisar sin cargar la app
// entera (un service worker no puede recalcular el documento). Ver js/notificaciones.js.
export const guardarAgenda = (agenda) => escribir('agenda', JSON.stringify(agenda));

// Copia del documento antes de migrarlo a otro esquema. Se guarda una sola vez por nombre;
// si no hay espacio, se sigue sin ella (el respaldo principal queda en OneDrive).
export async function guardarRespaldo(nombre, texto) {
  const clave = `respaldo-${nombre}`;
  try {
    if (await leer(clave)) return false;
    await escribir(clave, texto);
    return true;
  } catch {
    return false;
  }
}

export async function borrarTodo() {
  await cola;
  if (!soloLocal) {
    try {
      await operar('readwrite', (t) => t.clear());
    } catch {
      /* se borra lo local igual */
    }
  }
  for (const clave of [...Object.values(CLAVES_LOCALES), CLAVE_MIGRADO, claveLocal('respaldo-e1')]) {
    try {
      localStorage.removeItem(clave);
    } catch {
      /* sin acceso a localStorage */
    }
  }
}

export const tipo = () => (soloLocal ? 'localStorage' : 'IndexedDB');

// Pide que el navegador no borre los datos cuando le falte espacio.
export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function espacioUsado() {
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ?? null;
  } catch {
    return null;
  }
}
