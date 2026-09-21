// Reportes: resumen del mes, gasto por grupo, categoría, medio o persona, historial y saldos.
import { vivo } from './modelo.js';
import { sumarMeses, periodoDe, fechaEnMes, ultimoDia, aCentavos, deCentavos, redondear } from './util.js';
import { coincidePersona } from './filtro.js';
import { estadoPartidas, ingresosDelMes, partidasDelMes, usoDelPlan, tasaDe } from './presupuesto.js';
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

    const c = {
      comprometido: 0, pagado: 0, pendiente: 0, ingresoEsperado: 0, ingresoReal: 0, ingresoRecibido: 0, ingresoPorRecibir: 0, otrosIngresos: 0,
      fueraDelPlan: 0, ahorro: 0, abonos: 0,
    };
    for (const it of plan) {
      c.comprometido += aCentavos(usoDelPlan(it));
      c.pagado += aCentavos(it.real);
      c.pendiente += aCentavos(it.queda);
    }
    // Un pago de salario ya registrado cuenta con el neto que llegó (ya sin las deducciones de ese
    // pago); uno que falta, con el neto configurado en el salario.
    for (const it of ingresos) {
      c.ingresoEsperado += aCentavos(it.esperado);
      if (it.hecho) c.ingresoRecibido += aCentavos(it.real);
      else c.ingresoPorRecibir += aCentavos(it.esperado);
    }
    for (const a of ix.porPeriodo.get(periodo) || []) {
      if (!coincidePersona(a.personaId, filtro)) continue;
      if (a.clase === 'ingreso') {
        c.ingresoReal += a.c;
        if (!a.ingresoId) c.otrosIngresos += a.c; // ingresos que no son pagos de un salario
      } else if (a.clase === 'ahorro') c.ahorro += a.c;
      else if (a.clase === 'prestamo' && a.tipoPago === 'abono') c.abonos += a.c;
      else if (a.clase === 'gasto' && !a.prestamoId && !(a.partidaId && enPlan.has(`${a.partidaId}|${a.parte || ''}`))) c.fueraDelPlan += a.c;
    }

    const gasto = gastoDelMes(ix, periodo, filtro);
    const r = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, deCentavos(v)]));
    r.descontado = descontadoDelMes(ix, periodo, filtro);
    r.ingresoDelMes = deCentavos(c.ingresoRecibido + c.ingresoPorRecibir + c.otrosIngresos);
    r.libre = deCentavos(c.ingresoRecibido + c.ingresoPorRecibir + c.otrosIngresos - c.comprometido - c.fueraDelPlan);
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

// Lo que de verdad se gasta en una categoría o en una partida, para proponer el monto de una
// partida variable. `categoriasSobreSuPromedio` avisa cuando algo se dispara; esto es lo
// contrario: el promedio que convierte el presupuesto de "lo que creo que gasto" a "lo que
// gasto". Solo cuenta meses completos (el mes en curso está a medias y bajaría el promedio).
export function sugerirMonto(ix, { categoriaId = null, grupoId = null, partidaId = null, meses = 6, hasta = periodoDe(ix.hoy), filtro = null } = {}) {
  const n = Math.max(1, Math.round(meses));
  const valores = [];
  for (let i = 1; i <= n; i++) {
    const periodo = sumarMeses(hasta, -i);
    if (periodo < (ix.config.inicio || '')) break;
    const g = gastoDelMes(ix, periodo, filtro);
    const fuente = partidaId ? g.porPartida : grupoId ? g.porGrupo : g.porCategoria;
    valores.push(Number(fuente[partidaId || grupoId || categoriaId]) || 0);
  }
  if (!valores.length) return null;
  const conGasto = valores.filter((v) => v > 0);
  const ordenados = [...valores].sort((a, b) => a - b);
  const mediana = ordenados.length % 2
    ? ordenados[(ordenados.length - 1) / 2]
    : (ordenados[ordenados.length / 2 - 1] + ordenados[ordenados.length / 2]) / 2;
  return {
    meses: valores.length,
    mesesConGasto: conGasto.length,
    promedio: redondear(valores.reduce((a, v) => a + v, 0) / valores.length),
    // La mediana aguanta mejor un mes raro (la emergencia del carro) que el promedio.
    mediana: redondear(mediana),
    maximo: redondear(Math.max(...valores)),
    minimo: redondear(Math.min(...valores)),
    valores,
  };
}

// Gasto de los últimos `n` meses hasta `hasta`, por grupo.
// Por dónde va el mes y cuánto queda libre por día. Solo tiene sentido en el mes en curso: en uno
// pasado el mes ya terminó, y en uno futuro no ha empezado. `libre` viene de resumenMes.
export function ritmoDelMes(ix, periodo, libre) {
  const actual = periodoDe(ix.hoy);
  if (periodo !== actual) return null;
  const dias = ultimoDia(periodo);
  const dia = Number(ix.hoy.slice(8));
  const restantes = dias - dia + 1; // hoy cuenta: todavía se puede gastar
  return {
    dia, dias, restantes,
    fraccion: dia / dias, // qué parte del mes ya pasó
    librePorDia: restantes > 0 ? redondear(libre / restantes) : 0,
  };
}

// Cómo va a cerrar el mes si se sigue al mismo ritmo. `ritmoDelMes` ya decía por dónde va cada
// partida variable; esto es la suma: el número que contesta "¿voy a cerrar arriba o abajo?".
//
// Lo de monto fijo se proyecta completo (va a pagarse entero, falte lo que falte del mes). Lo
// variable y lo que se gasta fuera del plan se proyecta al ritmo que lleva, y nunca por debajo
// de lo que ya se gastó. Solo tiene sentido en el mes en curso: uno pasado ya cerró y uno
// futuro no ha empezado (ahí está la proyección de flujo, en core/proyeccion.js).
export function cierreProyectado(ix, periodo, filtro) {
  const r = resumenMes(ix, periodo, filtro);
  const ritmo = ritmoDelMes(ix, periodo, r.libre);
  if (!ritmo) return null;
  const alRitmo = (real) => Math.max(aCentavos(real), Math.round(aCentavos(real) / ritmo.fraccion));

  let proyectado = 0;
  let variable = 0;
  const excesos = [];
  for (const it of r.plan) {
    const esperado = aCentavos(usoDelPlan(it));
    const real = aCentavos(it.real);
    const esVariable = it.forma === 'variable' || it.forma === 'abonos';
    if (!esVariable || it.hecho || !(esperado > 0)) {
      proyectado += Math.max(esperado, real);
      continue;
    }
    const alCierre = Math.max(alRitmo(it.real), esperado ? 0 : real);
    proyectado += alCierre;
    variable += alCierre;
    if (alCierre > esperado) excesos.push({ nombre: it.nombre, clave: it.clave, esperado: deCentavos(esperado), proyectado: deCentavos(alCierre) });
  }
  const fueraDelPlan = alRitmo(r.fueraDelPlan);
  proyectado += fueraDelPlan;

  const ingreso = aCentavos(r.ingresoDelMes);
  const cierre = ingreso - proyectado;
  return {
    ritmo,
    ingreso: r.ingresoDelMes,
    comprometido: r.comprometido,
    proyectado: deCentavos(proyectado),
    fueraDelPlan: deCentavos(fueraDelPlan),
    variable: deCentavos(variable),
    cierre: deCentavos(cierre),
    // Contra lo que el plan decía que iba a sobrar: positivo es mejor de lo previsto.
    contraPlan: deCentavos(cierre - aCentavos(r.libre)),
    arriba: cierre >= 0,
    excesos: excesos.sort((a, b) => (b.proyectado - b.esperado) - (a.proyectado - a.esperado)),
  };
}

// Lo que costó deber: intereses y comisiones de tarjeta más intereses y seguros de préstamos,
// entre dos meses. Es el número que no aparece en ningún lado y cambia comportamiento: no
// cuánto se debe, sino cuánto se pagó solo por deber.
export function costoDeLaDeuda(ix, desde, hasta, filtro) {
  return memo(ix, `costo-deuda|${desde}|${hasta}|${claveFiltro(filtro)}`, () => {
    let tarjetas = 0;
    let ingreso = 0;
    for (let p = desde; p <= hasta; p = sumarMeses(p, 1)) {
      for (const a of ix.porPeriodo.get(p) || []) {
        if (!coincidePersona(a.personaId, filtro)) continue;
        if (a.clase === 'gasto' && a.categoriaId === 'cargos-tarjeta') tarjetas += a.c;
        else if (a.clase === 'ingreso') ingreso += a.c;
      }
      if (p >= hasta) break;
    }
    const prestamos = costoDePrestamos(ix, desde, hasta, filtro);
    const total = deCentavos(tarjetas) + prestamos.intereses + prestamos.seguros;
    return {
      tarjetas: deCentavos(tarjetas),
      intereses: prestamos.intereses,
      seguros: prestamos.seguros,
      total: redondear(total),
      ingreso: deCentavos(ingreso),
      // Qué parte de lo que entró se fue solo en deber.
      pctIngreso: ingreso > 0 ? redondear((aCentavos(total) / ingreso) * 100) : 0,
    };
  });
}

// Categorías que este mes van muy por encima de lo normal, comparando con el promedio de los
// `meses` anteriores completos. Solo las que tienen historia y peso suficiente, para no avisar de
// una farmacia de L50. Devuelve [{ categoriaId, gasto, promedio, exceso }], de mayor a menor exceso.
export function categoriasSobreSuPromedio(ix, periodo, { meses = 3, factor = 1.5, minimo = 500 } = {}) {
  const previos = Array.from({ length: meses }, (_, i) => sumarMeses(periodo, -(meses - i)));
  const conDatos = previos.map((p) => gastoDelMes(ix, p)).filter((g) => g.total > 0);
  if (conDatos.length < 2) return []; // sin al menos dos meses de historia no hay "lo normal"
  const actual = gastoDelMes(ix, periodo).porCategoria;
  const out = [];
  for (const [categoriaId, gasto] of Object.entries(actual)) {
    const suma = conDatos.reduce((t, g) => t + (g.porCategoria[categoriaId] || 0), 0);
    const promedio = redondear(suma / conDatos.length);
    if (promedio < minimo || gasto <= promedio * factor) continue;
    out.push({ categoriaId, gasto, promedio, exceso: redondear(gasto - promedio) });
  }
  return out.sort((a, b) => b.exceso - a.exceso);
}

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
    // Las tarjetas no tienen saldo a favor: su deuda está en tarjetas.js. Con la apertura del primer
    // año cargado, cada cuenta empieza con lo que se movió en los años anteriores.
    const previo = ix.apertura?.cuentas || {};
    for (const cuenta of ix.doc.cuentas || []) if (vivo(cuenta) && cuenta.tipo !== 'tarjeta') c[cuenta.id] = aCentavos(cuenta.saldoInicial) + (previo[cuenta.id] || 0);
    for (const a of ix.saldos) {
      if (hasta && a.fecha > hasta) continue;
      if (a.cuentaId in c) c[a.cuentaId] += a.delta;
    }
    return aLempiras(c);
  });
}

// Saldo en lempiras (las cuentas en dólares, con la tasa del mes que se pida; sin mes, la de hoy,
// que es lo que corresponde a un saldo que todavía está ahí).
export function enLempirasAprox(ix, cuentaId, saldo, periodo = '') {
  if (ix.monedaDe(cuentaId) !== 'USD') return saldo;
  return redondear(saldo * (ix.tasaEn ? ix.tasaEn(periodo) : Number(ix.config.tasaReferencia) || 0));
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

// Montos en lempiras, sin las claves que suman cero.
const aLempirasSinCeros = (obj) => Object.fromEntries(Object.entries(obj).filter(([, c]) => c !== 0).map(([k, c]) => [k, deCentavos(c)]));

// Resumen de un año, completo, hasta `hasta` (una fecha de ese año) o hasta el final del mes
// `hastaMes` (por meses completos, como los resúmenes guardados): ingresos bruto y neto,
// deducciones por concepto y por persona, gasto por grupo, categoría, partida, medio y persona,
// ahorro, pagos a deudas, salidas de dinero (por fecha de pago) y cada mes. También la deuda de
// préstamos al empezar y al corte (con los intereses y seguros pagados) y el patrimonio.
// `sinDatos`: el año no tiene registros (con el filtro, de esa persona).
export function resumenAnual(ix, anio, filtro, { hasta = '', hastaMes = '' } = {}) {
  const y = String(anio);
  return memo(ix, `anual|${y}|${hasta}|${hastaMes}|${claveFiltro(filtro)}`, () => {
    const corteMes = hastaMes || (hasta ? periodoDe(hasta) : `${y}-12`);
    const fin = hasta || fechaEnMes(corteMes, 31);
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
    // Lo que salió en dólares se valora con la tasa de su mes, no con la de hoy.
    for (const a of ix.saldos) {
      if (a.delta >= 0 || a.fecha < `${y}-01-01` || a.fecha > fin || !coincidePersona(a.personaId, filtro)) continue;
      if (!TIPOS_SALIDA.includes(ix.movimientos.get(a.origen)?.tipo)) continue;
      const c = a.moneda === 'USD' ? Math.round(-a.delta * tasaDe(ix, a.fecha.slice(0, 7))) : -a.delta;
      meses[Number(a.fecha.slice(5, 7)) - 1].salidas += c;
    }
    for (const m of meses) for (const k of ['bruto', 'neto', 'deducciones', 'gasto', 'ahorro', 'cuotas', 'abonos', 'salidas']) t[k] += m[k];

    const anterior = `${Number(y) - 1}-12`;
    const deuda = { inicio: deudaAl(ix, anterior, filtro), fin: deudaAl(ix, corteMes, filtro), ...costoDePrestamos(ix, `${y}-01`, corteMes, filtro) };
    deuda.baja = redondear(deuda.inicio - deuda.fin);
    const aL = aLempirasSinCeros;
    return {
      anio: y, hasta, hastaMes, corteMes, sinDatos: !registros,
      ingresos: {
        bruto: deCentavos(t.bruto), neto: deCentavos(t.neto), incompletos: t.incompletos,
        porPersona: Object.fromEntries(Object.entries(t.ingresosPorPersona).filter(([, x]) => x.bruto || x.neto)
          .map(([id, x]) => [id, { bruto: deCentavos(x.bruto), neto: deCentavos(x.neto) }])),
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

// ---------------------------------------------------------------- Resúmenes guardados

// Un año que no está cargado se consulta con su resumen guardado (colección `resumenes`): los
// totales de cada mes en centavos, para el hogar ('') y para cada persona. El gasto por grupo no se
// guarda: sale del gasto por categoría con los grupos de hoy.
export const VERSION_RESUMEN = 1;
const doce = () => Array(12).fill(0);
const sumarMes = (obj, clave, i, c) => { (obj[clave] ??= doce())[i] += c; };
const conClavesOrdenadas = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const trioPatrimonio = (p) => [aCentavos(p.cuentas), aCentavos(p.tarjetas), aCentavos(p.prestamos)];

function varianteDelAnio(ix, y, filtro) {
  const v = {
    registros: doce(), bruto: doce(), neto: doce(), incompletos: doce(), deducciones: doce(), gasto: doce(), estimado: doce(),
    ahorro: doce(), cuotas: doce(), abonos: doce(), salidas: doce(),
    porCategoria: {}, porPartida: {}, porMedio: {}, porPersona: {}, ingresosPorPersona: {}, deduccionesPorConcepto: {}, deduccionesPorPersona: {},
    deudaInicio: aCentavos(deudaAl(ix, `${Number(y) - 1}-12`, filtro)), deuda: doce(), intereses: doce(), seguros: doce(),
    patrimonioInicio: trioPatrimonio(patrimonioAl(ix, `${Number(y) - 1}-12-31`, filtro)), patrimonio: [],
  };
  for (let i = 0; i < 12; i++) {
    const periodo = `${y}-${String(i + 1).padStart(2, '0')}`;
    for (const a of ix.porPeriodo.get(periodo) || []) {
      if (!coincidePersona(a.personaId, filtro)) continue;
      v.registros[i]++;
      const persona = a.personaId || 'sin';
      if (a.clase === 'gasto') {
        v.gasto[i] += a.c;
        sumarMes(v.porCategoria, a.categoriaId || 'sin', i, a.c);
        sumarMes(v.porMedio, a.medioId || 'sin', i, a.c);
        sumarMes(v.porPersona, persona, i, a.c);
        if (a.partidaId) sumarMes(v.porPartida, a.partidaId, i, a.c);
        if (a.estimado) v.estimado[i] = 1;
      } else if (a.clase === 'ingreso') {
        v.neto[i] += a.c;
        v.bruto[i] += a.bruto ?? a.c;
        const x = (v.ingresosPorPersona[persona] ??= { bruto: doce(), neto: doce() });
        x.neto[i] += a.c;
        x.bruto[i] += a.bruto ?? a.c;
        if (a.completo === false) v.incompletos[i]++;
      } else if (a.clase === 'deduccion') {
        v.deducciones[i] += a.c;
        sumarMes(v.deduccionesPorConcepto, a.nombre, i, a.c);
        sumarMes(v.deduccionesPorPersona, persona, i, a.c);
      } else if (a.clase === 'ahorro') {
        v.ahorro[i] += a.c;
      } else if (a.clase === 'prestamo') {
        if (a.tipoPago === 'abono') v.abonos[i] += a.c;
        else v.cuotas[i] += a.c;
      }
    }
    v.deuda[i] = aCentavos(deudaAl(ix, periodo, filtro));
    const costo = costoDePrestamos(ix, `${y}-01`, periodo, filtro);
    v.intereses[i] = aCentavos(costo.intereses);
    v.seguros[i] = aCentavos(costo.seguros);
    v.patrimonio.push(trioPatrimonio(patrimonioAl(ix, fechaEnMes(periodo, 31), filtro)));
  }
  for (const a of ix.saldos) {
    if (a.delta >= 0 || a.fecha < `${y}-01-01` || a.fecha > `${y}-12-31` || !coincidePersona(a.personaId, filtro)) continue;
    if (!TIPOS_SALIDA.includes(ix.movimientos.get(a.origen)?.tipo)) continue;
    v.salidas[Number(a.fecha.slice(5, 7)) - 1] += a.moneda === 'USD' ? Math.round(-a.delta * tasaDe(ix, a.fecha.slice(0, 7))) : -a.delta;
  }
  for (const k of ['porCategoria', 'porPartida', 'porMedio', 'porPersona', 'ingresosPorPersona', 'deduccionesPorConcepto', 'deduccionesPorPersona']) {
    v[k] = conClavesOrdenadas(v[k]);
  }
  return v;
}

// Resumen para guardar de un año cargado (con el año siguiente también cargado, si existe: sus
// pagos pueden ser de meses de este año). `personas`: ids de las personas del hogar.
export function resumenDelAnio(ix, anio, personas = []) {
  const y = String(anio);
  const variantes = {};
  for (const personaId of ['', ...[...personas].sort()]) variantes[personaId] = varianteDelAnio(ix, y, personaId ? { personaId } : null);
  return { version: VERSION_RESUMEN, anio: Number(y), variantes };
}

// Lo mismo que resumenAnual, a partir de un resumen guardado: el año completo o hasta el final
// de `hastaMes`. Una persona sin variante (se agregó después) sale sin datos.
export function resumenAnualDeGuardado(ix, guardado, filtro, { hastaMes = '' } = {}) {
  const y = String(guardado.anio);
  const corteMes = hastaMes || `${y}-12`;
  const n = Math.min(12, Math.max(1, Number(corteMes.slice(5, 7)) || 12));
  const v = guardado.variantes?.[filtro?.personaId || ''] || varianteVacia();
  const suma = (arr, hasta = n) => (arr || []).slice(0, hasta).reduce((a, x) => a + x, 0);
  const porClave = (obj) => aLempirasSinCeros(Object.fromEntries(Object.entries(obj || {}).map(([k, arr]) => [k, suma(arr)])));
  const grupos = (porCategoria, i = null) => {
    const out = {};
    for (const [cat, arr] of Object.entries(porCategoria || {})) sumarEn(out, ix.grupoDe(cat === 'sin' ? null : cat), i === null ? suma(arr) : arr[i]);
    return aLempirasSinCeros(out);
  };
  const patrimonio = ([cuentas, tarjetas, prestamos]) => ({
    cuentas: deCentavos(cuentas), tarjetas: deCentavos(tarjetas), prestamos: deCentavos(prestamos), total: deCentavos(cuentas - tarjetas - prestamos),
  });
  const deuda = { inicio: deCentavos(v.deudaInicio), fin: deCentavos(v.deuda[n - 1]), intereses: deCentavos(v.intereses[n - 1]), seguros: deCentavos(v.seguros[n - 1]) };
  deuda.baja = redondear(deuda.inicio - deuda.fin);
  return {
    anio: y, hasta: '', hastaMes, corteMes, sinDatos: !suma(v.registros),
    ingresos: {
      bruto: deCentavos(suma(v.bruto)), neto: deCentavos(suma(v.neto)), incompletos: suma(v.incompletos),
      porPersona: Object.fromEntries(Object.entries(v.ingresosPorPersona || {}).map(([id, x]) => [id, { bruto: suma(x.bruto), neto: suma(x.neto) }])
        .filter(([, x]) => x.bruto || x.neto).map(([id, x]) => [id, { bruto: deCentavos(x.bruto), neto: deCentavos(x.neto) }])),
    },
    deducciones: { total: deCentavos(suma(v.deducciones)), porConcepto: porClave(v.deduccionesPorConcepto), porPersona: porClave(v.deduccionesPorPersona) },
    gasto: {
      total: deCentavos(suma(v.gasto)), estimado: suma(v.estimado) > 0, porGrupo: grupos(v.porCategoria), porCategoria: porClave(v.porCategoria),
      porPartida: porClave(v.porPartida), porMedio: porClave(v.porMedio), porPersona: porClave(v.porPersona),
    },
    ahorro: deCentavos(suma(v.ahorro)),
    pagosDeuda: { cuotas: deCentavos(suma(v.cuotas)), abonos: deCentavos(suma(v.abonos)), total: deCentavos(suma(v.cuotas) + suma(v.abonos)) },
    salidas: deCentavos(suma(v.salidas)),
    meses: Array.from({ length: 12 }, (_, i) => {
      const incluido = i < n;
      const de = (arr) => (incluido ? arr[i] : 0);
      return {
        periodo: `${y}-${String(i + 1).padStart(2, '0')}`, incluido, bruto: deCentavos(de(v.bruto)), neto: deCentavos(de(v.neto)), deducciones: deCentavos(de(v.deducciones)),
        gasto: deCentavos(de(v.gasto)), ahorro: deCentavos(de(v.ahorro)), pagosDeuda: deCentavos(de(v.cuotas) + de(v.abonos)), salidas: deCentavos(de(v.salidas)),
        porGrupo: incluido ? grupos(v.porCategoria, i) : {},
      };
    }),
    deuda,
    patrimonio: { inicio: patrimonio(v.patrimonioInicio), fin: patrimonio(v.patrimonio[n - 1]) },
  };
}

function varianteVacia() {
  return {
    registros: doce(), bruto: doce(), neto: doce(), incompletos: doce(), deducciones: doce(), gasto: doce(), estimado: doce(), ahorro: doce(),
    cuotas: doce(), abonos: doce(), salidas: doce(), deudaInicio: 0, deuda: doce(), intereses: doce(), seguros: doce(),
    patrimonioInicio: [0, 0, 0], patrimonio: Array.from({ length: 12 }, () => [0, 0, 0]),
  };
}

// Compara dos años. `modo`: 'va' (en lo que va del año: los dos cortan el mismo día que `hoy`)
// o 'completo'. `sentido` de cada fila: 1 si subir es bueno, -1 si subir es malo.
// `guardados`: resúmenes guardados de los años que no están cargados ({ '2025': resumen }). Si
// uno de los dos años sale de un resumen, "en lo que va del año" corta los dos al final del mes
// anterior al de `hoy` (en enero, que no tiene meses completos, se compara el año completo).
export function compararAnios(ix, anioA, anioB, { modo = 'va', hoy = ix.hoy, filtro, guardados = {} } = {}) {
  const guardadoDe = (anio) => guardados[String(anio)] || null;
  const conResumen = !!(guardadoDe(anioA) || guardadoDe(anioB));
  const mesAnterior = Number(String(hoy).slice(5, 7)) - 1;
  const modoReal = modo === 'va' && conResumen && mesAnterior < 1 ? 'completo' : modo;
  const opciones = (anio) => {
    if (modoReal !== 'va') return {};
    return conResumen ? { hastaMes: `${anio}-${String(mesAnterior).padStart(2, '0')}` } : { hasta: mismoDiaEn(anio, hoy) };
  };
  const resumen = (anio) => (guardadoDe(anio)
    ? resumenAnualDeGuardado(ix, guardadoDe(anio), filtro, opciones(anio))
    : resumenAnual(ix, anio, filtro, opciones(anio)));
  const A = resumen(anioA);
  const B = resumen(anioB);
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
    .sort((x, y) => orden.indexOf(x) - orden.indexOf(y) || x.localeCompare(y))
    .map((id) => {
      const detalle = (clave, pertenece) => [...new Set([...ids(A.gasto[clave]), ...ids(B.gasto[clave])])]
        .filter(pertenece)
        .map((x) => ({ id: x, A: A.gasto[clave][x] || 0, B: B.gasto[clave][x] || 0, ...diferencia(A.gasto[clave][x] || 0, B.gasto[clave][x] || 0) }))
        .sort((x, y) => Math.max(y.A, y.B) - Math.max(x.A, x.B) || x.id.localeCompare(y.id));
      return {
        id, A: A.gasto.porGrupo[id] || 0, B: B.gasto.porGrupo[id] || 0, ...diferencia(A.gasto.porGrupo[id] || 0, B.gasto.porGrupo[id] || 0),
        categorias: detalle('porCategoria', (c) => ix.grupoDe(c === 'sin' ? null : c) === id),
        partidas: detalle('porPartida', (p) => grupoDePartida(p) === id),
      };
    });
  const meses = A.meses.map((m, i) => ({ mes: i + 1, A: m.incluido ? m.gasto : null, B: B.meses[i].incluido ? B.meses[i].gasto : null }));
  const corte = (r) => r.hasta || (r.hastaMes ? fechaEnMes(r.hastaMes, 31) : '');
  return {
    anioA: String(anioA), anioB: String(anioB), modo: modoReal, corteA: corte(A), corteB: corte(B), A, B, sinDatosA: A.sinDatos, sinDatosB: B.sinDatos,
    resumenA: !!guardadoDe(anioA), resumenB: !!guardadoDe(anioB), filas, grupos, meses,
  };
}
