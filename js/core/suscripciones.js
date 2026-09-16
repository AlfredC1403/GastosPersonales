// Suscripciones: partidas de gasto con ciclo de cobro (Netflix, iCloud, el hosting). Se guardan
// como cualquier gasto del presupuesto —así el mes, los reportes y el reparto las tratan igual—
// y aquí se ven como lo que son: un cobro que se repite hasta que alguien lo cancela. Casi todas
// cobran en dólares, así que cada una lleva su moneda y sale con las dos cifras: la de su moneda
// (la exacta) y su equivalente en lempiras con la tasa de referencia.
import { vivo } from './modelo.js';
import { periodoDe, sumarMeses, sumarDias, redondear } from './util.js';
import { coincidePersona } from './filtro.js';
import {
  PASO_CICLO, esSuscripcion, partidaActivaEn, partesDelMes, equivalenteMensual, enPruebaGratis, monedaDe, enLempirasDe, diaDeCobro,
} from './presupuesto.js';

// Hasta dónde se busca el próximo cobro: dos años cubre cualquier ciclo.
const MESES_ADELANTE = 26;

// Cada cuánto cobra. Si la partida no guarda el ciclo (viene de una versión anterior), se deduce
// de los meses en que aplica.
export function cicloDe(p) {
  if (p?.ciclo && PASO_CICLO[p.ciclo]) return p.ciclo;
  const n = p?.meses?.length || 12;
  return n === 1 ? 'anual' : n === 2 ? 'semestral' : n === 4 ? 'trimestral' : 'mensual';
}

// Próximo cobro desde `hoy`: el día de renovación del primer mes en que de verdad cobra (los
// meses de prueba gratis no cuentan). null si ya no vuelve a cobrar (cancelada o terminada).
export function proximoCobro(p, hoy) {
  let periodo = periodoDe(hoy);
  for (let i = 0; i < MESES_ADELANTE; i++, periodo = sumarMeses(periodo, 1)) {
    if (!partidaActivaEn(p, periodo)) continue;
    if (!partesDelMes(p, periodo).some((x) => x.base > 0)) continue;
    const fecha = diaDeCobro(p, periodo);
    if (fecha >= hoy) return fecha;
  }
  return null;
}

// Una suscripción con lo que cobra, cuándo vuelve a cobrar y lo que cuesta al mes y al año.
// `periodo` es el mes que se está viendo (por defecto, el de `hoy`).
export function estadoSuscripciones(ix, { hoy, filtro = null, periodo = null } = {}) {
  const mes = periodo || periodoDe(hoy);
  const out = [];
  for (const p of ix.doc.partidas || []) {
    if (!vivo(p) || !esSuscripcion(p) || !coincidePersona(p.responsableId || null, filtro)) continue;
    const monto = Number(p.monto) || 0;
    const alMes = redondear(equivalenteMensual(p));
    const alAnio = redondear(alMes * 12);
    out.push({
      id: p.id,
      partida: p,
      nombre: p.nombre,
      moneda: monedaDe(p),
      ciclo: cicloDe(p),
      monto,
      montoL: enLempirasDe(ix, p, monto),
      alMes,
      alAnio,
      alMesL: enLempirasDe(ix, p, alMes),
      alAnioL: enLempirasDe(ix, p, alAnio),
      dia: p.dia || null,
      medioId: p.medioPagoId || null,
      categoriaId: p.categoriaId || null,
      responsableId: p.responsableId || null,
      proximo: proximoCobro(p, hoy),
      enPrueba: enPruebaGratis(p, mes),
      pruebaHasta: p.pruebaHasta || null,
      hasta: p.hasta || null,
      // Activa: sigue cobrando en el mes que se ve (una cancelada se queda en los meses de antes).
      activa: partidaActivaEn(p, mes),
      sinMonto: !monto,
    });
  }
  return out.sort((a, b) => Number(!a.activa) - Number(!b.activa)
    || (a.proximo || '9999-99-99').localeCompare(b.proximo || '9999-99-99')
    || a.nombre.localeCompare(b.nombre));
}

// Totales de las que siguen activas: al mes y al año en lempiras, y cuánto de eso cobra en dólares.
export function resumenSuscripciones(lista) {
  const activas = lista.filter((s) => s.activa);
  const suma = (campo, cuales = activas) => redondear(cuales.reduce((a, s) => a + s[campo], 0));
  return {
    cuantas: activas.length,
    alMes: suma('alMesL'),
    alAnio: suma('alAnioL'),
    enDolares: suma('alMes', activas.filter((s) => s.moneda === 'USD')),
    enLempiras: suma('alMesL', activas.filter((s) => s.moneda === 'L')),
    enPrueba: activas.filter((s) => s.enPrueba).length,
    sinMonto: activas.filter((s) => s.sinMonto).length,
  };
}

// Pruebas gratis que terminan (y empiezan a cobrar) dentro de los próximos `dias` días.
export function pruebasPorTerminar(lista, hoy, dias = 7) {
  const hasta = sumarDias(hoy, dias);
  return lista.filter((s) => s.activa && s.pruebaHasta && s.pruebaHasta >= hoy && s.pruebaHasta <= hasta);
}
