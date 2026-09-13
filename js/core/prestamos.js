// Préstamos: saldo con los pagos registrados, deuda por mes, cuotas del mes y bola de nieve.
import { redondear, sumarMeses, mesesEntre, mesDe, periodoDe, aCentavos, deCentavos } from './util.js';
import { vivo } from './modelo.js';
import { coincidePersona } from './filtro.js';
import { planillaDe } from './nomina.js';

// Un saldo menor a L1 es redondeo: el banco lo ajusta en la última cuota.
export const RESIDUO = 1;

const tasaMensual = (tasa) => (Number(tasa) || 0) / 100 / 12;

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

// Recorre los pagos desde el último saldo conocido. Las cuotas se suman por mes: el interés y el
// seguro se cobran una sola vez aunque la cuota se pague en dos partes (por ejemplo, la mitad en
// cada quincena). Los pagos van por mes y, dentro del mes, por fecha: la cuota de diciembre pagada
// el 2 de enero se aplica antes que un abono del 1 de enero.
// `inicio`: cómo estaba el préstamo al cierre de un año (la apertura del año siguiente); desde ahí
// solo cuentan los pagos de los meses posteriores. Devuelve los valores sin redondear.
export function recorrerPrestamo(p, pagos = [], inicio = null) {
  const r = tasaMensual(p.tasa);
  const seguro = seguroDe(p);
  const desdeInicio = !!inicio && inicio.periodo >= p.saldoPeriodo;
  const s = desdeInicio
    ? { saldo: inicio.saldo, ultimoPeriodo: inicio.ultimoPeriodo, interesPagado: inicio.interesPagado, capitalPagado: inicio.capitalPagado, cuotasPagadas: inicio.cuotasPagadas, parciales: [...(inicio.parciales || [])] }
    : { saldo: Number(p.saldo) || 0, ultimoPeriodo: p.saldoPeriodo, interesPagado: 0, capitalPagado: 0, cuotasPagadas: 0, parciales: [] };
  const despuesDe = desdeInicio ? inicio.periodo : p.saldoPeriodo;

  const porMes = new Map();
  for (const x of pagos) {
    if (x.tipo !== 'cuota' || !(x.periodo > despuesDe)) continue;
    const g = porMes.get(x.periodo) || { tipo: 'cuota', periodo: x.periodo, fecha: x.fecha, c: 0 };
    g.c += aCentavos(x.monto);
    if (x.fecha > g.fecha) g.fecha = x.fecha;
    porMes.set(x.periodo, g);
  }
  // Un abono cuenta si es posterior al saldo conocido; si es del mismo día, si se anotó
  // después de registrar ese saldo.
  const abonoPosterior = (x) => x.fecha > p.fechaSaldo || (x.fecha === p.fechaSaldo && (x.creado || '') > (p.saldoRegistrado || ''));
  const abonos = pagos
    .filter((x) => x.tipo === 'abono' && abonoPosterior(x) && !(desdeInicio && x.periodo <= despuesDe))
    .map((x) => ({ ...x, c: aCentavos(x.monto) }));
  const eventos = [...porMes.values(), ...abonos].sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0)
    || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  for (const e of eventos) {
    const monto = deCentavos(e.c);
    let aCapital;
    if (e.tipo === 'abono') {
      aCapital = monto;
    } else {
      const interes = s.saldo * r;
      const sinSeguro = Math.max(0, monto - seguro);
      s.interesPagado += Math.min(interes, sinSeguro);
      aCapital = Math.max(0, sinSeguro - interes);
      if (e.c >= aCentavos(p.cuota)) s.cuotasPagadas++;
      else s.parciales.push(e.periodo);
      if (e.periodo > s.ultimoPeriodo) s.ultimoPeriodo = e.periodo;
    }
    aCapital = Math.min(aCapital, s.saldo);
    s.saldo -= aCapital;
    s.capitalPagado += aCapital;
  }
  return s;
}

// Saldo estimado a partir del último saldo conocido (o de `inicio`) y de los pagos registrados después.
// `pagos`: [{ tipo: 'cuota' | 'abono', periodo, fecha, monto, creado }].
export function estadoPrestamo(p, pagos = [], inicio = null) {
  const seguro = seguroDe(p);
  const pagoPI = Math.max(0, p.cuota - seguro);
  const r = tasaMensual(p.tasa);
  const { saldo: crudo, ultimoPeriodo, interesPagado, capitalPagado, cuotasPagadas, parciales } = recorrerPrestamo(p, pagos, inicio);
  const pagado = crudo < RESIDUO;
  const saldo = pagado ? 0 : redondear(crudo);
  const restantes = pagado ? 0 : mesesParaPagar(saldo, p.tasa, pagoPI);
  return {
    saldo,
    seguro,
    pagoPI: redondear(pagoPI),
    interesMes: redondear(saldo * r),
    pagado,
    cuotasPagadas,
    parciales,
    capitalPagado: redondear(capitalPagado),
    interesPagado: redondear(interesPagado),
    ultimoPeriodo,
    restantes,
    finEstimado: pagado ? ultimoPeriodo : Number.isFinite(restantes) ? sumarMeses(ultimoPeriodo, restantes) : null,
  };
}

const pagosDe = (ix, id) => ix.pagosPrestamo.get(id) || [];

// Cómo estaba el préstamo al cierre del año anterior a los datos cargados, si hace falta.
const inicioDe = (ix, p) => ix.apertura?.prestamos?.[p.id] || null;
const pagosHasta = (ix, p, hasta) => (hasta ? pagosDe(ix, p.id).filter((x) => x.periodo <= hasta) : pagosDe(ix, p.id));

// Estado de un préstamo con los pagos hasta `hasta` (o todos). Se guarda en el índice para
// no recalcularlo en cada pantalla.
export function estadoDe(ix, p, hasta = '') {
  ix.estadosPrestamo ??= new WeakMap();
  let porCorte = ix.estadosPrestamo.get(p);
  if (!porCorte) ix.estadosPrestamo.set(p, (porCorte = new Map()));
  if (!porCorte.has(hasta)) porCorte.set(hasta, estadoPrestamo(p, pagosHasta(ix, p, hasta), inicioDe(ix, p)));
  return porCorte.get(hasta);
}

// Lo mismo sin redondear, para guardarlo en la apertura del año siguiente.
export const estadoCrudoDe = (ix, p, hasta) => recorrerPrestamo(p, pagosHasta(ix, p, hasta), inicioDe(ix, p));

// Un préstamo sigue activo en `periodo` si no pasó su última cuota ni se terminó de pagar antes.
export function prestamoActivoEn(ix, p, periodo) {
  if (periodo > periodoDe(p.ultimaCuota)) return false;
  const est = estadoDe(ix, p);
  return !(est.pagado && periodo > est.ultimoPeriodo);
}

// Deuda total estimada al cierre de `periodo`, con los pagos registrados hasta ese mes.
// Antes del saldo conocido de un préstamo se usa ese saldo.
export function deudaAl(ix, periodo, filtro) {
  let total = 0;
  for (const p of ix.doc.prestamos || []) {
    if (!vivo(p) || !coincidePersona(p.responsableId, filtro)) continue;
    total += periodo < p.saldoPeriodo ? Number(p.saldo) || 0 : estadoDe(ix, p, periodo).saldo;
  }
  return redondear(total);
}

// Intereses y seguros pagados en los préstamos entre los meses `desde` y `hasta` (incluidos).
export function costoDePrestamos(ix, desde, hasta, filtro) {
  let intereses = 0;
  let seguros = 0;
  for (const p of ix.doc.prestamos || []) {
    if (!vivo(p) || !coincidePersona(p.responsableId, filtro)) continue;
    intereses += estadoDe(ix, p, hasta).interesPagado - estadoDe(ix, p, sumarMeses(desde, -1)).interesPagado;
    const meses = new Set(pagosDe(ix, p.id).filter((x) => x.tipo === 'cuota' && x.periodo >= desde && x.periodo <= hasta && x.periodo > p.saldoPeriodo).map((x) => x.periodo));
    seguros += meses.size * seguroDe(p);
  }
  return { intereses: redondear(intereses), seguros: redondear(seguros) };
}

// Cuotas de préstamos que tocan en `periodo`, con lo pagado (pendiente, parcial, completo).
// Una cuota que se descuenta por planilla lleva `planilla` y se paga con los recibos del salario.
export function cuotasDelMes(ix, periodo, filtro) {
  const items = [];
  for (const p of ix.doc.prestamos || []) {
    if (!vivo(p) || !coincidePersona(p.responsableId, filtro) || !prestamoActivoEn(ix, p, periodo)) continue;
    const pagos = pagosDe(ix, p.id).filter((x) => x.tipo === 'cuota' && x.periodo === periodo);
    const esperado = aCentavos(p.cuota);
    const real = pagos.reduce((a, x) => a + aCentavos(x.monto), 0);
    const estado = !real ? 'pendiente' : real > esperado ? 'excedido' : real >= esperado ? 'completo' : 'parcial';
    const planilla = planillaDe(ix, p.id);
    items.push({
      clave: `prestamo:${p.id}`, tipoItem: 'prestamo', prestamo: p, nombre: p.nombre, responsableId: p.responsableId || null,
      dia: planilla ? null : p.dia || null, grupoId: ix.grupoDe(p.categoriaId || 'prestamos'), categoriaId: p.categoriaId || 'prestamos',
      medioId: planilla ? null : p.cuentaId || null, forma: planilla ? 'planilla' : 'fijo',
      planilla: planilla ? { ingreso: planilla.ingreso, deduccion: planilla.deduccion, esperados: planilla.veces, descontados: pagos.filter((x) => x.planilla).length } : null,
      esperado: deCentavos(esperado), real: deCentavos(real), queda: deCentavos(Math.max(0, esperado - real)), sobrante: 0,
      estado, hecho: estado === 'completo' || estado === 'excedido',
      pagos: pagos.map((x) => ix.movimientos.get(x.origen) || ix.recibosPorId.get(x.origen)).filter(Boolean),
    });
  }
  return items;
}

// ---------------------------------------------------------------- Bola de nieve

export function prestamosParaSimular(ix) {
  return (ix.doc.prestamos || [])
    .filter(vivo)
    .map((p) => {
      const est = estadoDe(ix, p);
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
