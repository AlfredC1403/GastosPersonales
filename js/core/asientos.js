// Asientos: los registros tal como la persona los escribió se convierten en movimientos
// de saldo, gasto, ingreso, pago de préstamo y ahorro. Todos los saldos, reportes y
// filtros leen de aquí. Los montos van en centavos enteros.
import { vivo } from './modelo.js';
import { periodoDe, aCentavos, deCentavos } from './util.js';
import { personaDeMovimiento } from './filtro.js';

export const SIN_GRUPO = 'sin-grupo';

const mapa = (lista) => new Map((lista || []).map((r) => [r.id, r]));
const porFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);

function agregar(indice, clave, valor) {
  const lista = indice.get(clave);
  if (lista) lista.push(valor);
  else indice.set(clave, [valor]);
}

const tieneValor = (v) => v !== null && v !== undefined && v !== '';

// Parte de una partida anual a la que corresponde un pago ('apartar' o 'pagar'); null en las demás.
export const parteDe = (r) => (r.parte === 'apartar' || r.parte === 'pagar' ? r.parte : null);
export const claveRecibo = (r) => `${r.ingresoId}|${r.tipo || 'ordinario'}|${r.ocurrencia}`;

export function expandir(doc, ix) {
  const out = [];
  const tasaReferencia = Number(doc.config?.tasaReferencia) || 0;

  for (const m of doc.movimientos || []) {
    if (!vivo(m)) continue;
    const periodo = m.periodo || periodoDe(m.fecha);
    const monto = Number(m.monto) || 0;
    const moneda = ix.monedaDe(m.cuentaId);
    const base = { origen: m.id, fecha: m.fecha, periodo, personaId: personaDeMovimiento(m, ix.cuentas) };
    const saldo = (cuentaId, delta) => out.push({ ...base, clase: 'saldo', cuentaId, moneda: ix.monedaDe(cuentaId), delta: aCentavos(delta) });
    const { c, estimado } = ix.enLempiras(monto, moneda, m.tasa);

    if (m.tipo === 'gasto') {
      saldo(m.cuentaId, -monto);
      const categoriaId = m.categoriaId || (m.prestamoId ? 'prestamos' : null);
      out.push({
        ...base, clase: 'gasto', c, estimado, categoriaId, grupoId: ix.grupoDe(categoriaId), partidaId: m.partidaId || null,
        parte: parteDe(m), medioId: m.cuentaId, prestamoId: m.prestamoId || null,
      });
      if (m.prestamoId) out.push({ ...base, clase: 'prestamo', prestamoId: m.prestamoId, tipoPago: 'cuota', c, creado: m.creado || '' });
    } else if (m.tipo === 'ingreso') {
      saldo(m.cuentaId, monto);
      const categoriaId = m.categoriaId || null;
      out.push({ ...base, clase: 'ingreso', c, bruto: c, estimado, categoriaId, grupoId: ix.grupoDe(categoriaId), medioId: m.cuentaId, ingresoId: null });
    } else if (m.tipo === 'transferencia') {
      saldo(m.cuentaId, -monto);
      const monedaDestino = ix.monedaDe(m.cuentaDestinoId);
      let llega = monto;
      if (tieneValor(m.montoDestino)) llega = Number(m.montoDestino) || 0;
      else if (moneda !== monedaDestino) {
        const tasa = Number(m.tasa) || tasaReferencia;
        llega = !tasa ? 0 : moneda === 'USD' ? monto * tasa : monto / tasa;
      }
      saldo(m.cuentaDestinoId, llega);
      if (m.metaId || ix.partidas.get(m.partidaId)?.tipo === 'aporte') {
        out.push({ ...base, clase: 'ahorro', c, estimado, partidaId: m.partidaId || null, metaId: m.metaId || null, cuentaId: m.cuentaDestinoId });
      }
    } else if (m.tipo === 'abono') {
      saldo(m.cuentaId, -monto);
      if (m.prestamoId) out.push({ ...base, clase: 'prestamo', prestamoId: m.prestamoId, tipoPago: 'abono', c, creado: m.creado || '' });
    } else if (m.tipo === 'ajuste') {
      saldo(m.cuentaId, monto);
    }
  }

  for (const r of doc.recibos || []) {
    if (!vivo(r)) continue;
    const ingreso = ix.ingresos.get(r.ingresoId);
    const periodo = r.periodo || periodoDe(r.ocurrencia || r.fecha);
    const base = { origen: r.id, fecha: r.fecha, periodo, personaId: r.personaId || ingreso?.personaId || null };
    const neto = aCentavos(r.neto);
    const deducciones = r.deducciones || [];
    const descontado = deducciones.filter((d) => !d.noAplica && tieneValor(d.monto)).reduce((a, d) => a + aCentavos(d.monto), 0);
    const categoriaId = r.tipo === 'decimo13' || r.tipo === 'decimo14' ? 'decimos' : ingreso?.categoriaId || 'salario';
    out.push({ ...base, clase: 'saldo', cuentaId: r.cuentaId, moneda: ix.monedaDe(r.cuentaId), delta: neto });
    out.push({
      ...base, clase: 'ingreso', c: neto, bruto: neto + descontado, completo: deducciones.every((d) => d.noAplica || tieneValor(d.monto)),
      estimado: false, categoriaId, grupoId: ix.grupoDe(categoriaId), medioId: r.cuentaId, ingresoId: r.ingresoId, tipoRecibo: r.tipo || 'ordinario',
    });
    // Lo descontado no es gasto del hogar: se ve aparte. Un préstamo por planilla baja su saldo
    // y un ahorro suma en su cuenta, aunque ese dinero nunca pase por la cuenta del salario.
    for (const d of deducciones) {
      if (d.noAplica || !tieneValor(d.monto)) continue;
      const definicion = ingreso?.deducciones?.find((x) => x.id === d.deduccionId);
      const naturaleza = d.naturaleza || definicion?.naturaleza || 'gasto';
      const cd = aCentavos(d.monto);
      const cat = d.categoriaId ?? definicion?.categoriaId ?? null;
      out.push({
        ...base, clase: 'deduccion', c: cd, deduccionId: d.deduccionId, nombre: d.nombre || definicion?.nombre || 'Deducción', naturaleza,
        categoriaId: cat, grupoId: ix.grupoDe(cat), ingresoId: r.ingresoId,
      });
      const prestamoId = d.prestamoId ?? definicion?.prestamoId;
      if (naturaleza === 'prestamo' && prestamoId) {
        out.push({ ...base, clase: 'prestamo', prestamoId, tipoPago: 'cuota', c: cd, creado: r.creado || '', planilla: true });
      }
      const cuentaDestinoId = d.cuentaDestinoId ?? definicion?.cuentaDestinoId;
      if (naturaleza === 'ahorro' && cuentaDestinoId) {
        out.push({ ...base, clase: 'saldo', cuentaId: cuentaDestinoId, moneda: ix.monedaDe(cuentaDestinoId), delta: cd });
        out.push({ ...base, clase: 'ahorro', c: cd, estimado: false, partidaId: null, metaId: null, cuentaId: cuentaDestinoId, planilla: true });
      }
    }
  }

  return out.sort(porFecha);
}

// Índice con todo lo que las pantallas consultan. Se crea una vez por cada cambio de los
// datos; `hoy` llega de afuera para que los cálculos no dependan del reloj.
export function crearIndice(doc, { hoy = '' } = {}) {
  const ix = {
    doc,
    hoy,
    config: doc.config || {},
    personas: mapa(doc.personas),
    grupos: mapa(doc.grupos),
    categorias: mapa(doc.categorias),
    cuentas: mapa(doc.cuentas),
    partidas: mapa(doc.partidas),
    ingresos: mapa(doc.ingresos),
    prestamos: mapa(doc.prestamos),
    metas: mapa(doc.metas),
    movimientos: mapa(doc.movimientos),
  };
  const tasaReferencia = Number(ix.config.tasaReferencia) || 0;

  ix.ordenGrupos = (doc.grupos || []).filter(vivo)
    .sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99) || (a.nombre || '').localeCompare(b.nombre || ''))
    .map((g) => g.id);
  ix.grupoDe = (categoriaId) => {
    const grupoId = ix.categorias.get(categoriaId)?.grupoId;
    return grupoId && vivo(ix.grupos.get(grupoId)) ? grupoId : SIN_GRUPO;
  };
  ix.monedaDe = (cuentaId) => ix.cuentas.get(cuentaId)?.moneda || 'L';
  // Monto en lempiras (centavos). Lo que está en dólares usa la tasa del registro o, si no
  // tiene, la tasa de referencia, y queda marcado como estimado.
  ix.enLempiras = (monto, moneda, tasa) => {
    if (moneda !== 'USD') return { c: aCentavos(monto), estimado: false };
    const t = Number(tasa) || tasaReferencia;
    return { c: aCentavos((Number(monto) || 0) * t), estimado: !Number(tasa) };
  };

  ix.asientos = expandir(doc, ix);
  ix.saldos = [];
  ix.porPeriodo = new Map();
  ix.pagosPrestamo = new Map();
  for (const a of ix.asientos) {
    if (a.clase === 'saldo') ix.saldos.push(a);
    else agregar(ix.porPeriodo, a.periodo, a);
    if (a.clase === 'prestamo') {
      agregar(ix.pagosPrestamo, a.prestamoId, {
        tipo: a.tipoPago, periodo: a.periodo, fecha: a.fecha, monto: deCentavos(a.c), creado: a.creado, origen: a.origen, planilla: !!a.planilla,
      });
    }
  }

  // Pagos de cada partida por mes: `${partidaId}|${periodo}` → [{ m, c }]
  ix.pagosPartida = new Map();
  for (const m of doc.movimientos || []) {
    if (!vivo(m) || !m.partidaId) continue;
    const { c } = ix.enLempiras(m.monto, ix.monedaDe(m.cuentaId), m.tasa);
    agregar(ix.pagosPartida, `${m.partidaId}|${m.periodo || periodoDe(m.fecha)}`, { m, c });
  }
  for (const lista of ix.pagosPartida.values()) lista.sort((a, b) => porFecha(a.m, b.m) || (a.m.creado || '').localeCompare(b.m.creado || ''));

  ix.recibos = new Map(); // claveRecibo → recibos
  ix.recibosPorPeriodo = new Map();
  ix.recibosPorIngreso = new Map();
  ix.recibosPorId = mapa(doc.recibos);
  for (const r of doc.recibos || []) {
    if (!vivo(r)) continue;
    agregar(ix.recibos, claveRecibo(r), r);
    agregar(ix.recibosPorPeriodo, r.periodo || periodoDe(r.ocurrencia || r.fecha), r);
    agregar(ix.recibosPorIngreso, r.ingresoId, r);
  }

  ix.ajustes = new Map(); // `${partidaId}:${periodo}` → ajuste
  for (const a of doc.ajustesPartida || []) if (vivo(a)) ix.ajustes.set(`${a.partidaId}:${a.periodo}`, a);

  return ix;
}
