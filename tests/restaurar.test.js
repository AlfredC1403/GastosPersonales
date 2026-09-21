// Restaurar parte de un respaldo: qué se propone traer y qué se deja como está.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { diferencias, conteoPorColeccion, paraGuardar } from '../js/core/restaurar.js';

const partida = (id, nombre, extra = {}) => ({ id, nombre, tipo: 'gasto', monto: 1000, moneda: 'L', actualizado: '2026-08-01T10:00:00Z', ...extra });

const doc = (datos) => ({ ...docVacio(), ...datos });

test('propone traer lo que está vivo en el respaldo y aquí no está o está borrado', () => {
  const respaldo = doc({ partidas: [partida('a', 'Súper'), partida('b', 'Luz'), partida('c', 'Agua')] });
  const actual = doc({
    partidas: [
      partida('a', 'Súper'), // igual
      partida('b', 'Luz', { borrado: true, actualizado: '2026-09-01T10:00:00Z' }), // borrada después
      // 'c' ya no está
    ],
  });
  const d = diferencias(actual, respaldo);
  assert.deepEqual(d.map((x) => [x.id, x.estado]), [['b', 'falta'], ['c', 'falta']]);
  assert.deepEqual(conteoPorColeccion(actual, respaldo), { partidas: { falta: 2, cambio: 0 } });
});

test('una versión más nueva en el respaldo no se propone: sincronizar ya la habría traído', () => {
  const respaldo = doc({ partidas: [partida('a', 'Súper', { monto: 2000, actualizado: '2026-09-05T10:00:00Z' })] });
  const actual = doc({ partidas: [partida('a', 'Súper', { monto: 1500, actualizado: '2026-09-01T10:00:00Z' })] });
  assert.deepEqual(diferencias(actual, respaldo), []);
});

test('una versión más vieja en el respaldo se muestra aparte, como cambio', () => {
  const respaldo = doc({ partidas: [partida('a', 'Súper', { monto: 1000, actualizado: '2026-08-01T10:00:00Z' })] });
  const actual = doc({ partidas: [partida('a', 'Súper', { monto: 1500, actualizado: '2026-09-01T10:00:00Z' })] });
  const d = diferencias(actual, respaldo);
  assert.equal(d.length, 1);
  assert.equal(d[0].estado, 'cambio');
  assert.equal(d[0].registro.monto, 1000);
  assert.equal(d[0].actual.monto, 1500);
});

test('lo borrado en el respaldo no se propone, y los resúmenes se dejan fuera', () => {
  const respaldo = doc({
    partidas: [partida('a', 'Súper', { borrado: true })],
    resumenes: [{ id: '2025', anio: '2025', actualizado: '2026-01-01T00:00:00Z' }],
  });
  assert.deepEqual(diferencias(doc({}), respaldo), []);
});

test('el registro que se guarda viene sin la marca de borrado', () => {
  const respaldo = doc({ partidas: [partida('a', 'Súper')] });
  const actual = doc({ partidas: [partida('a', 'Súper', { borrado: true, actualizado: '2026-09-01T10:00:00Z' })] });
  const r = paraGuardar(diferencias(actual, respaldo)[0]);
  assert.equal('borrado' in r, false);
  assert.equal(r.nombre, 'Súper');
});

test('se puede mirar una sola colección', () => {
  const respaldo = doc({ partidas: [partida('a', 'Súper')], comercios: [{ id: 'x', nombre: 'Súper', actualizado: 't' }] });
  const d = diferencias(doc({}), respaldo, { coleccion: 'comercios' });
  assert.deepEqual(d.map((x) => x.coleccion), ['comercios']);
});
