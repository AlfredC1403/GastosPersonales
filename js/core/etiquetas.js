// Etiquetas de los movimientos: la dimensión que faltaba.
//
// Categoría, grupo y partida son jerárquicos y fijos: cada gasto cae en uno y solo uno. Lo que
// no se podía era cruzar: "el viaje a Roatán" toca comida, transporte y entretenimiento a la
// vez, y "la remodelación del baño" toca casa y personal. Una etiqueta atraviesa todo eso.
import { vivo } from './modelo.js';
import { periodoDe, deCentavos, slug } from './util.js';

export const MAXIMO = 8; // por movimiento; más que esto deja de clasificar y empieza a estorbar
export const LARGO = 30;

// Deja una etiqueta como se guarda: sin espacios de sobra, en minúsculas y sin el # que la gente
// escribe por costumbre. Se guarda el texto tal cual (con tildes), no su slug, porque es lo que
// la persona escribió y lo que va a leer.
export function normalizar(texto) {
  return String(texto ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, LARGO).toLowerCase();
}

// Limpia una lista: normaliza, quita vacías y repetidas (comparando sin tildes) y corta en MAXIMO.
export function limpiar(lista) {
  const out = [];
  const vistas = new Set();
  for (const x of Array.isArray(lista) ? lista : []) {
    const e = normalizar(x);
    const clave = slug(e);
    if (!e || !clave || vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(e);
    if (out.length >= MAXIMO) break;
  }
  return out;
}

// Todas las etiquetas que el hogar ha usado, de la más usada a la menos.
// @returns [{ etiqueta, veces, ultima }]
export function etiquetasDelHogar(doc) {
  const cuenta = new Map();
  for (const m of doc?.movimientos || []) {
    if (!vivo(m)) continue;
    for (const e of m.etiquetas || []) {
      const clave = slug(e);
      if (!clave) continue;
      const x = cuenta.get(clave) || { etiqueta: e, veces: 0, ultima: '' };
      x.veces += 1;
      if (m.fecha > x.ultima) x.ultima = m.fecha;
      cuenta.set(clave, x);
    }
  }
  return [...cuenta.values()].sort((a, b) => b.veces - a.veces || b.ultima.localeCompare(a.ultima));
}

// Las que empiezan o contienen lo que se está escribiendo, para proponerlas.
export function sugerir(doc, texto, { excluir = [], maximo = 8 } = {}) {
  const buscado = slug(normalizar(texto));
  const fuera = new Set(excluir.map((e) => slug(e)));
  const lista = etiquetasDelHogar(doc).filter((x) => !fuera.has(slug(x.etiqueta)));
  if (!buscado) return lista.slice(0, maximo);
  const empiezan = lista.filter((x) => slug(x.etiqueta).startsWith(buscado));
  const contienen = lista.filter((x) => !slug(x.etiqueta).startsWith(buscado) && slug(x.etiqueta).includes(buscado));
  return [...empiezan, ...contienen].slice(0, maximo);
}

/**
 * Lo gastado por etiqueta, con su periodo y su gente. Es lo que contesta "¿cuánto nos costó el
 * viaje?", que sin etiquetas no se podía preguntar.
 * @returns [{ etiqueta, total, cuantos, desde, hasta, periodos }] de mayor a menor gasto.
 */
export function gastoPorEtiqueta(ix, { desde = '', hasta = '', filtro = null } = {}) {
  const porEtiqueta = new Map();
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m) || !m.etiquetas?.length) continue;
    if (desde && m.fecha < desde) continue;
    if (hasta && m.fecha > hasta) continue;
    if (filtro?.personaId && (m.personaId || null) !== filtro.personaId && (m.creadoPor || null) !== filtro.personaId) continue;
    const { c } = ix.montoEnLempiras(m);
    const signo = m.tipo === 'ingreso' ? -1 : 1;
    for (const e of m.etiquetas) {
      const clave = slug(e);
      if (!clave) continue;
      const x = porEtiqueta.get(clave) || { etiqueta: e, c: 0, cuantos: 0, desde: m.fecha, hasta: m.fecha, periodos: new Set() };
      x.c += signo * c;
      x.cuantos += 1;
      if (m.fecha < x.desde) x.desde = m.fecha;
      if (m.fecha > x.hasta) x.hasta = m.fecha;
      x.periodos.add(m.periodo || periodoDe(m.fecha));
      porEtiqueta.set(clave, x);
    }
  }
  return [...porEtiqueta.values()]
    .map((x) => ({ ...x, total: deCentavos(x.c), periodos: [...x.periodos].sort() }))
    .sort((a, b) => b.c - a.c);
}

// Lo gastado en una etiqueta, con sus movimientos, para la pantalla de detalle.
export function detalleDeEtiqueta(ix, etiqueta, opciones = {}) {
  const clave = slug(etiqueta);
  const movimientos = (ix.doc.movimientos || []).filter((m) => vivo(m) && (m.etiquetas || []).some((e) => slug(e) === clave));
  const total = movimientos.reduce((a, m) => a + (m.tipo === 'ingreso' ? -1 : 1) * ix.montoEnLempiras(m).c, 0);
  return { etiqueta, movimientos: movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha)), total: deCentavos(total), cuantos: movimientos.length, ...opciones };
}
