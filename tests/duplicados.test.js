// Movimientos repetidos: el caso de dos personas anotando el mismo pago.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seParecen, confianza, parecidosA, duplicadosDelMes } from '../js/core/duplicados.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const HOY = '2026-09-21';
const mov = (id, fecha, monto, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', moneda: 'L', categoriaId: 'comida',
  creado: `${fecha}T12:00:00Z`, actualizado: `${fecha}T12:00:00Z`, ...extra,
});

function ix(movimientos = [], comercios = []) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-01' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ana', nombre: 'Ana' }];
  doc.comercios = comercios;
  doc.movimientos = movimientos;
  return crearIndice(doc, { hoy: HOY });
}

test('se parecen los del mismo tipo, cuenta y monto con pocos días de diferencia', () => {
  const a = mov('a', '2026-09-10', 1200);
  assert.equal(seParecen(a, mov('b', '2026-09-11', 1200)), true);
  assert.equal(seParecen(a, mov('b', '2026-09-12', 1200)), true, 'dos días todavía');
  assert.equal(seParecen(a, mov('b', '2026-09-13', 1200)), false, 'tres ya no');
  assert.equal(seParecen(a, mov('b', '2026-09-10', 1400)), false, 'otro monto');
  assert.equal(seParecen(a, mov('b', '2026-09-10', 1200, { cuentaId: 'ahorro' })), false, 'otra cuenta');
  assert.equal(seParecen(a, mov('b', '2026-09-10', 1200, { tipo: 'ingreso' })), false, 'otro tipo');
  assert.equal(seParecen(a, a), false, 'no se parece a sí mismo');
  // Un centavo de diferencia sigue siendo el mismo pago; cien lempiras no.
  assert.equal(seParecen(mov('a', '2026-09-10', 1200), mov('b', '2026-09-10', 1200.01)), true);
  assert.equal(seParecen(mov('a', '2026-09-10', 1200), mov('b', '2026-09-10', 1300)), false);
});

test('un financiamiento nunca es un duplicado: sus cuotas son una sola compra', () => {
  const a = mov('a', '2026-09-10', 12000, { cuotas: { n: 12, tipo: 'intra' } });
  assert.equal(seParecen(a, mov('b', '2026-09-10', 12000)), false);
});

test('la confianza sube cuando coinciden el comercio y quien lo anotó es otra persona', () => {
  const base = { fecha: '2026-09-10', monto: 1200, comercioId: 'colonia', partidaId: 'super' };
  const deMoises = mov('a', '2026-09-10', 1200, { ...base, creadoPor: 'moises' });
  const deAna = mov('b', '2026-09-10', 1200, { ...base, creadoPor: 'ana' });
  assert.equal(confianza(deMoises, deAna), 100);
  // Los dos anotados por la misma persona: es más probable que de verdad sean dos pagos.
  const mismaPersona = mov('c', '2026-09-10', 1200, { ...base, creadoPor: 'moises' });
  assert.ok(confianza(deMoises, mismaPersona) < 100);
  // Sin nada más que el monto y el día, la confianza es baja.
  assert.ok(confianza(mov('x', '2026-09-10', 300), mov('y', '2026-09-10', 300)) < 70);
});

test('antes de guardar se buscan los parecidos que ya están', () => {
  const i = ix([
    mov('a', '2026-09-10', 1200, { comercioId: 'colonia', creadoPor: 'ana' }),
    mov('b', '2026-09-10', 600, { comercioId: 'colonia' }),
    mov('c', '2026-01-10', 1200, { comercioId: 'colonia' }), // de otro mes
  ], [{ id: 'colonia', nombre: 'La Colonia' }]);

  const candidato = { fecha: '2026-09-11', monto: 1200, tipo: 'gasto', cuentaId: 'gastos', moneda: 'L', comercioId: 'colonia', creadoPor: 'moises' };
  const parecidos = parecidosA(i, candidato);
  assert.deepEqual(parecidos.map((p) => p.movimiento.id), ['a']);
  assert.ok(parecidos[0].confianza >= 70);
  // Un borrado no cuenta.
  const conBorrado = ix([mov('a', '2026-09-10', 1200, { borrado: true })]);
  assert.deepEqual(parecidosA(conBorrado, candidato), []);
  // Sin fecha o sin monto no hay nada que comparar.
  assert.deepEqual(parecidosA(i, { monto: 1200 }), []);
});

test('los repetidos de un mes se revisan todos juntos, sin repetir la pareja', () => {
  const i = ix([
    mov('a', '2026-09-10', 1200, { comercioId: 'colonia', creadoPor: 'moises' }),
    mov('b', '2026-09-11', 1200, { comercioId: 'colonia', creadoPor: 'ana' }),
    mov('c', '2026-09-20', 350, { nota: 'café' }),
    mov('d', '2026-09-20', 350, { nota: 'café' }),
    mov('e', '2026-09-25', 99, {}),
  ], [{ id: 'colonia', nombre: 'La Colonia' }]);

  const parejas = duplicadosDelMes(i, '2026-09');
  assert.deepEqual(parejas.map((p) => [p.a.id, p.b.id]), [['a', 'b'], ['c', 'd']]);
  assert.ok(parejas[0].confianza >= parejas[1].confianza);
  // Con el mínimo más alto solo queda el caso claro.
  assert.deepEqual(duplicadosDelMes(i, '2026-09', { minimo: 85 }).map((p) => p.a.id), ['a']);
});
