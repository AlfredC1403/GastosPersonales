// Cálculos puros: préstamos, saldos, compromisos del mes, presupuesto y bola de nieve.
import { redondear, sumarMeses, mesesEntre, mesDe, periodoDe, hoy, periodoActual } from './util.js';
import { vivo } from './modelo.js';

const TODOS_LOS_MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const ORDEN_CLASES = ['ingreso', 'prestamo', 'fijo', 'fijo_variable', 'aporte', 'provision'];

// Un saldo menor a L1 es redondeo: el banco lo ajusta en la última cuota.
const RESIDUO = 1;

const tasaMensual = (tasa) => (Number(tasa) || 0) / 100 / 12;

// ---------------------------------------------------------------- Préstamos

// Cuota de capital + interés que salda `saldo` en `n` pagos.
export function cuotaPI(saldo, tasa, n) {
  if (n <= 0) return saldo;
  const r = tasaMensual(tasa);
  if (r === 0) return saldo / n;
  return (saldo * r) / (1 - Math.pow(1 + r, -n));
}

// Pagos que faltan después del periodo en que se tomó el saldo.
export const cuotasRestantes = (p) => Math.max(0, mesesEntre(p.saldoPeriodo, periodoDe(p.ultimaCuota)));

// Parte de la cuota que no es capital ni interés (seguros, cargos): lo que sobra de la
// cuota real frente a la que exigirían el saldo, la tasa y el plazo.
export function seguroEstimado(p) {
  const n = cuotasRestantes(p);
  if (!n || !(p.saldo > 0)) return 0;
  return Math.max(0, p.cuota - cuotaPI(p.saldo, p.tasa, n));
}

export const seguroDe = (p) =>
  p.seguro === null || p.seguro === undefined || p.seguro === '' ? seguroEstimado(p) : Number(p.seguro);

export function mesesParaPagar(saldo, tasa, pago) {
  if (saldo < RESIDUO) return 0;
  if (!(pago > 0)) return Infinity;
  const r = tasaMensual(tasa);
  if (r === 0) return Math.ceil(saldo / pago);
  const x = 1 - (r * saldo) / pago;
  if (x <= 0) return Infinity; // la cuota no alcanza ni para el interés
  return Math.ceil(-Math.log(x) / Math.log(1 + r) - 1e-6);
}

// Saldo estimado a partir del último saldo conocido y de los pagos registrados después.
export function estadoPrestamo(p, movimientos = []) {
  const r = tasaMensual(p.tasa);
  const seguro = seguroDe(p);
  const pagoPI = Math.max(0, p.cuota - seguro);
  let saldo = Number(p.saldo) || 0;
  let ultimoPeriodo = p.saldoPeriodo;
  let interesPagado = 0;
  let capitalPagado = 0;
  let cuotasPagadas = 0;

  // Un abono cuenta si es posterior al saldo conocido; si es del mismo día, si se anotó
  // después de registrar ese saldo.
  const abonoPosterior = (m) => m.fecha > p.fechaSaldo ||
    (m.fecha === p.fechaSaldo && (m.creado || '') > (p.saldoRegistrado || ''));
  const eventos = movimientos
    .filter((m) => vivo(m) && m.prestamoId === p.id &&
      ((m.tipo === 'gasto' && m.periodo > p.saldoPeriodo) || (m.tipo === 'abono' && abonoPosterior(m))))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  for (const m of eventos) {
    let aCapital;
    if (m.tipo === 'abono') {
      aCapital = Number(m.monto);
    } else {
      const interes = saldo * r;
      const sinSeguro = Math.max(0, Number(m.monto) - seguro);
      interesPagado += Math.min(interes, sinSeguro);
      aCapital = Math.max(0, sinSeguro - interes);
      cuotasPagadas++;
      if (m.periodo > ultimoPeriodo) ultimoPeriodo = m.periodo;
    }
    aCapital = Math.min(aCapital, saldo);
    saldo -= aCapital;
    capitalPagado += aCapital;
  }

  const pagado = saldo < RESIDUO;
  saldo = pagado ? 0 : redondear(saldo);
  const restantes = pagado ? 0 : mesesParaPagar(saldo, p.tasa, pagoPI);
  return {
    saldo,
    seguro,
    pagoPI: redondear(pagoPI),
    interesMes: redondear(saldo * r),
    pagado,
    cuotasPagadas,
    capitalPagado: redondear(capitalPagado),
    interesPagado: redondear(interesPagado),
    ultimoPeriodo,
    restantes,
    finEstimado: pagado ? ultimoPeriodo : Number.isFinite(restantes) ? sumarMeses(ultimoPeriodo, restantes) : null,
  };
}

// Deuda total estimada al cierre de `periodo`, con los pagos registrados hasta ese mes.
// Antes del saldo conocido de un préstamo se usa ese saldo.
export function deudaAl(doc, periodo) {
  const movs = doc.movimientos.filter((m) => vivo(m) && (m.periodo || periodoDe(m.fecha)) <= periodo);
  const total = doc.prestamos.filter(vivo).reduce(
    (a, p) => a + (periodo < p.saldoPeriodo ? Number(p.saldo) || 0 : estadoPrestamo(p, movs).saldo), 0);
  return redondear(total);
}

// Un préstamo sigue activo en `periodo` si no pasó su última cuota ni se terminó de pagar antes.
function prestamoActivoEn(p, periodo, movimientos) {
  if (periodo > periodoDe(p.ultimaCuota)) return false;
  const est = estadoPrestamo(p, movimientos);
  return !(est.pagado && periodo > est.ultimoPeriodo);
}

// ---------------------------------------------------------------- Cuentas

export function saldosCuentas(doc) {
  const s = {};
  for (const c of doc.cuentas) if (vivo(c)) s[c.id] = Number(c.saldoInicial) || 0;
  const mover = (id, v) => {
    if (id in s) s[id] += v;
  };
  for (const m of doc.movimientos) {
    if (!vivo(m)) continue;
    const v = Number(m.monto) || 0;
    if (m.tipo === 'ingreso' || m.tipo === 'ajuste') mover(m.cuentaId, v);
    else if (m.tipo === 'gasto' || m.tipo === 'abono') mover(m.cuentaId, -v);
    else if (m.tipo === 'transferencia') {
      mover(m.cuentaId, -v);
      mover(m.cuentaDestinoId, v);
    }
  }
  for (const k in s) s[k] = redondear(s[k]);
  return s;
}

// ---------------------------------------------------------------- Compromisos del mes

// Lista de lo que toca pagar, apartar o recibir en `periodo`, marcando lo ya registrado.
export function compromisosDelMes(doc, periodo) {
  const mes = mesDe(periodo);
  const movs = doc.movimientos.filter((m) => vivo(m) && m.periodo === periodo && (m.plantillaId || m.prestamoId));
  const items = [];

  const agregar = (item, hechos) => {
    if (!item.esperado && !hechos.length) return;
    items.push({
      ...item,
      esperado: redondear(item.esperado || 0),
      real: redondear(hechos.reduce((a, m) => a + Number(m.monto), 0)),
      movimientos: hechos,
      hecho: hechos.length > 0,
    });
  };

  for (const p of doc.prestamos) {
    if (!vivo(p) || !prestamoActivoEn(p, periodo, doc.movimientos)) continue;
    const hechos = movs.filter((m) => m.prestamoId === p.id && m.tipo === 'gasto');
    agregar({ clave: `prestamo:${p.id}`, clase: 'prestamo', parte: 'principal', nombre: p.nombre, prestamo: p,
      esperado: p.cuota, responsableId: p.responsableId, dia: p.dia || null }, hechos);
  }

  for (const t of doc.plantillas) {
    if (!vivo(t) || t.activo === false) continue;
    if ((t.desde && periodo < t.desde) || (t.hasta && periodo > t.hasta)) continue;
    const meses = t.meses?.length ? t.meses : TODOS_LOS_MESES;
    const add = (parte, esperado, nombre = t.nombre) => {
      const hechos = movs.filter((m) => m.plantillaId === t.id && (m.parte || 'principal') === parte);
      agregar({ clave: `${t.id}:${parte}`, clase: t.clase, parte, nombre, plantilla: t, esperado,
        responsableId: t.responsableId, dia: t.dia || null }, hechos);
    };
    if (t.clase === 'provision') {
      add('apartar', t.monto, `Apartar para ${t.nombre}`);
      if (Number(t.mesPago) === mes) add('pagar', t.montoAnual, `Pagar ${t.nombre}`);
    } else if (t.clase === 'ingreso') {
      if (meses.includes(mes)) add('principal', t.monto);
      if (t.decimo14 && mes === 6) add('decimo14', t.monto, `${t.nombre} · décimo cuarto mes`);
      if (t.decimo13 && mes === 12) add('decimo13', t.monto, `${t.nombre} · décimo tercer mes`);
    } else if (meses.includes(mes)) {
      add('principal', t.monto);
    }
  }

  return items.sort((a, b) =>
    ORDEN_CLASES.indexOf(a.clase) - ORDEN_CLASES.indexOf(b.clase) ||
    (a.dia || 99) - (b.dia || 99) ||
    a.nombre.localeCompare(b.nombre));
}

function fechaSugerida(periodo, dia) {
  if (periodo === periodoActual()) return hoy();
  const d = Math.min(Math.max(Number(dia) || 1, 1), 28);
  return `${periodo}-${String(d).padStart(2, '0')}`;
}

// Movimiento listo para guardar al marcar un compromiso como hecho.
export function movimientoParaCompromiso(item, periodo) {
  const base = { fecha: fechaSugerida(periodo, item.dia), periodo, monto: item.esperado,
    personaId: item.responsableId || null, nota: '' };
  if (item.clase === 'prestamo') {
    const p = item.prestamo;
    return { ...base, tipo: 'gasto', cuentaId: p.cuentaId || 'gastos', categoriaId: p.categoriaId || 'prestamos', prestamoId: p.id };
  }
  const t = item.plantilla;
  const vinculo = { plantillaId: t.id, parte: item.parte };
  switch (t.clase) {
    case 'ingreso':
      return { ...base, ...vinculo, tipo: 'ingreso', cuentaId: t.cuentaId || 'gastos', categoriaId: t.categoriaId || 'salario' };
    case 'aporte':
      return { ...base, ...vinculo, tipo: 'transferencia', cuentaId: t.cuentaId || 'gastos', cuentaDestinoId: t.cuentaDestinoId || 'ahorro' };
    case 'provision':
      return item.parte === 'apartar'
        ? { ...base, ...vinculo, tipo: 'transferencia', cuentaId: t.cuentaId || 'gastos', cuentaDestinoId: t.cuentaDestinoId || 'reservas' }
        : { ...base, ...vinculo, tipo: 'gasto', cuentaId: t.cuentaDestinoId || 'reservas', categoriaId: t.categoriaId || 'otros' };
    default:
      return { ...base, ...vinculo, tipo: 'gasto', cuentaId: t.cuentaId || 'gastos', categoriaId: t.categoriaId || 'otros' };
  }
}

// ---------------------------------------------------------------- Resumen del mes

export const CLASES_GASTO = ['prestamo', 'fijo', 'fijo_variable', 'provision', 'adicional'];

export function claseDeMovimiento(m, plantillas) {
  if (m.tipo === 'abono') return 'abono';
  if (m.prestamoId && m.tipo === 'gasto') return 'prestamo';
  const t = m.plantillaId ? plantillas.get(m.plantillaId) : null;
  if (m.tipo === 'gasto') return t && t.clase !== 'ingreso' ? t.clase : 'adicional';
  if (m.tipo === 'transferencia' && t?.clase === 'aporte') return 'aporte';
  return null;
}

export function resumenMes(doc, periodo) {
  const items = compromisosDelMes(doc, periodo);
  const plantillas = new Map(doc.plantillas.map((t) => [t.id, t]));
  const r = {
    ingresoEsperado: 0, ingresoReal: 0, comprometido: 0, pagado: 0, pendiente: 0, adicionales: 0, gastoReal: 0,
    porClase: { prestamo: 0, fijo: 0, fijo_variable: 0, provision: 0, adicional: 0, aporte: 0, abono: 0 },
    porCategoria: {}, pendientes: [], items,
  };
  for (const it of items) {
    if (it.clase === 'ingreso') {
      r.ingresoEsperado += it.esperado;
      continue;
    }
    if (it.clase === 'provision' && it.parte === 'pagar') continue; // sale de Reservas, ya se apartó antes
    r.comprometido += it.esperado;
    if (it.hecho) r.pagado += it.real;
    else {
      r.pendiente += it.esperado;
      r.pendientes.push(it);
    }
  }
  for (const m of doc.movimientos) {
    if (!vivo(m) || m.periodo !== periodo) continue;
    const v = Number(m.monto) || 0;
    if (m.tipo === 'ingreso') r.ingresoReal += v;
    const clase = claseDeMovimiento(m, plantillas);
    if (!clase) continue;
    r.porClase[clase] += v;
    if (m.tipo === 'gasto') {
      r.gastoReal += v;
      const cat = m.categoriaId || 'otros';
      r.porCategoria[cat] = (r.porCategoria[cat] || 0) + v;
      if (clase === 'adicional') r.adicionales += v;
    }
  }
  r.libre = r.ingresoEsperado - r.comprometido - r.adicionales;
  for (const k of ['ingresoEsperado', 'ingresoReal', 'comprometido', 'pagado', 'pendiente', 'adicionales', 'gastoReal', 'libre']) {
    r[k] = redondear(r[k]);
  }
  return r;
}

export function historial(doc, hasta, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const periodo = sumarMeses(hasta, i - n + 1);
    return { periodo, ...resumenMes(doc, periodo) };
  });
}

// ---------------------------------------------------------------- Presupuesto mensual

// Equivalente mensual de cada plantilla (un seguro de 10 meses cuenta 10/12 por mes).
export function equivalenteMensual(t) {
  const monto = Number(t.monto) || 0;
  if (t.clase === 'provision') return monto;
  const meses = t.meses?.length ? t.meses.length : 12;
  let eq = (monto * meses) / 12;
  if (t.clase === 'ingreso') eq += (monto * ((t.decimo13 ? 1 : 0) + (t.decimo14 ? 1 : 0))) / 12;
  return eq;
}

export function presupuestoMensual(doc, periodo = periodoActual()) {
  const r = { porClase: Object.fromEntries(ORDEN_CLASES.map((c) => [c, 0])), porPersona: {}, egresos: 0, esenciales: 0 };
  const sumar = (clase, persona, v) => {
    r.porClase[clase] += v;
    if (clase === 'ingreso') return;
    r.egresos += v;
    if (clase !== 'aporte') r.esenciales += v;
    const k = persona || 'sin';
    r.porPersona[k] = (r.porPersona[k] || 0) + v;
  };
  for (const t of doc.plantillas) {
    if (vivo(t) && t.activo !== false && !(t.hasta && periodo > t.hasta)) sumar(t.clase, t.responsableId, equivalenteMensual(t));
  }
  for (const p of doc.prestamos) {
    if (vivo(p) && prestamoActivoEn(p, periodo, doc.movimientos)) sumar('prestamo', p.responsableId, Number(p.cuota) || 0);
  }
  return r;
}

// ---------------------------------------------------------------- Bola de nieve

export function prestamosParaSimular(doc) {
  return doc.prestamos
    .filter(vivo)
    .map((p) => {
      const est = estadoPrestamo(p, doc.movimientos);
      return { id: p.id, nombre: p.nombre, tasa: Number(p.tasa) || 0, cuota: Number(p.cuota) || 0,
        seguro: est.seguro, saldo: est.saldo, ultimoPeriodo: est.ultimoPeriodo, finOriginal: periodoDe(p.ultimaCuota) };
    })
    .filter((p) => p.saldo >= RESIDUO);
}

export function ordenarPrioridad(prestamos, estrategia = 'bola', orden = []) {
  const copia = [...prestamos];
  if (estrategia === 'avalancha') return copia.sort((a, b) => b.tasa - a.tasa || a.saldo - b.saldo);
  if (estrategia === 'personalizado' && orden.length) {
    const pos = (p) => (orden.includes(p.id) ? orden.indexOf(p.id) : orden.length);
    return copia.sort((a, b) => pos(a) - pos(b));
  }
  return copia.sort((a, b) => a.saldo - b.saldo || b.tasa - a.tasa);
}

// Simula mes a mes. Con `rodar`, el hogar sigue pagando cada mes la suma de todas las
// cuotas (+ el extra): cuando un préstamo se termina, su cuota completa pasa al siguiente
// en la lista de prioridad. Sin `rodar`, cada préstamo sigue su calendario normal.
export function simularDeudas(prestamos, opciones = {}) {
  const {
    desde, extraMensual = 0, extraJunio = 0, extraDiciembre = 0,
    estrategia = 'bola', orden = [], rodar = true, maxMeses = 720,
  } = opciones;

  const ls = prestamos.filter((p) => p.saldo >= RESIDUO).map((p) => ({
    id: p.id, nombre: p.nombre, tasa: p.tasa, r: tasaMensual(p.tasa), cuota: p.cuota, seguro: p.seguro,
    pi: Math.max(0, p.cuota - p.seguro), saldo: p.saldo, saldoInicial: p.saldo, interes: 0, seguros: 0, fin: null,
  }));
  const prioridad = ordenarPrioridad(ls, estrategia, orden);
  const presupuesto = ls.reduce((a, l) => a + l.cuota, 0) + (rodar ? Number(extraMensual) || 0 : 0);
  const quedan = () => ls.some((l) => l.saldo > 0);
  const serie = [];

  for (let i = 0; i < maxMeses && quedan(); i++) {
    const periodo = sumarMeses(desde, i);
    const mes = mesDe(periodo);
    let disponible = presupuesto + (rodar ? (mes === 6 ? Number(extraJunio) || 0 : 0) + (mes === 12 ? Number(extraDiciembre) || 0 : 0) : 0);
    const cerrarSiTermina = (l) => {
      if (l.saldo >= RESIDUO) return;
      disponible -= l.saldo;
      l.saldo = 0;
      l.fin = periodo;
    };

    for (const l of ls) {
      if (!(l.saldo > 0)) continue;
      const interes = l.saldo * l.r;
      const pago = Math.min(l.pi, l.saldo + interes);
      l.saldo += interes - pago;
      l.interes += interes;
      l.seguros += l.seguro;
      disponible -= pago + l.seguro;
      cerrarSiTermina(l);
    }
    if (rodar) {
      for (const l of prioridad) {
        if (disponible < 0.01) break;
        if (!(l.saldo > 0)) continue;
        const abono = Math.min(disponible, l.saldo);
        l.saldo -= abono;
        disponible -= abono;
        cerrarSiTermina(l);
      }
    }
    serie.push({ periodo, total: redondear(ls.reduce((a, l) => a + l.saldo, 0)), saldos: ls.map((l) => redondear(l.saldo)) });
  }

  return {
    fin: serie.length ? serie[serie.length - 1].periodo : null,
    meses: serie.length,
    completo: !quedan(),
    presupuesto: redondear(presupuesto),
    interes: redondear(ls.reduce((a, l) => a + l.interes, 0)),
    seguros: redondear(ls.reduce((a, l) => a + l.seguros, 0)),
    orden: prioridad.map((l) => l.id),
    prestamos: ls.map((l) => ({ id: l.id, nombre: l.nombre, fin: l.fin, saldoInicial: redondear(l.saldoInicial),
      interes: redondear(l.interes), seguros: redondear(l.seguros), cuota: l.cuota })),
    serie,
  };
}
