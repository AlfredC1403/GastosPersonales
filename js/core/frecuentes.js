// Registro rápido: los comercios donde el hogar compra seguido, con el monto de siempre.
//
// La mayor parte de los gastos de un mes son los mismos cinco o seis lugares: el súper, la
// gasolinera, la pulpería, el café. Anotarlos es un formulario entero cada vez. Con la historia
// que ya está en el archivo se puede proponer el gasto completo (comercio, monto, cuenta,
// categoría y partida) y dejar el registro en dos toques.
import { vivo } from './modelo.js';
import { periodoDe, sumarMeses, redondear } from './util.js';
import { coincidePersona } from './filtro.js';

export const MESES = 3;
export const MAXIMO = 6;

// El valor que más se repite; si ninguno se repite, la mediana. En un súper cada compra es
// distinta y la mediana acierta más; en el café siempre es el mismo monto y la moda lo clava.
function montoHabitual(montos) {
  const veces = new Map();
  for (const v of montos) veces.set(v, (veces.get(v) || 0) + 1);
  let moda = null;
  let max = 1;
  for (const [v, n] of veces) if (n > max) { max = n; moda = v; }
  if (moda != null) return moda;
  const o = [...montos].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : redondear((o[o.length / 2 - 1] + o[o.length / 2]) / 2);
}

// Lo que más se repite en una lista de valores (la cuenta con la que se paga, la categoría).
function loDeSiempre(valores) {
  const veces = new Map();
  for (const v of valores) if (v != null) veces.set(v, (veces.get(v) || 0) + 1);
  let mejor = null;
  let max = 0;
  for (const [v, n] of veces) if (n > max) { max = n; mejor = v; }
  return mejor;
}

// Los comercios donde más se compró en los últimos `meses`, del más frecuente al menos. Cada uno
// trae el gasto que la app va a proponer: monto, cuenta, categoría, partida y moneda.
export function comerciosFrecuentes(ix, { meses = MESES, maximo = MAXIMO, filtro = null, minimo = 2 } = {}) {
  const desde = sumarMeses(periodoDe(ix.hoy), -(Math.max(1, meses) - 1));
  const porComercio = new Map();
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m) || m.tipo !== 'gasto' || !m.comercioId || m.cuotas) continue;
    if ((m.periodo || periodoDe(m.fecha)) < desde) continue;
    if (!coincidePersona(m.personaId ?? null, filtro)) continue;
    const c = ix.comercios.get(m.comercioId);
    if (!vivo(c)) continue;
    if (!porComercio.has(m.comercioId)) porComercio.set(m.comercioId, []);
    porComercio.get(m.comercioId).push(m);
  }

  const lista = [];
  for (const [comercioId, movs] of porComercio) {
    if (movs.length < minimo) continue;
    const c = ix.comercios.get(comercioId);
    const moneda = loDeSiempre(movs.map((m) => m.moneda)) || 'L';
    const mismaMoneda = movs.filter((m) => (m.moneda || 'L') === moneda);
    lista.push({
      comercioId,
      nombre: c.nombre || '',
      veces: movs.length,
      ultima: movs.reduce((a, m) => (m.fecha > a ? m.fecha : a), ''),
      moneda,
      monto: montoHabitual(mismaMoneda.map((m) => Number(m.monto) || 0)),
      cuentaId: loDeSiempre(movs.map((m) => m.cuentaId)) || c.medioPagoId || null,
      categoriaId: loDeSiempre(movs.map((m) => m.categoriaId)) || c.categoriaId || null,
      partidaId: loDeSiempre(movs.map((m) => m.partidaId)) ?? c.partidaId ?? null,
      etiquetas: loDeSiempre(movs.map((m) => (m.etiquetas || []).join('|'))),
    });
  }
  // Primero los que más se repiten; entre dos iguales, el más reciente.
  lista.sort((a, b) => b.veces - a.veces || (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : 0));
  return lista.slice(0, Math.max(1, maximo));
}

// El movimiento que propone un comercio frecuente, listo para guardar o para abrir en el
// formulario completo si hay que cambiarle algo.
export function gastoSugerido(f, { fecha, personaId = null }) {
  return {
    tipo: 'gasto',
    fecha,
    periodo: periodoDe(fecha),
    monto: f.monto,
    moneda: f.moneda,
    cuentaId: f.cuentaId,
    categoriaId: f.categoriaId,
    partidaId: f.partidaId,
    comercioId: f.comercioId,
    etiquetas: f.etiquetas ? f.etiquetas.split('|') : [],
    personaId,
    nota: '',
  };
}
