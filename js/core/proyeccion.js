// Proyección del flujo de caja: cómo va a quedar el saldo del hogar mes a mes.
//
// La app sabía contestar muy bien "¿en qué se me fue el mes?" y no sabía contestar "¿me va a
// alcanzar?". Todo lo que hace falta ya estaba: las partidas con su vigencia, los salarios con
// sus días de pago, las cuotas de los préstamos, los financiamientos de tarjeta con su plan de
// cuotas, las suscripciones con su ciclo, los pagos anuales con su mes y las renovaciones.
// Aquí eso se mira hacia adelante en vez de hacia atrás.
//
// Qué cuenta como salida de cada mes:
//   - el plan del mes (partidas y cuotas de préstamo que no van por planilla);
//   - las cuotas de financiamientos de tarjeta que no cuelgan de una partida (si cuelgan, la
//     partida ya las tiene contadas y sumarlas otra vez las cobraría dos veces);
//   - las renovaciones que vencen ese mes y no son una partida.
// El mes en curso cuenta solo lo que falta por pagar: lo ya pagado ya salió del saldo.
import { vivo } from './modelo.js';
import { periodoDe, sumarMeses, aCentavos, deCentavos, redondear } from './util.js';
import { coincidePersona } from './filtro.js';
import { estadoPartidas, ingresosDelMes, partidaActivaEn } from './presupuesto.js';
import { cuotasDelMes } from './prestamos.js';
import { financiamientos } from './tarjetas.js';
import { renovacionesDelMes } from './renovaciones.js';
import { saldosCuentas, enLempirasAprox, resumenMes } from './reportes.js';

export const MESES_POR_DEFECTO = 12;
const MAXIMO_MESES = 60;

// Saldo de hoy en las cuentas líquidas (las tarjetas no son saldo: son deuda).
export function saldoLiquido(ix, { filtro = null, hasta = ix.hoy } = {}) {
  const saldos = saldosCuentas(ix, hasta);
  let c = 0;
  for (const cuenta of ix.doc.cuentas || []) {
    if (!vivo(cuenta) || cuenta.tipo === 'tarjeta') continue;
    if (!coincidePersona(cuenta.titularId || null, filtro)) continue;
    c += aCentavos(enLempirasAprox(ix, cuenta.id, saldos[cuenta.id] || 0));
  }
  return deCentavos(c);
}

// Cuotas de financiamiento de tarjeta por mes, solo las que no cuelgan de una partida.
function cuotasDeTarjetaPorMes(ix, filtro) {
  const porMes = new Map();
  for (const f of financiamientos(ix)) {
    if (f.situacion === 'cancelado' || f.situacion === 'terminado') continue;
    if (f.movimiento.partidaId) continue; // ya va dentro de su partida
    if (!coincidePersona(f.cuenta.titularId || null, filtro)) continue;
    for (const q of f.cuotas) {
      if (q.fecha <= ix.hoy) continue;
      const lista = porMes.get(q.periodo) || [];
      lista.push({ nombre: f.nombre, monto: deCentavos(q.c), cuota: q.k, de: q.n, tarjeta: f.cuenta.nombre });
      porMes.set(q.periodo, lista);
    }
  }
  return porMes;
}

// Lo que el plan compromete en un mes futuro, con el detalle de lo que más pesa.
function planDelMes(ix, periodo, filtro) {
  const partes = [];
  let c = 0;
  for (const it of estadoPartidas(ix, periodo, filtro)) {
    // Pagar un pago anual sale de lo que ya se apartó mes a mes: no es plata nueva que salga.
    if (it.parte === 'pagar' || it.enPrueba) continue;
    const monto = Number(it.esperado) || 0;
    if (!monto) continue;
    c += aCentavos(monto);
    partes.push({ tipo: 'partida', id: it.partida.id, nombre: it.nombre, monto, dia: it.dia });
  }
  for (const it of cuotasDelMes(ix, periodo, filtro)) {
    if (it.planilla) continue; // ya viene descontada del neto
    const monto = Number(it.esperado) || 0;
    if (!monto) continue;
    c += aCentavos(monto);
    partes.push({ tipo: 'prestamo', id: it.prestamo.id, nombre: it.nombre, monto, dia: it.dia });
  }
  return { c, partes };
}

// Lo que se espera que entre en un mes futuro.
function entradaDelMes(ix, periodo, filtro) {
  let c = 0;
  const partes = [];
  for (const it of ingresosDelMes(ix, periodo, filtro)) {
    const monto = Number(it.esperado) || 0;
    if (!monto) continue;
    c += aCentavos(monto);
    partes.push({ tipo: 'ingreso', id: it.ingreso.id, nombre: it.nombre, monto, dia: it.dia });
  }
  return { c, partes };
}

// Un ajuste del simulador que aplica en `periodo`.
function ajusteAplica(a, periodo) {
  if (a.periodo) return a.periodo === periodo;
  if (a.desde && periodo < a.desde) return false;
  if (a.hasta && periodo > a.hasta) return false;
  return true;
}

/**
 * Proyecta el flujo de caja mes a mes.
 *
 * @param ix índice del documento.
 * @param opciones.desde  primer mes (por defecto, el de hoy).
 * @param opciones.meses  cuántos meses proyectar (1 a 60).
 * @param opciones.filtro { personaId } para ver solo lo de una persona.
 * @param opciones.saldoInicial  saldo de arranque; por defecto, el líquido de hoy.
 * @param opciones.ajustes  cambios del simulador (ver `simular`).
 * @returns { saldoInicial, meses: [...], minimo, mesesEnRojo, entraTotal, saleTotal }
 */
export function proyectar(ix, {
  desde = periodoDe(ix.hoy), meses = MESES_POR_DEFECTO, filtro = null, saldoInicial = null, ajustes = [],
} = {}) {
  const n = Math.min(MAXIMO_MESES, Math.max(1, Math.round(meses)));
  const actual = periodoDe(ix.hoy);
  const cuotasTarjeta = cuotasDeTarjetaPorMes(ix, filtro);
  let saldo = aCentavos(saldoInicial ?? saldoLiquido(ix, { filtro }));
  const arranque = deCentavos(saldo);
  const salida = [];

  for (let i = 0, periodo = desde; i < n; i++, periodo = sumarMeses(periodo, 1)) {
    const esActual = periodo === actual;
    const pasado = periodo < actual;
    let entra = 0;
    let sale = 0;
    const hitos = [];

    if (esActual) {
      // El mes en curso cuenta lo que todavía no ha pasado: lo ya pagado salió del saldo, y lo
      // ya recibido ya entró.
      const r = resumenMes(ix, periodo, filtro);
      entra = aCentavos(r.ingresoPorRecibir);
      sale = aCentavos(r.pendiente);
      for (const it of r.pendientes.slice(0, 6)) if (it.queda > 0) hitos.push({ tipo: 'pendiente', nombre: it.nombre, monto: it.queda });
    } else if (!pasado) {
      const plan = planDelMes(ix, periodo, filtro);
      const entrada = entradaDelMes(ix, periodo, filtro);
      entra = entrada.c;
      sale = plan.c;
      hitos.push(...plan.partes.filter((x) => x.monto > 0));
      // Un ingreso extraordinario (el décimo) es un hito tan importante como un gasto grande.
      hitos.push(...entrada.partes.filter((x) => x.tipo === 'ingreso' && /décimo/i.test(x.nombre)));
    }

    // Cuotas de tarjeta que no cuelgan de una partida.
    for (const q of cuotasTarjeta.get(periodo) || []) {
      sale += aCentavos(q.monto);
      hitos.push({ tipo: 'cuota-tarjeta', nombre: `${q.nombre} · cuota ${q.cuota} de ${q.de}`, monto: q.monto });
    }

    // Renovaciones del mes que no son una partida (el seguro del carro, la licencia).
    for (const r of renovacionesDelMes(ix, periodo, filtro)) {
      if (!r.montoL || r.vence < ix.hoy) continue;
      sale += aCentavos(r.montoL);
      hitos.push({ tipo: 'renovacion', id: r.id, nombre: r.nombre, monto: r.montoL });
    }

    // Ajustes del simulador.
    for (const a of ajustes) {
      if (!ajusteAplica(a, periodo)) continue;
      if (a.tipo === 'quitarPartida') {
        const p = ix.partidas.get(a.partidaId);
        if (p && partidaActivaEn(p, periodo)) {
          const it = estadoPartidas(ix, periodo, filtro).find((x) => x.partida.id === a.partidaId && x.parte !== 'pagar');
          if (it?.esperado) {
            sale -= aCentavos(it.esperado);
            hitos.push({ tipo: 'ajuste', nombre: `Sin ${it.nombre}`, monto: -it.esperado });
          }
        }
      } else if (a.tipo === 'gasto') {
        sale += aCentavos(a.monto);
        hitos.push({ tipo: 'ajuste', nombre: a.nombre || 'Gasto nuevo', monto: Number(a.monto) || 0 });
      } else if (a.tipo === 'ingreso') {
        entra += aCentavos(a.monto);
        hitos.push({ tipo: 'ajuste', nombre: a.nombre || 'Ingreso nuevo', monto: Number(a.monto) || 0 });
      }
    }

    const neto = entra - sale;
    const inicio = saldo;
    saldo += neto;
    salida.push({
      periodo,
      entra: deCentavos(entra),
      sale: deCentavos(sale),
      neto: deCentavos(neto),
      saldoInicio: deCentavos(inicio),
      saldoFin: deCentavos(saldo),
      enRojo: saldo < 0,
      // Los cinco montos que más mueven el mes: es lo que explica un mes en rojo.
      hitos: hitos.filter((h) => Math.abs(h.monto) > 0).sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)).slice(0, 5),
    });
  }

  const minimo = salida.reduce((a, m) => (a === null || m.saldoFin < a.saldoFin ? m : a), null);
  return {
    saldoInicial: arranque,
    meses: salida,
    minimo,
    mesesEnRojo: salida.filter((m) => m.enRojo).map((m) => m.periodo),
    entraTotal: redondear(salida.reduce((a, m) => a + m.entra, 0)),
    saleTotal: redondear(salida.reduce((a, m) => a + m.sale, 0)),
  };
}

/**
 * "¿Qué pasa si…?": la misma proyección con unos cambios, contra la de hoy.
 *
 * Ajustes:
 *   { tipo: 'quitarPartida', partidaId, desde?, hasta? }  cancelar una suscripción o un gasto
 *   { tipo: 'gasto', nombre, monto, desde?, hasta?, periodo? }  un gasto nuevo, fijo o de una vez
 *   { tipo: 'ingreso', nombre, monto, desde?, hasta?, periodo? }  un aumento o un ingreso extra
 *
 * @returns { base, escenario, diferencia: { porMes, alFinal, mesesEnRojoAntes, mesesEnRojoDespues } }
 */
export function simular(ix, opciones = {}, ajustes = []) {
  const base = proyectar(ix, { ...opciones, ajustes: [] });
  const escenario = proyectar(ix, { ...opciones, ajustes });
  const ultimo = (p) => (p.meses.length ? p.meses[p.meses.length - 1].saldoFin : p.saldoInicial);
  return {
    base,
    escenario,
    diferencia: {
      porMes: escenario.meses.map((m, i) => ({ periodo: m.periodo, delta: redondear(m.saldoFin - base.meses[i].saldoFin) })),
      alFinal: redondear(ultimo(escenario) - ultimo(base)),
      mesesEnRojoAntes: base.mesesEnRojo.length,
      mesesEnRojoDespues: escenario.mesesEnRojo.length,
    },
  };
}

// Cuotas de financiamiento que quedarían si se toma una compra a `meses` cuotas: sirve para
// simular un financiamiento antes de firmarlo.
export function ajusteDeFinanciamiento({ nombre, total, meses, desde, interesAnual = 0 }) {
  const n = Math.max(1, Math.round(meses));
  const i = (Number(interesAnual) || 0) / 100 / 12;
  const cuota = i > 0 ? (total * i) / (1 - (1 + i) ** -n) : total / n;
  return {
    tipo: 'gasto',
    nombre: nombre || 'Financiamiento nuevo',
    monto: redondear(cuota),
    desde,
    hasta: sumarMeses(desde, n - 1),
  };
}
