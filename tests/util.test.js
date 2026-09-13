import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumarMeses, mesesEntre, dinero, dineroCorto, duracion, fechaEnMes, ultimoDia, aCentavos, deCentavos, slug } from '../js/core/util.js';

test('periodos y formato', () => {
  assert.equal(sumarMeses('2026-09', 4), '2027-01');
  assert.equal(sumarMeses('2026-01', -1), '2025-12');
  assert.equal(mesesEntre('2026-09', '2055-01'), 340);
  assert.equal(dinero(-1234.5), '-L1,234.50');
  assert.equal(dineroCorto(1679956.53), 'L1.68M');
  assert.equal(duracion(15), '1 año y 3 meses');
  assert.equal(duracion(11), '11 meses');
});

test('día 31 = último día del mes, también en febrero bisiesto', () => {
  assert.equal(ultimoDia('2026-02'), 28);
  assert.equal(ultimoDia('2028-02'), 29);
  assert.equal(fechaEnMes('2026-02', 31), '2026-02-28');
  assert.equal(fechaEnMes('2028-02', 31), '2028-02-29');
  assert.equal(fechaEnMes('2026-09', 15), '2026-09-15');
  assert.equal(fechaEnMes('2026-09', 0), '2026-09-01');
});

test('centavos sin residuos', () => {
  assert.equal(aCentavos(0.1) + aCentavos(0.2), aCentavos(0.3));
  assert.equal(aCentavos(3333.33) + aCentavos(2666.67), aCentavos(6000));
  assert.equal(deCentavos(aCentavos(1450.35)), 1450.35);
  assert.equal(aCentavos('abc'), 0);
});

test('slug para ids', () => {
  assert.equal(slug('Súper La Colonia'), 'super-la-colonia');
  assert.equal(slug('  Pizza Hut #12 '), 'pizza-hut-12');
  assert.equal(slug('Ñandú'), 'nandu');
});
