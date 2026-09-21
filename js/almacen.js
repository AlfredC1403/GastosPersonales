// Guardado local del documento y de su estado de sincronización.
// Usa IndexedDB (sin el límite de ~5 MB de localStorage); si el navegador no lo permite,
// sigue con localStorage como antes.
const BD = 'gastos-hogar';
const TABLA = 'datos';
const CLAVES_LOCALES = { doc: 'gastos.doc', sync: 'gastos.sync', agenda: 'gastos.agenda' };
const CLAVE_MODO = 'gastos.almacen'; // 'local' si IndexedDB falló alguna vez en este navegador
const CLAVE_MIGRADO = 'gastos.almacen.desde'; // fecha en que se pasó de localStorage a IndexedDB

// Clave con la que se cifra lo que se guarda aquí, cuando el hogar lo activó (ver js/cifrado.js).
// Es null mientras no se escriba el PIN, y por eso el documento no se lee hasta entonces.
//
// Se cifra el documento y sus respaldos, que es donde están los ingresos, las deudas y los
// saldos. El estado de sincronización se deja en claro a propósito: son el id de la carpeta de
// OneDrive y la lista de archivos, y hace falta para poder volver a bajarlo todo si algún día
// se olvida el PIN. La agenda de avisos no se guarda cuando hay cifrado (ver `guardarAgenda`).
let clave = null;
const seCifra = (nombre) => nombre === 'doc' || nombre.startsWith('respaldo-');
// Un sobre se reconoce sin abrir el módulo de cifrado, que solo se carga cuando hace falta:
// la mayoría de los dispositivos no lo usan y son 1.5 KB en la carga inicial.
const esSobre = (texto) => typeof texto === 'string' && texto.startsWith('{"cifrado"');
const cripto = () => import('./cifrado.js');
export const definirClave = (k) => { clave = k; };
export const hayClave = () => !!clave;

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

async function leerCrudo(nombre) {
  if (!soloLocal) {
    try {
      return await operar('readonly', (t) => t.get(nombre));
    } catch {
      pasarALocal();
    }
  }
  return leerLocal(claveLocal(nombre));
}

// Lo guardado puede estar en claro (nunca se cifró, o se acaba de desactivar) o en un sobre.
// Un sobre sin clave no se puede abrir: quien lee se entera por el código del error.
async function leer(nombre) {
  const texto = await leerCrudo(nombre);
  if (!esSobre(texto)) return texto;
  if (!clave) throw Object.assign(new Error('Los datos de este dispositivo están cifrados: escribe el PIN.'), { codigo: 'sin_clave' });
  return (await cripto()).descifrar(clave, texto);
}

// Borra lo que quedó cifrado y ya no se puede abrir (se olvidó el PIN). Lo demás se conserva:
// el estado de sincronización está en claro, así que OneDrive vuelve a bajarlo todo.
export function borrarCifrado() {
  clave = null;
  return enCola(async () => {
    if (!soloLocal) {
      try {
        const bd = await abrir();
        const nombres = await new Promise((ok, mal) => {
          const pet = bd.transaction(TABLA, 'readonly').objectStore(TABLA).getAllKeys();
          pet.onsuccess = () => ok(pet.result || []);
          pet.onerror = () => mal(pet.error);
        });
        for (const n of nombres.filter((x) => seCifra(String(x)))) {
          await operar('readwrite', (t) => t.delete(n));
        }
        return;
      } catch {
        pasarALocal();
      }
    }
    try {
      localStorage.removeItem(CLAVES_LOCALES.doc);
    } catch {
      /* sin acceso a localStorage */
    }
  });
}

function escribir(nombre, texto) {
  return enCola(async () => {
    const contenido = clave && seCifra(nombre) ? await (await cripto()).cifrar(clave, texto) : texto;
    if (!soloLocal) {
      try {
        await operar('readwrite', (t) => t.put(contenido, nombre));
        return;
      } catch {
        pasarALocal();
      }
    }
    escribirLocal(claveLocal(nombre), contenido);
  });
}

// Carga el documento y la sincronización. La primera vez copia lo que había en
// localStorage. El documento viejo queda ahí como respaldo, pero la sincronización se
// quita: así una versión vieja de la app no puede subir datos desactualizados.
// `perdido` indica que IndexedDB estaba vacío aunque ya se había usado (el navegador lo borró).
export async function cargar() {
  let doc = null;
  let cifrado = false;
  try {
    doc = await leer('doc');
  } catch (e) {
    if (e.codigo !== 'sin_clave') throw e;
    cifrado = true; // hay documento, pero hace falta el PIN para abrirlo
  }
  let sync = await leer('sync');
  let copiado = false;
  let perdido = false;
  if (!soloLocal && doc == null && !cifrado) {
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
  if (!soloLocal && (doc != null || cifrado)) {
    try {
      localStorage.removeItem(CLAVES_LOCALES.sync);
      if (!leerLocal(CLAVE_MIGRADO)) localStorage.setItem(CLAVE_MIGRADO, new Date().toISOString());
    } catch {
      /* sin acceso a localStorage */
    }
  }
  return { doc: parsear(doc), sync: parsear(sync), copiado, perdido, cifrado };
}

export const guardarDoc = (doc) => escribir('doc', JSON.stringify(doc));
export const guardarSync = (sync) => escribir('sync', JSON.stringify(sync));
// Lo que vence en los próximos días, ya calculado, para que sw.js pueda avisar sin cargar la app
// entera (un service worker no puede recalcular el documento). Ver js/notificaciones.js.
//
// sw.js lee esta entrada directo de IndexedDB y no tiene el PIN, así que no podría descifrarla.
// Con el cifrado activado no se guarda: se apagan los avisos en segundo plano (los de dentro de
// la app siguen igual), que es mejor que dejar en claro lo que viene.
export const guardarAgenda = (agenda) => (clave ? borrarAgenda() : escribir('agenda', JSON.stringify(agenda)));

export function borrarAgenda() {
  return enCola(async () => {
    if (!soloLocal) {
      try {
        await operar('readwrite', (t) => t.delete('agenda'));
      } catch {
        pasarALocal();
      }
    }
    try {
      localStorage.removeItem(claveLocal('agenda'));
    } catch {
      /* sin acceso a localStorage */
    }
  });
}

// Copia del documento antes de migrarlo a otro esquema. Se guarda una sola vez por nombre;
// si no hay espacio, se sigue sin ella (el respaldo principal queda en OneDrive).
export async function guardarRespaldo(nombre, texto) {
  const donde = `respaldo-${nombre}`;
  try {
    if (await leerCrudo(donde)) return false;
    await escribir(donde, texto);
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
