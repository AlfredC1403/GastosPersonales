import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuotasRestantes, seguroEstimado, seguroDe, estadoPrestamo, deudaAl, prestamosParaSimular, simularDeudas, cuotasDelMes, estadoDe,
} from '../js/core/prestamos.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const cerca = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const prestamo = (id, tasa, cuota, saldo, ultimaCuota) => ({
  id, nombre: id, tasa, cuota, saldo, ultimaCuota, seguro: null, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10',
  dia: Number(ultimaCuota.slice(8)), cuentaId: 'gastos', categoriaId: 'prestamos', responsableId: 'moises',
});

const PRESTAMOS = [
  prestamo('carro', 16.5, 10132.46, 168000, '2028-04-02'),
  prestamo('muro', 19, 12041.56, 277297.49, '2029-04-02'),
  prestamo('rap', 9.75, 1665.54, 45036.66, '2029-04-02'),
  prestamo('casa', 9, 14916.23, 1679956.53, '2055-01-07'),
];

const cuota = (id, prestamoId, periodo, fecha, monto, extra = {}) => ({ id, tipo: 'gasto', prestamoId, periodo, fecha, monto, cuentaId: 'gastos', ...extra });
const indice = (prestamos, movimientos = []) => crearIndice({ ...docVacio(), prestamos, movimientos }, { hoy: '2026-09-15' });

test('cuotas restantes y seguro estimado dentro de la cuota', () => {
  assert.deepEqual(PRESTAMOS.map(cuotasRestantes), [19, 31, 31, 340]);
  const s = PRESTAMOS.map(seguroEstimado);
  cerca(s[1], 653.1);
  cerca(s[3], 1238.35);
  assert.equal(seguroDe({ ...PRESTAMOS[3], seguro: 1000 }), 1000);
  assert.equal(seguroDe({ ...PRESTAMOS[3], seguro: 0 }), 0);
});

test('el pago del mes del saldo no lo reduce; los siguientes sí', () => {
  const casa = PRESTAMOS[3];
  const ix = indice(PRESTAMOS, [
    cuota('a', 'casa', '2026-09', '2026-09-07', 14916.23),
    cuota('b', 'casa', '2026-10', '2026-10-07', 14916.23),
  ]);
  const e = estadoDe(ix, casa);
  cerca(e.saldo, 1679956.53 - 1078.21); // 14,916.23 − 1,238.35 de seguro − 12,599.67 de interés
  assert.equal(e.cuotasPagadas, 1);
  assert.equal(e.ultimoPeriodo, '2026-10');
  assert.equal(estadoPrestamo(casa, []).finEstimado, '2055-01');
});

test('un abono a capital baja el saldo y adelanta el fin; uno borrado no cuenta', () => {
  const rap = PRESTAMOS[2];
  const abono = { id: 'x', tipo: 'abono', prestamoId: 'rap', fecha: '2026-09-20', periodo: '2026-09', monto: 10000, cuentaId: 'gastos' };
  const e = estadoDe(indice(PRESTAMOS, [abono]), rap);
  cerca(e.saldo, 35036.66);
  assert.ok(e.finEstimado < '2029-04');
  cerca(estadoDe(indice(PRESTAMOS, [{ ...abono, borrado: true }]), rap).saldo, 45036.66);
});

test('un abono del mismo día del saldo cuenta solo si se anotó después de registrar el saldo', () => {
  const rap = { ...PRESTAMOS[2], saldoRegistrado: '2026-09-10T12:00:00Z' };
  const abono = (creado) => ({ tipo: 'abono', periodo: '2026-09', fecha: '2026-09-10', monto: 5000, creado });
  cerca(estadoPrestamo(rap, [abono('2026-09-10T15:00:00Z')]).saldo, 40036.66);
  cerca(estadoPrestamo(rap, [abono('2026-09-10T09:00:00Z')]).saldo, 45036.66);
});

test('una cuota pagada en dos mitades deja el mismo saldo que pagada completa', () => {
  const carro = PRESTAMOS[0];
  const completa = estadoPrestamo(carro, [{ tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-02', monto: 10132.46 }]);
  const mitades = estadoPrestamo(carro, [
    { tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-15', monto: 5066.23 },
    { tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-30', monto: 5066.23 },
  ]);
  assert.equal(mitades.saldo, completa.saldo);
  assert.equal(mitades.interesPagado, completa.interesPagado);
  assert.equal(mitades.cuotasPagadas, 1);
  assert.deepEqual(mitades.parciales, []);

  const media = estadoPrestamo(carro, [{ tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-15', monto: 5066.23 }]);
  assert.deepEqual(media.parciales, ['2026-10']);
  assert.equal(media.cuotasPagadas, 0);
  assert.ok(media.saldo > completa.saldo);
});

test('cuotas del mes: pendiente, parcial y completa', () => {
  const ix = indice(PRESTAMOS, [
    cuota('m1', 'carro', '2026-10', '2026-10-15', 5066.23),
    cuota('m2', 'muro', '2026-10', '2026-10-02', 12041.56),
  ]);
  const porId = Object.fromEntries(cuotasDelMes(ix, '2026-10').map((it) => [it.prestamo.id, it]));
  assert.equal(porId.carro.estado, 'parcial');
  assert.equal(porId.carro.queda, 5066.23);
  assert.equal(porId.muro.estado, 'completo');
  assert.equal(porId.rap.estado, 'pendiente');
  assert.equal(porId.carro.grupoId, 'deudas');
  assert.ok(!cuotasDelMes(ix, '2028-05').some((it) => it.prestamo.id === 'carro')); // ya pasó la última cuota
});

test('deuda al cierre de cada mes usa solo los pagos registrados hasta ese mes', () => {
  const ix = indice(PRESTAMOS, [
    cuota('o', 'casa', '2026-10', '2026-10-07', 14916.23),
    { id: 'a', tipo: 'abono', prestamoId: 'rap', periodo: '2026-11', fecha: '2026-11-15', monto: 5000, cuentaId: 'gastos', creado: '2026-11-15T10:00:00Z' },
  ]);
  const inicial = 168000 + 277297.49 + 45036.66 + 1679956.53;
  cerca(deudaAl(ix, '2026-09'), inicial);
  cerca(deudaAl(ix, '2026-10'), inicial - 1078.21);
  cerca(deudaAl(ix, '2026-11'), inicial - 1078.21 - 5000);
  cerca(deudaAl(ix, '2026-08'), inicial); // antes del saldo conocido
});

test('sin plan, cada préstamo termina en la fecha del banco', () => {
  const ps = prestamosParaSimular(indice(PRESTAMOS));
  const r = simularDeudas(ps, { desde: '2026-10', rodar: false });
  const fin = Object.fromEntries(r.prestamos.map((p) => [p.id, p.fin]));
  assert.deepEqual(fin, { carro: '2028-04', muro: '2029-04', rap: '2029-04', casa: '2055-01' });
  assert.ok(r.completo);
});

test('bola de nieve: menor saldo primero, termina antes y paga menos interés', () => {
  const ps = prestamosParaSimular(indice(PRESTAMOS));
  const sin = simularDeudas(ps, { desde: '2026-10', rodar: false });
  const bola = simularDeudas(ps, { desde: '2026-10', estrategia: 'bola' });
  assert.deepEqual(bola.orden, ['rap', 'carro', 'muro', 'casa']);
  assert.ok(bola.fin < sin.fin);
  assert.ok(bola.interes < sin.interes);
  cerca(bola.presupuesto, 38755.79);

  const avalancha = simularDeudas(ps, { desde: '2026-10', estrategia: 'avalancha', extraMensual: 3000 });
  assert.deepEqual(avalancha.orden, ['muro', 'carro', 'rap', 'casa']);
  assert.ok(avalancha.fin <= bola.fin);

  const custom = simularDeudas(ps, { desde: '2026-10', estrategia: 'personalizado', orden: ['casa', 'rap'] });
  assert.deepEqual(custom.orden.slice(0, 2), ['casa', 'rap']);
});

test('los abonos de junio y diciembre solo entran esos meses', () => {
  const ps = [{ id: 'a', nombre: 'a', tasa: 0, cuota: 100, seguro: 0, saldo: 1000 }];
  const r = simularDeudas(ps, { desde: '2026-10', extraDiciembre: 500 });
  // oct 100, nov 100, dic 100 + 500 → 200 pendientes; ene 100, feb 100 → termina en febrero
  assert.equal(r.fin, '2027-02');
  assert.equal(r.serie[2].total, 200);
});
