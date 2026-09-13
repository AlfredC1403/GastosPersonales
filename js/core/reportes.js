// Reportes: resumen del mes, gasto por grupo, categoría, medio o persona, historial y saldos.
import { vivo } from './modelo.js';
import { sumarMeses, periodoDe, aCentavos, deCentavos, redondear } from './util.js';
import { coincidePersona } from './filtro.js';
import { estadoPartidas, ingresosDelMes, partidasDelMes, usoDelPlan } from './presupuesto.js';
import { cuotasDelMes, deudaAl, costoDePrestamos } from './prestamos.js';
import { deudaTarjetasAl } from './tarjetas.js';
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
    // Las tarjetas no tienen saldo a favor: su deuda está en tarjetas.js.
    for (const cuenta of ix.doc.cuentas || []) if (vivo(cuenta) && cuenta.tipo !== 'tarjeta') c[cuenta.id] = aCentavos(cuenta.saldoInicial);
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

// ---------------------------------------------------------------- Patrimonio, resumen anual y comparación de años

// Patrimonio al final de `fecha`: cuentas (los dólares, con la tasa de referencia) menos lo que
// se debe en tarjetas y préstamos. Montos en lempiras.
export function patrimonioAl(ix, fecha, filtro) {
  return memo(ix, `patrimonio|${fecha}|${claveFiltro(filtro)}`, () => {
    const saldos = saldosCuentas(ix, fecha);
    let cuentas = 0;
    for (const c of ix.doc.cuentas || []) {
      if (vivo(c) && c.tipo !== 'tarjeta' && coincidePersona(c.titularId || null, filtro)) cuentas += aCentavos(enLempirasAprox(ix, c.id, saldos[c.id] || 0));
    }
    const tarjetas = deudaTarjetasAl(ix, fecha, filtro);
    const prestamos = aCentavos(deudaAl(ix, periodoDe(fecha), filtro));
    return { cuentas: deCentavos(cuentas), tarjetas: deCentavos(tarjetas), prestamos: deCentavos(prestamos), total: deCentavos(cuentas - tarjetas - prestamos) };
  });
}

const esBisiesto = (anio) => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

// El mismo día del año en `anio` (un 29 de febrero pasa al 28 si el año no es bisiesto).
export function mismoDiaEn(anio, fecha) {
  const mmdd = String(fecha).slice(5, 10);
  return mmdd === '02-29' && !esBisiesto(Number(anio)) ? `${anio}-02-28` : `${anio}-${mmdd}`;
}

const TIPOS_SALIDA = ['gasto', 'abono', 'pago_tarjeta'];
const totalesVacios = () => ({ bruto: 0, neto: 0, deducciones: 0, gasto: 0, ahorro: 0, cuotas: 0, abonos: 0, salidas: 0, porGrupo: {} });

// Resumen de un año, completo o hasta `hasta` (una fecha de ese año): ingresos bruto y neto,
// deducciones por concepto y por persona, gasto por grupo, categoría, partida, medio y persona,
// ahorro, pagos a deudas, salidas de dinero (por fecha de pago) y cada mes. También la deuda de
// préstamos al empezar y al corte (con los intereses y seguros pagados) y el patrimonio.
// `sinDatos`: el año no tiene registros (con el filtro, de esa persona).
export function resumenAnual(ix, anio, filtro, { hasta = '' } = {}) {
  const y = String(anio);
  return memo(ix, `anual|${y}|${hasta}|${claveFiltro(filtro)}`, () => {
    const corteMes = hasta ? periodoDe(hasta) : `${y}-12`;
    const fin = hasta || `${y}-12-31`;
    const meses = Array.from({ length: 12 }, (_, i) => ({ periodo: `${y}-${String(i + 1).padStart(2, '0')}`, ...totalesVacios() }));
    const t = {
      ...totalesVacios(), porCategoria: {}, porPartida: {}, porMedio: {}, porPersona: {}, ingresosPorPersona: {}, deduccionesPorConcepto: {},
      deduccionesPorPersona: {}, incompletos: 0, estimado: false,
    };
    let registros = 0;
    for (const m of meses) {
      if (m.periodo > corteMes) continue;
      for (const a of ix.porPeriodo.get(m.periodo) || []) {
        if ((hasta && m.periodo === corteMes && a.fecha > hasta) || !coincidePersona(a.personaId, filtro)) continue;
        registros++;
        const persona = a.personaId || 'sin';
        if (a.clase === 'gasto') {
          m.gasto += a.c;
          sumarEn(m.porGrupo, a.grupoId, a.c);
          sumarEn(t.porGrupo, a.grupoId, a.c);
          sumarEn(t.porCategoria, a.categoriaId || 'sin', a.c);
          sumarEn(t.porMedio, a.medioId || 'sin', a.c);
          sumarEn(t.porPersona, persona, a.c);
          if (a.partidaId) sumarEn(t.porPartida, a.partidaId, a.c);
          if (a.estimado) t.estimado = true;
        } else if (a.clase === 'ingreso') {
          m.neto += a.c;
          m.bruto += a.bruto ?? a.c;
          const x = t.ingresosPorPersona[persona] || (t.ingresosPorPersona[persona] = { bruto: 0, neto: 0 });
          x.neto += a.c;
          x.bruto += a.bruto ?? a.c;
          if (a.completo === false) t.incompletos++;
        } else if (a.clase === 'deduccion') {
          m.deducciones += a.c;
          sumarEn(t.deduccionesPorConcepto, a.nombre, a.c);
          sumarEn(t.deduccionesPorPersona, persona, a.c);
        } else if (a.clase === 'ahorro') {
          m.ahorro += a.c;
        } else if (a.clase === 'prestamo') {
          if (a.tipoPago === 'abono') m.abonos += a.c;
          else m.cuotas += a.c;
        }
      }
    }
    // El dinero que salió de las cuentas, por la fecha del pago (una compra con tarjeta sale al pagarla).
    const tasa = Number(ix.config.tasaReferencia) || 0;
    for (const a of ix.saldos) {
      if (a.delta >= 0 || a.fecha < `${y}-01-01` || a.fecha > fin || !coincidePersona(a.personaId, filtro)) continue;
      if (!TIPOS_SALIDA.includes(ix.movimientos.get(a.origen)?.tipo)) continue;
      const c = a.moneda === 'USD' ? Math.round(-a.delta * tasa) : -a.delta;
      meses[Number(a.fecha.slice(5, 7)) - 1].salidas += c;
    }
    for (const m of meses) for (const k of ['bruto', 'neto', 'deducciones', 'gasto', 'ahorro', 'cuotas', 'abonos', 'salidas']) t[k] += m[k];

    const anterior = `${Number(y) - 1}-12`;
    const deuda = { inicio: deudaAl(ix, anterior, filtro), fin: deudaAl(ix, corteMes, filtro), ...costoDePrestamos(ix, `${y}-01`, corteMes, filtro) };
    deuda.baja = redondear(deuda.inicio - deuda.fin);
    const aL = (obj) => aLempiras(obj);
    return {
      anio: y, hasta, corteMes, sinDatos: !registros,
      ingresos: {
        bruto: deCentavos(t.bruto), neto: deCentavos(t.neto), incompletos: t.incompletos,
        porPersona: Object.fromEntries(Object.entries(t.ingresosPorPersona).map(([id, x]) => [id, { bruto: deCentavos(x.bruto), neto: deCentavos(x.neto) }])),
      },
      deducciones: { total: deCentavos(t.deducciones), porConcepto: aL(t.deduccionesPorConcepto), porPersona: aL(t.deduccionesPorPersona) },
      gasto: {
        total: deCentavos(t.gasto), estimado: t.estimado, porGrupo: aL(t.porGrupo), porCategoria: aL(t.porCategoria), porPartida: aL(t.porPartida),
        porMedio: aL(t.porMedio), porPersona: aL(t.porPersona),
      },
      ahorro: deCentavos(t.ahorro),
      pagosDeuda: { cuotas: deCentavos(t.cuotas), abonos: deCentavos(t.abonos), total: deCentavos(t.cuotas + t.abonos) },
      salidas: deCentavos(t.salidas),
      meses: meses.map((m) => ({
        periodo: m.periodo, incluido: m.periodo <= corteMes, bruto: deCentavos(m.bruto), neto: deCentavos(m.neto), deducciones: deCentavos(m.deducciones),
        gasto: deCentavos(m.gasto), ahorro: deCentavos(m.ahorro), pagosDeuda: deCentavos(m.cuotas + m.abonos), salidas: deCentavos(m.salidas), porGrupo: aL(m.porGrupo),
      })),
      deuda,
      patrimonio: { inicio: patrimonioAl(ix, `${Number(y) - 1}-12-31`, filtro), fin: patrimonioAl(ix, fin, filtro) },
    };
  });
}

// Diferencia de A frente a B, en lempiras y en porcentaje (null si B es cero).
export function diferencia(a, b) {
  const dif = deCentavos(aCentavos(a) - aCentavos(b));
  return { dif, pct: aCentavos(b) ? Math.round(((aCentavos(a) - aCentavos(b)) / Math.abs(aCentavos(b))) * 1000) / 10 : null };
}

// Compara dos años. `modo`: 'va' (en lo que va del año: los dos cortan el mismo día que `hoy`)
// o 'completo'. `sentido` de cada fila: 1 si subir es bueno, -1 si subir es malo.
export function compararAnios(ix, anioA, anioB, { modo = 'va', hoy = ix.hoy, filtro } = {}) {
  const corte = (anio) => (modo === 'va' ? mismoDiaEn(anio, hoy) : '');
  const A = resumenAnual(ix, anioA, filtro, { hasta: corte(anioA) });
  const B = resumenAnual(ix, anioB, filtro, { hasta: corte(anioB) });
  const fila = (clave, nombre, sentido, valor) => ({ clave, nombre, sentido, A: valor(A), B: valor(B), ...diferencia(valor(A), valor(B)) });
  const filas = [
    fila('bruto', 'Ingresos brutos', 1, (r) => r.ingresos.bruto),
    fila('neto', 'Ingresos netos', 1, (r) => r.ingresos.neto),
    fila('deducciones', 'Deducciones', -1, (r) => r.deducciones.total),
    fila('gasto', 'Gasto', -1, (r) => r.gasto.total),
    fila('ahorro', 'Ahorro', 1, (r) => r.ahorro),
    fila('pagosDeuda', 'Pagos a deudas', 1, (r) => r.pagosDeuda.total),
    fila('deuda', 'Deuda de préstamos al corte', -1, (r) => r.deuda.fin),
    fila('patrimonio', 'Patrimonio al corte', 1, (r) => r.patrimonio.fin.total),
  ];

  // Gasto por grupo, y dentro de cada grupo por categoría y por partida.
  const ids = (obj) => Object.keys(obj);
  const grupoDePartida = (id) => ix.grupoDe(ix.partidas.get(id)?.categoriaId);
  const orden = [...ix.ordenGrupos, 'sin-grupo'];
  const grupos = [...new Set([...ids(A.gasto.porGrupo), ...ids(B.gasto.porGrupo)])]
    .sort((x, y) => orden.indexOf(x) - orden.indexOf(y))
    .map((id) => {
      const detalle = (clave, pertenece) => [...new Set([...ids(A.gasto[clave]), ...ids(B.gasto[clave])])]
        .filter(pertenece)
        .map((x) => ({ id: x, A: A.gasto[clave][x] || 0, B: B.gasto[clave][x] || 0, ...diferencia(A.gasto[clave][x] || 0, B.gasto[clave][x] || 0) }))
        .sort((x, y) => Math.max(y.A, y.B) - Math.max(x.A, x.B));
      return {
        id, A: A.gasto.porGrupo[id] || 0, B: B.gasto.porGrupo[id] || 0, ...diferencia(A.gasto.porGrupo[id] || 0, B.gasto.porGrupo[id] || 0),
        categorias: detalle('porCategoria', (c) => ix.grupoDe(c === 'sin' ? null : c) === id),
        partidas: detalle('porPartida', (p) => grupoDePartida(p) === id),
      };
    });
  const meses = A.meses.map((m, i) => ({ mes: i + 1, A: m.incluido ? m.gasto : null, B: B.meses[i].incluido ? B.meses[i].gasto : null }));
  return { anioA: String(anioA), anioB: String(anioB), modo, corteA: A.hasta, corteB: B.hasta, A, B, sinDatosA: A.sinDatos, sinDatosB: B.sinDatos, filas, grupos, meses };
}
