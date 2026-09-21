// Registro rápido: qué comercios propone la app y con qué monto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { comerciosFrecuentes, gastoSugerido } from '../js/core/frecuentes.js';

const HOY = '2026-09-13';

const comercio = (id, nombre, extra = {}) => ({ id, nombre, categoriaId: null, partidaId: null, medioPagoId: null, moneda: 'L', actualizado: 't', ...extra });
const gasto = (id, fecha, monto, comercioId, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', moneda: 'L', comercioId,
  categoriaId: 'comida', partidaId: null, personaId: 'moises', etiquetas: [], creado: `${fecha}T12:00:00Z`, actualizado: `${fecha}T12:00:00Z`, ...extra,
});

function ix(datos) {
  const d = { ...docVacio(), ...datos };
  d.config = { ...d.config, inicio: '2026-01' };
  d.personas = [{ id: 'moises', nombre: 'Moises', actualizado: 't' }, { id: 'ana', nombre: 'Ana', actualizado: 't' }];
  return crearIndice(d, { hoy: HOY });
}

test('propone los comercios que se repiten, del más frecuente al menos', () => {
  const lista = comerciosFrecuentes(ix({
    comercios: [comercio('super', 'Súper'), comercio('cafe', 'Café'), comercio('ferre', 'Ferretería')],
    movimientos: [
      gasto('a', '2026-09-01', 800, 'super'), gasto('b', '2026-08-15', 1200, 'super'), gasto('c', '2026-07-20', 900, 'super'),
      gasto('d', '2026-09-10', 75, 'cafe'), gasto('e', '2026-09-03', 75, 'cafe'),
      gasto('f', '2026-08-02', 450, 'ferre'), // una sola vez: no alcanza
    ],
  }));
  assert.deepEqual(lista.map((f) => f.comercioId), ['super', 'cafe']);
  assert.equal(lista[0].veces, 3);
  assert.equal(lista[0].ultima, '2026-09-01');
});

test('el monto propuesto es el que más se repite y, si ninguno se repite, la mediana', () => {
  const lista = comerciosFrecuentes(ix({
    comercios: [comercio('cafe', 'Café'), comercio('super', 'Súper')],
    movimientos: [
      gasto('a', '2026-09-10', 75, 'cafe'), gasto('b', '2026-09-03', 75, 'cafe'), gasto('c', '2026-08-28', 120, 'cafe'),
      gasto('d', '2026-09-01', 800, 'super'), gasto('e', '2026-08-15', 1200, 'super'), gasto('f', '2026-07-20', 1000, 'super'),
    ],
  }));
  const por = Object.fromEntries(lista.map((f) => [f.comercioId, f]));
  assert.equal(por.cafe.monto, 75); // se repite
  assert.equal(por.super.monto, 1000); // ninguno se repite: la mediana
});

test('no mira más atrás de los meses pedidos ni cuenta las compras a cuotas', () => {
  const datos = {
    comercios: [comercio('super', 'Súper')],
    movimientos: [
      gasto('a', '2026-09-01', 800, 'super'), gasto('b', '2026-02-15', 900, 'super'),
      gasto('c', '2026-08-10', 5000, 'super', { cuotas: 6 }),
    ],
  };
  assert.deepEqual(comerciosFrecuentes(ix(datos)), []);
  assert.equal(comerciosFrecuentes(ix(datos), { meses: 12 }).length, 1);
});

test('el filtro por persona deja fuera lo que anotó alguien más', () => {
  const datos = {
    comercios: [comercio('super', 'Súper')],
    movimientos: [
      gasto('a', '2026-09-01', 800, 'super'), gasto('b', '2026-08-15', 900, 'super'),
      gasto('c', '2026-09-05', 300, 'super', { personaId: 'ana' }),
    ],
  };
  assert.equal(comerciosFrecuentes(ix(datos))[0].veces, 3);
  assert.equal(comerciosFrecuentes(ix(datos), { filtro: { personaId: 'moises' } })[0].veces, 2);
  assert.deepEqual(comerciosFrecuentes(ix(datos), { filtro: { personaId: 'ana' } }), []);
});

test('el gasto sugerido queda listo para guardarse', () => {
  const f = comerciosFrecuentes(ix({
    comercios: [comercio('super', 'Súper')],
    movimientos: [
      gasto('a', '2026-09-01', 800, 'super', { partidaId: 'mercado', etiquetas: ['casa'] }),
      gasto('b', '2026-08-15', 800, 'super', { partidaId: 'mercado', etiquetas: ['casa'] }),
    ],
  }))[0];
  const m = gastoSugerido(f, { fecha: HOY, personaId: 'moises' });
  assert.equal(m.tipo, 'gasto');
  assert.equal(m.periodo, '2026-09');
  assert.equal(m.monto, 800);
  assert.equal(m.partidaId, 'mercado');
  assert.equal(m.comercioId, 'super');
  assert.deepEqual(m.etiquetas, ['casa']);
});
