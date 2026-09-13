import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pagosProgramados, quincenaDe, deduccionesDelPago, montoEsperado, reciboSugerido, valoresAnteriores, estadoRecibo, pagosSinRegistrar,
  pagosParaRegistrar, planillaDe,
} from '../js/core/nomina.js';
import { crearIndice } from '../js/core/asientos.js';
import { cuotasDelMes, estadoDe } from '../js/core/prestamos.js';
import { resumenMes, saldosCuentas, descontadoDelMes } from '../js/core/reportes.js';
import { presupuestoMensual } from '../js/core/presupuesto.js';
import { docVacio } from '../js/core/modelo.js';

const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

// Datos ficticios.
const rap = { id: 'rap', nombre: 'Préstamo RAP', tasa: 10, cuota: 1500.05, saldo: 40000, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10', ultimaCuota: '2029-06-02', responsableId: 'moises', cuentaId: 'gastos', categoriaId: 'prestamos' };

function salario(datos = {}) {
  return {
    id: 'sal', nombre: 'Salario Moises', personaId: 'moises', frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'igual', cuentaId: 'gastos',
    netoEsperado: 15000, decimo13: true, decimo14: true, activo: true,
    deducciones: [
      { id: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', fija: true, montoEsperado: 480.5, aplicaEn: 'ambas' },
      { id: 'isr', nombre: 'ISR', naturaleza: 'gasto', categoriaId: 'isr', fija: false, montoEsperado: null, aplicaEn: 'q2' },
      { id: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', categoriaId: 'prestamos', prestamoId: 'rap', aplicaEn: 'ambas' },
      { id: 'coop', nombre: 'Cooperativa', naturaleza: 'ahorro', categoriaId: 'ahorro', cuentaDestinoId: 'ahorro', fija: true, montoEsperado: 500, aplicaEn: 'q1' },
    ],
    ...datos,
  };
}

function indice(datos = {}, hoy = '2026-10-20') {
  const doc = { ...docVacio(), prestamos: [rap], ingresos: [salario()], ...datos };
  doc.config = { ...doc.config, inicio: '2026-09' };
  return crearIndice(doc, { hoy });
}

const recibo = (id, ocurrencia, deducciones, extra = {}) => ({
  id, ingresoId: 'sal', tipo: 'ordinario', ocurrencia, periodo: ocurrencia.slice(0, 7), fecha: ocurrencia, cuentaId: 'gastos', neto: 14000, extras: [], deducciones,
  personaId: 'moises', creado: `${ocurrencia}T12:00:00Z`, ...extra,
});

test('cada pago ordinario sabe si es la primera o la segunda quincena', () => {
  const s = salario();
  assert.deepEqual(pagosProgramados(s, '2026-02').map((p) => [p.ocurrencia, p.quincena]), [['2026-02-15', 'q1'], ['2026-02-28', 'q2']]);
  assert.equal(quincenaDe(s, '2026-10-31'), 'q2');
  assert.equal(quincenaDe({ ...s, frecuencia: 'mensual' }, '2026-10-31'), 'q1');
});

test('las deducciones aplican según la quincena y los décimos solo llevan las marcadas', () => {
  const s = salario();
  const [q1, q2] = pagosProgramados(s, '2026-10');
  assert.deepEqual(deduccionesDelPago(s, q1).map((d) => d.id), ['ihss', 'rap', 'coop']);
  assert.deepEqual(deduccionesDelPago(s, q2).map((d) => d.id), ['ihss', 'isr', 'rap']);
  const decimo = pagosProgramados(s, '2026-12').find((p) => p.tipo === 'decimo13');
  assert.deepEqual(deduccionesDelPago(s, decimo), []);
  const conIsr = { ...s, deducciones: s.deducciones.map((d) => (d.id === 'isr' ? { ...d, enDecimos: true } : d)) };
  assert.deepEqual(deduccionesDelPago(conIsr, decimo).map((d) => d.id), ['isr']);
});

test('un préstamo por planilla descuenta la mitad en cada quincena y entre las dos completan la cuota', () => {
  const ix = indice();
  const s = salario();
  const [q1, q2] = pagosProgramados(s, '2026-10');
  const d = s.deducciones[2];
  assert.equal(montoEsperado(ix, s, d, q1), 750.02);
  assert.equal(montoEsperado(ix, s, d, q2), 750.03);
  assert.equal(montoEsperado(ix, s, { ...d, aplicaEn: 'q1' }, q1), 1500.05);
  assert.equal(montoEsperado(ix, s, s.deducciones[1], q2), null);
  assert.equal(planillaDe(ix, 'rap').veces, 2);
});

test('el recibo sugerido trae llenas las deducciones fijas y la del préstamo; las demás quedan pendientes', () => {
  const ix = indice();
  const s = salario();
  const [, q2] = pagosProgramados(s, '2026-10');
  const r = reciboSugerido(ix, s, q2, { hoy: '2026-10-20' });
  assert.deepEqual([r.ocurrencia, r.fecha, r.neto, r.periodo], ['2026-10-31', '2026-10-20', 15000, '2026-10']);
  assert.deepEqual(r.deducciones.map((x) => [x.deduccionId, x.monto]), [['ihss', 480.5], ['isr', null], ['rap', 750.03]]);
  assert.deepEqual([r.deducciones[2].naturaleza, r.deducciones[2].prestamoId], ['prestamo', 'rap']);
  const e = estadoRecibo({ ...r, neto: 13500 });
  assert.deepEqual([e.pendientes, e.completo, e.descontado, e.bruto], [1, false, 1230.53, 14730.53]);
});

test('los valores anteriores prefieren la misma quincena', () => {
  const ix = indice({
    recibos: [
      recibo('r1', '2026-09-15', [{ deduccionId: 'ihss', monto: 590 }, { deduccionId: 'coop', monto: 500 }]),
      recibo('r2', '2026-09-30', [{ deduccionId: 'ihss', monto: 600 }, { deduccionId: 'isr', monto: 410.5 }]),
    ],
  });
  const s = salario();
  const [q1, q2] = pagosProgramados(s, '2026-10');
  const antes15 = valoresAnteriores(ix, s, q1);
  assert.equal(antes15.ultimo.id, 'r1');
  assert.deepEqual(antes15.guia, { ihss: 590, coop: 500, isr: 410.5 });
  const antes31 = valoresAnteriores(ix, s, q2);
  assert.equal(antes31.ultimo.id, 'r2');
  assert.equal(antes31.guia.ihss, 600);
});

test('un recibo con planilla baja el préstamo, suma el ahorro y no cuenta como gasto del hogar', () => {
  const q1 = recibo('r1', '2026-10-15', [
    { deduccionId: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', monto: 480.5 },
    { deduccionId: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', monto: 750.02 },
    { deduccionId: 'coop', nombre: 'Cooperativa', naturaleza: 'ahorro', cuentaDestinoId: 'ahorro', monto: 500 },
  ]);
  let ix = indice({ recibos: [q1] });
  let cuota = cuotasDelMes(ix, '2026-10').find((it) => it.prestamo.id === 'rap');
  assert.equal(cuota.estado, 'parcial');
  assert.deepEqual([cuota.planilla.esperados, cuota.planilla.descontados, cuota.forma], [2, 1, 'planilla']);
  assert.equal(cuota.pagos[0].id, 'r1');

  const r = resumenMes(ix, '2026-10');
  assert.ok(!r.plan.some((it) => it.clave === 'prestamo:rap')); // ya viene descontada del neto
  assert.equal(r.gastoReal, 0);
  assert.equal(r.descontado.total, 1730.52);
  assert.deepEqual(r.descontado.porConcepto, { IHSS: 480.5, 'Préstamo RAP': 750.02, Cooperativa: 500 });
  const s = saldosCuentas(ix);
  assert.equal(s.gastos, 14000);
  assert.equal(s.ahorro, 500);
  assert.equal(descontadoDelMes(ix, '2026-10').incompletos.length, 0);

  // Con la segunda quincena, la cuota queda completa y el saldo igual que con un pago de la cuota entera.
  const q2 = recibo('r2', '2026-10-31', [{ deduccionId: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', monto: 750.03 }]);
  ix = indice({ recibos: [q1, q2] });
  cuota = cuotasDelMes(ix, '2026-10').find((it) => it.prestamo.id === 'rap');
  assert.equal(cuota.estado, 'completo');
  const entera = indice({ movimientos: [{ id: 'm', tipo: 'gasto', fecha: '2026-10-02', periodo: '2026-10', cuentaId: 'gastos', monto: 1500.05, prestamoId: 'rap' }], ingresos: [] });
  assert.equal(estadoDe(ix, ix.prestamos.get('rap')).saldo, estadoDe(entera, entera.prestamos.get('rap')).saldo);

  // Borrar el recibo lo revierte todo.
  ix = indice({ recibos: [{ ...q1, borrado: true }] });
  assert.equal(cuotasDelMes(ix, '2026-10').find((it) => it.prestamo.id === 'rap').estado, 'pendiente');
  assert.equal(saldosCuentas(ix).ahorro, 0);
  cerca(estadoDe(ix, ix.prestamos.get('rap')).saldo, 40000);
});

test('una deducción sin monto deja el recibo incompleto', () => {
  const ix = indice({ recibos: [recibo('r1', '2026-10-15', [{ deduccionId: 'ihss', nombre: 'IHSS', monto: null }, { deduccionId: 'coop', nombre: 'Cooperativa', monto: null, noAplica: true }])] });
  const d = descontadoDelMes(ix, '2026-10');
  assert.equal(d.incompletos.length, 1);
  assert.equal(estadoRecibo(d.incompletos[0]).pendientes, 1);
});

test('el presupuesto no cuenta dos veces la cuota por planilla', () => {
  const ix = indice();
  const p = presupuestoMensual(ix, '2026-10');
  assert.equal(p.prestamos, 0);
  assert.equal(p.planilla, 1500.05);
  assert.equal(p.egresos, 0);
});

test('pagos sin registrar: con dos días de gracia y desde el inicio del registro', () => {
  const ix = indice({ recibos: [recibo('r1', '2026-09-15', [])] }, '2026-10-17');
  const faltan = pagosSinRegistrar(ix, { hoy: '2026-10-17', desde: '2026-09' }).map((x) => x.pago.ocurrencia);
  assert.deepEqual(faltan, ['2026-09-30']); // el del 15 de octubre todavía está en gracia
  assert.deepEqual(pagosSinRegistrar(ix, { hoy: '2026-10-18', desde: '2026-09' }).map((x) => x.pago.ocurrencia), ['2026-09-30', '2026-10-15']);
  const sinMonto = indice({ ingresos: [salario({ netoEsperado: 0 })] }, '2026-10-18');
  assert.deepEqual(pagosSinRegistrar(sinMonto, { hoy: '2026-10-18', desde: '2026-09' }), []);
  assert.equal(pagosParaRegistrar(ix, { hoy: '2026-10-17' })[0].pago.ocurrencia, '2026-10-15');
});
