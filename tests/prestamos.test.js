import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuotasRestantes, seguroEstimado, seguroDe, estadoPrestamo, deudaAl, prestamosParaSimular, financiamientosParaSimular, simularDeudas, cuotasDelMes, estadoDe,
} from '../js/core/prestamos.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';
import { mesesEntre } from '../js/core/util.js';

const cerca = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const prestamo = (id, tasa, cuota, saldo, ultimaCuota) => ({
  id, nombre: id, tasa, cuota, saldo, ultimaCuota, seguro: null, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10',
  dia: Number(ultimaCuota.slice(8)), cuentaId: 'gastos', categoriaId: 'prestamos', responsableId: 'moises',
});

// Préstamos de ejemplo (datos ficticios).
const PRESTAMOS = [
  prestamo('carro', 15, 8400, 150000, '2028-06-02'),
  prestamo('moto', 20, 10500, 250000, '2029-06-02'),
  prestamo('rap', 10, 1500.05, 40000, '2029-06-02'),
  prestamo('casa', 8.5, 13000, 1500000, '2054-06-07'),
];

const cuota = (id, prestamoId, periodo, fecha, monto, extra = {}) => ({ id, tipo: 'gasto', prestamoId, periodo, fecha, monto, cuentaId: 'gastos', ...extra });
const indice = (prestamos, movimientos = []) => crearIndice({ ...docVacio(), prestamos, movimientos }, { hoy: '2026-09-15' });

test('cuotas restantes y seguro estimado dentro de la cuota', () => {
  assert.deepEqual(PRESTAMOS.map(cuotasRestantes), [21, 33, 33, 333]);
  const s = PRESTAMOS.map(seguroEstimado);
  cerca(s[1], 589.49);
  cerca(s[3], 1255.42);
  assert.equal(seguroDe({ ...PRESTAMOS[3], seguro: 1000 }), 1000);
  assert.equal(seguroDe({ ...PRESTAMOS[3], seguro: 0 }), 0);
});

test('el pago del mes del saldo no lo reduce; los siguientes sí', () => {
  const casa = PRESTAMOS[3];
  const ix = indice(PRESTAMOS, [
    cuota('a', 'casa', '2026-09', '2026-09-07', 13000),
    cuota('b', 'casa', '2026-10', '2026-10-07', 13000),
  ]);
  const e = estadoDe(ix, casa);
  cerca(e.saldo, 1500000 - 1119.58); // 13,000 − 1,255.42 de seguro − 10,625 de interés
  assert.equal(e.cuotasPagadas, 1);
  assert.equal(e.ultimoPeriodo, '2026-10');
  assert.equal(estadoPrestamo(casa, []).finEstimado, '2054-06');
});

test('un abono a capital baja el saldo y adelanta el fin; uno borrado no cuenta', () => {
  const rap = PRESTAMOS[2];
  const abono = { id: 'x', tipo: 'abono', prestamoId: 'rap', fecha: '2026-09-20', periodo: '2026-09', monto: 10000, cuentaId: 'gastos' };
  const e = estadoDe(indice(PRESTAMOS, [abono]), rap);
  cerca(e.saldo, 30000);
  assert.ok(e.finEstimado < '2029-06');
  cerca(estadoDe(indice(PRESTAMOS, [{ ...abono, borrado: true }]), rap).saldo, 40000);
});

test('un abono del mismo día del saldo cuenta solo si se anotó después de registrar el saldo', () => {
  const rap = { ...PRESTAMOS[2], saldoRegistrado: '2026-09-10T12:00:00Z' };
  const abono = (creado) => ({ tipo: 'abono', periodo: '2026-09', fecha: '2026-09-10', monto: 5000, creado });
  cerca(estadoPrestamo(rap, [abono('2026-09-10T15:00:00Z')]).saldo, 35000);
  cerca(estadoPrestamo(rap, [abono('2026-09-10T09:00:00Z')]).saldo, 40000);
});

test('una cuota pagada en dos mitades deja el mismo saldo que pagada completa', () => {
  const carro = PRESTAMOS[0];
  const completa = estadoPrestamo(carro, [{ tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-02', monto: 8400 }]);
  const mitades = estadoPrestamo(carro, [
    { tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-15', monto: 4200 },
    { tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-30', monto: 4200 },
  ]);
  assert.equal(mitades.saldo, completa.saldo);
  assert.equal(mitades.interesPagado, completa.interesPagado);
  assert.equal(mitades.cuotasPagadas, 1);
  assert.deepEqual(mitades.parciales, []);

  const media = estadoPrestamo(carro, [{ tipo: 'cuota', periodo: '2026-10', fecha: '2026-10-15', monto: 4200 }]);
  assert.deepEqual(media.parciales, ['2026-10']);
  assert.equal(media.cuotasPagadas, 0);
  assert.ok(media.saldo > completa.saldo);
});

test('cuotas del mes: pendiente, parcial y completa', () => {
  const ix = indice(PRESTAMOS, [
    cuota('m1', 'carro', '2026-10', '2026-10-15', 4200),
    cuota('m2', 'moto', '2026-10', '2026-10-02', 10500),
  ]);
  const porId = Object.fromEntries(cuotasDelMes(ix, '2026-10').map((it) => [it.prestamo.id, it]));
  assert.equal(porId.carro.estado, 'parcial');
  assert.equal(porId.carro.queda, 4200);
  assert.equal(porId.moto.estado, 'completo');
  assert.equal(porId.rap.estado, 'pendiente');
  assert.equal(porId.carro.grupoId, 'deudas');
  assert.ok(!cuotasDelMes(ix, '2028-07').some((it) => it.prestamo.id === 'carro')); // ya pasó la última cuota
});

test('deuda al cierre de cada mes usa solo los pagos registrados hasta ese mes', () => {
  const ix = indice(PRESTAMOS, [
    cuota('o', 'casa', '2026-10', '2026-10-07', 13000),
    { id: 'a', tipo: 'abono', prestamoId: 'rap', periodo: '2026-11', fecha: '2026-11-15', monto: 5000, cuentaId: 'gastos', creado: '2026-11-15T10:00:00Z' },
  ]);
  const inicial = 150000 + 250000 + 40000 + 1500000;
  cerca(deudaAl(ix, '2026-09'), inicial);
  cerca(deudaAl(ix, '2026-10'), inicial - 1119.58);
  cerca(deudaAl(ix, '2026-11'), inicial - 1119.58 - 5000);
  cerca(deudaAl(ix, '2026-08'), inicial); // antes del saldo conocido
});

test('sin plan, cada préstamo termina en la fecha del banco', () => {
  const ps = prestamosParaSimular(indice(PRESTAMOS));
  const r = simularDeudas(ps, { desde: '2026-10', rodar: false });
  const fin = Object.fromEntries(r.prestamos.map((p) => [p.id, p.fin]));
  assert.deepEqual(fin, { carro: '2028-06', moto: '2029-06', rap: '2029-06', casa: '2054-06' });
  assert.ok(r.completo);
});

test('bola de nieve: menor saldo primero, termina antes y paga menos interés', () => {
  const ps = prestamosParaSimular(indice(PRESTAMOS));
  const sin = simularDeudas(ps, { desde: '2026-10', rodar: false });
  const bola = simularDeudas(ps, { desde: '2026-10', estrategia: 'bola' });
  assert.deepEqual(bola.orden, ['rap', 'carro', 'moto', 'casa']);
  assert.ok(bola.fin < sin.fin);
  assert.ok(bola.interes < sin.interes);
  cerca(bola.presupuesto, 33400.05);

  const avalancha = simularDeudas(ps, { desde: '2026-10', estrategia: 'avalancha', extraMensual: 3000 });
  assert.deepEqual(avalancha.orden, ['moto', 'carro', 'rap', 'casa']);
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

// ---------------------------------------------------------------- Financiamientos en el plan

function conFinanciamientos(extra = {}) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-01' };
  doc.cuentas = [...doc.cuentas, {
    id: 'visa', nombre: 'Visa', tipo: 'tarjeta', moneda: 'L', saldoInicial: 0, creado: '2026-01-01T00:00:00Z', actualizado: 't',
    tarjeta: { diaCorte: 20, diaPago: 10, limite: { L: 200000 }, saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-01-01', cargos: [] },
  }];
  doc.movimientos = [
    // Tasa cero a 12 cuotas de L1,000 desde el 10 de febrero: al 13 de septiembre van 8 cobradas.
    { id: 'f1', tipo: 'gasto', fecha: '2026-02-10', monto: 12000, cuentaId: 'visa', categoriaId: 'otros', nota: 'Refri', actualizado: '2026-02-10T12:00:00Z',
      cuotas: { n: 12, tipo: 'intra', tasaAnual: 0, cobro: 'dia', cuotaBanco: 1000 } },
  ];
  Object.assign(doc, extra);
  return crearIndice(doc, { hoy: '2026-09-13' });
}

test('un financiamiento entra al simulador como deuda con su cuota', () => {
  const [f] = financiamientosParaSimular(conFinanciamientos());
  assert.equal(f.tipo, 'financiamiento');
  assert.match(f.nombre, /Refri/);
  assert.match(f.nombre, /Visa/); // se dice de qué tarjeta es
  assert.equal(f.cuota, 1000);
  assert.equal(f.tasa, 0);
  // El saldo es el capital que falta (4 cuotas), no el total del financiamiento.
  assert.equal(f.saldo, 4000);
  // Y el id no choca con el de un préstamo que se llamara igual.
  assert.match(f.id, /^fin:/);
});

test('los terminados y los cancelados no entran al plan', () => {
  const viejo = {
    id: 'f2', tipo: 'gasto', fecha: '2026-01-05', monto: 3000, cuentaId: 'visa', categoriaId: 'otros', nota: 'Ya pagado', actualizado: '2026-01-05T12:00:00Z',
    cuotas: { n: 3, tipo: 'intra', tasaAnual: 0, cobro: 'dia' },
  };
  const ix = conFinanciamientos();
  const doc = { ...ix.doc, movimientos: [...ix.doc.movimientos, viejo] };
  const conViejo = crearIndice(doc, { hoy: '2026-09-13' });
  assert.deepEqual(financiamientosParaSimular(conViejo).map((f) => f.id), ['fin:f1']);
});

test('al terminar un financiamiento su cuota pasa a la siguiente deuda', () => {
  const ix = conFinanciamientos({
    prestamos: [{
      id: 'carro', nombre: 'Carro', tasa: 12, cuota: 5000, saldo: 100000, saldoPeriodo: '2026-08', fechaSaldo: '2026-08-31',
      ultimaCuota: '2030-01-02', cuentaId: 'gastos', actualizado: 't',
    }],
  });
  const deudas = [...prestamosParaSimular(ix), ...financiamientosParaSimular(ix)];
  assert.deepEqual(deudas.map((d) => d.tipo), ['prestamo', 'financiamiento']);

  const opciones = { desde: '2026-10', estrategia: 'bola' };
  const con = simularDeudas(deudas, opciones);
  const soloPrestamo = simularDeudas(deudas.filter((d) => d.tipo === 'prestamo'), opciones);

  // El presupuesto del plan suma las dos cuotas.
  assert.equal(con.presupuesto, 6000);
  // La bola de nieve ataca primero el saldo más chico, que es el financiamiento.
  assert.equal(con.orden[0], 'fin:f1');
  // Con el financiamiento dentro, el carro se termina antes que si fuera solo.
  assert.ok(mesesEntre(con.prestamos.find((p) => p.id === 'carro').fin, soloPrestamo.prestamos[0].fin) > 0,
    'el carro debería terminar antes al sumarle la cuota liberada');
  // Y el tipo viaja hasta el resultado, para poder mostrarlo distinto.
  assert.deepEqual(con.prestamos.map((p) => p.tipo).sort(), ['financiamiento', 'prestamo']);
});

test('la comisión que viaja en la cuota se paga pero no baja el saldo', () => {
  const ix = conFinanciamientos({
    movimientos: [{
      id: 'f3', tipo: 'gasto', fecha: '2026-02-10', monto: 12000, cuentaId: 'visa', categoriaId: 'otros', nota: 'Con comisión', actualizado: '2026-02-10T12:00:00Z',
      cuotas: { n: 12, tipo: 'intra', tasaAnual: 0, cobro: 'dia', cuotaBanco: 1000, comision: { valor: 50, unidad: 'monto', cobro: 'mensual' } },
    }],
  });
  const [f] = financiamientosParaSimular(ix);
  // La cuota es lo que se paga; la comisión va aparte, como el seguro de un préstamo.
  assert.equal(f.cuota, 1050);
  assert.equal(f.seguro, 50);
  assert.equal(f.saldo, 4000);
  // Al simular, los L50 se gastan cada mes sin bajar el saldo.
  const r = simularDeudas([f], { desde: '2026-10', rodar: false });
  assert.equal(r.prestamos[0].seguros, 50 * r.meses);
});

test('un financiamiento dice hasta qué mes ya se cobró, para que el plan arranque bien', () => {
  // Cuotas el 10 de cada mes desde febrero; al 13 de septiembre la última cobrada es la de septiembre.
  const [f] = financiamientosParaSimular(conFinanciamientos());
  assert.equal(f.ultimoPeriodo, '2026-09');
  // Uno que todavía no cobra ninguna no tiene último periodo (y el plan no debe romperse con eso).
  const doc = { movimientos: [{
    id: 'nuevo', tipo: 'gasto', fecha: '2026-10-05', monto: 6000, cuentaId: 'visa', categoriaId: 'otros', nota: 'Por empezar', actualizado: '2026-09-13T12:00:00Z',
    cuotas: { n: 6, tipo: 'intra', tasaAnual: 0, cobro: 'dia' },
  }] };
  const [sinCobrar] = financiamientosParaSimular(conFinanciamientos(doc));
  assert.equal(sinCobrar.ultimoPeriodo, null);
  assert.equal(sinCobrar.saldo, 6000);
});
