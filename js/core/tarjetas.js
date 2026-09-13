// Tarjetas de crédito bimonetarias: ciclos (corte y fecha límite), cargos de la tarjeta
// (membresía, seguros), compras a cuotas, tasas de los dólares y estado de cuenta de cada corte.
// Una tarjeta es una cuenta con `tipo: 'tarjeta'` y su configuración en `cuenta.tarjeta`.
// Su saldo es lo que se debe, en lempiras y en dólares por separado.
import { vivo } from './modelo.js';
import { periodoDe, mesDe, sumarMeses, sumarDias, fechaEnMes, aCentavos, deCentavos, redondear } from './util.js';
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

// Cuándo cae cada cuota. Depende del banco: unos las cargan en el corte de la tarjeta y otros el
// mismo día del mes en que se sacó el financiamiento (un extra del 30 cae los días 30, aunque el
// corte sea el 12). 'corte' es lo que hacía la app antes, y sigue siendo lo que se asume si no se dice.
export const COBROS_CUOTA = { corte: 'En el corte de la tarjeta', dia: 'El mismo día de cada mes' };
export const cobroDeCuotas = (q) => (q?.cobro === 'dia' ? 'dia' : 'corte');

// Día del mes en que cae la cuota cuando el banco cobra por día (31 = el último del mes, que
// fechaEnMes recorta a lo que tenga cada mes: un financiamiento del 31 cae el 28 en febrero).
export const diaDeCuota = (m) => Number(String((m.cuotas?.primerCorte) || m.fecha || '').slice(8, 10)) || 1;

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
  if (!(valor > 0)) return { c: 0, mensual: false, comoGasto: false };
  return {
    c: x.unidad === 'monto' ? aCentavos(valor) : Math.round((total * valor) / 100),
    mensual: x.cobro === 'mensual',
    // Con `comoGasto` la comisión no viaja en ninguna cuota: se registra en la fecha del
    // financiamiento (ver comisionInmediata), que es cuando el banco la cobra de verdad.
    comoGasto: !!x.comoGasto,
  };
}

// La comisión cuando se registra como gasto del mes en vez de viajar en la cuota:
// { c, fecha, periodo } o null. Es deuda de la tarjeta y gasto en la fecha del financiamiento.
export function comisionInmediata(cuenta, m) {
  const comision = comisionDeCuotas(m.cuotas, aCentavos(m.monto));
  if (!comision.c || !comision.comoGasto) return null;
  return { c: comision.c, fecha: m.fecha, periodo: periodoDe(m.fecha) };
}

// Por qué cuota va un financiamiento: 1 si empieza desde el principio. Las anteriores no se
// registran (ya se pagaron antes de usar la app), pero la amortización se calcula completa.
export const desdeCuotaDe = (q) => Math.max(1, Math.round(Number(q?.desdeCuota) || 1));

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
  // `primerCorte` guarda la fecha de la primera cuota: el corte que la lleva, o el día en que cae.
  const porDia = cobroDeCuotas(q) === 'dia';
  const primero = porDia ? (q.primerCorte || m.fecha) : corteDe(cuenta, q.primerCorte || m.fecha);
  const dia = Number(primero.slice(8, 10)) || 1;
  const intra = q.tipo !== 'extra';
  const cuotaBanco = aCentavos(q.cuotaBanco);
  const r = tasaMensual(q.tasaAnual) || (cuotaBanco > 0 ? tasaDeCuota(total, cuotaBanco, n) : 0);
  const cuota = cuotaBanco > 0 ? cuotaBanco : Math.round(cuotaNivelada(total, r, n));
  const comision = comisionDeCuotas(q, total);
  const base = Math.floor(total / n);
  let saldo = total;
  let lista = Array.from({ length: n }, (_, i) => {
    const interes = r ? Math.round(saldo * r) : 0;
    // Sin intereses, si se anotó la cuota del banco se usa esa: los bancos redondean (L25,797.97
    // entre 18 lo cobran como L1,433.20) y la última cuota absorbe la diferencia. Así los números
    // de la app calzan con el estado de cuenta en vez de quedar a unos centavos.
    let capital = r ? Math.min(saldo, Math.max(0, cuota - interes)) : Math.min(saldo, cuotaBanco > 0 ? cuotaBanco : base);
    if (i === n - 1) capital = saldo;
    saldo -= capital;
    const com = comision.c && !comision.comoGasto && (comision.mensual || i === 0) ? comision.c : 0;
    const mes = sumarMeses(periodoDe(primero), i);
    const fecha = porDia ? fechaEnMes(mes, dia) : corteDelMes(cuenta, mes);
    return { k: i + 1, n, fecha, periodo: periodoDe(fecha), capital, interes, comision: com, c: capital + interes + com, intra };
  });
  // Un financiamiento que ya venía empezado: las cuotas anteriores no generan nada.
  const desde = desdeCuotaDe(q);
  if (desde > 1) lista = lista.filter((x) => x.k >= desde);
  if (q.canceladaEl) {
    const quedan = lista.filter((x) => x.fecha > q.canceladaEl);
    if (quedan.length) {
      lista = lista.filter((x) => x.fecha <= q.canceladaEl);
      const capital = quedan.reduce((a, x) => a + x.capital, 0);
      // La comisión única se cobra aunque se cancele antes de la primera cuota.
      const com = comision.c && !comision.comoGasto && !comision.mensual && !lista.length && desde === 1 ? comision.c : 0;
      lista.push({
        k: (lista[lista.length - 1]?.k || desde - 1) + 1, n, fecha: q.canceladaEl, periodo: periodoDe(q.canceladaEl), capital, interes: 0, comision: com, c: capital + com, intra, cancelacion: true,
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
// Con la `apertura` del año (los años anteriores no están cargados), la tarjeta empieza con lo que
// debía al cierre del año anterior: `saldoFecha` pasa a ser ese cierre e `inicial`, esa deuda.
// `previos`: ids de los registros de años anteriores que trae la apertura; lo que hicieron hasta
// el cierre ya está contado en ella.
export function prepararTarjetas(doc, { hoy = '', tasaReferencia = 0, apertura = null, previos = null } = {}) {
  const tarjetas = new Map();
  const inicio = doc.config?.inicio ? `${doc.config.inicio}-01` : '';
  const movimientos = (doc.movimientos || []).filter(vivo);
  const esPrevio = (m) => !!previos?.has(m.id);
  for (const cuenta of doc.cuentas || []) {
    if (!vivo(cuenta) || !esTarjeta(cuenta)) continue;
    const t = cuenta.tarjeta || {};
    const ap = apertura && fechaSaldoDe(cuenta) <= apertura.fecha ? apertura.tarjetas?.[cuenta.id] || null : null;
    const saldoFecha = ap ? apertura.fecha : fechaSaldoDe(cuenta);
    const inicial = ap ? { L: ap.deuda.L, USD: ap.deuda.USD } : { L: aCentavos(t.saldoInicial?.L), USD: aCentavos(t.saldoInicial?.USD) };
    const propios = movimientos.filter((m) => m.cuentaId === cuenta.id);
    const pagos = movimientos.filter((m) => m.tipo === 'pago_tarjeta' && m.cuentaDestinoId === cuenta.id).sort(porFecha);

    const cuotas = new Map();
    for (const m of propios) if (m.tipo === 'gasto' && m.cuotas) cuotas.set(m.id, cuotasDeCompra(cuenta, m));
    const desdeCargos = [sumarDias(saldoFecha, 1), inicio].filter(Boolean).sort().pop();
    const cargos = hoy ? cargosDeTarjeta(cuenta, desdeCargos, hoy) : [];

    const conTasa = pagos.filter((p) => !esPrevio(p) && aCentavos(p.pagoUSD) > 0 && Number(p.tasa) > 0 && posteriorAlSaldo(cuenta, p.fecha, p.creado));
    const ultimaTasa = conTasa.length ? Number(conTasa[conTasa.length - 1].tasa) : Number(ap?.ultimaTasa) || Number(tasaReferencia) || 0;
    const cargosUSD = [];
    if (!ap && aCentavos(t.saldoInicial?.USD) > 0) cargosUSD.push({ clave: `inicial:${cuenta.id}`, fecha: saldoFecha, usd: aCentavos(t.saldoInicial.USD) });
    for (const m of propios) {
      const cargo = (m.tipo === 'gasto' && !m.cuotas) || m.tipo === 'transferencia';
      if (cargo && !esPrevio(m) && m.moneda === 'USD' && posteriorAlSaldo(cuenta, m.fecha, m.creado)) cargosUSD.push({ clave: m.id, fecha: m.fecha, usd: aCentavos(m.monto) });
    }
    for (const c of cargos) if (c.moneda === 'USD') cargosUSD.push({ clave: c.clave, fecha: c.fecha, usd: c.c });
    const pagosUSD = conTasa.map((p) => ({ fecha: p.fecha, usd: aCentavos(p.pagoUSD), tasa: Number(p.tasa) }));
    const semilla = ap ? { pendientes: ap.pendientesUSD || [], aFavor: ap.aFavorUSD || [] } : null;
    const tasas = asignarTasas(cargosUSD, pagosUSD, ultimaTasa, semilla);

    // `dolares`: con qué se asignaron las tasas, para saber cómo quedan al cierre de un año (cierres.js).
    const dolares = { cargos: cargosUSD, pagos: pagosUSD, semilla, ultimaTasa: ap ? Number(ap.ultimaTasa) || null : null };
    tarjetas.set(cuenta.id, { cuenta, saldoFecha, inicial, cuotas, cargos, ultimaTasa, tasas, dolares });
  }
  return tarjetas;
}

// Estado de cuenta de un corte: saldo al corte, lo pagado después del corte (hasta el corte
// siguiente, aunque sea tarde), lo que falta o queda a favor y cómo va: 'abierto' (el corte no
// llega), 'pagado', 'parcial', 'pendiente' o 'vencido'. Montos en lempiras y en dólares por separado.
// Listas: `compras` (compras, cuotas, cargos y créditos del ciclo), `pagos` (los de este corte)
// y `despues` (lo cargado después del corte, hasta hoy).
// Deuda con la que empieza la tarjeta en los datos cargados, en centavos de cada moneda.
const inicialDe = (ix, cuenta) => ix.tarjetas.get(cuenta.id)?.inicial || { L: aCentavos(cuenta.tarjeta?.saldoInicial?.L), USD: aCentavos(cuenta.tarjeta?.saldoInicial?.USD) };

export function estadoCiclo(ix, cuenta, corte) {
  const info = ix.tarjetas.get(cuenta.id);
  const eventos = ix.eventosTarjeta.get(cuenta.id) || [];
  const inicio = inicioCiclo(cuenta, corte);
  const limite = limiteDe(cuenta, corte);
  const siguiente = corteSiguiente(cuenta, corte);
  const alCorte = { ...inicialDe(ix, cuenta) };
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

// Límite de la tarjeta: el banco da uno solo y lo muestra en las dos monedas. El de lempiras sale
// del de dólares con la tasa del día en que se dio, y no cambia; esa tasa (lempiras ÷ dólares) solo
// sirve para el límite. { L, USD, tasa } en unidades (null lo que no hay); null sin límite.
export function limiteDeTarjeta(cuenta) {
  const L = Number(cuenta?.tarjeta?.limite?.L) || 0;
  const USD = Number(cuenta?.tarjeta?.limite?.USD) || 0;
  if (!(L > 0) && !(USD > 0)) return null;
  return { L: L > 0 ? L : null, USD: USD > 0 ? USD : null, tasa: L > 0 && USD > 0 ? L / USD : null };
}

// Lo disponible: el límite menos lo que se debe y el capital de las cuotas por cobrar de un
// intrafinanciamiento (`uso`, centavos por moneda). Lo que se debe en una moneda ocupa el mismo
// límite en la otra, con la tasa del límite. Si el límite está en una sola moneda, lo de la otra se
// pasa con `tasaRespaldo` (la última tasa de pago o la de referencia; sin tasa, no se cuenta).
export function disponibleDe(limite, uso, tasaRespaldo = 0) {
  if (!limite) return { disponible: { L: null, USD: null }, usoPct: null };
  const pct = (usado, total) => Math.max(0, Math.min(100, Math.round((usado / total) * 100)));
  if (limite.L !== null) {
    const tasa = limite.tasa || tasaRespaldo;
    const usadoL = uso.L + (tasa ? Math.round(uso.USD * tasa) : 0);
    const libreL = aCentavos(limite.L) - usadoL;
    return {
      disponible: { L: deCentavos(libreL), USD: limite.tasa ? deCentavos(Math.round(libreL / limite.tasa)) : null },
      usoPct: pct(usadoL, aCentavos(limite.L)),
    };
  }
  const usadoUSD = uso.USD + (tasaRespaldo ? Math.round(uso.L / tasaRespaldo) : 0);
  return { disponible: { L: null, USD: deCentavos(aCentavos(limite.USD) - usadoUSD) }, usoPct: pct(usadoUSD, aCentavos(limite.USD)) };
}

// Resumen de una tarjeta hoy: deuda, disponible y el estado del último corte. El capital de las
// cuotas que faltan de un intrafinanciamiento baja el disponible (`porCobrar`); el de un
// extrafinanciamiento está fuera del límite (`extraPorCobrar`).
export function resumenTarjeta(ix, cuenta) {
  const info = ix.tarjetas.get(cuenta.id);
  const eventos = ix.eventosTarjeta.get(cuenta.id) || [];
  const deuda = { ...inicialDe(ix, cuenta) };
  const porCobrar = monedas();
  const extraPorCobrar = monedas();
  for (const e of eventos) {
    if (!ix.hoy || e.fecha <= ix.hoy) deuda[e.moneda] += e.delta;
    else if (e.tipo === 'cuota') (e.intra ? porCobrar : extraPorCobrar)[e.moneda] += e.capital ?? e.delta;
  }
  const tasa = info?.ultimaTasa || Number(ix.config.tasaReferencia) || 0;
  const limite = limiteDeTarjeta(cuenta);
  const { disponible, usoPct } = disponibleDe(limite, { L: deuda.L + porCobrar.L, USD: deuda.USD + porCobrar.USD }, tasa);
  const corteAbierto = corteDe(cuenta, ix.hoy || info?.saldoFecha || fechaSaldoDe(cuenta));
  return {
    deuda: enUnidades(deuda), deudaEnL: deCentavos(deuda.L + Math.round(deuda.USD * tasa)), tasa,
    porCobrar: enUnidades(porCobrar), extraPorCobrar: enUnidades(extraPorCobrar), limite, disponible, usoPct,
    corteAbierto, abierto: estadoCiclo(ix, cuenta, corteAbierto), ultimo: estadoCiclo(ix, cuenta, corteAnterior(cuenta, corteAbierto)),
  };
}

// Lo que se debe en las tarjetas al final de `fecha`, en centavos de lempira: el saldo en cada
// moneda (los dólares, con la última tasa) y el capital de las cuotas que faltan de las compras
// hechas hasta esa fecha. Antes del saldo con que empezó una tarjeta, no se cuenta.
export function deudaTarjetasAl(ix, fecha, filtro) {
  let total = 0;
  for (const { cuenta, saldoFecha, ultimaTasa, inicial } of ix.tarjetas.values()) {
    if (!coincidePersona(cuenta.titularId || null, filtro) || fecha < saldoFecha) continue;
    const deuda = { ...inicial };
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
  for (const { cuenta, saldoFecha } of ix.tarjetas.values()) {
    if (!coincidePersona(cuenta.titularId || null, filtro)) continue;
    for (let corte = corteDe(cuenta, sumarDias(desde, -62)); limiteDe(cuenta, corte) <= hasta; corte = corteSiguiente(cuenta, corte)) {
      const limite = limiteDe(cuenta, corte);
      if (limite < desde || corte < saldoFecha) continue;
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

// ---------------------------------------------------------------- Financiamientos

// Estado de cada financiamiento de las tarjetas (intrafinanciamientos y extrafinanciamientos), en
// lempiras. Es lo que se ve en la pantalla Financiamientos y en el estado de cuenta de cada tarjeta.
// `situacion`: 'por-empezar' (ninguna cuota cobrada todavía), 'en-curso', 'cancelado' o 'terminado'.
export function financiamientos(ix, { hoy = ix.hoy, cuentaId = null } = {}) {
  const out = [];
  for (const info of ix.tarjetas.values()) {
    if (cuentaId && info.cuenta.id !== cuentaId) continue;
    for (const [id, lista] of info.cuotas) {
      const m = ix.movimientos.get(id);
      if (!m || !lista.length) continue;
      const q = m.cuotas || {};
      const desde = desdeCuotaDe(q);
      const cobradas = lista.filter((x) => x.fecha <= hoy);
      const faltan = lista.filter((x) => x.fecha > hoy);
      const cancelado = lista.some((x) => x.cancelacion && x.fecha <= hoy);
      const total = aCentavos(m.monto);
      const comision = comisionDeCuotas(q, total);
      const suma = (xs, campo) => xs.reduce((a, x) => a + x[campo], 0);
      out.push({
        id,
        movimiento: m,
        cuenta: info.cuenta,
        tipo: q.tipo === 'extra' ? 'extra' : 'intra',
        nombre: m.nota || ix.comercios.get(m.comercioId)?.nombre || ix.categorias.get(m.categoriaId)?.nombre || 'Financiamiento',
        fecha: m.fecha,
        total: deCentavos(total),
        n: lista[0].n,
        desde, // 1 si empezó en la app; mayor si ya venía empezado
        // La cuota que sigue y cuántas quedan. `k` es el número real, no la posición en la lista.
        siguiente: faltan[0] || null,
        cuotaActual: faltan[0]?.k || null,
        cobradas: cobradas.length,
        registradas: lista.length, // las que la app registra (las de antes de `desde` no cuentan)
        faltan: faltan.length,
        cancelado,
        // Uno que ya venía empezado (desde > 1) está en curso aunque la app no le haya visto
        // cobrar ninguna cuota todavía.
        situacion: cancelado ? 'cancelado' : !faltan.length ? 'terminado' : cobradas.length || desde > 1 ? 'en-curso' : 'por-empezar',
        cuotaMonto: deCentavos((faltan[0] || lista[lista.length - 1]).c),
        capitalPendiente: deCentavos(suma(faltan, 'capital')),
        capitalPagado: deCentavos(suma(cobradas, 'capital')),
        interesPendiente: deCentavos(suma(faltan, 'interes')),
        interesPagado: deCentavos(suma(cobradas, 'interes')),
        pendiente: deCentavos(suma(faltan, 'c')),
        // La comisión, esté en la cuota o registrada como gasto del mes.
        comision: deCentavos(comision.c),
        comisionComoGasto: comision.comoGasto,
        comisionMensual: comision.mensual,
        termina: lista[lista.length - 1].periodo,
        cuotas: lista,
      });
    }
  }
  // Primero lo que sigue vivo, y dentro de eso lo que se cobra antes.
  const orden = { 'por-empezar': 0, 'en-curso': 0, cancelado: 1, terminado: 2 };
  return out.sort((a, b) => orden[a.situacion] - orden[b.situacion]
    || (a.siguiente?.fecha || a.termina).localeCompare(b.siguiente?.fecha || b.termina)
    || a.nombre.localeCompare(b.nombre));
}

// Según la fecha del financiamiento y el corte de la tarjeta, qué cuota sería la siguiente hoy.
// Sirve para avisar cuando el número de cuota que se escribió no cuadra con las fechas: si alguien
// dice que va por la 8 pero la 7 todavía no se ha cobrado, algo está mal en la fecha o en el número.
export function cuotaSiguienteHoy(cuenta, m, hoy) {
  const completo = cuotasDeCompra(cuenta, { ...m, cuotas: { ...(m.cuotas || {}), desdeCuota: 1, canceladaEl: null } });
  return completo.find((x) => x.fecha > hoy)?.k || null; // null = ya pasaron todas
}

// Lo que las tarjetas tienen comprometido en cuotas que aún no se cobran, por tipo.
export function comprometidoEnCuotas(ix, opciones = {}) {
  const t = { intra: 0, extra: 0, total: 0, vigentes: 0 };
  for (const f of financiamientos(ix, opciones)) {
    if (f.situacion === 'terminado' || f.situacion === 'cancelado') continue;
    t[f.tipo] += f.pendiente;
    t.total += f.pendiente;
    t.vigentes += 1;
  }
  return { intra: redondear(t.intra), extra: redondear(t.extra), total: redondear(t.total), vigentes: t.vigentes };
}
