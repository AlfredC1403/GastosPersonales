// Partidas del presupuesto (con abonos, cierre, sobrante y "solo este mes"), ingresos
// esperados de cada mes y presupuesto mensual promedio.
import { vivo } from './modelo.js';
import { mesDe, periodoDe, sumarMeses, fechaEnMes, aCentavos, deCentavos } from './util.js';
import { coincidePersona } from './filtro.js';
import { parteDe, claveRecibo } from './asientos.js';
import { prestamoActivoEn } from './prestamos.js';
import { pagosProgramados, pagosPorMes, ingresoMensual, planillaDe, estadoRecibo } from './nomina.js';

const TODOS_LOS_MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_MESES_ARRASTRE = 240;

export function partidaActivaEn(p, periodo) {
  if (!vivo(p) || p.activo === false) return false;
  return !((p.desde && periodo < p.desde) || (p.hasta && periodo > p.hasta));
}

// Partes de una partida en un mes con su monto base (centavos). Un pago anual se aparta
// cada mes y se paga en su mes; las demás partidas tienen una sola parte (null).
export function partesDelMes(p, periodo) {
  if (p.tipo === 'anual') {
    const partes = [{ parte: 'apartar', base: aCentavos(p.monto) }];
    if (Number(p.mesPago) === mesDe(periodo)) partes.push({ parte: 'pagar', base: aCentavos(p.montoAnual) });
    return partes;
  }
  const meses = p.meses?.length ? p.meses : TODOS_LOS_MESES;
  return meses.includes(mesDe(periodo)) ? [{ parte: null, base: aCentavos(p.monto) }] : [];
}

// "Solo este mes": el ajuste cambia el monto de la parte principal (en un pago anual, la
// del pago si toca ese mes; si no, lo que se aparta) u omite la partida.
function parteAjustable(p, periodo) {
  if (p.tipo !== 'anual') return null;
  return Number(p.mesPago) === mesDe(periodo) ? 'pagar' : 'apartar';
}

function calcular(ix, p, periodo, parte, base, arrastre) {
  const pagos = (ix.pagosPartida.get(`${p.id}|${periodo}`) || []).filter((x) => parteDe(x.m) === parte);
  const ajuste = ix.ajustes.get(`${p.id}:${periodo}`) || null;
  const omitida = !!ajuste?.omitir;
  let monto = base;
  if (omitida) monto = 0;
  else if (ajuste && ajuste.monto !== null && ajuste.monto !== undefined && ajuste.monto !== '' && parte === parteAjustable(p, periodo)) {
    monto = aCentavos(ajuste.monto);
  }
  const esperado = monto + arrastre;
  const real = pagos.reduce((a, x) => a + x.c, 0);
  const cierra = pagos.some((x) => x.m.cierra);
  let estado;
  if (omitida && !real) estado = 'omitida';
  else if (!real) estado = 'pendiente';
  else if (real > esperado) estado = 'excedido';
  else if (real === esperado || cierra) estado = 'completo';
  else estado = 'parcial';
  const abierta = estado === 'pendiente' || estado === 'parcial';
  return {
    base: monto, arrastre, esperado, real, cierra, omitida, ajuste, estado, pagos: pagos.map((x) => x.m),
    queda: abierta ? esperado - real : 0,
    sobrante: estado === 'completo' && real < esperado ? esperado - real : 0,
  };
}

// Lo que sobró de meses anteriores en una partida que acumula. Cada mes que ya pasó cuenta
// como cerrado: lo no gastado pasa al siguiente; lo gastado de más no se arrastra.
export function arrastreDe(ix, p, periodo) {
  if (!p.acumula || p.tipo !== 'gasto') return 0;
  ix.arrastres ??= new Map();
  const clave = `${p.id}|${periodo}`;
  if (!ix.arrastres.has(clave)) ix.arrastres.set(clave, calcularArrastre(ix, p, periodo));
  return ix.arrastres.get(clave);
}

function calcularArrastre(ix, p, periodo) {
  const inicios = [p.acumulaDesde, p.desde, ix.config.inicio, p.creado ? periodoDe(p.creado) : null].filter(Boolean);
  let mes = inicios.sort().pop();
  let arrastre = 0;
  // Si la partida viene de años que no están cargados, se sigue con lo que sobraba al empezar el
  // primer año cargado (guardado en su apertura).
  const ap = ix.apertura;
  if (ap && mes && mes < ap.mes && periodo >= ap.mes) {
    mes = ap.mes;
    arrastre = ap.partidas?.[p.id] || 0;
    if (mes === periodo) return arrastre;
  }
  if (!mes || mes >= periodo) return 0;
  for (let i = 0; mes < periodo && i < MAX_MESES_ARRASTRE; i++, mes = sumarMeses(mes, 1)) {
    const parte = partesDelMes(p, mes)[0];
    const r = calcular(ix, p, mes, null, parte ? parte.base : 0, arrastre);
    arrastre = Math.max(0, r.esperado - r.real);
  }
  return arrastre;
}

const nombreParte = (p, parte) => (parte === 'apartar' ? `Apartar para ${p.nombre}` : parte === 'pagar' ? `Pagar ${p.nombre}` : p.nombre);

// Estado de cada partida en `periodo`. Los montos salen en lempiras.
export function estadoPartidas(ix, periodo, filtro) {
  const items = [];
  for (const p of ix.doc.partidas || []) {
    if (!partidaActivaEn(p, periodo) || !coincidePersona(p.responsableId, filtro)) continue;
    for (const { parte, base } of partesDelMes(p, periodo)) {
      const r = calcular(ix, p, periodo, parte, base, parte === null ? arrastreDe(ix, p, periodo) : 0);
      items.push({
        clave: `${p.id}:${parte || 'principal'}`,
        tipoItem: 'partida',
        partida: p,
        parte,
        nombre: nombreParte(p, parte),
        tipo: p.tipo,
        forma: p.tipo === 'anual' || p.tipo === 'aporte' ? (p.forma === 'abonos' ? 'abonos' : 'fijo') : p.forma || 'fijo',
        responsableId: p.responsableId || null,
        categoriaId: p.categoriaId || null,
        grupoId: ix.grupoDe(p.categoriaId),
        medioId: parte === 'pagar' ? p.cuentaDestinoId || 'reservas' : p.medioPagoId || null,
        dia: p.dia || null,
        acumula: !!p.acumula && p.tipo === 'gasto',
        estado: r.estado,
        hecho: r.estado === 'completo' || r.estado === 'excedido' || r.estado === 'omitida',
        omitida: r.omitida,
        cierra: r.cierra,
        ajuste: r.ajuste,
        pagos: r.pagos,
        base: deCentavos(r.base),
        arrastre: deCentavos(r.arrastre),
        esperado: deCentavos(r.esperado),
        real: deCentavos(r.real),
        queda: deCentavos(r.queda),
        sobrante: deCentavos(r.sobrante),
      });
    }
  }
  return items;
}

// Partidas que aplican en `periodo` (de todo el hogar), para saber si un gasto está en el plan.
export function partidasDelMes(ix, periodo) {
  const claves = new Set();
  for (const p of ix.doc.partidas || []) {
    if (!partidaActivaEn(p, periodo)) continue;
    for (const { parte } of partesDelMes(p, periodo)) claves.add(`${p.id}|${parte || ''}`);
  }
  return claves;
}

// Lo que cuenta del plan en el mes: lo gastado si ya se pasó o se cerró con sobrante (salvo
// que el sobrante quede guardado en la partida), y lo esperado mientras siga abierta.
export function usoDelPlan(it) {
  if (it.estado === 'omitida') return it.real;
  if (it.estado === 'completo' && it.real < it.esperado) return it.acumula ? it.esperado : it.real;
  return Math.max(it.esperado, it.real);
}

// ---------------------------------------------------------------- Ingresos

const netoDe = (ingreso, tipo) => aCentavos(ingreso.netoEsperado) * (tipo === 'ordinario' ? 1 : pagosPorMes(ingreso));

// Ingresos esperados en `periodo` y lo recibido en cada pago. Los recibos que no coinciden
// con un pago programado (porque cambió la configuración) también aparecen.
export function ingresosDelMes(ix, periodo, filtro) {
  const items = [];
  const vistos = new Set();
  for (const ingreso of ix.doc.ingresos || []) {
    if (!coincidePersona(ingreso.personaId || null, filtro)) continue;
    const programados = pagosProgramados(ingreso, periodo);
    for (const pago of programados) {
      const clave = claveRecibo({ ingresoId: ingreso.id, ...pago });
      const recibos = ix.recibos.get(clave) || [];
      recibos.forEach((r) => vistos.add(r.id));
      items.push(itemIngreso(ingreso, pago, recibos, programados.filter((x) => x.tipo === 'ordinario').length));
    }
  }
  for (const r of ix.recibosPorPeriodo.get(periodo) || []) {
    if (vistos.has(r.id)) continue;
    const ingreso = ix.ingresos.get(r.ingresoId) || { id: r.ingresoId, nombre: 'Ingreso', personaId: r.personaId };
    if (!coincidePersona(r.personaId || ingreso.personaId || null, filtro)) continue;
    items.push({ ...itemIngreso(ingreso, { tipo: r.tipo || 'ordinario', ocurrencia: r.ocurrencia, fecha: r.fecha }, [r], 1), esperado: 0, fueraDeCalendario: true });
  }
  return items.sort((a, b) => (a.ocurrencia < b.ocurrencia ? -1 : a.ocurrencia > b.ocurrencia ? 1 : 0) || a.nombre.localeCompare(b.nombre));
}

function itemIngreso(ingreso, pago, recibos, ordinariosEnMes) {
  const real = recibos.reduce((a, r) => a + aCentavos(r.neto), 0);
  const esperado = vivo(ingreso) && ingreso.activo !== false ? netoDe(ingreso, pago.tipo) : 0;
  const dia = Number(pago.ocurrencia?.slice(8, 10)) || null;
  let nombre = ingreso.nombre;
  if (pago.tipo === 'decimo14') nombre += ' · décimo cuarto mes';
  else if (pago.tipo === 'decimo13') nombre += ' · décimo tercer mes';
  else if (ordinariosEnMes > 1) nombre += ` · pago del ${dia}`;
  const faltanDeducciones = recibos.reduce((n, r) => n + estadoRecibo(r).pendientes, 0);
  return {
    clave: `ingreso:${claveRecibo({ ingresoId: ingreso.id, ...pago })}`,
    tipoItem: 'ingreso',
    ingreso,
    pago,
    tipo: pago.tipo,
    ocurrencia: pago.ocurrencia,
    fecha: pago.fecha,
    nombre,
    responsableId: ingreso.personaId || null,
    dia,
    recibos,
    faltanDeducciones,
    esperado: deCentavos(esperado),
    real: deCentavos(real),
    hecho: recibos.length > 0,
    estado: recibos.length ? 'completo' : 'pendiente',
  };
}

// ---------------------------------------------------------------- Presupuesto mensual

// Equivalente mensual de una partida (un seguro de 10 meses cuenta 10/12 por mes).
export function equivalenteMensual(p) {
  if (p.tipo === 'anual') return Number(p.monto) || 0;
  const meses = p.meses?.length ? p.meses.length : 12;
  return ((Number(p.monto) || 0) * meses) / 12;
}

// Presupuesto promedio del mes por grupo, persona y medio de pago. Los aportes no cuentan
// como esenciales (sirven para el fondo de emergencia).
export function presupuestoMensual(ix, periodo, filtro) {
  const r = { ingresos: 0, egresos: 0, esenciales: 0, aportes: 0, prestamos: 0, planilla: 0, porGrupo: {}, porPersona: {}, porMedio: {} };
  const sumar = (persona, grupoId, medioId, monto, aporte) => {
    if (!coincidePersona(persona, filtro)) return;
    const v = aCentavos(monto);
    r.egresos += v;
    if (aporte) r.aportes += v;
    else r.esenciales += v;
    const kp = persona || 'sin';
    r.porPersona[kp] = (r.porPersona[kp] || 0) + v;
    r.porGrupo[grupoId] = (r.porGrupo[grupoId] || 0) + v;
    const km = medioId || 'sin';
    r.porMedio[km] = (r.porMedio[km] || 0) + v;
  };
  for (const ingreso of ix.doc.ingresos || []) {
    if (vivo(ingreso) && ingreso.activo !== false && coincidePersona(ingreso.personaId || null, filtro)) r.ingresos += aCentavos(ingresoMensual(ingreso));
  }
  for (const p of ix.doc.partidas || []) {
    if (partidaActivaEn(p, periodo)) sumar(p.responsableId, ix.grupoDe(p.categoriaId), p.medioPagoId, equivalenteMensual(p), p.tipo === 'aporte');
  }
  for (const p of ix.doc.prestamos || []) {
    if (!vivo(p) || !prestamoActivoEn(ix, p, periodo)) continue;
    const cuota = Number(p.cuota) || 0;
    // Una cuota por planilla ya viene descontada del neto: no se cuenta otra vez como egreso.
    if (planillaDe(ix, p.id)) {
      if (coincidePersona(p.responsableId, filtro)) r.planilla += aCentavos(cuota);
      continue;
    }
    if (coincidePersona(p.responsableId, filtro)) r.prestamos += aCentavos(cuota);
    sumar(p.responsableId, ix.grupoDe(p.categoriaId || 'prestamos'), p.cuentaId, cuota, false);
  }
  for (const k of ['ingresos', 'egresos', 'esenciales', 'aportes', 'prestamos', 'planilla']) r[k] = deCentavos(r[k]);
  for (const k of ['porGrupo', 'porPersona', 'porMedio']) r[k] = Object.fromEntries(Object.entries(r[k]).map(([id, c]) => [id, deCentavos(c)]));
  return r;
}

// ---------------------------------------------------------------- Registros sugeridos

function fechaSugerida(periodo, dia, hoy) {
  if (periodo === periodoDe(hoy)) return hoy;
  return fechaEnMes(periodo, dia || 1);
}

// Movimiento listo para guardar al registrar un pago de una partida o de una cuota. Sin
// `monto`, lo que queda por pagar; con `monto: null`, vacío (para escribirlo).
export function movimientoParaItem(it, periodo, { hoy, monto, cierra = false } = {}) {
  const base = {
    fecha: fechaSugerida(periodo, it.dia, hoy), periodo, monto: monto === undefined ? it.queda || it.esperado : monto,
    personaId: it.responsableId || null, nota: '',
  };
  if (it.tipoItem === 'prestamo') {
    const p = it.prestamo;
    return { ...base, tipo: 'gasto', cuentaId: p.cuentaId || 'gastos', categoriaId: p.categoriaId || 'prestamos', prestamoId: p.id, partidaId: null };
  }
  const p = it.partida;
  const vinculo = { partidaId: p.id, ...(it.parte ? { parte: it.parte } : {}) };
  if (p.tipo === 'aporte' || it.parte === 'apartar') {
    return {
      ...base, ...vinculo, tipo: 'transferencia', cuentaId: p.medioPagoId || 'gastos', cuentaDestinoId: p.cuentaDestinoId || (p.tipo === 'aporte' ? 'ahorro' : 'reservas'),
      ...(p.tipo === 'aporte' && p.metaId ? { metaId: p.metaId } : {}),
    };
  }
  if (it.parte === 'pagar') {
    return { ...base, ...vinculo, tipo: 'gasto', cuentaId: p.cuentaDestinoId || 'reservas', categoriaId: p.categoriaId || 'otros' };
  }
  return { ...base, ...vinculo, tipo: 'gasto', cuentaId: p.medioPagoId || 'gastos', categoriaId: p.categoriaId || 'otros', ...(cierra ? { cierra: true } : {}) };
}
