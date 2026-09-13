import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoPartidas, equivalenteMensual, presupuestoMensual, pagosProgramados, ingresosDelMes, ingresoMensual, movimientoParaItem, reciboParaItem,
} from '../js/core/presupuesto.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const partida = (id, datos = {}) => ({
  id, nombre: id, categoriaId: 'comida', responsableId: 'ruth', tipo: 'gasto', forma: 'fijo', monto: 0, meses: [], dia: null,
  medioPagoId: 'gastos', cuentaDestinoId: null, acumula: false, activo: true, creado: '2026-09-01T00:00:00Z', ...datos,
});
const gasto = (id, partidaId, fecha, monto, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', categoriaId: 'comida', partidaId, creado: `${fecha}T12:00:00Z`, ...extra,
});
function indice(datos) {
  const doc = { ...docVacio(), ...datos };
  doc.config = { ...doc.config, inicio: '2026-09' };
  return crearIndice(doc, { hoy: '2026-10-15' });
}
const item = (ix, periodo, id, parte = 'principal') => estadoPartidas(ix, periodo).find((it) => it.clave === `${id}:${parte}`);

test('súper de 6,000 en abonos: 2,000 parcial, 4,000 completo, 500 más excedido', () => {
  const partidas = [partida('super', { forma: 'abonos', monto: 6000 })];
  let ix = indice({ partidas, movimientos: [gasto('a', 'super', '2026-10-03', 2000)] });
  let it = item(ix, '2026-10', 'super');
  assert.equal(it.estado, 'parcial');
  assert.equal(it.real, 2000);
  assert.equal(it.queda, 4000);
  assert.ok(!it.hecho);

  const movimientos = [gasto('a', 'super', '2026-10-03', 2000), gasto('b', 'super', '2026-10-05', 4000)];
  it = item(indice({ partidas, movimientos }), '2026-10', 'super');
  assert.equal(it.estado, 'completo');
  assert.equal(it.queda, 0);
  assert.ok(it.hecho);
  assert.equal(it.pagos.length, 2);

  ix = indice({ partidas, movimientos: [...movimientos, gasto('c', 'super', '2026-10-20', 500)] });
  it = item(ix, '2026-10', 'super');
  assert.equal(it.estado, 'excedido');
  assert.equal(it.real, 6500);
});

test('la luz cerrada con menos del monto deja sobrante; pasa al mes siguiente solo si acumula', () => {
  const movimientos = [gasto('luz-oct', 'luz', '2026-10-08', 1450, { cierra: true, categoriaId: 'servicios' })];
  const sinAcumular = indice({ partidas: [partida('luz', { forma: 'variable', monto: 1800, categoriaId: 'servicios' })], movimientos });
  const oct = item(sinAcumular, '2026-10', 'luz');
  assert.equal(oct.estado, 'completo');
  assert.equal(oct.sobrante, 350);
  assert.equal(item(sinAcumular, '2026-11', 'luz').esperado, 1800);

  const acumula = indice({ partidas: [partida('luz', { forma: 'variable', monto: 1800, acumula: true, acumulaDesde: '2026-10', categoriaId: 'servicios' })], movimientos });
  const nov = item(acumula, '2026-11', 'luz');
  assert.equal(nov.arrastre, 350);
  assert.equal(nov.esperado, 2150);
  // lo que no se gastó en noviembre también pasa a diciembre
  assert.equal(item(acumula, '2026-12', 'luz').esperado, 1800 + 2150);
});

test('el exceso no se arrastra', () => {
  const ix = indice({
    partidas: [partida('gas', { monto: 1000, acumula: true, acumulaDesde: '2026-10', forma: 'variable' })],
    movimientos: [gasto('g1', 'gas', '2026-10-10', 1300)],
  });
  assert.equal(item(ix, '2026-10', 'gas').estado, 'excedido');
  assert.equal(item(ix, '2026-11', 'gas').esperado, 1000);
});

test('cambiar solo este mes y omitir un mes', () => {
  const partidas = [partida('ninera', { monto: 5000, categoriaId: 'ninos' })];
  const ajustesPartida = [
    { id: 'ninera:2026-10', partidaId: 'ninera', periodo: '2026-10', monto: 2500 },
    { id: 'ninera:2026-11', partidaId: 'ninera', periodo: '2026-11', omitir: true },
  ];
  const ix = indice({ partidas, ajustesPartida });
  assert.equal(item(ix, '2026-10', 'ninera').esperado, 2500);
  const nov = item(ix, '2026-11', 'ninera');
  assert.equal(nov.estado, 'omitida');
  assert.ok(nov.hecho);
  assert.equal(nov.queda, 0);
  assert.equal(item(ix, '2026-12', 'ninera').esperado, 5000);
});

test('pago anual: se aparta cada mes y se paga en su mes', () => {
  const tasa = partida('tasa', { tipo: 'anual', monto: 391.5, montoAnual: 4698, mesPago: 12, categoriaId: 'transporte', cuentaDestinoId: 'reservas' });
  const ix = indice({ partidas: [tasa] });
  assert.deepEqual(estadoPartidas(ix, '2026-10').map((it) => it.nombre), ['Apartar para tasa']);
  const dic = estadoPartidas(ix, '2026-12');
  assert.deepEqual(dic.map((it) => it.nombre), ['Apartar para tasa', 'Pagar tasa']);
  assert.equal(dic[1].esperado, 4698);
  assert.equal(dic[1].medioId, 'reservas');

  const apartar = movimientoParaItem(dic[0], '2026-12', { hoy: '2026-10-15' });
  assert.deepEqual([apartar.tipo, apartar.cuentaId, apartar.cuentaDestinoId, apartar.parte], ['transferencia', 'gastos', 'reservas', 'apartar']);
  const pagar = movimientoParaItem(dic[1], '2026-12', { hoy: '2026-10-15' });
  assert.deepEqual([pagar.tipo, pagar.cuentaId, pagar.parte, pagar.fecha], ['gasto', 'reservas', 'pagar', '2026-12-01']);
});

test('una partida de 10 meses no aparece en noviembre y cuenta 10/12 en el presupuesto', () => {
  const seguro = partida('seguro', { monto: 1098.75, meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], categoriaId: 'transporte' });
  const ix = indice({ partidas: [seguro] });
  assert.ok(item(ix, '2026-10', 'seguro'));
  assert.equal(item(ix, '2026-11', 'seguro'), undefined);
  cerca(equivalenteMensual(seguro), 915.63);
});

test('registrar desde una partida: gasto con su vínculo, aporte como transferencia', () => {
  const ix = indice({
    partidas: [
      partida('super', { forma: 'abonos', monto: 6000 }),
      partida('ahorro', { tipo: 'aporte', monto: 3000, categoriaId: 'ahorro', cuentaDestinoId: 'ahorro' }),
    ],
    movimientos: [gasto('a', 'super', '2026-10-03', 2000)],
  });
  const m = movimientoParaItem(item(ix, '2026-10', 'super'), '2026-10', { hoy: '2026-10-15', cierra: true });
  assert.deepEqual([m.tipo, m.partidaId, m.monto, m.fecha, m.cierra], ['gasto', 'super', 4000, '2026-10-15', true]);
  const t = movimientoParaItem(item(ix, '2026-10', 'ahorro'), '2026-10', { hoy: '2026-10-15' });
  assert.deepEqual([t.tipo, t.cuentaId, t.cuentaDestinoId, t.monto], ['transferencia', 'gastos', 'ahorro', 3000]);
});

test('pagos quincenales: el 15 y el último día, con fin de semana y décimos', () => {
  const salario = { id: 'sal', nombre: 'Salario Ruth', personaId: 'ruth', frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'anterior',
    cuentaId: 'gastos', netoEsperado: 14250, decimo13: true, decimo14: true, activo: true, deducciones: [] };
  assert.deepEqual(pagosProgramados(salario, '2026-02').map((p) => p.ocurrencia), ['2026-02-15', '2026-02-28']);
  // 15 de febrero de 2026 es domingo y 28 es sábado: se pagan el viernes
  assert.deepEqual(pagosProgramados(salario, '2026-02').map((p) => p.fecha), ['2026-02-13', '2026-02-27']);
  assert.deepEqual(pagosProgramados(salario, '2026-06').map((p) => p.tipo), ['ordinario', 'ordinario', 'decimo14']);
  assert.deepEqual(pagosProgramados({ ...salario, frecuencia: 'mensual', diasPago: [31] }, '2026-09').map((p) => p.ocurrencia), ['2026-09-30']);
  cerca(ingresoMensual(salario), (14250 * 2 * 14) / 12);
});

test('ingresos del mes: lo recibido marca cada pago; un recibo fuera de calendario también aparece', () => {
  const salario = { id: 'sal', nombre: 'Salario Ruth', personaId: 'ruth', frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'igual',
    cuentaId: 'gastos', netoEsperado: 14250, activo: true, deducciones: [] };
  const recibos = [
    { id: 'r1', ingresoId: 'sal', tipo: 'ordinario', ocurrencia: '2026-10-15', periodo: '2026-10', fecha: '2026-10-15', cuentaId: 'gastos', neto: 14100, deducciones: [] },
    { id: 'r2', ingresoId: 'sal', tipo: 'extra', ocurrencia: '2026-10-20', periodo: '2026-10', fecha: '2026-10-20', cuentaId: 'gastos', neto: 1000, deducciones: [] },
  ];
  const ix = indice({ ingresos: [salario], recibos });
  const items = ingresosDelMes(ix, '2026-10');
  assert.deepEqual(items.map((it) => [it.nombre, it.hecho, it.real]), [
    ['Salario Ruth · pago del 15', true, 14100],
    ['Salario Ruth', true, 1000],
    ['Salario Ruth · pago del 31', false, 0],
  ]);
  assert.equal(items[1].fueraDeCalendario, true);
  const recibo = reciboParaItem(items[2], { hoy: '2026-10-15' });
  assert.deepEqual([recibo.ocurrencia, recibo.fecha, recibo.neto, recibo.periodo], ['2026-10-31', '2026-10-15', 14250, '2026-10']);
});

test('presupuesto mensual por grupo, persona y medio; los aportes no son esenciales', () => {
  const ix = indice({
    partidas: [
      partida('super', { monto: 6000, medioPagoId: 'gastos' }),
      partida('internet', { monto: 1199, categoriaId: 'comunicaciones', responsableId: 'moises' }),
      partida('ahorro', { tipo: 'aporte', monto: 3000, categoriaId: 'ahorro', responsableId: null, cuentaDestinoId: 'ahorro' }),
      partida('vieja', { monto: 999, activo: false }),
    ],
    prestamos: [{ id: 'carro', nombre: 'Carro', tasa: 16.5, cuota: 10132.46, saldo: 168000, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10', ultimaCuota: '2028-04-02', responsableId: 'ruth', cuentaId: 'gastos', categoriaId: 'prestamos' }],
    ingresos: [{ id: 'sal', nombre: 'Salario', personaId: 'ruth', frecuencia: 'mensual', diasPago: [31], netoEsperado: 30000, decimo13: true, decimo14: true, activo: true }],
  });
  const p = presupuestoMensual(ix, '2026-10');
  cerca(p.ingresos, 35000);
  cerca(p.egresos, 6000 + 1199 + 3000 + 10132.46);
  cerca(p.esenciales, 6000 + 1199 + 10132.46);
  cerca(p.porGrupo.deudas, 10132.46);
  cerca(p.porGrupo.casa, 1199);
  cerca(p.porPersona.sin, 3000);
  cerca(p.porMedio.gastos, p.egresos);
  const ruth = presupuestoMensual(ix, '2026-10', { personaId: 'ruth' });
  cerca(ruth.egresos, 6000 + 10132.46);
});
