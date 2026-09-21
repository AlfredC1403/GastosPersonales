// Tasa de cambio de cada mes. Antes era un solo valor en la configuración, así que el resumen
// de un año viejo valoraba una partida de US$50 con la tasa de hoy y la comparación entre años
// salía movida. Ahora se guarda una tasa por mes y cada cálculo usa la de su mes.
//
// La lista no tiene que estar completa: un mes sin tasa propia usa la última anterior que exista
// (la tasa no cambió ese mes, o nadie la anotó), y si no hay ninguna anterior, la más antigua.
// Si no hay ninguna, se cae a la que quedó en la configuración, que es como trabajaba el
// esquema 3: así un archivo recién migrado da exactamente los mismos números.
import { vivo } from './modelo.js';
import { periodoDe } from './util.js';

export const idTasa = (periodo) => `tasa-${periodo}`;

const esPeriodo = (p) => /^\d{4}-\d{2}$/.test(p || '');

// La tasa suelta que guardaba el esquema 3, vista como la tasa de un mes: el mes en que se
// anotó o, si no se sabe, el de inicio del hogar. La migración la escribe en la lista con esta
// misma forma, y mientras tanto sirve de respaldo para que nada cambie de valor.
export function tasasDesdeConfig(config = {}) {
  const valor = Number(config.tasaReferencia) || 0;
  const periodo = String(config.tasaReferenciaDesde || config.inicio || '').slice(0, 7);
  if (!(valor > 0) || !esPeriodo(periodo)) return [];
  return [{ id: idTasa(periodo), periodo, valor, nota: '', creado: '', creadoPor: null, actualizado: '', actualizadoPor: null }];
}

// Tasas vivas ordenadas por mes, de la más vieja a la más nueva. Un documento que todavía no
// tiene lista (recién abierto, o de una app anterior) usa la tasa de la configuración.
export function tasasOrdenadas(doc) {
  const lista = (doc?.tasas || [])
    .filter((t) => vivo(t) && Number(t.valor) > 0 && esPeriodo(t.periodo || ''))
    .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
  return lista.length ? lista : tasasDesdeConfig(doc?.config);
}

// Busca la tasa de un mes en una lista ya ordenada.
export function tasaEnLista(lista, periodo, respaldo = 0) {
  if (!lista.length) return Number(respaldo) || 0;
  let elegida = null;
  for (const t of lista) {
    if (t.periodo > periodo) break;
    elegida = t;
  }
  return Number((elegida || lista[0]).valor) || Number(respaldo) || 0;
}

// Prepara el buscador que usa el índice: `tasaEn(periodo)` y `tasaEn()` para la de hoy.
export function prepararTasas(doc, hoy = '') {
  const lista = tasasOrdenadas(doc);
  const respaldo = Number(doc?.config?.tasaReferencia) || 0;
  const deHoy = periodoDe(hoy) || '9999-12';
  const cache = new Map();
  return (periodo) => {
    const p = /^\d{4}-\d{2}$/.test(periodo || '') ? periodo : deHoy;
    if (!cache.has(p)) cache.set(p, tasaEnLista(lista, p, respaldo));
    return cache.get(p);
  };
}

// La tasa que la app propone al anotar un mes nuevo: la última que se anotó.
export function ultimaTasaAnotada(doc) {
  const lista = tasasOrdenadas(doc);
  return lista.length ? lista[lista.length - 1] : null;
}

// Meses entre la última tasa anotada y `hoy`. Una tasa vieja distorsiona en silencio todo lo
// que está en dólares y no se ha pagado, así que la app avisa cuando se pasa de un mes.
export function mesesSinAnotar(doc, hoy) {
  const ultima = ultimaTasaAnotada(doc);
  const actual = periodoDe(hoy);
  if (!ultima || !actual) return null;
  const [a1, m1] = ultima.periodo.split('-').map(Number);
  const [a2, m2] = actual.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}
