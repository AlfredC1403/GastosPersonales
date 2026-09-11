import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuotasRestantes, seguroEstimado, seguroDe, estadoPrestamo, saldosCuentas, compromisosDelMes,
  movimientoParaCompromiso, resumenMes, presupuestoMensual, prestamosParaSimular, simularDeudas, equivalenteMensual, deudaAl,
} from '../js/core/finanzas.js';
import { sumarMeses, mesesEntre, dinero, dineroCorto, duracion } from '../js/core/util.js';
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

test('periodos y formato', () => {
  assert.equal(sumarMeses('2026-09', 4), '2027-01');
  assert.equal(sumarMeses('2026-01', -1), '2025-12');
  assert.equal(mesesEntre('2026-09', '2055-01'), 340);
  assert.equal(dinero(-1234.5), '-L1,234.50');
  assert.equal(dineroCorto(1679956.53), 'L1.68M');
  assert.equal(duracion(15), '1 año y 3 meses');
  assert.equal(duracion(11), '11 meses');
});

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
  const movs = [
    { id: 'a', tipo: 'gasto', prestamoId: 'casa', periodo: '2026-09', fecha: '2026-09-07', monto: 14916.23 },
    { id: 'b', tipo: 'gasto', prestamoId: 'casa', periodo: '2026-10', fecha: '2026-10-07', monto: 14916.23 },
  ];
  const e = estadoPrestamo(casa, movs);
  cerca(e.saldo, 1679956.53 - 1078.21); // 14,916.23 − 1,238.35 de seguro − 12,599.67 de interés
  assert.equal(e.cuotasPagadas, 1);
  assert.equal(e.ultimoPeriodo, '2026-10');
  assert.equal(estadoPrestamo(casa, []).finEstimado, '2055-01');
});

test('un abono a capital baja el saldo y adelanta el fin', () => {
  const rap = PRESTAMOS[2];
  const e = estadoPrestamo(rap, [{ id: 'x', tipo: 'abono', prestamoId: 'rap', fecha: '2026-09-20', periodo: '2026-09', monto: 10000 }]);
  cerca(e.saldo, 35036.66);
  assert.ok(e.finEstimado < '2029-04');
  const borrado = estadoPrestamo(rap, [{ id: 'x', tipo: 'abono', prestamoId: 'rap', fecha: '2026-09-20', monto: 10000, borrado: true }]);
  cerca(borrado.saldo, 45036.66);
});

test('un abono del mismo día del saldo cuenta solo si se anotó después de registrar el saldo', () => {
  const rap = { ...PRESTAMOS[2], saldoRegistrado: '2026-09-10T12:00:00Z' };
  const abono = (creado) => ({ id: creado, tipo: 'abono', prestamoId: 'rap', fecha: '2026-09-10', monto: 5000, creado });
  cerca(estadoPrestamo(rap, [abono('2026-09-10T15:00:00Z')]).saldo, 40036.66);
  cerca(estadoPrestamo(rap, [abono('2026-09-10T09:00:00Z')]).saldo, 45036.66);
});

test('deuda al cierre de cada mes usa solo los pagos registrados hasta ese mes', () => {
  const doc = { prestamos: PRESTAMOS, movimientos: [
    { id: 'o', tipo: 'gasto', prestamoId: 'casa', periodo: '2026-10', fecha: '2026-10-07', monto: 14916.23 },
    { id: 'a', tipo: 'abono', prestamoId: 'rap', periodo: '2026-11', fecha: '2026-11-15', monto: 5000, creado: '2026-11-15T10:00:00Z' },
  ] };
  const inicial = 168000 + 277297.49 + 45036.66 + 1679956.53;
  cerca(deudaAl(doc, '2026-09'), inicial);
  cerca(deudaAl(doc, '2026-10'), inicial - 1078.21);
  cerca(deudaAl(doc, '2026-11'), inicial - 1078.21 - 5000);
  cerca(deudaAl(doc, '2026-08'), inicial); // antes del saldo conocido
});

test('sin plan, cada préstamo termina en la fecha del banco', () => {
  const ps = prestamosParaSimular({ prestamos: PRESTAMOS, movimientos: [] });
  const r = simularDeudas(ps, { desde: '2026-10', rodar: false });
  const fin = Object.fromEntries(r.prestamos.map((p) => [p.id, p.fin]));
  assert.deepEqual(fin, { carro: '2028-04', muro: '2029-04', rap: '2029-04', casa: '2055-01' });
  assert.ok(r.completo);
});

test('bola de nieve: menor saldo primero, termina antes y paga menos interés', () => {
  const ps = prestamosParaSimular({ prestamos: PRESTAMOS, movimientos: [] });
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

test('saldos de cuentas', () => {
  const doc = docVacio();
  doc.movimientos = [
    { id: '1', tipo: 'ingreso', cuentaId: 'gastos', monto: 50000 },
    { id: '2', tipo: 'gasto', cuentaId: 'gastos', monto: 1200.5 },
    { id: '3', tipo: 'transferencia', cuentaId: 'gastos', cuentaDestinoId: 'emergencias', monto: 5000 },
    { id: '4', tipo: 'ajuste', cuentaId: 'ahorro', monto: 300 },
    { id: '5', tipo: 'gasto', cuentaId: 'gastos', monto: 999, borrado: true },
  ];
  const s = saldosCuentas(doc);
  assert.equal(s.gastos, 43799.5);
  assert.equal(s.emergencias, 5000);
  assert.equal(s.ahorro, 300);
});

function docDePrueba() {
  const doc = docVacio();
  doc.prestamos = [PRESTAMOS[0]];
  doc.plantillas = [
    { id: 'seguro', nombre: 'Seguro carro', clase: 'fijo', monto: 1098.75, meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], responsableId: 'ruth' },
    { id: 'tasa', nombre: 'Tasa vehicular', clase: 'provision', monto: 391.5, montoAnual: 4698, mesPago: 12, cuentaDestinoId: 'reservas', categoriaId: 'transporte' },
    { id: 'sal', nombre: 'Salario Ruth', clase: 'ingreso', monto: 30000, decimo13: true, decimo14: true },
    { id: 'ahorro', nombre: 'Aporte a ahorro', clase: 'aporte', monto: 0, cuentaDestinoId: 'ahorro' },
    { id: 'viejo', nombre: 'Algo inactivo', clase: 'fijo', monto: 100, activo: false },
  ];
  return doc;
}

test('compromisos del mes: meses activos, pagos anuales, décimos y montos sin definir', () => {
  const doc = docDePrueba();
  const nombres = (p) => compromisosDelMes(doc, p).map((i) => i.nombre);
  assert.deepEqual(nombres('2026-09'), ['Salario Ruth', 'carro', 'Seguro carro', 'Apartar para Tasa vehicular']);
  assert.deepEqual(nombres('2026-12'), ['Salario Ruth', 'Salario Ruth · décimo tercer mes', 'carro', 'Apartar para Tasa vehicular', 'Pagar Tasa vehicular']);
  assert.ok(nombres('2027-06').includes('Salario Ruth · décimo cuarto mes'));
  assert.ok(!nombres('2028-05').includes('carro')); // ya pasó la última cuota
});

test('registrar un compromiso lo marca como hecho y crea el movimiento correcto', () => {
  const doc = docDePrueba();
  const [ingreso, carro, , apartar] = compromisosDelMes(doc, '2026-10');
  assert.equal(movimientoParaCompromiso(carro, '2026-10').tipo, 'gasto');
  assert.equal(movimientoParaCompromiso(carro, '2026-10').prestamoId, 'carro');
  const t = movimientoParaCompromiso(apartar, '2026-10');
  assert.deepEqual([t.tipo, t.cuentaId, t.cuentaDestinoId], ['transferencia', 'gastos', 'reservas']);
  assert.equal(movimientoParaCompromiso(ingreso, '2026-10').tipo, 'ingreso');

  doc.movimientos.push({ id: 'm1', ...movimientoParaCompromiso(carro, '2026-10'), monto: 10132.46 });
  doc.movimientos.push({ id: 'm2', tipo: 'gasto', periodo: '2026-10', fecha: '2026-10-05', monto: 800, cuentaId: 'gastos', categoriaId: 'ropa' });
  const r = resumenMes(doc, '2026-10');
  const item = r.items.find((i) => i.clave === 'prestamo:carro');
  assert.ok(item.hecho);
  assert.equal(r.adicionales, 800);
  assert.equal(r.porClase.prestamo, 10132.46);
  assert.equal(r.porCategoria.ropa, 800);
  cerca(r.comprometido, 10132.46 + 1098.75 + 391.5);
  cerca(r.libre, 30000 - r.comprometido - 800);
});

test('presupuesto mensual usa equivalentes (10/12 del seguro) y deja fuera los aportes de lo esencial', () => {
  const doc = docDePrueba();
  cerca(equivalenteMensual(doc.plantillas[0]), 915.63, 0.01);
  cerca(equivalenteMensual(doc.plantillas[2]), 35000);
  const p = presupuestoMensual(doc, '2026-10');
  cerca(p.porClase.prestamo, 10132.46);
  cerca(p.esenciales, 10132.46 + 915.625 + 391.5);
});
