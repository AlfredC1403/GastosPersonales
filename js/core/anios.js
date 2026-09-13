// Reparto del documento en archivos: `finanzas.json` (configuración y catálogos) y un
// `finanzas-AAAA.json` por año con los movimientos, recibos y ajustes de ese año.
import { ESQUEMA, COLECCIONES_PRINCIPAL, COLECCIONES_ANIO, fusionarEn } from './modelo.js';

export const PRINCIPAL = 'principal';
const ANIO = /^\d{4}$/;

export const nombreArchivo = (clave) => (clave === PRINCIPAL ? 'finanzas.json' : `finanzas-${clave}.json`);

export function claveDeNombre(nombre) {
  if (nombre === 'finanzas.json') return PRINCIPAL;
  const m = /^finanzas-(\d{4})\.json$/.exec(nombre || '');
  return m ? m[1] : null;
}

// Año al que pertenece un registro: el de su fecha (o su mes, en los ajustes de partida).
// Un registro sin fecha válida va al año en que se creó y, si tampoco se sabe, al del inicio.
export function anioDeRegistro(coleccion, r, anioPorDefecto) {
  const fuente = coleccion === 'ajustesPartida' ? r.periodo : r.fecha || r.periodo;
  const a = String(fuente ?? '').slice(0, 4);
  if (ANIO.test(a)) return a;
  const c = String(r.creado ?? '').slice(0, 4);
  return ANIO.test(c) ? c : anioPorDefecto;
}

const anioPorDefectoDe = (doc) => {
  const a = String(doc.config?.inicio ?? '').slice(0, 4);
  return ANIO.test(a) ? a : '2026';
};

// Clave del archivo donde se guarda un registro: 'principal' o el año ('2026').
export function archivoDe(doc, coleccion, r) {
  return COLECCIONES_ANIO.includes(coleccion) ? anioDeRegistro(coleccion, r, anioPorDefectoDe(doc)) : PRINCIPAL;
}

export const archivoAnioVacio = (anio) => ({ esquema: ESQUEMA, anio: Number(anio), apertura: null, movimientos: [], recibos: [], ajustesPartida: [] });

// Contenido de un archivo, tomado del documento completo.
export function contenidoArchivo(doc, clave) {
  if (clave === PRINCIPAL) {
    const principal = { esquema: ESQUEMA, config: doc.config };
    for (const c of COLECCIONES_PRINCIPAL) principal[c] = doc[c] || [];
    return principal;
  }
  const porDefecto = anioPorDefectoDe(doc);
  const archivo = archivoAnioVacio(clave);
  for (const c of COLECCIONES_ANIO) archivo[c] = (doc[c] || []).filter((r) => anioDeRegistro(c, r, porDefecto) === clave);
  return archivo;
}

// Años que tienen registros en el documento, de menor a mayor.
export function aniosDelDoc(doc) {
  const porDefecto = anioPorDefectoDe(doc);
  const anios = new Set();
  for (const c of COLECCIONES_ANIO) for (const r of doc[c] || []) anios.add(anioDeRegistro(c, r, porDefecto));
  return [...anios].sort();
}

export function separarPorAnio(doc) {
  const anios = {};
  for (const a of aniosDelDoc(doc)) anios[a] = contenidoArchivo(doc, a);
  return { principal: contenidoArchivo(doc, PRINCIPAL), anios };
}

// Si el mismo registro aparece en dos años (se movió y un archivo quedó con la copia
// vieja), queda la versión más reciente.
export function unirAnios(principal, anios) {
  let doc = { ...principal };
  for (const c of COLECCIONES_ANIO) doc[c] = [];
  for (const clave of Object.keys(anios).sort()) doc = fusionarEn(doc, anios[clave], COLECCIONES_ANIO);
  return doc;
}

// Valida el contenido de un archivo de año.
export function normalizarAnio(contenido, clave) {
  if (!contenido || typeof contenido !== 'object' || Array.isArray(contenido)) {
    throw new Error(`${nombreArchivo(clave)} no tiene el formato de Gastos del hogar.`);
  }
  if (Number(contenido.esquema) > ESQUEMA) {
    throw Object.assign(new Error('Los datos son de una versión más nueva de la app. Actualiza la app.'), { codigo: 'esquema_nuevo' });
  }
  const out = { ...archivoAnioVacio(clave), ...contenido };
  for (const c of COLECCIONES_ANIO) if (!Array.isArray(out[c])) out[c] = [];
  return out;
}

// true si el archivo del año `clave` tiene registros cuya versión vigente en `doc` ya es
// de otro año: hay que volver a subirlo para que quede vivo en un solo archivo.
export function tieneCopiasViejas(doc, clave, contenido) {
  const porDefecto = anioPorDefectoDe(doc);
  for (const c of COLECCIONES_ANIO) {
    const vigentes = new Map((doc[c] || []).map((r) => [r.id, r]));
    for (const r of contenido[c] || []) {
      const v = vigentes.get(r.id);
      if (v && anioDeRegistro(c, v, porDefecto) !== clave) return true;
    }
  }
  return false;
}
