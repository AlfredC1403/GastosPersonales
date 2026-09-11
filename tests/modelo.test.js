import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio, fusionar, sellar, normalizar, esPristino } from '../js/core/modelo.js';

const reg = (id, actualizado, extra = {}) => ({ id, nombre: id, actualizado, ...extra });

test('fusionar conserva lo de ambos y gana la edición más reciente', () => {
  const a = { ...docVacio(), movimientos: [reg('1', '2026-09-10T10:00:00Z', { monto: 1 }), reg('2', '2026-09-10T10:00:00Z')] };
  const b = { ...docVacio(), movimientos: [reg('1', '2026-09-10T11:00:00Z', { monto: 5 }), reg('3', '2026-09-10T09:00:00Z')] };
  const f = fusionar(a, b);
  const porId = Object.fromEntries(f.movimientos.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(porId).sort(), ['1', '2', '3']);
  assert.equal(porId['1'].monto, 5);
});

test('un borrado más reciente no revive', () => {
  const a = { ...docVacio(), movimientos: [reg('1', '2026-09-10T12:00:00Z', { borrado: true })] };
  const b = { ...docVacio(), movimientos: [reg('1', '2026-09-10T11:00:00Z')] };
  assert.equal(fusionar(a, b).movimientos[0].borrado, true);
  assert.equal(fusionar(b, a).movimientos[0].borrado, true);
});

test('fusionar da el mismo resultado en ambos sentidos (empates incluidos)', () => {
  const a = { ...docVacio(), movimientos: [reg('1', 't', { monto: 1 })] };
  const b = { ...docVacio(), movimientos: [reg('1', 't', { monto: 2 })] };
  assert.deepEqual(fusionar(a, b).movimientos, fusionar(b, a).movimientos);
});

test('los valores por defecto nunca pisan datos reales', () => {
  const real = { ...docVacio(), cuentas: docVacio().cuentas.map((c) => (c.id === 'emergencias' ? { ...c, meta: 200000, actualizado: '2026-09-10' } : c)) };
  const f = fusionar(docVacio(), real);
  assert.equal(f.cuentas.find((c) => c.id === 'emergencias').meta, 200000);
  assert.equal(f.cuentas.length, 4);
});

test('sellar registra quién crea y quién edita', () => {
  const r1 = sellar({ monto: 10 }, 'ruth', '2026-09-10T10:00:00Z');
  assert.ok(r1.id);
  assert.equal(r1.creadoPor, 'ruth');
  const r2 = sellar({ ...r1, monto: 20 }, 'moises', '2026-09-11T10:00:00Z');
  assert.equal(r2.creadoPor, 'ruth');
  assert.equal(r2.actualizadoPor, 'moises');
  assert.equal(r2.creado, '2026-09-10T10:00:00Z');
});

test('normalizar valida el formato y completa lo que falte', () => {
  assert.throws(() => normalizar({ hola: 1 }));
  assert.throws(() => normalizar([]));
  const d = normalizar({ esquema: 1, movimientos: [reg('1', 't')] });
  assert.equal(d.cuentas.length, 4);
  assert.equal(d.movimientos.length, 1);
  assert.ok(esPristino(docVacio()));
  assert.ok(!esPristino(d));
});
