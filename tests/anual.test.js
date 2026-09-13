import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { resumenAnual, compararAnios, patrimonioAl, mismoDiaEn, diferencia } from '../js/core/reportes.js';

const T = (fecha) => `${fecha}T12:00:00Z`;

function libro(movimientos, hoy, extra = {}) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2025-01' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ruth', nombre: 'Ruth' }];
  doc.cuentas = doc.cuentas.map((c) => (c.id === 'gastos' ? { ...c, saldoInicial: 10000 } : c));
  doc.movimientos = movimientos;
  Object.assign(doc, extra);
  return crearIndice(doc, { hoy });
}
const gasto = (id, fecha, monto, categoriaId, personaId, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), cuentaId: 'gastos', monto, categoriaId, personaId, creado: T(fecha), ...extra,
});
const MOVIMIENTOS = [
  gasto('a', '2025-02-10', 1000, 'comida', 'moises'),
  gasto('b', '2025-03-20', 500, 'comida', 'ruth'),
  gasto('c', '2025-06-01', 700, 'transporte', 'ruth'),
  gasto('d', '2026-01-05', 1200, 'comida', 'ruth'),
  gasto('e', '2026-03-14', 300, 'transporte', 'moises'),
];

test('en lo que va del año los dos años cortan el mismo día; año completo compara todo', () => {
  const ix = libro(MOVIMIENTOS, '2026-03-15');
  let c = compararAnios(ix, 2026, 2025, { modo: 'va' });
  assert.deepEqual([c.corteA, c.corteB], ['2026-03-15', '2025-03-15']);
  const gastoDe = (x) => x.filas.find((f) => f.clave === 'gasto');
  assert.deepEqual(gastoDe(c), { clave: 'gasto', nombre: 'Gasto', sentido: -1, A: 1500, B: 1000, dif: 500, pct: 50 });
  assert.deepEqual(c.grupos.map((g) => [g.id, g.A, g.B, g.pct]), [['comida', 1200, 1000, 20], ['transporte', 300, 0, null]]);
  assert.deepEqual(c.meses.slice(1, 4).map((m) => [m.A, m.B]), [[0, 1000], [300, 0], [null, null]]);

  c = compararAnios(ix, 2026, 2025, { modo: 'completo' });
  assert.deepEqual([gastoDe(c).B, gastoDe(c).dif, gastoDe(c).pct], [2200, -700, -31.8]);
});

test('el filtro de persona cambia los dos años, y un año sin registros se marca sin datos', () => {
  const ix = libro(MOVIMIENTOS, '2026-03-15');
  const c = compararAnios(ix, 2026, 2025, { modo: 'va', filtro: { personaId: 'moises' } });
  assert.deepEqual([c.filas[3].A, c.filas[3].B], [300, 1000]);
  const vacio = compararAnios(ix, 2026, 2024);
  assert.deepEqual([vacio.sinDatosA, vacio.sinDatosB], [false, true]);
  assert.deepEqual(diferencia(100, 0), { dif: 100, pct: null });
  assert.deepEqual(diferencia(0, 0), { dif: 0, pct: null });
  assert.equal(mismoDiaEn(2025, '2028-02-29'), '2025-02-28');
});

test('resumen anual: ingresos bruto y neto, deducciones por concepto, recibos incompletos, salidas de dinero y patrimonio', () => {
  const ingresos = [{ id: 'sal', nombre: 'Salario', personaId: 'moises', frecuencia: 'mensual', diasPago: [31], netoEsperado: 14000, cuentaId: 'gastos', activo: true, deducciones: [] }];
  const recibos = [{
    id: 'r1', ingresoId: 'sal', ocurrencia: '2026-01-31', tipo: 'ordinario', fecha: '2026-01-31', periodo: '2026-01', cuentaId: 'gastos', neto: 14000,
    deducciones: [{ deduccionId: 'ihss', nombre: 'IHSS', monto: 600 }, { deduccionId: 'isr', nombre: 'ISR', monto: null }],
  }];
  const prestamos = [{ id: 'casa', nombre: 'Casa', tasa: 12, cuota: 1000, saldo: 50000, saldoPeriodo: '2026-01', fechaSaldo: '2026-01-31', ultimaCuota: '2035-01-07', responsableId: 'moises', cuentaId: 'gastos' }];
  const ix = libro(MOVIMIENTOS, '2026-03-15', { ingresos, recibos, prestamos });
  const r = resumenAnual(ix, 2026, null, { hasta: '2026-03-15' });
  assert.deepEqual([r.ingresos.bruto, r.ingresos.neto, r.ingresos.incompletos, r.deducciones.porConcepto], [14600, 14000, 1, { IHSS: 600 }]);
  assert.deepEqual([r.gasto.total, r.salidas, r.meses[0].neto, r.meses[3].incluido], [1500, 1500, 14000, false]);
  // Cuentas: L10,000 iniciales − L2,200 de 2025 − L1,500 de 2026 + L14,000 del salario; préstamo de L50,000.
  assert.deepEqual(patrimonioAl(ix, '2026-03-15'), { cuentas: 20300, tarjetas: 0, prestamos: 50000, total: -29700 });
  assert.deepEqual([r.patrimonio.fin.total, r.deuda.fin], [-29700, 50000]);
  assert.equal(resumenAnual(ix, 2025).gasto.total, 2200);
});
