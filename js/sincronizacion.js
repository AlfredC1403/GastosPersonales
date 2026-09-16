// Sincronización con la carpeta de OneDrive: `finanzas.json` y un `finanzas-AAAA.json` por
// año. No depende del navegador: recibe las operaciones de OneDrive (`ops`) y el documento
// en memoria (`libro`), así se puede probar con una carpeta simulada.
//
// Una pasada: (1) baja los archivos que cambiaron y los fusiona con lo local: el principal y los
// años desde `desde` (si el año más viejo no trae apertura, también el anterior); (2) si el
// principal es de un esquema anterior, guarda un respaldo antes de tocar nada; (3) sube los archivos
// con cambios, primero los años y al final el principal. Si alguien guardó al mismo tiempo (412 o
// 409), vuelve a empezar. Un año que existe en OneDrive y no se bajó nunca se sube: se perderían sus datos.
import { ESQUEMA, COLECCIONES_ANIO, fusionar, fusionarEn } from './core/modelo.js';
import { normalizar } from './core/migraciones.js';
import { PRINCIPAL, claveDeNombre, nombreArchivo, contenidoArchivo, aniosDelDoc, normalizarAnio, tieneCopiasViejas } from './core/anios.js';
import { aniosCargados, fusionarApertura } from './core/cierres.js';

const MAX_INTENTOS = 4;

const errorCon = (mensaje, extra) => Object.assign(new Error(mensaje), extra);

// Datos de la versión 1 de la app dentro de un archivo principal (plantillas, o registros de año
// que ahora van en su propio archivo), aunque el archivo diga que es de un esquema posterior.
const tieneRestosV1 = (contenido) => (Array.isArray(contenido?.plantillas) && contenido.plantillas.length > 0)
  || COLECCIONES_ANIO.some((c) => Array.isArray(contenido?.[c]) && contenido[c].length > 0);

// Esquema de un archivo principal, para saber si hay que respaldarlo antes de escribirlo.
const esquemaDe = (contenido) => (tieneRestosV1(contenido) ? 1 : Math.min(ESQUEMA, Number(contenido?.esquema) || 1));

export function marcarPendiente(estado, clave) {
  if (!estado.pendientes.includes(clave)) estado.pendientes.push(clave);
}

function quitarPendiente(estado, clave) {
  estado.pendientes = estado.pendientes.filter((k) => k !== clave);
}

function marcarCargado(estado, clave) {
  if (clave !== PRINCIPAL && !estado.cargados.includes(clave)) estado.cargados = [...estado.cargados, clave].sort();
}

const registrosDe = (contenido) => COLECCIONES_ANIO.reduce((n, c) => n + (contenido[c]?.length || 0), 0);

// ¿Se puede calcular desde `limite`? Sí si el año cargado más viejo desde ahí es el primero de la
// carpeta o trae su apertura.
function aperturaLista(doc, limite, primero) {
  const [menor] = aniosCargados(doc).filter((a) => a >= limite);
  return !!menor && (menor <= primero || !!doc.aperturas?.[menor]);
}

/**
 * @param libro  { doc(), adoptar(doc), cambios(clave) }: `cambios` cuenta las ediciones locales de cada archivo.
 * @param estado { archivos: { [clave]: { itemId, eTag, esquema } }, pendientes: [clave], cargados: [año] }. Se modifica.
 *               `cargados`: años cuyo archivo ya se fusionó con el documento (o que se crearon aquí).
 * @param ops    { listar(), descargar(archivo), subir(archivo, contenido, eTag), crear(nombre, contenido), respaldar(nombre, contenido) }
 * @param sello  texto para el nombre del respaldo, por ejemplo '2026-09-20-1530'.
 * @param desde  año más viejo que hace falta ('2026'); sin él se bajan todos los años.
 * @returns { intentos, anios: años que hay en la carpeta, desde: año más viejo que quedó cargado (o null) }
 */
export async function sincronizarCarpeta({ libro, estado, ops, sello, desde = null }) {
  estado.archivos ??= {};
  estado.pendientes ??= [];
  // Las versiones anteriores cargaban todos los años.
  estado.cargados ??= [...new Set([...Object.keys(estado.archivos).filter((k) => k !== PRINCIPAL), ...aniosDelDoc(libro.doc())])].sort();

  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const remotos = new Map();
    for (const archivo of await ops.listar()) {
      const clave = claveDeNombre(archivo.nombre);
      if (clave) remotos.set(clave, archivo);
    }
    const principal = remotos.get(PRINCIPAL);
    if (!principal) throw errorCon(`No encontré ${nombreArchivo(PRINCIPAL)} en la carpeta.`, { codigo: 'sin_principal' });
    const aniosRemotos = [...remotos.keys()].filter((k) => k !== PRINCIPAL).sort();

    // 1. Bajar lo que cambió. El principal va primero: dice de qué versión son los datos.
    let original = null;
    if (estado.archivos[PRINCIPAL]?.eTag !== principal.eTag) {
      const contenido = await ops.descargar(principal);
      const esquema = esquemaDe(contenido);
      if (esquema < ESQUEMA) original = contenido;
      libro.adoptar(fusionar(libro.doc(), normalizar(contenido)));
      estado.archivos[PRINCIPAL] = { itemId: principal.itemId, eTag: principal.eTag, esquema };
    }
    const aniosBajados = [];
    const bajar = async (clave) => {
      const archivo = remotos.get(clave);
      if (estado.archivos[clave]?.eTag === archivo.eTag && estado.cargados.includes(clave)) return;
      const anio = normalizarAnio(await ops.descargar(archivo), clave);
      libro.adoptar(fusionarApertura(fusionarEn(libro.doc(), anio, COLECCIONES_ANIO), clave, anio.apertura));
      estado.archivos[clave] = { itemId: archivo.itemId, eTag: archivo.eTag, esquema: ESQUEMA };
      marcarCargado(estado, clave);
      aniosBajados.push([clave, anio]);
    };
    // Los años desde `desde`, del más nuevo al más viejo, y los que siguen en el documento (o
    // tienen cambios por subir): así sus aperturas se calculan con lo último de OneDrive.
    let limite = desde && aniosRemotos.length ? String(desde) : null;
    for (const clave of [...aniosRemotos].reverse()) {
      if (!limite || clave >= limite || estado.pendientes.includes(clave) || estado.cargados.includes(clave)) await bajar(clave);
    }
    // Si el año más viejo no tiene con qué empezar, también el anterior, y así.
    if (limite) {
      for (const clave of aniosRemotos.filter((a) => a < limite).reverse()) {
        if (aperturaLista(libro.doc(), limite, aniosRemotos[0])) break;
        limite = clave;
        await bajar(clave);
      }
    }
    // Un registro que se movió de año puede seguir en el archivo viejo: se vuelve a subir sin él.
    for (const [clave, anio] of aniosBajados) if (tieneCopiasViejas(libro.doc(), clave, anio)) marcarPendiente(estado, clave);

    // 2. Principal de un esquema anterior (o con datos de una app vieja): respaldo con el nombre
    // del esquema que se deja atrás, y se sube todo con el nuevo.
    const esquemaPrevio = estado.archivos[PRINCIPAL]?.esquema || 1;
    if (esquemaPrevio < ESQUEMA) {
      await ops.respaldar(`finanzas-e${esquemaPrevio}-${sello}.json`, original ?? await ops.descargar(principal));
      for (const clave of [PRINCIPAL, ...aniosDelDoc(libro.doc())]) marcarPendiente(estado, clave);
    }

    // 3. Años con registros que todavía no tienen archivo: son de este dispositivo.
    for (const anio of aniosDelDoc(libro.doc())) {
      if (!remotos.has(anio)) {
        marcarCargado(estado, anio);
        marcarPendiente(estado, anio);
      }
    }

    // 4. Subir: los años primero y el principal al final.
    const orden = [...estado.pendientes].sort((a, b) => (a === PRINCIPAL) - (b === PRINCIPAL) || a.localeCompare(b));
    let conflicto = false;
    for (const clave of orden) {
      const version = libro.cambios(clave);
      const contenido = contenidoArchivo(libro.doc(), clave);
      const remoto = remotos.get(clave);
      if (!remoto && clave !== PRINCIPAL && !registrosDe(contenido) && !contenido.apertura) {
        quitarPendiente(estado, clave);
        continue;
      }
      // Nunca se pisa un año de OneDrive que no se fusionó con lo local.
      if (remoto && clave !== PRINCIPAL && !estado.cargados.includes(clave)) continue;
      try {
        const r = remoto
          ? await ops.subir(remoto, contenido, estado.archivos[clave]?.eTag)
          : await ops.crear(nombreArchivo(clave), contenido);
        estado.archivos[clave] = { itemId: r.itemId, eTag: r.eTag, esquema: ESQUEMA };
        marcarCargado(estado, clave);
        if (libro.cambios(clave) === version) quitarPendiente(estado, clave);
      } catch (e) {
        if (e.status !== 412 && e.status !== 409) throw e;
        conflicto = true; // alguien guardó justo antes: se vuelve a leer y se fusiona
        break;
      }
    }
    if (!conflicto) return { intentos: intento + 1, anios: aniosRemotos, desde: limite };
  }
  throw errorCon('Otra persona está guardando al mismo tiempo. Se reintentará en un momento.', { status: 412 });
}

// ---------------------------------------------------------------- Estado que se ve

// Lo que muestra la pastilla de la cabecera, a partir del estado de la sincronización:
// 'local' | 'sincronizando' | 'error' | 'sesion' | 'offline' | 'pendiente' | 'ok'.
// 'pendiente' es lo que queda por subir: mientras haya algo, nunca se dice que está todo guardado.
const ESTADOS_PROPIOS = ['sincronizando', 'error', 'sesion', 'offline'];

export function estadoVisible(sync) {
  if (!sync?.ubicacion) return 'local';
  if (ESTADOS_PROPIOS.includes(sync.estado)) return sync.estado;
  // `estado === 'pendiente'` también cuando todavía no se ha hecho la primera pasada.
  if (sync.estado === 'pendiente' || sync.pendientes?.length) return 'pendiente';
  return 'ok';
}
