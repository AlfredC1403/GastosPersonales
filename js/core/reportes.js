// Reportes: resumen del mes, gasto por grupo, categoría, medio o persona, historial y saldos.
import { vivo } from './modelo.js';
import { sumarMeses, aCentavos, deCentavos, redondear } from './util.js';
import { coincidePersona } from './filtro.js';
import { estadoPartidas, ingresosDelMes, partidasDelMes, usoDelPlan } from './presupuesto.js';
import { cuotasDelMes } from './prestamos.js';
import { estadoRecibo } from './nomina.js';

// Guarda resultados en el índice: se rehace solo cuando cambian los datos.
function memo(ix, clave, calcular) {
  ix.memo ??= new Map();
  if (!ix.memo.has(clave)) ix.memo.set(clave, calcular());
  return ix.memo.get(clave);
}
const claveFiltro = (filtro) => filtro?.personaId || '';

const sumarEn = (obj, clave, c) => {
  obj[clave] = (obj[clave] || 0) + c;
};
const aLempiras = (obj) => Object.fromEntries(Object.entries(obj).map(([k, c]) => [k, deCentavos(c)]));

// Gasto registrado en el mes (por fecha de compra), con sus totales por dimensión.
export function gastoDelMes(ix, periodo, filtro) {
  return memo(ix, `gasto|${periodo}|${claveFiltro(filtro)}`, () => {
    const t = { total: 0, estimado: false, porGrupo: {}, porCategoria: {}, porMedio: {}, porPersona: {}, porPartida: {} };
    for (const a of ix.porPeriodo.get(periodo) || []) {
      if (a.clase !== 'gasto' || !coincidePersona(a.personaId, filtro)) continue;
      t.total += a.c;
      if (a.estimado) t.estimado = true;
      sumarEn(t.porGrupo, a.grupoId, a.c);
      sumarEn(t.porCategoria, a.categoriaId || 'sin', a.c);
      sumarEn(t.porMedio, a.medioId || 'sin', a.c);
      sumarEn(t.porPersona, a.personaId || 'sin', a.c);
      if (a.partidaId) sumarEn(t.porPartida, a.partidaId, a.c);
    }
    return {
      total: deCentavos(t.total), estimado: t.estimado, porGrupo: aLempiras(t.porGrupo), porCategoria: aLempiras(t.porCategoria),
      porMedio: aLempiras(t.porMedio), porPersona: aLempiras(t.porPersona), porPartida: aLempiras(t.porPartida),
    };
  });
}

// Lo descontado de los salarios en el mes (por fecha del pago): no es gasto del hogar, porque
// el presupuesto trabaja con el neto. También los recibos con deducciones sin monto.
export function descontadoDelMes(ix, periodo, filtro) {
  return memo(ix, `descontado|${periodo}|${claveFiltro(filtro)}`, () => {
    const c = { total: 0, porConcepto: {}, porPersona: {}, porNaturaleza: {} };
    for (const a of ix.porPeriodo.get(periodo) || []) {
      if (a.clase !== 'deduccion' || !coincidePersona(a.personaId, filtro)) continue;
      c.total += a.c;
      sumarEn(c.porConcepto, a.nombre, a.c);
      sumarEn(c.porPersona, a.personaId || 'sin', a.c);
      sumarEn(c.porNaturaleza, a.naturaleza, a.c);
    }
    const incompletos = (ix.recibosPorPeriodo.get(periodo) || []).filter((r) => {
      const persona = r.personaId || ix.ingresos.get(r.ingresoId)?.personaId || null;
      return coincidePersona(persona, filtro) && estadoRecibo(r).pendientes > 0;
    });
    return {
      total: deCentavos(c.total), porConcepto: aLempiras(c.porConcepto), porPersona: aLempiras(c.porPersona), porNaturaleza: aLempiras(c.porNaturaleza),
      incompletos,
    };
  });
}

// Todo lo del mes: plan (partidas y cuotas), ingresos, gasto real y lo que queda libre.
// Con filtro, las partidas y cuotas van por responsable, y lo registrado, por quién pagó.
export function resumenMes(ix, periodo, filtro) {
  return memo(ix, `resumen|${periodo}|${claveFiltro(filtro)}`, () => {
    const partidas = estadoPartidas(ix, periodo, filtro);
    const cuotas = cuotasDelMes(ix, periodo, filtro);
    const ingresos = ingresosDelMes(ix, periodo, filtro);
    // Pagar un pago anual sale de lo que ya se apartó, y una cuota por planilla ya viene
    // descontada del neto: ninguna de las dos se cuenta otra vez.
    const plan = [...cuotas.filter((it) => !it.planilla), ...partidas.filter((it) => it.parte !== 'pagar')];
    const enPlan = partidasDelMes(ix, periodo);

    const c = { comprometido: 0, pagado: 0, pendiente: 0, ingresoEsperado: 0, ingresoReal: 0, fueraDelPlan: 0, ahorro: 0, abonos: 0 };
    for (const it of plan) {
      c.comprometido += aCentavos(usoDelPlan(it));
      c.pagado += aCentavos(it.real);
      c.pendiente += aCentavos(it.queda);
    }
    for (const it of ingresos) c.ingresoEsperado += aCentavos(it.esperado);
    for (const a of ix.porPeriodo.get(periodo) || []) {
      if (!coincidePersona(a.personaId, filtro)) continue;
      if (a.clase === 'ingreso') c.ingresoReal += a.c;
      else if (a.clase === 'ahorro') c.ahorro += a.c;
      else if (a.clase === 'prestamo' && a.tipoPago === 'abono') c.abonos += a.c;
      else if (a.clase === 'gasto' && !a.prestamoId && !(a.partidaId && enPlan.has(`${a.partidaId}|${a.parte || ''}`))) c.fueraDelPlan += a.c;
    }

    const gasto = gastoDelMes(ix, periodo, filtro);
    const r = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, deCentavos(v)]));
    r.descontado = descontadoDelMes(ix, periodo, filtro);
    r.libre = deCentavos(c.ingresoEsperado - c.comprometido - c.fueraDelPlan);
    r.gastoReal = gasto.total;
    r.gasto = gasto;
    r.partidas = partidas;
    r.cuotas = cuotas;
    r.ingresos = ingresos;
    r.plan = plan;
    r.pendientes = plan
      .filter((it) => it.queda > 0 || (it.estado === 'pendiente' && it.esperado > 0))
      .sort((a, b) => (a.dia || 99) - (b.dia || 99) || a.nombre.localeCompare(b.nombre));
    return r;
  });
}

// Gasto de los últimos `n` meses hasta `hasta`, por grupo.
export function historial(ix, hasta, n = 6, filtro) {
  return Array.from({ length: n }, (_, i) => {
    const periodo = sumarMeses(hasta, i - n + 1);
    return { periodo, ...gastoDelMes(ix, periodo, filtro) };
  });
}

// Grupos para un gráfico apilado: los 5 primeros con su color y el resto como "Otros grupos".
// `valores(porGrupo)` devuelve los montos en el mismo orden que `series`.
export function seriesDeGrupos(ix) {
  const principales = ix.ordenGrupos.slice(0, 5);
  const series = principales.map((id) => ({ clave: id, nombre: ix.grupos.get(id)?.nombre || id, color: colorGrupo(ix, id) }));
  series.push({ clave: 'otros', nombre: 'Otros grupos', color: 'var(--tinta3)' });
  const valores = (porGrupo = {}) => {
    const otros = Object.entries(porGrupo).filter(([id]) => !principales.includes(id)).reduce((a, [, x]) => a + x, 0);
    return [...principales.map((id) => porGrupo[id] || 0), redondear(otros)];
  };
  return { series, valores };
}

// Color de un grupo: los cinco primeros del orden tienen el suyo; el resto, gris.
export function colorGrupo(ix, grupoId) {
  const i = ix.ordenGrupos.indexOf(grupoId);
  return i >= 0 && i < 5 ? `var(--s${i + 1})` : 'var(--tinta3)';
}

// Saldo de cada cuenta en su moneda, con los movimientos hasta `hasta` (fecha) o todos.
export function saldosCuentas(ix, hasta) {
  return memo(ix, `saldos|${hasta || ''}`, () => {
    const c = {};
    for (const cuenta of ix.doc.cuentas || []) if (vivo(cuenta)) c[cuenta.id] = aCentavos(cuenta.saldoInicial);
    for (const a of ix.saldos) {
      if (hasta && a.fecha > hasta) continue;
      if (a.cuentaId in c) c[a.cuentaId] += a.delta;
    }
    return aLempiras(c);
  });
}

// Saldo en lempiras (las cuentas en dólares, con la tasa de referencia si hay).
export function enLempirasAprox(ix, cuentaId, saldo) {
  if (ix.monedaDe(cuentaId) !== 'USD') return saldo;
  return redondear(saldo * (Number(ix.config.tasaReferencia) || 0));
}
