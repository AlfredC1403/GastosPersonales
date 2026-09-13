// Metas de ahorro: lo ahorrado, lo que falta, el aporte sugerido por mes y por pago, y si van
// al día. Una meta con cuenta propia se mide con el saldo de esa cuenta; una sin cuenta (o que
// comparte la cuenta con otra meta), con su saldo inicial y los aportes y retiros marcados con ella.
import { vivo } from './modelo.js';
import { periodoDe, mesesEntre, sumarDias, aCentavos, deCentavos } from './util.js';
import { coincidePersona } from './filtro.js';
import { saldosCuentas, enLempirasAprox } from './reportes.js';
import { pagosPorMes } from './nomina.js';

export const SITUACIONES_META = {
  lograda: { texto: 'Lograda', clase: 'ok' },
  'al-dia': { texto: 'Al día', clase: 'ok' },
  atrasada: { texto: 'Atrasada', clase: 'aviso' },
  vencida: { texto: 'Pasó la fecha', clase: 'mal' },
  'sin-fecha': { texto: 'Sin fecha', clase: '' },
};

// Menos de L1 de diferencia con el ritmo parejo no cuenta como atraso.
const TOLERANCIA = 100;
const esPeriodo = (p) => /^\d{4}-\d{2}$/.test(p || '');

export function medidaPorCuenta(ix, meta) {
  const cuenta = meta.cuentaId ? ix.cuentas.get(meta.cuentaId) : null;
  if (!vivo(cuenta) || cuenta.tipo === 'tarjeta') return false;
  return !(ix.doc.metas || []).some((x) => x.id !== meta.id && vivo(x) && x.activo !== false && x.cuentaId === meta.cuentaId);
}

// Movimientos marcados con la meta hasta `hasta` (fecha), en centavos de lempira. Aporte: una
// transferencia (salvo la que sale de la cuenta de la meta) o un ingreso. Retiro: una
// transferencia desde la cuenta de la meta o un gasto.
export function movimientosDeMeta(ix, meta, hasta = '') {
  const lista = [];
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m) || m.metaId !== meta.id || (hasta && m.fecha > hasta)) continue;
    let signo = 0;
    if (m.tipo === 'transferencia') signo = meta.cuentaId && m.cuentaId === meta.cuentaId ? -1 : 1;
    else if (m.tipo === 'ingreso') signo = 1;
    else if (m.tipo === 'gasto') signo = -1;
    if (signo) lista.push({ m, fecha: m.fecha, c: signo * ix.montoEnLempiras(m).c });
  }
  return lista;
}

function ahorradoAl(ix, meta, fecha, porCuenta) {
  if (porCuenta) return aCentavos(enLempirasAprox(ix, meta.cuentaId, saldosCuentas(ix, fecha)[meta.cuentaId] || 0));
  return aCentavos(meta.saldoInicial) + movimientosDeMeta(ix, meta, fecha).reduce((a, x) => a + x.c, 0);
}

// Pagos de salario al mes de quien aporta: 2 si cobra por quincena. Una meta del hogar usa el
// mayor de los salarios activos.
export function pagosDeLaPersona(ix, personaId) {
  let pagos = 1;
  for (const i of ix.doc.ingresos || []) {
    if (!vivo(i) || i.activo === false || (personaId && i.personaId !== personaId)) continue;
    pagos = Math.max(pagos, pagosPorMes(i));
  }
  return pagos;
}

// Estado de una meta hoy (`ix.hoy`). Los montos salen en lempiras.
// - aporteMensual: lo que falta repartido en partes iguales hasta el mes de la fecha objetivo
//   (este mes incluido); aportePorPago, dividido entre los pagos de salario del mes.
// - situacion: 'lograda', 'sin-fecha', 'vencida', o 'al-dia' / 'atrasada' comparando lo ahorrado
//   con un ritmo parejo desde el mes en que empezó la meta.
export function estadoMeta(ix, meta) {
  const hoy = ix.hoy;
  const actual = periodoDe(hoy);
  const porCuenta = medidaPorCuenta(ix, meta);
  const objetivo = aCentavos(meta.montoObjetivo);
  const ahorrado = ahorradoAl(ix, meta, hoy, porCuenta);
  const falta = Math.max(0, objetivo - ahorrado);
  const fin = meta.fechaObjetivo ? periodoDe(meta.fechaObjetivo) : null;
  const mesesRestantes = fin ? Math.max(0, mesesEntre(actual, fin) + 1) : null;
  const aporteMensual = falta && mesesRestantes ? Math.ceil(falta / mesesRestantes) : 0;
  const pagos = pagosDeLaPersona(ix, meta.responsableId || null);
  const aportePorPago = aporteMensual && pagos > 1 ? Math.ceil(aporteMensual / pagos) : null;

  // El ritmo parejo empieza el mes en que se creó la meta, o al inicio del registro si es después.
  const inicio = [meta.creado ? periodoDe(meta.creado) : '', ix.config.inicio].filter(esPeriodo).sort().pop() || actual;
  const antesDelInicio = sumarDias(`${inicio}-01`, -1);
  const finMesAnterior = sumarDias(`${actual}-01`, -1);
  const esteMes = ahorrado - ahorradoAl(ix, meta, finMesAnterior, porCuenta);

  let situacion;
  let ritmo = null;
  if (objetivo > 0 && ahorrado >= objetivo) situacion = 'lograda';
  else if (!fin) situacion = 'sin-fecha';
  else if (actual > fin) situacion = 'vencida';
  else {
    const alInicio = ahorradoAl(ix, meta, antesDelInicio, porCuenta);
    const total = Math.max(1, mesesEntre(inicio, fin) + 1);
    const transcurridos = Math.min(total, Math.max(0, mesesEntre(inicio, actual)));
    ritmo = Math.round(alInicio + ((objetivo - alInicio) * transcurridos) / total);
    situacion = ahorrado + TOLERANCIA >= ritmo ? 'al-dia' : 'atrasada';
  }
  return {
    meta, porCuenta, objetivo: deCentavos(objetivo), ahorrado: deCentavos(ahorrado), falta: deCentavos(falta),
    pct: objetivo ? Math.max(0, Math.min(100, Math.round((ahorrado / objetivo) * 100))) : 0,
    fin, mesesRestantes, aporteMensual: deCentavos(aporteMensual), aportePorPago: aportePorPago === null ? null : deCentavos(aportePorPago), pagos,
    situacion, ritmo: ritmo === null ? null : deCentavos(ritmo), inicio, esteMes: deCentavos(esteMes),
  };
}

// Metas activas (con filtro, las de esa persona), de la fecha más cercana a la más lejana.
export function estadoMetas(ix, filtro) {
  return (ix.doc.metas || [])
    .filter((x) => vivo(x) && x.activo !== false && coincidePersona(x.responsableId || null, filtro))
    .map((x) => estadoMeta(ix, x))
    .sort((a, b) => (a.fin || '9999').localeCompare(b.fin || '9999') || a.meta.nombre.localeCompare(b.meta.nombre));
}
