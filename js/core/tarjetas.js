// Tarjetas de crédito bimonetarias: ciclos (corte y fecha límite), cargos de la tarjeta
// (membresía, seguros), compras a cuotas, tasas de los dólares y estado de cuenta de cada corte.
// Una tarjeta es una cuenta con `tipo: 'tarjeta'` y su configuración en `cuenta.tarjeta`.
// Su saldo es lo que se debe, en lempiras y en dólares por separado.
import { vivo } from './modelo.js';
import { periodoDe, mesDe, sumarMeses, sumarDias, fechaEnMes, aCentavos, deCentavos } from './util.js';
import { coincidePersona } from './filtro.js';
import { asignarTasas } from './divisas.js';

export const TIPOS_CARGO = { membresia: 'Membresía', seguro: 'Seguro', otro: 'Otro cargo' };
export const PERIODICIDADES = { mensual: 'Cada mes', anual: 'Una vez al año', meses: 'En los meses elegidos' };

const porFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
const monedas = () => ({ L: 0, USD: 0 });
const enUnidades = (o) => ({ L: deCentavos(o.L), USD: deCentavos(o.USD) });

export const esTarjeta = (cuenta) => !!cuenta && cuenta.tipo === 'tarjeta';

// Corte de un mes: el día de corte, o el último día si el mes es más corto.
export const corteDelMes = (cuenta, periodo) => fechaEnMes(periodo, Number(cuenta.tarjeta?.diaCorte) || 31);
export const corteSiguiente = (cuenta, corte) => corteDelMes(cuenta, sumarMeses(periodoDe(corte), 1));
export const corteAnterior = (cuenta, corte) => corteDelMes(cuenta, sumarMeses(periodoDe(corte), -1));
export const inicioCiclo = (cuenta, corte) => sumarDias(corteAnterior(cuenta, corte), 1);

// Corte del ciclo al que pertenece `fecha`: una compra del día del corte entra en ese ciclo.
export function corteDe(cuenta, fecha) {
  const delMes = corteDelMes(cuenta, periodoDe(fecha));
  return fecha <= delMes ? delMes : corteSiguiente(cuenta, delMes);
}

// Fecha límite de pago: el siguiente día de pago después del corte.
export function limiteDe(cuenta, corte) {
  const dia = Number(cuenta.tarjeta?.diaPago) || 1;
  const mismoMes = fechaEnMes(periodoDe(corte), dia);
  return mismoMes > corte ? mismoMes : fechaEnMes(sumarMeses(periodoDe(corte), 1), dia);
}

// Lo anterior a esta fecha ya está en el saldo inicial de la tarjeta.
export const fechaSaldoDe = (cuenta) => cuenta.tarjeta?.saldoFecha || String(cuenta.creado || '').slice(0, 10) || '0000-00-00';

// ¿Un registro de esta fecha cambia el saldo? Sí si es posterior al saldo inicial; si es del
// mismo día, solo si se anotó después de registrar ese saldo.
export function posteriorAlSaldo(cuenta, fecha, creado) {
  const saldoFecha = fechaSaldoDe(cuenta);
  const registrado = cuenta.tarjeta?.saldoRegistrado || cuenta.creado || '';
  return fecha > saldoFecha || (fecha === saldoFecha && !!creado && creado > registrado);
}

export const TIPOS_FINANCIAMIENTO = { intra: 'Intrafinanciamiento', extra: 'Extrafinanciamiento' };

const tasaMensual = (tasa) => (Number(tasa) || 0) / 100 / 12;
const cuotaNivelada = (monto, r, n) => (r ? (monto * r) / (1 - (1 + r) ** -n) : monto / n);

// Tasa mensual con la que la cuota del banco paga el monto en n cuotas (por bisección).
function tasaDeCuota(monto, cuota, n) {
  if (!(cuota * n > monto)) return 0;
  let bajo = 0;
  let alto = 1;
  for (let i = 0; i < 60; i++) {
    const medio = (bajo + alto) / 2;
    if (cuotaNivelada(monto, medio, n) > cuota) alto = medio;
    else bajo = medio;
  }
  return (bajo + alto) / 2;
}

// Comisión de una compra a cuotas en centavos: un porcentaje de la compra o un monto fijo,
// que se cobra una vez (con la primera cuota) o en cada cuota.
export function comisionDeCuotas(q, total) {
  const x = q?.comision;
  const valor = Number(x?.valor) || 0;
  if (!(valor > 0)) return { c: 0, mensual: false };
  return { c: x.unidad === 'monto' ? aCentavos(valor) : Math.round((total * valor) / 100), mensual: x.cobro === 'mensual' };
}

// Cuotas de una compra a cuotas: [{ k, n, fecha, periodo, capital, interes, comision, c, intra }]
// en centavos (c = capital + intereses + comisión). La primera se cobra en el corte de la compra
// (o en el de `primerCorte`) y las demás en los cortes siguientes.
// - `tipo`: 'intra' (intrafinanciamiento: usa el límite de la tarjeta) o 'extra'
//   (extrafinanciamiento: crédito aparte, fuera del límite). Los dos pueden tener intereses.
// - Sin intereses, el capital se reparte en partes iguales con el residuo en la última. Con la
//   tasa anual o la cuota del banco, cuota nivelada: el interés sale del saldo de cada mes.
// - Si la compra se canceló antes, el capital que faltaba se cobra ese día.
export function cuotasDeCompra(cuenta, m) {
  const q = m.cuotas || {};
  const n = Math.max(1, Math.round(Number(q.n) || 1));
  const total = aCentavos(m.monto);
  const primero = corteDe(cuenta, q.primerCorte || m.fecha);
  const intra = q.tipo !== 'extra';
  const cuotaBanco = aCentavos(q.cuotaBanco);
  const r = tasaMensual(q.tasaAnual) || (cuotaBanco > 0 ? tasaDeCuota(total, cuotaBanco, n) : 0);
  const cuota = cuotaBanco > 0 ? cuotaBanco : Math.round(cuotaNivelada(total, r, n));
  const comision = comisionDeCuotas(q, total);
  const base = Math.floor(total / n);
  let saldo = total;
  let lista = Array.from({ length: n }, (_, i) => {
    const interes = r ? Math.round(saldo * r) : 0;
    let capital = r ? Math.min(saldo, Math.max(0, cuota - interes)) : base;
    if (i === n - 1) capital = saldo;
    saldo -= capital;
    const com = comision.c && (comision.mensual || i === 0) ? comision.c : 0;
    const fecha = corteDelMes(cuenta, sumarMeses(periodoDe(primero), i));
    return { k: i + 1, n, fecha, periodo: periodoDe(fecha), capital, interes, comision: com, c: capital + interes + com, intra };
  });
  if (q.canceladaEl) {
    const quedan = lista.filter((x) => x.fecha > q.canceladaEl);
    if (quedan.length) {
      lista = lista.filter((x) => x.fecha <= q.canceladaEl);
      const capital = quedan.reduce((a, x) => a + x.capital, 0);
      // La comisión única se cobra aunque se cancele antes de la primera cuota.
      const com = comision.c && !comision.mensual && !lista.length ? comision.c : 0;
      lista.push({
        k: lista.length + 1, n, fecha: q.canceladaEl, periodo: periodoDe(q.canceladaEl), capital, interes: 0, comision: com, c: capital + com, intra, cancelacion: true,
      });
    }
  }
  return lista;
}

function aplicaCargo(cargo, mes) {
  if (cargo.activo === false || !(Number(cargo.monto) > 0)) return false;
  if ((cargo.periodicidad || 'mensual') === 'mensual') return true;
  return (Array.isArray(cargo.meses) ? cargo.meses.map(Number) : []).includes(mes);
}

// Cargos de la tarjeta (membresía, seguros) que se cobran en los cortes entre `desde` y `hasta`.
export function cargosDeTarjeta(cuenta, desde, hasta) {
  const out = [];
  const cargos = cuenta.tarjeta?.cargos || [];
  if (!cargos.length || !desde || !hasta || desde > hasta) return out;
  for (let corte = corteDe(cuenta, desde); corte <= hasta; corte = corteSiguiente(cuenta, corte)) {
    const mes = mesDe(periodoDe(corte));
    for (const cargo of cargos) {
      if (!aplicaCargo(cargo, mes)) continue;
      out.push({
        clave: `cargo:${cuenta.id}:${cargo.id}:${corte}`, cargo, fecha: corte, periodo: periodoDe(corte),
        moneda: cargo.moneda === 'USD' ? 'USD' : 'L', c: aCentavos(cargo.monto),
      });
    }
  }
  return out;
}

// Próxima vez que se cobra un cargo anual o de meses elegidos, a partir del mes `desde`.
export function proximoCobro(cuenta, cargo, desde) {
  if ((cargo.periodicidad || 'mensual') === 'mensual' || cargo.activo === false) return null;
  for (let i = 0; i < 12; i++) {
    const periodo = sumarMeses(desde, i);
    if (aplicaCargo(cargo, mesDe(periodo))) return corteDelMes(cuenta, periodo);
  }
  return null;
}

// Lo que los asientos necesitan de cada tarjeta: cuotas de las compras, cargos generados hasta
// hoy y la tasa en lempiras de cada cargo en dólares.
export function prepararTarjetas(doc, { hoy = '', tasaReferencia = 0 } = {}) {
  const tarjetas = new Map();
  const inicio = doc.config?.inicio ? `${doc.config.inicio}-01` : '';
  const movimientos = (doc.movimientos || []).filter(vivo);
  for (const cuenta of doc.cuentas || []) {
    if (!vivo(cuenta) || !esTarjeta(cuenta)) continue;
    const t = cuenta.tarjeta || {};
    const saldoFecha = fechaSaldoDe(cuenta);
    const propios = movimientos.filter((m) => m.cuentaId === cuenta.id);
    const pagos = movimientos.filter((m) => m.tipo === 'pago_tarjeta' && m.cuentaDestinoId === cuenta.id).sort(porFecha);

    const cuotas = new Map();
    for (const m of propios) if (m.tipo === 'gasto' && m.cuotas) cuotas.set(m.id, cuotasDeCompra(cuenta, m));
    const desdeCargos = [sumarDias(saldoFecha, 1), inicio].filter(Boolean).sort().pop();
    const cargos = hoy ? cargosDeTarjeta(cuenta, desdeCargos, hoy) : [];

    const conTasa = pagos.filter((p) => aCentavos(p.pagoUSD) > 0 && Number(p.tasa) > 0 && posteriorAlSaldo(cuenta, p.fecha, p.creado));
    const ultimaTasa = conTasa.length ? Number(conTasa[conTasa.length - 1].tasa) : Number(tasaReferencia) || 0;
    const cargosUSD = [];
    if (aCentavos(t.saldoInicial?.USD) > 0) cargosUSD.push({ clave: `inicial:${cuenta.id}`, fecha: saldoFecha, usd: aCentavos(t.saldoInicial.USD) });
    for (const m of propios) {
      const cargo = (m.tipo === 'gasto' && !m.cuotas) || m.tipo === 'transferencia';
      if (cargo && m.moneda === 'USD' && posteriorAlSaldo(cuenta, m.fecha, m.creado)) cargosUSD.push({ clave: m.id, fecha: m.fecha, usd: aCentavos(m.monto) });
    }
    for (const c of cargos) if (c.moneda === 'USD') cargosUSD.push({ clave: c.clave, fecha: c.fecha, usd: c.c });
    const tasas = asignarTasas(cargosUSD, conTasa.map((p) => ({ fecha: p.fecha, usd: aCentavos(p.pagoUSD), tasa: Number(p.tasa) })), ultimaTasa);

    tarjetas.set(cuenta.id, { cuenta, saldoFecha, cuotas, cargos, ultimaTasa, tasas });
  }
  return tarjetas;
}

// Estado de cuenta de un corte: saldo al corte, lo pagado después del corte (hasta el corte
// siguiente, aunque sea tarde), lo que falta o queda a favor y cómo va: 'abierto' (el corte no
// llega), 'pagado', 'parcial', 'pendiente' o 'vencido'. Montos en lempiras y en dólares por separado.
// Listas: `compras` (compras, cuotas, cargos y créditos del ciclo), `pagos` (los de este corte)
// y `despues` (lo cargado después del corte, hasta hoy).
export function estadoCiclo(ix, cuenta, corte) {
  const t = cuenta.tarjeta || {};
  const info = ix.tarjetas.get(cuenta.id);
  const eventos = ix.eventosTarjeta.get(cuenta.id) || [];
  const inicio = inicioCiclo(cuenta, corte);
  const limite = limiteDe(cuenta, corte);
  const siguiente = corteSiguiente(cuenta, corte);
  const alCorte = { L: aCentavos(t.saldoInicial?.L), USD: aCentavos(t.saldoInicial?.USD) };
  const pagado = monedas();
  const pagadoAlLimite = monedas();
  const tasa = info?.ultimaTasa || Number(ix.config.tasaReferencia) || 0;
  let pagadoEnL = 0; // lo que salió de las cuentas: los dólares, a la tasa de cada pago
  const cargosDelCiclo = monedas();
  const compras = [];
  const pagos = [];
  const despues = [];
  for (const e of eventos) {
    if (e.fecha <= corte) alCorte[e.moneda] += e.delta;
    if (e.fecha >= inicio && e.fecha <= corte) {
      // Los pagos hechos antes del corte son del estado de cuenta anterior.
      if (e.tipo === 'pago') continue;
      compras.push(e);
      if (e.delta > 0) cargosDelCiclo[e.moneda] += e.delta;
    } else if (e.fecha > corte && e.fecha <= siguiente && (!ix.hoy || e.fecha <= ix.hoy)) {
      // Lo de después de hoy (un pago con fecha futura) todavía no cuenta.
      if (e.tipo === 'pago') {
        pagado[e.moneda] -= e.delta;
        pagadoEnL -= e.moneda === 'USD' ? Math.round(e.delta * (e.tasa || tasa)) : e.delta;
        if (e.fecha <= limite) pagadoAlLimite[e.moneda] -= e.delta;
        pagos.push(e);
      } else {
        despues.push(e);
      }
    }
  }
  const resto = { L: alCorte.L - pagado.L, USD: alCorte.USD - pagado.USD };
  const pendiente = { L: Math.max(0, resto.L), USD: Math.max(0, resto.USD) };
  const aFavor = { L: Math.max(0, -resto.L), USD: Math.max(0, -resto.USD) };
  let situacion;
  if (ix.hoy && ix.hoy <= corte) situacion = 'abierto';
  else if (!pendiente.L && !pendiente.USD) situacion = 'pagado';
  else if (ix.hoy > limite) situacion = 'vencido';
  else if (pagado.L || pagado.USD) situacion = 'parcial';
  else situacion = 'pendiente';
  const enL = (o) => deCentavos(o.L + Math.round(o.USD * tasa));
  // Pagado, pero a la fecha límite todavía faltaba.
  const tarde = situacion === 'pagado' && (alCorte.L > pagadoAlLimite.L || alCorte.USD > pagadoAlLimite.USD);
  return {
    corte, inicio, limite, siguiente, situacion, tarde, tasa, antesDelSaldo: corte < (info?.saldoFecha || ''),
    alCorte: enUnidades(alCorte), pagado: enUnidades(pagado), pagadoAlLimite: enUnidades(pagadoAlLimite), pendiente: enUnidades(pendiente), aFavor: enUnidades(aFavor),
    cargosDelCiclo: enUnidades(cargosDelCiclo),
    contadoEnL: enL({ L: Math.max(0, alCorte.L), USD: Math.max(0, alCorte.USD) }), pagadoEnL: deCentavos(pagadoEnL), pendienteEnL: enL(pendiente),
    compras: compras.sort(porFecha), pagos: pagos.sort(porFecha), despues: despues.sort(porFecha),
    estimado: pendiente.USD > 0 || situacion === 'abierto',
  };
}

// Resumen de una tarjeta hoy: deuda, disponible y el estado del último corte. El capital de las
// cuotas que faltan de un intrafinanciamiento baja el disponible (`porCobrar`); el de un
// extrafinanciamiento está fuera del límite (`extraPorCobrar`).
export function resumenTarjeta(ix, cuenta) {
  const t = cuenta.tarjeta || {};
  const info = ix.tarjetas.get(cuenta.id);
  const eventos = ix.eventosTarjeta.get(cuenta.id) || [];
  const deuda = { L: aCentavos(t.saldoInicial?.L), USD: aCentavos(t.saldoInicial?.USD) };
  const porCobrar = monedas();
  const extraPorCobrar = monedas();
  for (const e of eventos) {
    if (!ix.hoy || e.fecha <= ix.hoy) deuda[e.moneda] += e.delta;
    else if (e.tipo === 'cuota') (e.intra ? porCobrar : extraPorCobrar)[e.moneda] += e.capital ?? e.delta;
  }
  const tasa = info?.ultimaTasa || Number(ix.config.tasaReferencia) || 0;
  const disponible = (moneda) => (Number(t.limite?.[moneda]) > 0 ? deCentavos(aCentavos(t.limite[moneda]) - deuda[moneda] - porCobrar[moneda]) : null);
  const corteAbierto = corteDe(cuenta, ix.hoy || fechaSaldoDe(cuenta));
  return {
    deuda: enUnidades(deuda), deudaEnL: deCentavos(deuda.L + Math.round(deuda.USD * tasa)), tasa,
    porCobrar: enUnidades(porCobrar), extraPorCobrar: enUnidades(extraPorCobrar), disponible: { L: disponible('L'), USD: disponible('USD') },
    corteAbierto, abierto: estadoCiclo(ix, cuenta, corteAbierto), ultimo: estadoCiclo(ix, cuenta, corteAnterior(cuenta, corteAbierto)),
  };
}

// Lo que se debe en las tarjetas al final de `fecha`, en centavos de lempira: el saldo en cada
// moneda (los dólares, con la última tasa) y el capital de las cuotas que faltan de las compras
// hechas hasta esa fecha. Antes del saldo con que empezó una tarjeta, no se cuenta.
export function deudaTarjetasAl(ix, fecha, filtro) {
  let total = 0;
  for (const { cuenta, saldoFecha, ultimaTasa } of ix.tarjetas.values()) {
    if (!coincidePersona(cuenta.titularId || null, filtro) || fecha < saldoFecha) continue;
    const t = cuenta.tarjeta || {};
    const deuda = { L: aCentavos(t.saldoInicial?.L), USD: aCentavos(t.saldoInicial?.USD) };
    for (const e of ix.eventosTarjeta.get(cuenta.id) || []) {
      if (e.fecha <= fecha) deuda[e.moneda] += e.delta;
      else if (e.tipo === 'cuota' && (ix.movimientos.get(e.origen)?.fecha || '9999') <= fecha) deuda.L += e.capital ?? e.delta;
    }
    total += deuda.L + Math.round(deuda.USD * (ultimaTasa || Number(ix.config.tasaReferencia) || 0));
  }
  return total;
}

const ESTADO_ITEM = { abierto: 'pendiente', pendiente: 'pendiente', parcial: 'parcial', vencido: 'pendiente', pagado: 'completo' };

// Pagos de tarjeta con fecha límite entre `desde` y `hasta`, como items del plan (para los
// pagos de la quincena y los avisos). Un corte que todavía no llega usa lo acumulado (estimado).
export function pagosDeTarjetas(ix, desde, hasta, filtro) {
  const items = [];
  for (const { cuenta } of ix.tarjetas.values()) {
    if (!coincidePersona(cuenta.titularId || null, filtro)) continue;
    for (let corte = corteDe(cuenta, sumarDias(desde, -62)); limiteDe(cuenta, corte) <= hasta; corte = corteSiguiente(cuenta, corte)) {
      const limite = limiteDe(cuenta, corte);
      if (limite < desde || corte < fechaSaldoDe(cuenta)) continue;
      const e = estadoCiclo(ix, cuenta, corte);
      const abierto = e.situacion === 'abierto';
      const esperado = abierto ? deCentavos(aCentavos(e.alCorte.L) + Math.round(aCentavos(e.alCorte.USD) * e.tasa)) : e.contadoEnL;
      if (!(esperado > 0) && !e.pagos.length) continue;
      items.push({
        clave: `tarjeta:${cuenta.id}:${corte}`, tipoItem: 'tarjeta', tarjeta: cuenta, estadoCuenta: e, corte, limite, fecha: limite,
        nombre: `Pago de ${cuenta.nombre}`, responsableId: cuenta.titularId || null, dia: Number(limite.slice(8, 10)), grupoId: 'deudas',
        categoriaId: null, medioId: cuenta.tarjeta?.cuentaPagoId || null, forma: 'tarjeta', situacion: e.situacion,
        esperado, real: e.pagadoEnL, queda: abierto ? Math.max(0, esperado - e.pagadoEnL) : e.pendienteEnL, sobrante: 0,
        estado: ESTADO_ITEM[e.situacion], hecho: e.situacion === 'pagado', estimado: e.estimado,
        pagos: [...new Set(e.pagos.map((p) => p.origen))].map((id) => ix.movimientos.get(id)).filter(Boolean),
      });
    }
  }
  return items;
}
