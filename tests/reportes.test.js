import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumenMes, gastoDelMes, historial, seriesDeGrupos, saldosCuentas } from '../js/core/reportes.js';
import { presupuestoMensual } from '../js/core/presupuesto.js';
import { deudaAl } from '../js/core/prestamos.js';
import { crearIndice } from '../js/core/asientos.js';
import { SIN_RESPONSABLE, personaDeMovimiento } from '../js/core/filtro.js';
import { docVacio } from '../js/core/modelo.js';

const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const partida = (id, datos) => ({ id, nombre: id, tipo: 'gasto', forma: 'fijo', meses: [], medioPagoId: 'gastos', activo: true, creado: '2026-09-01T00:00:00Z', ...datos });
const carro = { id: 'carro', nombre: 'Carro', tasa: 15, cuota: 8400, saldo: 150000, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10', ultimaCuota: '2028-06-02', responsableId: 'ruth', cuentaId: 'gastos', categoriaId: 'prestamos' };
const casa = { id: 'casa', nombre: 'Casa', tasa: 8.5, cuota: 13000, saldo: 1500000, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10', ultimaCuota: '2054-06-07', responsableId: 'moises', cuentaId: 'gastos', categoriaId: 'prestamos' };

function hogar() {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ruth', nombre: 'Ruth' }];
  doc.cuentas.push({ id: 'banco-ruth', nombre: 'Banco de Ruth', tipo: 'banco', moneda: 'L', saldoInicial: 0, titularId: 'ruth' });
  doc.prestamos = [carro, casa];
  doc.partidas = [
    partida('luz', { forma: 'variable', monto: 5000, categoriaId: 'servicios', responsableId: 'ruth' }),
    partida('internet', { monto: 1250, categoriaId: 'comunicaciones', responsableId: 'moises' }),
    partida('super', { forma: 'abonos', monto: 6000, categoriaId: 'comida', responsableId: 'ruth' }),
    partida('ahorro', { tipo: 'aporte', monto: 3000, categoriaId: 'ahorro', responsableId: null, cuentaDestinoId: 'ahorro' }),
  ];
  doc.ingresos = [{ id: 'sal-ruth', nombre: 'Salario Ruth', personaId: 'ruth', frecuencia: 'quincenal', diasPago: [15, 31], netoEsperado: 19000, cuentaId: 'gastos', activo: true }];
  doc.recibos = [{ id: 'r1', ingresoId: 'sal-ruth', tipo: 'ordinario', ocurrencia: '2026-10-15', periodo: '2026-10', fecha: '2026-10-15', cuentaId: 'gastos', neto: 18800, deducciones: [] }];
  const g = (id, fecha, monto, extra) => ({ id, tipo: 'gasto', periodo: fecha.slice(0, 7), fecha, monto, cuentaId: 'gastos', ...extra });
  doc.movimientos = [
    g('m1', '2026-10-03', 700, { categoriaId: 'ropa', personaId: 'moises' }),
    g('m2', '2026-10-04', 450, { cuentaId: 'banco-ruth', categoriaId: 'salud' }),
    g('m3', '2026-10-05', 300, { categoriaId: 'otros' }),
    g('m4', '2026-10-06', 5100, { categoriaId: 'servicios', partidaId: 'luz', personaId: 'moises' }),
    g('m5', '2026-10-07', 2000, { categoriaId: 'comida', partidaId: 'super', personaId: 'ruth' }),
    g('m6', '2026-10-02', 8400, { categoriaId: 'prestamos', prestamoId: 'carro', personaId: 'ruth' }),
    { id: 't1', tipo: 'transferencia', periodo: '2026-10', fecha: '2026-10-16', monto: 3000, cuentaId: 'gastos', cuentaDestinoId: 'ahorro', partidaId: 'ahorro' },
  ];
  return crearIndice(doc, { hoy: '2026-10-20' });
}

test('resumen del mes: plan, pagado, pendiente, fuera del plan y libre', () => {
  const ix = hogar();
  const r = resumenMes(ix, '2026-10');
  // plan: carro 8,400 + casa 13,000 + luz 5,100 (se pasó) + internet 1,250 + súper 6,000 + ahorro 3,000
  cerca(r.comprometido, 8400 + 13000 + 5100 + 1250 + 6000 + 3000);
  cerca(r.pagado, 8400 + 5100 + 2000 + 3000);
  cerca(r.pendiente, 13000 + 1250 + 4000);
  cerca(r.fueraDelPlan, 700 + 450 + 300);
  cerca(r.ingresoEsperado, 38000);
  cerca(r.ingresoReal, 18800);
  cerca(r.ahorro, 3000);
  // Libre: el pago del 15 cuenta con lo que llegó (18,800, ya sin deducciones) y el del 31, con el neto del salario.
  cerca(r.ingresoDelMes, 18800 + 19000);
  cerca(r.libre, 18800 + 19000 - r.comprometido - r.fueraDelPlan);
  cerca(r.gastoReal, 700 + 450 + 300 + 5100 + 2000 + 8400);
  assert.deepEqual(r.pendientes.map((it) => it.nombre), ['Casa', 'internet', 'super']);
});

test('libre: con los pagos de salario que faltan y los que ya llegaron, más otros ingresos del mes', () => {
  const ix = hogar();
  const doc = { ...ix.doc, movimientos: [...ix.doc.movimientos, { id: 'venta', tipo: 'ingreso', periodo: '2026-10', fecha: '2026-10-18', monto: 1000, cuentaId: 'gastos', categoriaId: 'otros-ingresos', personaId: 'ruth' }] };
  const r = resumenMes(crearIndice(doc, { hoy: '2026-10-20' }), '2026-10');
  cerca(r.ingresoRecibido, 18800);
  cerca(r.ingresoPorRecibir, 19000);
  cerca(r.otrosIngresos, 1000);
  cerca(r.ingresoDelMes, 38800);
  cerca(r.libre, 38800 - r.comprometido - r.fueraDelPlan);

  // Sin pagos registrados, todo sale del neto del salario.
  const sinRecibos = resumenMes(crearIndice({ ...ix.doc, recibos: [] }, { hoy: '2026-10-20' }), '2026-10');
  cerca(sinRecibos.ingresoDelMes, 38000);
  cerca(sinRecibos.ingresoRecibido, 0);
});

test('gasto por grupo y gráfico con los cinco primeros grupos y "Otros grupos"', () => {
  const ix = hogar();
  const g = gastoDelMes(ix, '2026-10');
  cerca(g.porGrupo.casa, 5100);
  cerca(g.porGrupo.comida, 2000);
  cerca(g.porGrupo.deudas, 8400);
  cerca(g.porGrupo.personal, 1000);
  cerca(g.porGrupo.salud, 450);
  cerca(g.porMedio['banco-ruth'], 450);
  const { series, valores } = seriesDeGrupos(ix);
  assert.deepEqual(series.map((s) => s.clave), ['casa', 'comida', 'transporte', 'hijos', 'deudas', 'otros']);
  const v = valores(g.porGrupo);
  cerca(v[5], 1450); // personal + salud
  cerca(v.reduce((a, x) => a + x, 0), g.total);
  const h = historial(ix, '2026-10', 3);
  assert.deepEqual(h.map((x) => x.periodo), ['2026-08', '2026-09', '2026-10']);
  assert.equal(h[0].total, 0);
});

test('filtro por persona: Moises + Ruth + sin responsable suman lo del hogar', () => {
  const ix = hogar();
  assert.equal(personaDeMovimiento(ix.doc.movimientos[1], ix.cuentas), 'ruth'); // sin persona: el titular de la cuenta
  assert.equal(personaDeMovimiento(ix.doc.movimientos[2], ix.cuentas), null);

  const periodo = '2026-10';
  const total = resumenMes(ix, periodo);
  const partes = ['moises', 'ruth', SIN_RESPONSABLE].map((p) => resumenMes(ix, periodo, { personaId: p }));
  for (const campo of ['comprometido', 'pagado', 'pendiente', 'fueraDelPlan', 'gastoReal', 'ingresoEsperado', 'ingresoReal', 'ingresoDelMes', 'libre', 'ahorro']) {
    cerca(partes.reduce((a, r) => a + r[campo], 0), total[campo]);
  }
  const [moises, ruth, sin] = partes;
  cerca(ruth.comprometido, 8400 + 5100 + 6000); // carro + luz + súper, aunque la luz la pagó Moises
  cerca(ruth.pagado, 8400 + 5100 + 2000);
  cerca(ruth.gastoReal, 450 + 2000 + 8400);
  cerca(moises.gastoReal, 700 + 5100);
  cerca(sin.comprometido, 3000);
  cerca(sin.fueraDelPlan, 300);

  const pTotal = presupuestoMensual(ix, periodo);
  const pPartes = ['moises', 'ruth', SIN_RESPONSABLE].map((p) => presupuestoMensual(ix, periodo, { personaId: p }));
  cerca(pPartes.reduce((a, r) => a + r.egresos, 0), pTotal.egresos);
  cerca(pPartes.reduce((a, r) => a + r.ingresos, 0), pTotal.ingresos);
  cerca(deudaAl(ix, periodo, { personaId: 'ruth' }) + deudaAl(ix, periodo, { personaId: 'moises' }), deudaAl(ix, periodo));
});

test('saldos de cuentas con gastos, transferencias, ajustes, recibos y una cuenta en dólares', () => {
  const doc = docVacio();
  doc.config = { ...doc.config, tasaReferencia: 24.6 };
  doc.cuentas.push({ id: 'usd', nombre: 'Ahorro en dólares', tipo: 'ahorro', moneda: 'USD', saldoInicial: 100 });
  doc.movimientos = [
    { id: '1', tipo: 'ingreso', fecha: '2026-09-01', cuentaId: 'gastos', monto: 50000 },
    { id: '2', tipo: 'gasto', fecha: '2026-09-02', cuentaId: 'gastos', monto: 1200.5 },
    { id: '3', tipo: 'transferencia', fecha: '2026-09-03', cuentaId: 'gastos', cuentaDestinoId: 'emergencias', monto: 5000 },
    { id: '4', tipo: 'ajuste', fecha: '2026-09-04', cuentaId: 'ahorro', monto: 300 },
    { id: '5', tipo: 'gasto', fecha: '2026-09-05', cuentaId: 'gastos', monto: 999, borrado: true },
    { id: '6', tipo: 'transferencia', fecha: '2026-09-06', cuentaId: 'gastos', cuentaDestinoId: 'usd', monto: 2450, tasa: 24.5 },
    { id: '7', tipo: 'gasto', fecha: '2026-09-07', cuentaId: 'usd', monto: 10, tasa: 24.7, categoriaId: 'otros' },
  ];
  doc.recibos = [{ id: 'r', ingresoId: 'x', tipo: 'ordinario', ocurrencia: '2026-09-15', fecha: '2026-09-15', cuentaId: 'gastos', neto: 1000 }];
  const ix = crearIndice(doc, { hoy: '2026-09-20' });
  const s = saldosCuentas(ix);
  cerca(s.gastos, 50000 - 1200.5 - 5000 - 2450 + 1000);
  assert.equal(s.emergencias, 5000);
  assert.equal(s.ahorro, 300);
  cerca(s.usd, 100 + 100 - 10);
  cerca(saldosCuentas(ix, '2026-09-03').gastos, 50000 - 1200.5 - 5000);
  cerca(gastoDelMes(ix, '2026-09').total, 1200.5 + 247);
});
