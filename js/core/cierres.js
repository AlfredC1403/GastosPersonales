// Cierre de cada año: cómo quedó todo al 31 de diciembre. Se guarda como la "apertura" del año
// siguiente (en su archivo), y así la app puede cargar solo el año actual y el anterior: el año
// cargado más viejo empieza con su apertura en lugar de recorrer todos los años anteriores.
//
// La apertura trae, al cierre del año anterior:
// - cuentas: lo que se movió en cada cuenta (sin su saldo inicial, que se suma aparte);
// - tarjetas: la deuda en lempiras y en dólares, la última tasa de pago, los cargos en dólares con
//   saldo y lo pagado de más (para seguir asignando tasas del cargo más antiguo al más nuevo);
// - préstamos: saldo, intereses y capital pagados, cuotas completas y meses a medias;
// - metas: lo ahorrado con movimientos marcados, y lo que había el día antes de que empezara;
// - partidas: lo que sobraba en las que acumulan;
// - registros: los de ese año o de antes que siguen contando después: compras a cuotas que se
//   siguen cobrando y pagos de un mes del año siguiente.
import { vivo, COLECCIONES_ANIO, gana } from './modelo.js';
import { anioDeRegistro, anioPorDefectoDe, aniosDelDoc } from './anios.js';
import { periodoDe, sumarDias, aCentavos } from './util.js';
import { saldosCuentas, resumenDelAnio } from './reportes.js';
import { estadoCrudoDe } from './prestamos.js';
import { estadoTasas } from './divisas.js';
import { arrastreDe } from './presupuesto.js';
import { ahorradoAl, inicioDeMeta } from './metas.js';

export const VERSION_APERTURA = 1;

const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ordenado = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

// Apertura del año `anio + 1`, calculada con un índice que tiene cargado `anio` y el año
// siguiente (los pagos del año siguiente pueden ser de diciembre).
export function cierreDelAnio(ix, anio) {
  const y = Number(anio);
  const fecha = `${y}-12-31`;
  const periodo = `${y}-12`;
  const porDefecto = anioPorDefectoDe(ix.doc);
  const deEsteAnioOAntes = (coleccion, r) => Number(anioDeRegistro(coleccion, r, porDefecto)) <= y;

  const registros = { movimientos: [], recibos: [] };
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m) || !deEsteAnioOAntes('movimientos', m)) continue;
    const t = ix.tarjetas.get(m.cuentaId);
    const cuotasDespues = !!t && m.tipo === 'gasto' && !!m.cuotas && (t.cuotas.get(m.id) || []).some((q) => q.fecha > fecha);
    if ((m.periodo || periodoDe(m.fecha)) > periodo || cuotasDespues) registros.movimientos.push(m);
  }
  for (const r of ix.doc.recibos || []) {
    if (vivo(r) && deEsteAnioOAntes('recibos', r) && (r.periodo || periodoDe(r.ocurrencia || r.fecha)) > periodo) registros.recibos.push(r);
  }
  registros.movimientos.sort(porId);
  registros.recibos.sort(porId);
  const traidos = new Set(registros.movimientos.map((m) => m.id));

  const saldos = saldosCuentas(ix, fecha);
  const cuentas = {};
  for (const c of ix.doc.cuentas || []) {
    if (!vivo(c) || c.tipo === 'tarjeta') continue;
    const movido = aCentavos(saldos[c.id]) - aCentavos(c.saldoInicial);
    if (movido) cuentas[c.id] = movido;
  }

  const tarjetas = {};
  for (const info of ix.tarjetas.values()) {
    if (info.saldoFecha > fecha) continue; // la tarjeta empezó después del cierre
    const deuda = { ...info.inicial };
    for (const e of ix.eventosTarjeta.get(info.cuenta.id) || []) if (e.fecha <= fecha) deuda[e.moneda] += e.delta;
    const hasta = (x) => x.fecha <= fecha;
    const pagos = info.dolares.pagos.filter(hasta);
    const { pendientes, aFavor } = estadoTasas(info.dolares.cargos.filter(hasta), pagos, info.dolares.semilla);
    tarjetas[info.cuenta.id] = {
      deuda,
      ultimaTasa: pagos.length ? pagos[pagos.length - 1].tasa : info.dolares.ultimaTasa,
      // Los cargos ya pagados solo hacen falta si su compra se sigue usando el año siguiente.
      pendientesUSD: pendientes.filter((c) => c.pendiente > 0 || traidos.has(c.clave)).map(({ clave, pendiente, lempiras }) => ({ clave, pendiente, lempiras })),
      aFavorUSD: aFavor,
    };
  }

  const prestamos = {};
  for (const p of ix.doc.prestamos || []) {
    if (!vivo(p) || !(p.saldoPeriodo <= periodo)) continue;
    const s = estadoCrudoDe(ix, p, periodo);
    prestamos[p.id] = {
      periodo, saldo: s.saldo, interesPagado: s.interesPagado, capitalPagado: s.capitalPagado, cuotasPagadas: s.cuotasPagadas,
      parciales: s.parciales, ultimoPeriodo: s.ultimoPeriodo,
    };
  }

  const metas = {};
  for (const meta of ix.doc.metas || []) {
    if (!vivo(meta)) continue;
    const entrada = { movimientos: ahorradoAl(ix, meta, fecha, false) - aCentavos(meta.saldoInicial) };
    const antesDelInicio = sumarDias(`${inicioDeMeta(ix, meta)}-01`, -1);
    if (antesDelInicio <= fecha) {
      const previo = ix.apertura && antesDelInicio < ix.apertura.fecha ? ix.apertura.metas?.[meta.id]?.alInicio : null;
      if (previo?.fecha === antesDelInicio) {
        entrada.alInicio = previo;
      } else {
        const cuenta = meta.cuentaId ? ix.cuentas.get(meta.cuentaId) : null;
        const saldo = saldosCuentas(ix, antesDelInicio)[meta.cuentaId];
        entrada.alInicio = {
          fecha: antesDelInicio,
          cuenta: cuenta && saldo !== undefined ? aCentavos(saldo) - aCentavos(cuenta.saldoInicial) : 0,
          movimientos: ahorradoAl(ix, meta, antesDelInicio, false) - aCentavos(meta.saldoInicial),
        };
      }
    }
    metas[meta.id] = entrada;
  }

  const partidas = {};
  for (const p of ix.doc.partidas || []) {
    if (!vivo(p) || !p.acumula || p.tipo !== 'gasto') continue;
    const sobra = arrastreDe(ix, p, `${y + 1}-01`);
    if (sobra) partidas[p.id] = sobra;
  }

  return {
    version: VERSION_APERTURA, anio: y + 1, fecha,
    cuentas: ordenado(cuentas), tarjetas: ordenado(tarjetas), prestamos: ordenado(prestamos), metas: ordenado(metas), partidas: ordenado(partidas),
    registros,
  };
}

// ---------------------------------------------------------------- Años cargados en el documento

// Años cargados: los que tienen registros o apertura, de menor a mayor.
export const aniosCargados = (doc) => [...new Set([...aniosDelDoc(doc), ...Object.keys(doc.aperturas || {})])].sort();

// Apertura con la que se calcula el índice: la del año cargado más viejo (null si ese año es el
// primero de los datos o si no está cargado ningún año).
export function aperturaActiva(doc) {
  const [primero] = aniosCargados(doc);
  return (primero && doc.aperturas?.[primero]) || null;
}

// El documento sin los registros ni las aperturas de `anios` (quedan en OneDrive).
export function quitarAnios(doc, anios) {
  const fuera = new Set(anios.map(String));
  const porDefecto = anioPorDefectoDe(doc);
  const out = { ...doc, aperturas: Object.fromEntries(Object.entries(doc.aperturas || {}).filter(([a]) => !fuera.has(a))) };
  for (const c of COLECCIONES_ANIO) out[c] = (doc[c] || []).filter((r) => !fuera.has(anioDeRegistro(c, r, porDefecto)));
  return out;
}

// Une la apertura de un archivo de año con la del documento: gana la calculada más recientemente.
// Un archivo sin apertura no borra la del documento (puede que todavía no se haya subido).
export function fusionarApertura(doc, clave, remota) {
  const local = doc.aperturas?.[clave];
  if (remota === undefined || (remota === null && local)) return doc;
  if (local && remota && !gana(remota, local)) return doc;
  return { ...doc, aperturas: { ...(doc.aperturas || {}), [clave]: remota } };
}

const sinSello = ({ actualizado, ...resto }) => resto;
export const mismaApertura = (a, b) => !!a && !!b && JSON.stringify(sinSello(a)) === JSON.stringify(sinSello(b));

// Lo que hay que volver a guardar: las aperturas de los años cargados después del primero (hasta el
// año actual) que cambiaron y los resúmenes de los años pasados cargados que cambiaron.
// Devuelve { aperturas: { '2027': apertura }, resumenes: { '2026': resumen } }.
export function cierresPendientes(doc, ix, { actual }) {
  const out = { aperturas: {}, resumenes: {} };
  const anios = aniosCargados(doc);
  if (!anios.length) return out;
  const primero = Number(anios[0]);
  const ultimo = Math.max(Number(anios[anios.length - 1]), Number(actual));
  for (let y = primero + 1; y <= ultimo; y++) {
    const nueva = cierreDelAnio(ix, y - 1);
    if (!mismaApertura(nueva, doc.aperturas?.[String(y)])) out.aperturas[String(y)] = nueva;
  }
  const personas = (doc.personas || []).filter(vivo).map((p) => p.id);
  for (let y = primero; y < Number(actual); y++) {
    const nuevo = resumenDelAnio(ix, y, personas);
    const guardado = (doc.resumenes || []).find((r) => r.id === String(y));
    const igual = vivo(guardado) && guardado.version === nuevo.version && JSON.stringify(guardado.variantes) === JSON.stringify(nuevo.variantes);
    if (!igual) out.resumenes[String(y)] = nuevo;
  }
  return out;
}
