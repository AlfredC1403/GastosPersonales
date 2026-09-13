// Sincronización con la carpeta de OneDrive: `finanzas.json` y un `finanzas-AAAA.json` por
// año. No depende del navegador: recibe las operaciones de OneDrive (`ops`) y el documento
// en memoria (`libro`), así se puede probar con una carpeta simulada.
//
// Una pasada: (1) baja los archivos que cambiaron y los fusiona con lo local; (2) si el
// principal es del esquema 1, guarda un respaldo antes de tocar nada; (3) sube los archivos
// con cambios, primero los años y al final el principal. Si alguien guardó al mismo tiempo
// (412 o 409), vuelve a empezar.
import { ESQUEMA, COLECCIONES_ANIO, fusionar, fusionarEn } from './core/modelo.js';
import { normalizar } from './core/migraciones.js';
import { PRINCIPAL, claveDeNombre, nombreArchivo, contenidoArchivo, aniosDelDoc, normalizarAnio, tieneCopiasViejas } from './core/anios.js';

const MAX_INTENTOS = 4;

const errorCon = (mensaje, extra) => Object.assign(new Error(mensaje), extra);

// Datos de una versión vieja de la app dentro de un archivo principal.
const tieneRestosV1 = (contenido) => (Number(contenido?.esquema) || 1) < ESQUEMA
  || (Array.isArray(contenido?.plantillas) && contenido.plantillas.length > 0)
  || COLECCIONES_ANIO.some((c) => Array.isArray(contenido?.[c]) && contenido[c].length > 0);

export function marcarPendiente(estado, clave) {
  if (!estado.pendientes.includes(clave)) estado.pendientes.push(clave);
}

function quitarPendiente(estado, clave) {
  estado.pendientes = estado.pendientes.filter((k) => k !== clave);
}

const registrosDe = (contenido) => COLECCIONES_ANIO.reduce((n, c) => n + (contenido[c]?.length || 0), 0);

/**
 * @param libro  { doc(), adoptar(doc), cambios(clave) }: `cambios` cuenta las ediciones locales de cada archivo.
 * @param estado { archivos: { [clave]: { itemId, eTag, esquema } }, pendientes: [clave] }. Se modifica.
 * @param ops    { listar(), descargar(archivo), subir(archivo, contenido, eTag), crear(nombre, contenido), respaldar(nombre, contenido) }
 * @param sello  texto para el nombre del respaldo, por ejemplo '2026-09-20-1530'.
 */
export async function sincronizarCarpeta({ libro, estado, ops, sello }) {
  estado.archivos ??= {};
  estado.pendientes ??= [];

  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const remotos = new Map();
    for (const archivo of await ops.listar()) {
      const clave = claveDeNombre(archivo.nombre);
      if (clave) remotos.set(clave, archivo);
    }
    const principal = remotos.get(PRINCIPAL);
    if (!principal) throw errorCon(`No encontré ${nombreArchivo(PRINCIPAL)} en la carpeta.`, { codigo: 'sin_principal' });

    // 1. Bajar lo que cambió. El principal va primero: dice de qué versión son los datos.
    let originalV1 = null;
    const aniosBajados = [];
    const claves = [PRINCIPAL, ...[...remotos.keys()].filter((k) => k !== PRINCIPAL).sort()];
    for (const clave of claves) {
      const archivo = remotos.get(clave);
      if (estado.archivos[clave]?.eTag === archivo.eTag) continue;
      const contenido = await ops.descargar(archivo);
      if (clave === PRINCIPAL) {
        const doc = normalizar(contenido);
        const viejo = tieneRestosV1(contenido);
        if (viejo) originalV1 = contenido;
        libro.adoptar(fusionar(libro.doc(), doc));
        estado.archivos[clave] = { itemId: archivo.itemId, eTag: archivo.eTag, esquema: viejo ? 1 : ESQUEMA };
      } else {
        const anio = normalizarAnio(contenido, clave);
        libro.adoptar(fusionarEn(libro.doc(), anio, COLECCIONES_ANIO));
        estado.archivos[clave] = { itemId: archivo.itemId, eTag: archivo.eTag, esquema: ESQUEMA };
        aniosBajados.push([clave, anio]);
      }
    }
    // Un registro que se movió de año puede seguir en el archivo viejo: se vuelve a subir sin él.
    for (const [clave, anio] of aniosBajados) if (tieneCopiasViejas(libro.doc(), clave, anio)) marcarPendiente(estado, clave);

    // 2. Principal del esquema 1 (o con datos de una app vieja): respaldo y se sube todo.
    if ((estado.archivos[PRINCIPAL]?.esquema || 1) < ESQUEMA) {
      const original = originalV1 ?? await ops.descargar(principal);
      await ops.respaldar(`finanzas-e1-${sello}.json`, original);
      for (const clave of [PRINCIPAL, ...aniosDelDoc(libro.doc())]) marcarPendiente(estado, clave);
    }

    // 3. Años con registros que todavía no tienen archivo.
    for (const anio of aniosDelDoc(libro.doc())) if (!remotos.has(anio)) marcarPendiente(estado, anio);

    // 4. Subir: los años primero y el principal al final.
    const orden = [...estado.pendientes].sort((a, b) => (a === PRINCIPAL) - (b === PRINCIPAL) || a.localeCompare(b));
    let conflicto = false;
    for (const clave of orden) {
      const version = libro.cambios(clave);
      const contenido = contenidoArchivo(libro.doc(), clave);
      const remoto = remotos.get(clave);
      if (!remoto && clave !== PRINCIPAL && !registrosDe(contenido)) {
        quitarPendiente(estado, clave);
        continue;
      }
      try {
        const r = remoto
          ? await ops.subir(remoto, contenido, estado.archivos[clave]?.eTag)
          : await ops.crear(nombreArchivo(clave), contenido);
        estado.archivos[clave] = { itemId: r.itemId, eTag: r.eTag, esquema: ESQUEMA };
        if (libro.cambios(clave) === version) quitarPendiente(estado, clave);
      } catch (e) {
        if (e.status !== 412 && e.status !== 409) throw e;
        conflicto = true; // alguien guardó justo antes: se vuelve a leer y se fusiona
        break;
      }
    }
    if (!conflicto) return { intentos: intento + 1 };
  }
  throw errorCon('Otra persona está guardando al mismo tiempo. Se reintentará en un momento.', { status: 412 });
}
