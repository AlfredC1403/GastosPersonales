import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asignarTasas } from '../js/core/divisas.js';
import { corteDe, limiteDe, cuotasDeCompra, estadoCiclo, resumenTarjeta, comisionInmediata, financiamientos, comprometidoEnCuotas, cuotaSiguienteHoy } from '../js/core/tarjetas.js';
import { crearIndice } from '../js/core/asientos.js';
import { gastoDelMes, saldosCuentas, resumenMes } from '../js/core/reportes.js';
import { tramosDePago } from '../js/core/quincena.js';
import { calcularAvisos } from '../js/core/avisos.js';
import { docVacio } from '../js/core/modelo.js';

const T = (fecha) => `${fecha}T12:00:00Z`;
const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const visa = (datos = {}) => ({
  id: 'visa', nombre: 'Visa', tipo: 'tarjeta', moneda: 'L', titularId: 'moises', saldoInicial: 0, creado: T('2026-08-01'),
  tarjeta: {
    banco: 'BAC', ultimos4: '1234', diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', limite: { L: 50000, USD: 2000 },
    saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-08-31', saldoRegistrado: T('2026-08-31'),
    cargos: [{ id: 'membresia', nombre: 'Membresía', tipo: 'membresia', monto: 1200, moneda: 'L', periodicidad: 'anual', meses: [10] }],
    ...datos,
  },
});
const compra = (id, fecha, monto, extra = {}) => ({ id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), cuentaId: 'visa', moneda: 'L', monto, categoriaId: 'otros', creado: T(fecha), ...extra });
const pago = (id, fecha, pagoL, pagoUSD, tasa, extra = {}) => ({
  id, tipo: 'pago_tarjeta', fecha, periodo: fecha.slice(0, 7), cuentaId: 'gastos', cuentaDestinoId: 'visa', pagoL, pagoUSD, tasa, personaId: 'moises', creado: T(fecha), ...extra,
});

function indice(movimientos, hoy, extra = {}) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ruth', nombre: 'Ruth' }];
  doc.cuentas = [...doc.cuentas, extra.tarjeta || visa()];
  doc.movimientos = movimientos;
  Object.assign(doc, extra.doc || {});
  return crearIndice(doc, { hoy });
}
const tarjetaDe = (ix) => ix.cuentas.get('visa');

test('corte y fecha límite: día 31, febrero bisiesto y la compra del día del corte', () => {
  const t31 = visa({ diaCorte: 31, diaPago: 15 });
  assert.equal(corteDe(t31, '2026-02-10'), '2026-02-28');
  assert.equal(corteDe(t31, '2028-02-29'), '2028-02-29');
  assert.equal(corteDe(t31, '2026-03-01'), '2026-03-31');
  assert.equal(limiteDe(t31, '2026-02-28'), '2026-03-15');
  const t = visa();
  assert.equal(corteDe(t, '2026-09-20'), '2026-09-20'); // el día del corte entra en ese ciclo
  assert.equal(corteDe(t, '2026-09-21'), '2026-10-20');
  assert.equal(limiteDe(t, '2026-09-20'), '2026-10-10');
  assert.equal(limiteDe(visa({ diaCorte: 5, diaPago: 25 }), '2026-09-05'), '2026-09-25');
});

test('US$100 pagados en dos partes (60 a 24.50 y 40 a 24.90) cuestan L2,466.00', () => {
  const tasas = asignarTasas([{ clave: 'a', fecha: '2026-09-10', usd: 10000 }], [
    { fecha: '2026-10-05', usd: 6000, tasa: 24.5 },
    { fecha: '2026-10-20', usd: 4000, tasa: 24.9 },
  ], 25);
  assert.deepEqual(tasas.get('a'), { c: 246600, estimado: false, pendienteUSD: 0 });

  // Con los registros: mientras falta un pago, la parte sin pagar usa la última tasa (estimado).
  const movs = [compra('usd', '2026-09-10', 100, { moneda: 'USD', personaId: 'ruth' }), pago('p1', '2026-10-05', 0, 60, 24.5)];
  let ix = indice(movs, '2026-10-12');
  let g = gastoDelMes(ix, '2026-09');
  assert.equal(g.total, 2450);
  assert.equal(g.estimado, true);
  ix = indice([...movs, pago('p2', '2026-10-20', 0, 40, 24.9)], '2026-10-25');
  g = gastoDelMes(ix, '2026-09');
  assert.equal(g.total, 2466);
  assert.equal(g.estimado, false);
  // La salida de dinero cuenta en la fecha de cada pago: 60 × 24.50 y 40 × 24.90.
  assert.equal(saldosCuentas(ix, '2026-10-06').gastos, -1470);
  assert.equal(saldosCuentas(ix).gastos, -2466);
});

test('estado del corte: parcial antes de la fecha límite y vencido después', () => {
  const movs = [compra('usd', '2026-09-10', 100, { moneda: 'USD' }), compra('l', '2026-09-12', 800), pago('p1', '2026-10-05', 800, 60, 24.5)];
  let e = estadoCiclo(indice(movs, '2026-10-08'), tarjetaDe(indice(movs, '2026-10-08')), '2026-09-20');
  assert.deepEqual([e.situacion, e.alCorte.USD, e.alCorte.L, e.pagadoAlLimite.USD, e.pendiente.USD, e.pendiente.L], ['parcial', 100, 800, 60, 40, 0]);
  assert.equal(e.limite, '2026-10-10');
  assert.equal(e.compras.length, 2);
  const ix = indice(movs, '2026-10-12');
  e = estadoCiclo(ix, tarjetaDe(ix), '2026-09-20');
  assert.equal(e.situacion, 'vencido');
  assert.equal(estadoCiclo(ix, tarjetaDe(ix), '2026-10-20').situacion, 'abierto');
  // Pagado tarde, antes del corte siguiente: queda pagado (y marcado como tarde) y ya no avisa.
  const tarde = indice([...movs, pago('p2', '2026-10-13', 0, 40, 24.9)], '2026-10-14');
  e = estadoCiclo(tarde, tarjetaDe(tarde), '2026-09-20');
  assert.deepEqual([e.situacion, e.tarde, e.pagado.USD, e.pagadoAlLimite.USD, new Set(e.pagos.map((x) => x.origen)).size], ['pagado', true, 100, 60, 2]);
  assert.equal(e.pagadoEnL, 800 + 60 * 24.5 + 40 * 24.9); // cada dólar a la tasa de su pago
  assert.ok(!calcularAvisos(tarde, { hoy: '2026-10-14' }).some((a) => a.id.startsWith('tarjeta-')));
  // Un pago con fecha futura todavía no cuenta.
  const antes = indice([...movs, pago('p2', '2026-10-13', 0, 40, 24.9)], '2026-10-08');
  assert.deepEqual([estadoCiclo(antes, tarjetaDe(antes), '2026-09-20').situacion, estadoCiclo(antes, tarjetaDe(antes), '2026-09-20').pendiente.USD], ['parcial', 40]);
  // Los pagos del 5 y el 13 de octubre son del corte de septiembre, no del de octubre.
  const oct = estadoCiclo(tarde, tarjetaDe(tarde), '2026-10-20');
  assert.deepEqual([oct.compras.length, oct.pagos.length], [0, 0]);
});

test('lo pagado de más queda a favor y baja el corte siguiente', () => {
  const movs = [compra('a', '2026-09-05', 1000), pago('p', '2026-09-25', 1200, 0, 0), compra('b', '2026-10-01', 500)];
  const ix = indice(movs, '2026-10-25');
  const sep = estadoCiclo(ix, tarjetaDe(ix), '2026-09-20');
  assert.deepEqual([sep.situacion, sep.pendiente.L, sep.aFavor.L], ['pagado', 0, 200]);
  assert.equal(estadoCiclo(ix, tarjetaDe(ix), '2026-10-20').alCorte.L, 500 + 1200 - 200); // compra, membresía de octubre y lo que quedó a favor
});

test('compra a cuotas a tasa cero que cruza de año, con el residuo en la última', () => {
  const movs = [compra('tv', '2026-11-10', 10000, { cuotas: { n: 3, tipo: 'intra' } })];
  const cuotas = cuotasDeCompra(visa(), movs[0]);
  assert.deepEqual(cuotas.map((q) => [q.fecha, q.c]), [['2026-11-20', 333333], ['2026-12-20', 333333], ['2027-01-20', 333334]]);
  const ix = indice(movs, '2026-11-25', { tarjeta: visa({ cargos: [] }) });
  assert.deepEqual(['2026-11', '2026-12', '2027-01'].map((p) => gastoDelMes(ix, p).total), [3333.33, 3333.33, 3333.34]);
  const r = resumenTarjeta(ix, tarjetaDe(ix));
  assert.equal(r.deuda.L, 3333.33);
  assert.equal(r.porCobrar.L, 6666.67);
  assert.equal(r.disponible.L, 40000); // la compra a tasa cero ocupa el límite completo
});

test('cuota nivelada con tasa: el interés sale del saldo de cada mes; el extrafinanciamiento no usa el límite', () => {
  const moto = compra('moto', '2026-09-10', 12000, { cuotas: { n: 12, tipo: 'extra', tasaAnual: 24 }, categoriaId: 'transporte' });
  const cuotas = cuotasDeCompra(visa(), moto);
  // 2 % al mes: cuota de L1,134.72 (1,134.7155 redondeado); en la primera, L240.00 de interés; en la segunda, 2 % de L11,105.28.
  assert.deepEqual([cuotas[0].c, cuotas[0].interes, cuotas[0].capital], [113472, 24000, 89472]);
  assert.deepEqual([cuotas[1].c, cuotas[1].interes, cuotas[1].capital], [113472, 22211, 91261]);
  assert.equal(cuotas.reduce((a, q) => a + q.capital, 0), 1200000);
  assert.ok(cuotas.slice(0, -1).every((q) => q.c === 113472 && !q.intra));

  const ix = indice([moto], '2026-10-25');
  const oct = gastoDelMes(ix, '2026-10');
  assert.equal(oct.porCategoria.transporte, 912.61);
  assert.equal(oct.porCategoria['cargos-tarjeta'], 1422.11); // L222.11 de interés de la cuota y L1,200 de la membresía anual de octubre
  const r = resumenTarjeta(ix, tarjetaDe(ix));
  assert.equal(r.deuda.L, 3469.44);
  assert.equal(r.disponible.L, 46530.56);
  assert.equal(r.extraPorCobrar.L, 10192.67);
  assert.equal(r.porCobrar.L, 0);

  // Cancelada después de dos cuotas: ese día se cobra el capital que faltaba según la tabla.
  const cancelada = cuotasDeCompra(visa(), { ...moto, cuotas: { ...moto.cuotas, canceladaEl: '2026-11-01' } });
  assert.deepEqual(cancelada.map((q) => [q.fecha, q.c, !!q.cancelacion]), [['2026-09-20', 113472, false], ['2026-10-20', 113472, false], ['2026-11-01', 1019267, true]]);
});

test('con la cuota del banco se deduce la tasa; sin intereses, una cancelación cobra lo que falta', () => {
  const cuotas = cuotasDeCompra(visa(), compra('moto', '2026-09-10', 12000, { cuotas: { n: 12, tipo: 'extra', cuotaBanco: 1100 } }));
  assert.ok(cuotas.slice(0, -1).every((q) => q.c === 110000));
  assert.equal(cuotas.reduce((a, q) => a + q.capital, 0), 1200000);
  assert.ok(cuotas[0].interes > cuotas[1].interes && cuotas[1].capital > cuotas[0].capital);
  assert.ok(Math.abs(cuotas[11].c - 110000) <= 100);

  const cancelada = cuotasDeCompra(visa(), compra('x', '2026-09-10', 6000, { cuotas: { n: 6, tipo: 'intra', canceladaEl: '2026-11-01' } }));
  assert.deepEqual(cancelada.map((q) => [q.fecha, q.c, !!q.cancelacion]), [['2026-09-20', 100000, false], ['2026-10-20', 100000, false], ['2026-11-01', 400000, true]]);
});

test('intrafinanciamiento a tasa cero con comisión: la compra usa el límite y la comisión es cargo de tarjeta', () => {
  const tv = compra('tv', '2026-09-12', 12000, { cuotas: { n: 12, tipo: 'intra', comision: { valor: 3, unidad: 'porcentaje', cobro: 'unica' } } });
  const cuotas = cuotasDeCompra(visa(), tv);
  assert.deepEqual([cuotas[0].c, cuotas[0].comision, cuotas[1].c], [136000, 36000, 100000]);
  assert.equal(cuotas.reduce((a, q) => a + q.comision + q.interes, 0), 36000);

  const ix = indice([tv], '2026-09-25');
  const sep = gastoDelMes(ix, '2026-09');
  assert.deepEqual([sep.porCategoria.otros, sep.porCategoria['cargos-tarjeta']], [1000, 360]);
  const r = resumenTarjeta(ix, tarjetaDe(ix));
  assert.deepEqual([r.deuda.L, r.porCobrar.L, r.disponible.L, r.extraPorCobrar.L], [1360, 11000, 50000 - 1360 - 11000, 0]);

  // Comisión fija en cada cuota.
  const mensual = cuotasDeCompra(visa(), compra('cel', '2026-09-12', 6000, { cuotas: { n: 6, comision: { valor: 25, unidad: 'monto', cobro: 'mensual' } } }));
  assert.ok(mensual.every((q) => q.c === 102500 && q.comision === 2500));
});

test('el límite es uno solo en las dos monedas: lo que se debe en una ocupa también el de la otra', () => {
  // Límite de US$2,000 dado cuando la tasa era 26.50: L53,000.
  const tarjeta = visa({ limite: { L: 53000, USD: 2000 }, cargos: [] });
  const movs = [compra('super', '2026-09-05', 10000), compra('hotel', '2026-09-06', 100, { moneda: 'USD' })];
  let r = resumenTarjeta(indice(movs, '2026-09-10', { tarjeta }), tarjeta);
  assert.equal(r.limite.tasa, 26.5);
  // Ocupan L10,000 + US$100 × 26.50 = L12,650: quedan L40,350, que son US$1,522.64.
  assert.deepEqual([r.disponible, r.usoPct], [{ L: 40350, USD: 1522.64 }, 24]);
  // La tasa del límite no cambia con la de los pagos.
  r = resumenTarjeta(indice([...movs, pago('p', '2026-09-08', 0, 50, 27.1)], '2026-09-10', { tarjeta }), tarjeta);
  assert.deepEqual(r.disponible, { L: 40350 + 50 * 26.5, USD: 1572.64 });

  // Con el límite solo en lempiras, los dólares se pasan con la tasa de referencia (o la última de pago).
  const soloL = visa({ limite: { L: 50000, USD: null }, cargos: [] });
  const config = { ...docVacio().config, inicio: '2026-09', tasaReferencia: 25 };
  r = resumenTarjeta(indice(movs, '2026-09-10', { tarjeta: soloL, doc: { config } }), soloL);
  assert.deepEqual([r.limite.tasa, r.disponible], [null, { L: 50000 - 10000 - 2500, USD: null }]);
});

test('la membresía anual se cobra en el corte de su mes', () => {
  assert.equal(gastoDelMes(indice([], '2026-10-15'), '2026-10').total, 0);
  const ix = indice([], '2026-10-25');
  assert.equal(gastoDelMes(ix, '2026-10').porCategoria['cargos-tarjeta'], 1200);
  assert.equal(resumenTarjeta(ix, tarjetaDe(ix)).deuda.L, 1200);
});

test('compra de Ruth en la tarjeta de Moises: con el filtro de Ruth sale el gasto, pero no el pago', () => {
  const movs = [compra('r', '2026-09-10', 900, { personaId: 'ruth' }), pago('p', '2026-10-01', 900, 0, 0)];
  const ix = indice(movs, '2026-10-05');
  assert.equal(gastoDelMes(ix, '2026-09', { personaId: 'ruth' }).total, 900);
  assert.equal(gastoDelMes(ix, '2026-09', { personaId: 'moises' }).total, 0);
  const pagoAsientos = ix.asientos.filter((a) => a.origen === 'p');
  assert.ok(pagoAsientos.every((a) => a.personaId === 'moises' && a.clase !== 'gasto'));
  assert.equal(resumenMes(ix, '2026-10', { personaId: 'ruth' }).gastoReal, 0);
  assert.equal(estadoCiclo(ix, tarjetaDe(ix), '2026-09-20').situacion, 'pagado');
});

test('en el plan por quincena, la compra con tarjeta no sale de caja; el pago de la tarjeta sale en su fecha límite', () => {
  const salario = { id: 'sal', nombre: 'Salario', personaId: 'moises', frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'igual', cuentaId: 'gastos', netoEsperado: 20000, activo: true, deducciones: [] };
  const gasolina = { id: 'gasolina', nombre: 'Gasolina', tipo: 'gasto', forma: 'abonos', monto: 3000, meses: [], categoriaId: 'transporte', medioPagoId: 'visa', activo: true, creado: T('2026-08-01') };
  const movs = [compra('g', '2026-09-18', 1500, { partidaId: 'gasolina' }), compra('ropa', '2026-09-19', 700)];
  const ix = indice(movs, '2026-09-25', { doc: { ingresos: [salario], partidas: [gasolina] } });
  const [, del15, del30] = tramosDePago(ix, '2026-09');
  assert.ok(!del15.items.some((x) => x.it.clave === 'gasolina:principal'));
  assert.equal(del15.fueraDelPlan, 0); // la ropa fue con tarjeta
  const pagoVisa = del30.items.find((x) => x.it.tipoItem === 'tarjeta');
  assert.deepEqual([pagoVisa.it.limite, pagoVisa.esperado / 100, pagoVisa.it.estado], ['2026-10-10', 2200, 'pendiente']);
});

test('avisos de la tarjeta: vence pronto, vencida y cargo anual del mes siguiente', () => {
  const movs = [compra('a', '2026-09-10', 800), pago('p', '2026-10-05', 300, 0, 0)];
  let avisos = calcularAvisos(indice(movs, '2026-10-08'), { hoy: '2026-10-08' });
  assert.equal(avisos.find((a) => a.id === 'tarjeta-vence:visa:2026-09-20').texto, 'Quedan L500.00.');
  avisos = calcularAvisos(indice(movs, '2026-10-12'), { hoy: '2026-10-12' });
  assert.equal(avisos.find((a) => a.id === 'tarjeta-vencida:visa:2026-09-20').cuando, 'hoy');
  avisos = calcularAvisos(indice([], '2026-09-15'), { hoy: '2026-09-15' });
  assert.ok(avisos.some((a) => a.id === 'cargo:visa:membresia:2026-10-20'));
});

// ---------------------------------------------------------------- Tasa del dólar

test('avisa de la tasa del mes solo cuando el hogar tiene algo en dólares', () => {
  const hoy = '2026-09-13';
  const base = (config, tasas = []) => {
    const doc = docVacio();
    doc.config = { ...doc.config, inicio: '2026-01', ...config };
    doc.tasas = tasas;
    return doc;
  };
  const avisosDe = (doc) => calcularAvisos(crearIndice(doc, { hoy }), { hoy }).filter((a) => a.id.startsWith('tasa-'));
  const tasa = (periodo, valor) => ({ id: `tasa-${periodo}`, periodo, valor, actualizado: 't' });

  // Sin nada en dólares no se dice nada, por vieja que esté la tasa.
  assert.deepEqual(avisosDe(base({}, [tasa('2020-01', 24)])), []);

  // Con una cuenta en dólares sí.
  const conUSD = (config, tasas) => {
    const doc = base(config, tasas);
    doc.cuentas.push({ id: 'ahorroUSD', nombre: 'Ahorro US$', tipo: 'ahorro', moneda: 'USD', saldoInicial: 100, actualizado: 't' });
    return doc;
  };
  assert.deepEqual(avisosDe(conUSD({}, [tasa('2020-01', 24)])).map((a) => a.id), ['tasa-vieja:2026-09']);
  // Si no hay ninguna tasa, el aviso es otro.
  assert.deepEqual(avisosDe(conUSD({ tasaReferencia: null })).map((a) => a.id), ['tasa-falta:2026-09']);
  // La de este mes: nada que avisar.
  assert.deepEqual(avisosDe(conUSD({}, [tasa('2026-08', 24), tasa('2026-09', 25)])), []);
  // La del mes pasado ya pide la de este.
  const delMesPasado = avisosDe(conUSD({}, [tasa('2026-08', 24)]));
  assert.deepEqual(delMesPasado.map((a) => a.id), ['tasa-vieja:2026-09']);
  assert.match(delMesPasado[0].texto, /La última anotada es 24, de agosto 2026/);

  // Un archivo que todavía trae la tasa suelta de la versión anterior se lee igual: cuenta como
  // la tasa del mes en que se anotó.
  assert.deepEqual(avisosDe(conUSD({ tasaReferencia: 24, tasaReferenciaDesde: '2026-09-01' })), []);
  assert.deepEqual(avisosDe(conUSD({ tasaReferencia: 24, tasaReferenciaDesde: '2026-07-01' })).map((a) => a.id), ['tasa-vieja:2026-09']);
  // Sin fecha, la tasa suelta se ancla al mes de inicio del hogar.
  assert.deepEqual(avisosDe(conUSD({ tasaReferencia: 24, tasaReferenciaDesde: '' })).map((a) => a.id), ['tasa-vieja:2026-09']);
});

// ---------------------------------------------------------------- Financiamientos

const financiamiento = (id, fecha, monto, cuotas) => compra(id, fecha, monto, { cuotas: { n: 6, tipo: 'intra', tasaAnual: 0, cuotaBanco: null, primerCorte: null, canceladaEl: null, comision: { valor: 0, unidad: 'porcentaje', cobro: 'unica' }, ...cuotas } });

test('la comisión marcada como gasto del mes sale de las cuotas y cae en la fecha del financiamiento', () => {
  const q = { comision: { valor: 2, unidad: 'porcentaje', cobro: 'unica' } };
  const t = visa();
  // Sin marcar: los L240 de comisión viajan en la primera cuota, como hasta ahora.
  const dentro = cuotasDeCompra(t, { monto: 12000, fecha: '2026-09-08', cuotas: { n: 6, ...q } });
  assert.deepEqual([dentro[0].comision, dentro[1].comision], [24000, 0]);
  assert.equal(comisionInmediata(t, { monto: 12000, fecha: '2026-09-08', cuotas: { n: 6, ...q } }), null);

  // Marcada: ninguna cuota la lleva, y se cobra el día de la compra.
  const conGasto = { n: 6, comision: { ...q.comision, comoGasto: true } };
  const fuera = cuotasDeCompra(t, { monto: 12000, fecha: '2026-09-08', cuotas: conGasto });
  assert.deepEqual(fuera.map((x) => x.comision), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(comisionInmediata(t, { monto: 12000, fecha: '2026-09-08', cuotas: conGasto }),
    { c: 24000, fecha: '2026-09-08', periodo: '2026-09' });
  // El capital no cambia: la comisión no es parte de lo financiado.
  assert.deepEqual(dentro.map((x) => x.capital), fuera.map((x) => x.capital));
});

test('la comisión como gasto es gasto y deuda en su mes, no en el de la primera cuota', () => {
  // Corte el 20: la compra del 8 de septiembre tiene su primera cuota el 20 de septiembre.
  const m = financiamiento('f1', '2026-09-08', 12000, { comision: { valor: 500, unidad: 'monto', cobro: 'unica', comoGasto: true } });
  const ix = indice([m], '2026-09-30');
  const cargos = (periodo) => (ix.porPeriodo.get(periodo) || []).filter((a) => a.clase === 'gasto' && a.categoriaId === 'cargos-tarjeta');
  assert.deepEqual(cargos('2026-09').map((a) => [a.nombre, a.c]), [['Comisión de financiamiento', 50000]]);
  // Y suma a la deuda de la tarjeta ese mismo día.
  const eventos = (ix.eventosTarjeta.get('visa') || []).filter((e) => e.tipo === 'comision');
  assert.deepEqual(eventos.map((e) => [e.fecha, e.delta]), [['2026-09-08', 50000]]);
});

test('un financiamiento ya empezado solo registra las cuotas que faltan', () => {
  const t = visa();
  const base = { monto: 12000, fecha: '2026-03-08', cuotas: { n: 12, tasaAnual: 24 } };
  const completo = cuotasDeCompra(t, base);
  assert.equal(completo.length, 12);

  // Vamos por la cuota 5: las cuatro primeras no se registran.
  const empezado = cuotasDeCompra(t, { ...base, cuotas: { ...base.cuotas, desdeCuota: 5 } });
  assert.equal(empezado.length, 8);
  // Conservan su número real y su fecha: la 5 sigue siendo la 5 de 12.
  assert.deepEqual([empezado[0].k, empezado[0].n, empezado[0].fecha], [5, 12, completo[4].fecha]);
  // Y su interés es el que toca en ese punto de la amortización, no el de la primera cuota.
  assert.deepEqual(empezado.map((x) => x.interes), completo.slice(4).map((x) => x.interes));
  assert.ok(empezado[0].interes < completo[0].interes, 'el interés baja conforme avanza el saldo');
  // El capital que falta es el de las cuotas que quedan.
  assert.equal(empezado.reduce((a, x) => a + x.capital, 0), completo.slice(4).reduce((a, x) => a + x.capital, 0));
});

test('en un financiamiento ya empezado la comisión única no se vuelve a cobrar', () => {
  const t = visa();
  const cuotas = { n: 12, tasaAnual: 24, desdeCuota: 5, comision: { valor: 2, unidad: 'porcentaje', cobro: 'unica' } };
  // La comisión iba en la cuota 1, que ya no se registra.
  assert.deepEqual(cuotasDeCompra(t, { monto: 12000, fecha: '2026-03-08', cuotas }).map((x) => x.comision), Array(8).fill(0));
  // Una comisión mensual sí sigue cobrándose en las que faltan.
  const mensual = cuotasDeCompra(t, { monto: 12000, fecha: '2026-03-08', cuotas: { ...cuotas, comision: { valor: 100, unidad: 'monto', cobro: 'mensual' } } });
  assert.deepEqual(mensual.map((x) => x.comision), Array(8).fill(10000));
});

test('un financiamiento ya empezado no mete en la deuda las cuotas viejas', () => {
  const m = financiamiento('f2', '2026-03-08', 12000, { n: 12, tasaAnual: 0, desdeCuota: 10 });
  const ix = indice([m], '2026-09-30');
  // Solo las cuotas 10, 11 y 12 existen, y todas caen después del saldo inicial de la tarjeta.
  const cuotas = ix.tarjetas.get('visa').cuotas.get('f2');
  assert.deepEqual(cuotas.map((x) => x.k), [10, 11, 12]);
  // Nada del financiamiento aparece antes del mes en que va la cuota 10.
  const gastos = [...ix.porPeriodo.keys()].filter((p) => (ix.porPeriodo.get(p) || []).some((a) => a.origen === 'f2')).sort();
  assert.deepEqual(gastos, ['2026-12', '2027-01', '2027-02']);
});

test('financiamientos(): estado de cada uno, en curso, por empezar y terminado', () => {
  const movs = [
    // Intra recién firmado: corte el 20, así que la primera cuota es el 20 de septiembre.
    financiamiento('nuevo', '2026-09-08', 12000, { n: 6, tasaAnual: 18 }),
    // Extra que ya venía por la cuota 8 de 12.
    financiamiento('viejo', '2026-03-08', 24000, { n: 12, tipo: 'extra', tasaAnual: 24, desdeCuota: 8 }),
    // Uno que ya terminó.
    financiamiento('listo', '2026-01-10', 6000, { n: 3, tasaAnual: 0 }),
  ];
  const ix = indice(movs, '2026-09-13');
  const porId = Object.fromEntries(financiamientos(ix).map((f) => [f.id, f]));

  assert.deepEqual([porId.nuevo.situacion, porId.nuevo.tipo, porId.nuevo.cuotaActual, porId.nuevo.faltan], ['por-empezar', 'intra', 1, 6]);
  // El que venía empezado está en curso aunque la app no le haya visto cobrar ninguna cuota.
  assert.deepEqual([porId.viejo.situacion, porId.viejo.tipo, porId.viejo.cuotaActual, porId.viejo.desde], ['en-curso', 'extra', 8, 8]);
  assert.equal(porId.viejo.faltan, 5); // cuotas 8 a 12
  assert.deepEqual([porId.listo.situacion, porId.listo.faltan, porId.listo.pendiente], ['terminado', 0, 0]);

  // El orden pone lo vivo primero, por fecha de cobro, y lo terminado al final.
  assert.deepEqual(financiamientos(ix).map((f) => f.id), ['nuevo', 'viejo', 'listo']);
  // Y el total comprometido separa intra de extra, sin contar lo terminado.
  const t = comprometidoEnCuotas(ix);
  cerca(t.total, porId.nuevo.pendiente + porId.viejo.pendiente);
  cerca(t.intra, porId.nuevo.pendiente);
  cerca(t.extra, porId.viejo.pendiente);
  assert.equal(t.vigentes, 2);
});

test('financiamientos(): se puede pedir solo los de una tarjeta', () => {
  const otra = { ...visa(), id: 'otra', nombre: 'Otra' };
  const movs = [
    financiamiento('a', '2026-09-08', 12000, { n: 6 }),
    { ...financiamiento('b', '2026-09-08', 8000, { n: 4 }), cuentaId: 'otra' },
  ];
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.cuentas = [...doc.cuentas, visa(), otra];
  doc.movimientos = movs;
  const ix = crearIndice(doc, { hoy: '2026-09-13' });
  assert.deepEqual(financiamientos(ix).map((f) => f.id).sort(), ['a', 'b']);
  assert.deepEqual(financiamientos(ix, { cuentaId: 'otra' }).map((f) => f.id), ['b']);
});

test('cuotaSiguienteHoy(): qué cuota tocaría hoy según la fecha y el corte', () => {
  const t = visa(); // corte el 20
  const m = { monto: 24000, fecha: '2026-03-08', cuotas: { n: 12, tasaAnual: 24 } };
  // Compra del 8 de marzo, corte el 20: cuota 1 el 20 de marzo, cuota 7 el 20 de septiembre.
  assert.equal(cuotaSiguienteHoy(t, m, '2026-03-01'), 1);
  assert.equal(cuotaSiguienteHoy(t, m, '2026-09-13'), 7);
  assert.equal(cuotaSiguienteHoy(t, m, '2026-09-20'), 8); // la del día ya se cobró
  // Cuando ya pasaron todas, no hay siguiente.
  assert.equal(cuotaSiguienteHoy(t, m, '2028-01-01'), null);
  // No le afecta el desdeCuota que se haya escrito: mira el plan completo.
  assert.equal(cuotaSiguienteHoy(t, { ...m, cuotas: { ...m.cuotas, desdeCuota: 9 } }, '2026-09-13'), 7);
});

// ---------------------------------------------------------------- Cuándo cae la cuota

test('unos bancos cobran la cuota en el corte y otros el mismo día del financiamiento', () => {
  const t = visa({ diaCorte: 12, diaPago: 2 });
  const base = { monto: 24000, fecha: '2025-08-30', cuotas: { n: 6, tasaAnual: 0 } };
  // Por defecto, en el corte de la tarjeta: el del 30 de agosto es el 12 de septiembre.
  assert.deepEqual(cuotasDeCompra(t, base).slice(0, 3).map((x) => x.fecha), ['2025-09-12', '2025-10-12', '2025-11-12']);
  // Por día: cae los 30, aunque el corte sea el 12.
  const porDia = cuotasDeCompra(t, { ...base, cuotas: { ...base.cuotas, cobro: 'dia' } });
  assert.deepEqual(porDia.slice(0, 3).map((x) => x.fecha), ['2025-08-30', '2025-09-30', '2025-10-30']);
  // Un financiamiento del 31 no se sale de los meses cortos.
  const fin = cuotasDeCompra(t, { monto: 12000, fecha: '2026-01-31', cuotas: { n: 4, tasaAnual: 0, cobro: 'dia' } });
  assert.deepEqual(fin.map((x) => x.fecha), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('por día, la primera cuota puede ser el mismo mes o el siguiente', () => {
  const t = visa({ diaCorte: 12 });
  const q = { n: 6, tasaAnual: 0, cobro: 'dia' };
  // Sin decir nada, empieza el día del financiamiento.
  assert.equal(cuotasDeCompra(t, { monto: 24000, fecha: '2025-08-30', cuotas: q })[0].fecha, '2025-08-30');
  // Con la fecha del mes siguiente, empieza ahí y sigue en ese día.
  const despues = cuotasDeCompra(t, { monto: 24000, fecha: '2025-08-30', cuotas: { ...q, primerCorte: '2025-09-30' } });
  assert.deepEqual(despues.slice(0, 2).map((x) => x.fecha), ['2025-09-30', '2025-10-30']);
});

test('sin intereses, la cuota que cobra el banco manda y la última absorbe el redondeo', () => {
  // El caso real de un extrafinanciamiento BAC: L25,797.97 en 18 cuotas de L1,433.20.
  const t = visa({ diaCorte: 12 });
  const m = { monto: 25797.97, fecha: '2025-08-30', cuotas: { n: 18, tipo: 'extra', tasaAnual: 0, cobro: 'dia', cuotaBanco: 1433.20 } };
  const lista = cuotasDeCompra(t, m);
  // Todas menos la última son exactamente la del estado de cuenta.
  assert.deepEqual([...new Set(lista.slice(0, -1).map((x) => x.c))], [143320]);
  // La última lleva lo que falta, y el total cuadra al centavo.
  assert.equal(lista.at(-1).c, 143357);
  assert.equal(lista.reduce((a, x) => a + x.c, 0), 2579797);
  // Sin anotar la cuota del banco, el reparto es parejo y también cuadra.
  const parejo = cuotasDeCompra(t, { ...m, cuotas: { ...m.cuotas, cuotaBanco: null } });
  assert.equal(parejo.reduce((a, x) => a + x.c, 0), 2579797);
  assert.equal(parejo[0].c, 143322);
});

test('con intereses, la cuota del banco sigue definiendo la amortización', () => {
  const t = visa({ diaCorte: 20 });
  const conTasa = cuotasDeCompra(t, { monto: 12000, fecha: '2026-09-08', cuotas: { n: 6, tasaAnual: 18, cuotaBanco: 2110 } });
  // El interés se calcula sobre el saldo y el resto de la cuota es capital.
  assert.equal(conTasa[0].c, 211000);
  assert.equal(conTasa[0].interes, Math.round(1200000 * (0.18 / 12)));
  assert.equal(conTasa.reduce((a, x) => a + x.capital, 0), 1200000);
});
