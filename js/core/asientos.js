// Asientos: los registros tal como la persona los escribió se convierten en movimientos
// de saldo, deuda de tarjeta, gasto, ingreso, deducción, pago de préstamo y ahorro. Todos los
// saldos, reportes y filtros leen de aquí. Los montos van en centavos enteros.
import { vivo, COLECCIONES_ANIO } from './modelo.js';
import { anioDeRegistro, anioPorDefectoDe } from './anios.js';
import { periodoDe, aCentavos, deCentavos } from './util.js';
import { personaDeMovimiento } from './filtro.js';
import { prepararTarjetas, posteriorAlSaldo, comisionInmediata } from './tarjetas.js';
import { prepararTasas } from './tasas.js';

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
  // Un registro de un año anterior que trae la apertura ya está contado en ella hasta el cierre:
  // de él solo cuenta lo que es de un mes posterior (y las cuotas que se cobran después).
  const ap = ix.apertura;
  const esPrevio = (r) => !!ix.previos?.has(r.id);

  for (const m of doc.movimientos || []) {
    if (!vivo(m)) continue;
    const periodo = m.periodo || periodoDe(m.fecha);
    const monto = Number(m.monto) || 0;
    const previo = esPrevio(m);
    // En una tarjeta cada movimiento dice su moneda; en una cuenta, es la de la cuenta.
    const tarjeta = ix.tarjetas.get(m.cuentaId);
    const moneda = ix.monedaDeMovimiento(m);
    const base = { origen: m.id, fecha: m.fecha, periodo, personaId: personaDeMovimiento(m, ix.cuentas) };
    const anotar = (a) => {
      if (!previo || (a.clase === 'saldo' || a.clase === 'tarjeta' ? a.fecha > ap.fecha : a.periodo >= ap.mes)) out.push(a);
    };
    const saldo = (cuentaId, delta) => anotar({ ...base, clase: 'saldo', cuentaId, moneda: ix.monedaDe(cuentaId), delta });
    // Lo que se debe en una tarjeta, en su moneda (solo lo posterior a su saldo inicial).
    const deuda = (t, delta, monedaDeuda, tipo, extra = {}) => {
      if (posteriorAlSaldo(t.cuenta, extra.fecha || m.fecha, m.creado)) {
        anotar({ ...base, ...extra, clase: 'tarjeta', cuentaId: t.cuenta.id, moneda: monedaDeuda, delta, tipo });
      }
    };
    const { c, estimado } = ix.montoEnLempiras(m);

    if (m.tipo === 'gasto') {
      const categoriaId = m.categoriaId || (m.prestamoId ? 'prestamos' : null);
      const gasto = (extra) => anotar({
        ...base, clase: 'gasto', categoriaId, grupoId: ix.grupoDe(categoriaId), partidaId: m.partidaId || null, parte: parteDe(m),
        medioId: m.cuentaId, prestamoId: m.prestamoId || null, comercioId: m.comercioId || null, ...extra,
      });
      if (tarjeta && m.cuotas) {
        // Comisión marcada como gasto del mes: se cobra en la fecha del financiamiento, no con la
        // primera cuota. Es deuda de la tarjeta, porque es el banco quien la carga ahí.
        const comision = comisionInmediata(tarjeta.cuenta, m);
        if (comision) {
          const enComision = { fecha: comision.fecha, periodo: comision.periodo };
          deuda(tarjeta, comision.c, 'L', 'comision', enComision);
          anotar({
            ...base, ...enComision, clase: 'gasto', c: comision.c, estimado: false, categoriaId: 'cargos-tarjeta',
            grupoId: ix.grupoDe('cargos-tarjeta'), partidaId: null, parte: null, medioId: m.cuentaId, prestamoId: null,
            comercioId: null, nombre: 'Comisión de financiamiento',
          });
        }
        // Compra a cuotas: cada cuota es deuda y gasto en el ciclo en que se cobra. El capital va a
        // la categoría de la compra; los intereses y la comisión, a los cargos de tarjeta.
        for (const q of tarjeta.cuotas.get(m.id) || []) {
          const enCuota = { fecha: q.fecha, periodo: q.periodo, cuota: q.k, cuotas: q.n };
          deuda(tarjeta, q.c, 'L', 'cuota', { ...enCuota, intra: q.intra, capital: q.capital, interes: q.interes, comision: q.comision });
          gasto({ ...enCuota, c: q.capital, estimado: false });
          for (const [c, nombre] of [[q.interes, 'Intereses de cuotas'], [q.comision, 'Comisión de cuotas']]) {
            if (!(c > 0)) continue;
            anotar({
              ...base, ...enCuota, clase: 'gasto', c, estimado: false, categoriaId: 'cargos-tarjeta', grupoId: ix.grupoDe('cargos-tarjeta'),
              partidaId: null, parte: null, medioId: m.cuentaId, prestamoId: null, comercioId: null, nombre,
            });
          }
        }
      } else {
        if (tarjeta) deuda(tarjeta, aCentavos(monto), moneda, 'compra');
        else saldo(m.cuentaId, -aCentavos(monto));
        gasto({ c, estimado });
        if (m.prestamoId) anotar({ ...base, clase: 'prestamo', prestamoId: m.prestamoId, tipoPago: 'cuota', c, creado: m.creado || '' });
      }
    } else if (m.tipo === 'ingreso') {
      if (tarjeta) deuda(tarjeta, -aCentavos(monto), moneda, 'credito');
      else saldo(m.cuentaId, aCentavos(monto));
      const categoriaId = m.categoriaId || null;
      anotar({ ...base, clase: 'ingreso', c, bruto: c, estimado, categoriaId, grupoId: ix.grupoDe(categoriaId), medioId: m.cuentaId, ingresoId: null });
    } else if (m.tipo === 'transferencia') {
      if (tarjeta) deuda(tarjeta, aCentavos(monto), moneda, 'avance');
      else saldo(m.cuentaId, -aCentavos(monto));
      const destino = ix.tarjetas.get(m.cuentaDestinoId);
      const monedaDestino = destino ? 'L' : ix.monedaDe(m.cuentaDestinoId);
      let llega = monto;
      if (tieneValor(m.montoDestino)) llega = Number(m.montoDestino) || 0;
      else if (moneda !== monedaDestino) {
        const tasa = Number(m.tasa) || ix.tasaEn(periodo);
        llega = !tasa ? 0 : moneda === 'USD' ? monto * tasa : monto / tasa;
      }
      if (destino) deuda(destino, -aCentavos(llega), 'L', 'pago');
      else saldo(m.cuentaDestinoId, aCentavos(llega));
      if (m.metaId || ix.partidas.get(m.partidaId)?.tipo === 'aporte') {
        anotar({ ...base, clase: 'ahorro', c, estimado, partidaId: m.partidaId || null, metaId: m.metaId || null, cuentaId: m.cuentaDestinoId });
      }
    } else if (m.tipo === 'abono') {
      if (tarjeta) deuda(tarjeta, aCentavos(monto), moneda, 'compra');
      else saldo(m.cuentaId, -aCentavos(monto));
      if (m.prestamoId) anotar({ ...base, clase: 'prestamo', prestamoId: m.prestamoId, tipoPago: 'abono', c, creado: m.creado || '' });
    } else if (m.tipo === 'ajuste') {
      if (tarjeta) deuda(tarjeta, aCentavos(monto), moneda, 'ajuste');
      else saldo(m.cuentaId, aCentavos(monto));
    } else if (m.tipo === 'pago_tarjeta') {
      // Pago de tarjeta: sale de la cuenta lo pagado en lempiras más los dólares a la tasa del
      // día, y baja la deuda en cada moneda. No es gasto.
      const destino = ix.tarjetas.get(m.cuentaDestinoId);
      const pagoL = aCentavos(m.pagoL);
      const pagoUSD = aCentavos(m.pagoUSD);
      const tasa = Number(m.tasa) || 0;
      const salida = ix.monedaDe(m.cuentaId) === 'USD'
        ? pagoUSD + (tasa ? Math.round(pagoL / tasa) : 0)
        : pagoL + Math.round(pagoUSD * tasa);
      saldo(m.cuentaId, -salida);
      if (destino) {
        if (pagoL) deuda(destino, -pagoL, 'L', 'pago');
        if (pagoUSD) deuda(destino, -pagoUSD, 'USD', 'pago', { tasa });
      }
    }
  }

  // Cargos de las tarjetas (membresía, seguros) en los cortes que ya pasaron.
  for (const t of ix.tarjetas.values()) {
    for (const cargo of t.cargos) {
      const base = { origen: cargo.clave, fecha: cargo.fecha, periodo: cargo.periodo, personaId: t.cuenta.titularId || null };
      out.push({ ...base, clase: 'tarjeta', cuentaId: t.cuenta.id, moneda: cargo.moneda, delta: cargo.c, tipo: 'cargo', nombre: cargo.cargo.nombre });
      const lps = cargo.moneda === 'USD'
        ? t.tasas.get(cargo.clave) || { c: Math.round(cargo.c * t.ultimaTasa), estimado: true }
        : { c: cargo.c, estimado: false };
      out.push({
        ...base, clase: 'gasto', c: lps.c, estimado: lps.estimado, categoriaId: 'cargos-tarjeta', grupoId: ix.grupoDe('cargos-tarjeta'),
        partidaId: null, parte: null, medioId: t.cuenta.id, prestamoId: null, comercioId: null, nombre: cargo.cargo.nombre,
      });
    }
  }

  for (const r of doc.recibos || []) {
    if (!vivo(r)) continue;
    const ingreso = ix.ingresos.get(r.ingresoId);
    const periodo = r.periodo || periodoDe(r.ocurrencia || r.fecha);
    const base = { origen: r.id, fecha: r.fecha, periodo, personaId: r.personaId || ingreso?.personaId || null };
    const previo = esPrevio(r);
    const anotar = (a) => {
      if (!previo || (a.clase === 'saldo' ? a.fecha > ap.fecha : a.periodo >= ap.mes)) out.push(a);
    };
    const neto = aCentavos(r.neto);
    const deducciones = r.deducciones || [];
    const descontado = deducciones.filter((d) => !d.noAplica && tieneValor(d.monto)).reduce((a, d) => a + aCentavos(d.monto), 0);
    const categoriaId = r.tipo === 'decimo13' || r.tipo === 'decimo14' ? 'decimos' : ingreso?.categoriaId || 'salario';
    anotar({ ...base, clase: 'saldo', cuentaId: r.cuentaId, moneda: ix.monedaDe(r.cuentaId), delta: neto });
    anotar({
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
      anotar({
        ...base, clase: 'deduccion', c: cd, deduccionId: d.deduccionId, nombre: d.nombre || definicion?.nombre || 'Deducción', naturaleza,
        categoriaId: cat, grupoId: ix.grupoDe(cat), ingresoId: r.ingresoId,
      });
      const prestamoId = d.prestamoId ?? definicion?.prestamoId;
      if (naturaleza === 'prestamo' && prestamoId) {
        anotar({ ...base, clase: 'prestamo', prestamoId, tipoPago: 'cuota', c: cd, creado: r.creado || '', planilla: true });
      }
      const cuentaDestinoId = d.cuentaDestinoId ?? definicion?.cuentaDestinoId;
      if (naturaleza === 'ahorro' && cuentaDestinoId) {
        anotar({ ...base, clase: 'saldo', cuentaId: cuentaDestinoId, moneda: ix.monedaDe(cuentaDestinoId), delta: cd });
        anotar({ ...base, clase: 'ahorro', c: cd, estimado: false, partidaId: null, metaId: null, cuentaId: cuentaDestinoId, planilla: true });
      }
    }
  }

  return out.sort(porFecha);
}

// Con la apertura de un año (los años anteriores no están cargados): los registros de años
// anteriores que sigan en el documento no se usan, porque ya están contados en ella, y se agregan
// los que la apertura trae de esos años (compras a cuotas que se siguen cobrando y registros de un
// mes de este año o posterior). `previos`: los ids de estos últimos.
function conApertura(doc, apertura) {
  const porDefecto = anioPorDefectoDe(doc);
  const desde = String(apertura.anio);
  const out = { ...doc };
  const previos = new Set();
  for (const c of COLECCIONES_ANIO) {
    const cargados = (doc[c] || []).filter((r) => anioDeRegistro(c, r, porDefecto) >= desde);
    const ids = new Set(cargados.map((r) => r.id));
    const traidos = (apertura.registros?.[c] || []).filter((r) => !ids.has(r.id));
    for (const r of traidos) previos.add(r.id);
    out[c] = [...cargados, ...traidos];
  }
  return { doc: out, previos };
}

// Índice con todo lo que las pantallas consultan. Se crea una vez por cada cambio de los
// datos; `hoy` llega de afuera para que los cálculos no dependan del reloj.
// `apertura`: cómo quedó todo al cierre del año anterior al primer año cargado (ver cierres.js);
// null si están cargados todos los años.
export function crearIndice(docCargado, { hoy = '', apertura = null } = {}) {
  const ap = apertura ? { ...apertura, mes: `${apertura.anio}-01` } : null;
  const { doc, previos } = ap ? conApertura(docCargado, ap) : { doc: docCargado, previos: null };
  const ix = {
    doc,
    hoy,
    apertura: ap,
    previos,
    config: doc.config || {},
    personas: mapa(doc.personas),
    grupos: mapa(doc.grupos),
    categorias: mapa(doc.categorias),
    cuentas: mapa(doc.cuentas),
    partidas: mapa(doc.partidas),
    ingresos: mapa(doc.ingresos),
    prestamos: mapa(doc.prestamos),
    metas: mapa(doc.metas),
    comercios: mapa(doc.comercios),
    movimientos: mapa(doc.movimientos),
  };
  // Tasa de cambio por mes (ver tasas.js). `ix.tasaEn()` sin mes da la de hoy, que es la que
  // corresponde a lo que todavía no se paga.
  ix.tasaEn = prepararTasas(doc, hoy);
  ix.topes = mapa(doc.topes);
  ix.renovaciones = mapa(doc.renovaciones);

  ix.ordenGrupos = (doc.grupos || []).filter(vivo)
    .sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99) || (a.nombre || '').localeCompare(b.nombre || ''))
    .map((g) => g.id);
  ix.grupoDe = (categoriaId) => {
    const grupoId = ix.categorias.get(categoriaId)?.grupoId;
    return grupoId && vivo(ix.grupos.get(grupoId)) ? grupoId : SIN_GRUPO;
  };
  ix.monedaDe = (cuentaId) => ix.cuentas.get(cuentaId)?.moneda || 'L';
  // Monto en lempiras (centavos). Lo que está en dólares usa la tasa del registro o, si no
  // tiene, la tasa de su mes, y queda marcado como estimado.
  ix.enLempiras = (monto, moneda, tasa, periodo = '') => {
    if (moneda !== 'USD') return { c: aCentavos(monto), estimado: false };
    const t = Number(tasa) || ix.tasaEn(periodo);
    return { c: aCentavos((Number(monto) || 0) * t), estimado: !Number(tasa) };
  };

  // Lo que se debe en una tarjeta y todavía no se paga se estima con la tasa de hoy, no con la
  // del mes de la compra: es lo que va a costar cuando se pague.
  ix.tarjetas = prepararTarjetas(doc, { hoy, tasaReferencia: ix.tasaEn(), apertura: ap, previos });
  ix.esTarjeta = (cuentaId) => ix.tarjetas.has(cuentaId);
  ix.monedaDeMovimiento = (m) => (ix.tarjetas.has(m.cuentaId) ? (m.moneda === 'USD' ? 'USD' : 'L') : ix.monedaDe(m.cuentaId));
  // Lempiras de un movimiento. Una compra en dólares con tarjeta usa la tasa de los pagos que la
  // cubren (del cargo más antiguo al más nuevo); mientras no se paga, la última tasa usada.
  ix.montoEnLempiras = (m) => {
    const t = ix.tarjetas.get(m.cuentaId);
    if (!t || m.moneda !== 'USD') return ix.enLempiras(m.monto, ix.monedaDeMovimiento(m), m.tasa, m.periodo || periodoDe(m.fecha));
    const asignada = t.tasas.get(m.id);
    return asignada ? { c: asignada.c, estimado: asignada.estimado } : { c: Math.round(aCentavos(m.monto) * t.ultimaTasa), estimado: true };
  };

  ix.asientos = expandir(doc, ix);
  ix.saldos = [];
  ix.porPeriodo = new Map();
  ix.pagosPrestamo = new Map();
  ix.eventosTarjeta = new Map();
  for (const a of ix.asientos) {
    if (a.clase === 'saldo') ix.saldos.push(a);
    else if (a.clase === 'tarjeta') agregar(ix.eventosTarjeta, a.cuentaId, a);
    else agregar(ix.porPeriodo, a.periodo, a);
    if (a.clase === 'prestamo') {
      agregar(ix.pagosPrestamo, a.prestamoId, {
        tipo: a.tipoPago, periodo: a.periodo, fecha: a.fecha, monto: deCentavos(a.c), creado: a.creado, origen: a.origen, planilla: !!a.planilla,
      });
    }
  }

  // Pagos de cada partida por mes: `${partidaId}|${periodo}` → [{ m, c, u }], en centavos de
  // lempira y de dólar. Una partida en dólares se mide en dólares, y un pago hecho en lempiras se
  // pasa con la tasa del registro o, si no tiene, la de referencia. Una compra a cuotas cuenta en
  // cada mes en que se cobra una cuota.
  const enDolares = (m, c) => {
    if (ix.monedaDeMovimiento(m) === 'USD') return aCentavos(m.monto);
    const t = Number(m.tasa) || ix.tasaEn(m.periodo || periodoDe(m.fecha));
    return t ? Math.round(c / t) : 0;
  };
  ix.pagosPartida = new Map();
  ix.usoComercios = new Map(); // comercioId → veces que se usó
  for (const m of doc.movimientos || []) {
    if (!vivo(m)) continue;
    if (m.comercioId) ix.usoComercios.set(m.comercioId, (ix.usoComercios.get(m.comercioId) || 0) + 1);
    if (!m.partidaId) continue;
    const t = ix.tarjetas.get(m.cuentaId);
    if (t && m.cuotas && m.tipo === 'gasto') {
      for (const q of t.cuotas.get(m.id) || []) {
        if (!(previos?.has(m.id) && q.periodo < ap.mes)) agregar(ix.pagosPartida, `${m.partidaId}|${q.periodo}`, { m, c: q.capital, u: enDolares(m, q.capital) });
      }
      continue;
    }
    const { c } = ix.montoEnLempiras(m);
    agregar(ix.pagosPartida, `${m.partidaId}|${m.periodo || periodoDe(m.fecha)}`, { m, c, u: enDolares(m, c) });
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
