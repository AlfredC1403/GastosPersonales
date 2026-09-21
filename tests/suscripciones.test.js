import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoPartidas, presupuestoMensual, movimientoParaItem, equivalenteMensual, equivalenteMensualL, mesesDeCiclo, enPruebaGratis,
} from '../js/core/presupuesto.js';
import { estadoSuscripciones, resumenSuscripciones, proximoCobro, cicloDe } from '../js/core/suscripciones.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';
import { calcularAvisos } from '../js/core/avisos.js';

const HOY = '2026-10-15';
const TASA = 25;
const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const suscripcion = (id, datos = {}) => ({
  id, nombre: id, tipo: 'gasto', suscripcion: true, ciclo: 'mensual', forma: 'fijo', categoriaId: 'suscripciones',
  responsableId: 'moises', monto: 0, moneda: 'USD', meses: [], dia: 5, medioPagoId: 'visa', activo: true,
  creado: '2026-09-01T00:00:00Z', ...datos,
});
const gasto = (id, partidaId, fecha, monto, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', moneda: 'L', categoriaId: 'suscripciones',
  partidaId, creado: `${fecha}T12:00:00Z`, ...extra,
});

function indice(datos, { hoy = HOY, tasa = TASA } = {}) {
  const doc = { ...docVacio(), ...datos };
  doc.config = { ...doc.config, inicio: '2026-09', tasaReferencia: tasa, tasaReferenciaDesde: hoy };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }];
  doc.cuentas = [
    ...doc.cuentas,
    { id: 'dolares', nombre: 'Cuenta en dólares', tipo: 'banco', moneda: 'USD', saldoInicial: 500, titularId: 'moises' },
    {
      id: 'visa', nombre: 'Visa', tipo: 'tarjeta', moneda: 'L', titularId: 'moises', saldoInicial: 0, creado: '2026-08-01T00:00:00Z',
      tarjeta: {
        banco: 'BAC', ultimos4: '1234', diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', limite: { L: 50000, USD: 2000 },
        saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-08-31', saldoRegistrado: '2026-08-31T00:00:00Z', cargos: [],
      },
    },
    ...(datos.cuentas || []),
  ];
  return crearIndice(doc, { hoy });
}
const item = (ix, periodo, id) => estadoPartidas(ix, periodo).find((it) => it.clave === `${id}:principal`);

// ---------------------------------------------------------------- Partidas en dólares

test('una partida en dólares se ve en dólares y suma en lempiras con la tasa de referencia', () => {
  const ix = indice({ partidas: [suscripcion('netflix', { monto: 9.99 })] });
  const it = item(ix, '2026-10', 'netflix');
  assert.equal(it.moneda, 'USD');
  assert.equal(it.enMoneda.esperado, 9.99);
  cerca(it.esperado, 9.99 * TASA); // 249.75
  assert.equal(it.estimado, true);
  // Se paga con tarjeta: el registro va en dólares, con lo que cobra.
  assert.equal(it.monedaPago, 'USD');
  const m = movimientoParaItem(it, '2026-10', { hoy: HOY });
  assert.deepEqual([m.moneda, m.monto, m.partidaId], ['USD', 9.99, 'netflix']);
});

test('US$9.99 pagados a otra tasa cierran la partida: en dólares es exacto y en lempiras es lo que costó', () => {
  const partidas = [suscripcion('icloud', { monto: 9.99, medioPagoId: 'dolares' })];
  // Desde una cuenta en dólares: el pago va en dólares, con la tasa real de ese día (26, no 25).
  const pago = gasto('p1', 'icloud', '2026-10-05', 9.99, { cuentaId: 'dolares', moneda: 'USD', tasa: 26 });
  const it = item(indice({ partidas, movimientos: [pago] }), '2026-10', 'icloud');
  assert.equal(it.estado, 'completo');
  assert.equal(it.enMoneda.real, 9.99);
  assert.equal(it.enMoneda.queda, 0);
  cerca(it.real, 9.99 * 26); // lo que costó de verdad
  cerca(it.esperado, 9.99 * TASA); // el estimado con la tasa de referencia
});

test('pagada desde una cuenta en lempiras: el monto se propone y se abona con la tasa de referencia', () => {
  const partidas = [suscripcion('spotify', { monto: 10, medioPagoId: 'gastos' })];
  let it = item(indice({ partidas }), '2026-10', 'spotify');
  assert.equal(it.monedaPago, 'L');
  const m = movimientoParaItem(it, '2026-10', { hoy: HOY });
  assert.equal(m.moneda, undefined); // en lempiras no lleva moneda: la pone la cuenta
  cerca(m.monto, 250);

  it = item(indice({ partidas, movimientos: [gasto('p1', 'spotify', '2026-10-05', 250)] }), '2026-10', 'spotify');
  assert.equal(it.estado, 'completo');
  assert.equal(it.enMoneda.real, 10);
});

test('el presupuesto mensual suma las partidas en dólares en lempiras', () => {
  const ix = indice({
    partidas: [
      suscripcion('netflix', { monto: 10 }),
      suscripcion('dominio', { monto: 24, ciclo: 'anual', meses: [3], mesCobro: 3 }),
      { ...suscripcion('luz'), suscripcion: false, ciclo: null, moneda: 'L', monto: 1800, categoriaId: 'servicios' },
    ],
  });
  const p = presupuestoMensual(ix, '2026-10');
  cerca(p.egresos, 10 * 25 + (24 / 12) * 25 + 1800); // 250 + 50 + 1800
  cerca(p.suscripciones, 300); // solo las suscripciones, en lempiras
  cerca(equivalenteMensual(ix.partidas.get('dominio')), 2);
  cerca(equivalenteMensualL(ix, ix.partidas.get('dominio')), 50);
});

test('sin tasa de referencia, lo que está en dólares no se puede estimar y la app lo avisa', () => {
  const ix = indice({ partidas: [suscripcion('netflix', { monto: 9.99 })] }, { tasa: null });
  const it = item(ix, '2026-10', 'netflix');
  assert.equal(it.enMoneda.esperado, 9.99);
  assert.equal(it.esperado, 0);
  const avisos = calcularAvisos(ix, { hoy: HOY }).filter((a) => a.id.startsWith('tasa-'));
  assert.deepEqual(avisos.map((a) => a.id), ['tasa-falta:2026-10']);
});

// ---------------------------------------------------------------- Ciclos de cobro

test('el ciclo dice en qué meses cobra', () => {
  assert.deepEqual(mesesDeCiclo('mensual', 5), []); // todos
  assert.deepEqual(mesesDeCiclo('trimestral', 2), [2, 5, 8, 11]);
  assert.deepEqual(mesesDeCiclo('semestral', 3), [3, 9]);
  assert.deepEqual(mesesDeCiclo('anual', 12), [12]);
  // Una suscripción guardada sin ciclo lo recupera de sus meses.
  assert.equal(cicloDe({ meses: [4, 10] }), 'semestral');
  assert.equal(cicloDe({ meses: [] }), 'mensual');
});

test('una suscripción anual solo aparece en su mes y cuenta 1/12 al mes', () => {
  const anual = suscripcion('dominio', { monto: 120, ciclo: 'anual', mesCobro: 3, meses: [3], dia: 14 });
  const ix = indice({ partidas: [anual] });
  assert.equal(item(ix, '2026-10', 'dominio'), undefined);
  assert.equal(item(ix, '2027-03', 'dominio').enMoneda.esperado, 120);
  cerca(equivalenteMensual(anual), 10);
  assert.equal(proximoCobro(anual, HOY), '2027-03-14');
});

// Una suscripción cobra siempre lo mismo hasta que se cancele: el formulario no deja elegirle
// forma de pago ni acumular lo que sobre. Si quedó guardada así desde otra pantalla, se ignora.
test('una suscripción es de monto fijo y no acumula, aunque venga guardada de otra forma', () => {
  const rara = suscripcion('spotify', { monto: 10, forma: 'variable', acumula: true, acumulaDesde: '2026-09' });
  const ix = indice({ partidas: [rara] });
  const it = item(ix, '2026-10', 'spotify');
  assert.equal(it.forma, 'fijo');
  assert.equal(it.acumula, false);
  // Septiembre pasó sin pagarse y no arrastra nada a octubre: se espera un solo cobro.
  assert.equal(it.arrastre, 0);
  assert.equal(it.enMoneda.esperado, 10);
});

// ---------------------------------------------------------------- Prueba gratis

test('en la prueba gratis no se aparta nada y el primer cobro es el siguiente', () => {
  const p = suscripcion('gpt', { monto: 20, dia: 8, pruebaHasta: '2026-10-20' });
  const ix = indice({ partidas: [p] });
  // El cobro del 8 de octubre cae dentro de la prueba: ese mes no cobra.
  assert.equal(enPruebaGratis(p, '2026-10'), true);
  assert.equal(item(ix, '2026-10', 'gpt').enMoneda.esperado, 0);
  assert.equal(enPruebaGratis(p, '2026-11'), false);
  assert.equal(item(ix, '2026-11', 'gpt').enMoneda.esperado, 20);
  assert.equal(proximoCobro(p, HOY), '2026-11-08');
});

test('avisa cuando la prueba gratis está por terminar, y no antes de tiempo', () => {
  const titulos = (pruebaHasta, hoy) => calcularAvisos(
    indice({ partidas: [suscripcion('gpt', { monto: 20, pruebaHasta })] }, { hoy }), { hoy },
  ).filter((a) => a.tipo === 'suscripcion').map((a) => a.titulo);
  assert.deepEqual(titulos('2026-10-18', HOY), ['La prueba de gpt termina el 18 oct']);
  assert.deepEqual(titulos('2026-11-30', HOY), []); // todavía falta mucho
  assert.deepEqual(titulos('2026-10-01', HOY), []); // ya pasó
});

// ---------------------------------------------------------------- Administrar

test('la lista de suscripciones: lo que cobra cada una, su próximo cobro y los totales', () => {
  const ix = indice({
    partidas: [
      suscripcion('netflix', { monto: 12, dia: 5 }),
      suscripcion('icloud', { monto: 2.99, dia: 22 }),
      suscripcion('dominio', { monto: 120, moneda: 'L', ciclo: 'anual', mesCobro: 3, meses: [3], dia: 14 }),
      suscripcion('vieja', { monto: 8, hasta: '2026-09' }), // cancelada el mes pasado
    ],
  });
  const lista = estadoSuscripciones(ix, { hoy: HOY });
  // Se ordenan por el próximo cobro; las canceladas, al final.
  assert.deepEqual(lista.map((s) => s.id), ['icloud', 'netflix', 'dominio', 'vieja']);
  assert.deepEqual(lista.map((s) => s.proximo), ['2026-10-22', '2026-11-05', '2027-03-14', null]);
  assert.deepEqual(lista.map((s) => s.activa), [true, true, true, false]);
  cerca(lista[0].alMesL, 2.99 * 25);

  const r = resumenSuscripciones(lista);
  assert.equal(r.cuantas, 3);
  cerca(r.enDolares, 14.99); // netflix + icloud, al mes
  cerca(r.enLempiras, 10); // el dominio: L120 al año
  cerca(r.alMes, 14.99 * 25 + 10);
  cerca(r.alAnio, r.alMes * 12);
});

test('cancelar una suscripción la deja en los meses de antes y la quita de los de después', () => {
  const partidas = [suscripcion('netflix', { monto: 12, hasta: '2026-10' })];
  const movimientos = [gasto('p1', 'netflix', '2026-10-05', 300, { cuentaId: 'visa', moneda: 'USD', monto: 12 })];
  const ix = indice({ partidas, movimientos });
  assert.equal(item(ix, '2026-10', 'netflix').estado, 'completo');
  assert.equal(item(ix, '2026-11', 'netflix'), undefined);
  assert.equal(proximoCobro(partidas[0], '2026-11-01'), null);
  cerca(presupuestoMensual(ix, '2026-11').egresos, 0);
});
