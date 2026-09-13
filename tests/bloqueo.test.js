import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configurarEntorno, esPinValido, esperaPara, activarPin, verificarPin, pinActivo, largoPin, minutosBloqueo,
  cambiarPin, desactivarPin, definirMinutos, quitarPin, estadoIntentos, debeBloquear, MAX_FALLOS,
} from '../js/bloqueo.js';

let datos;
let reloj;

beforeEach(() => {
  datos = new Map();
  reloj = 1_000_000;
  configurarEntorno({
    almacen: {
      leer: (k) => (datos.has(k) ? JSON.parse(datos.get(k)) : null),
      escribir: (k, v) => datos.set(k, JSON.stringify(v)),
      borrar: (k) => datos.delete(k),
    },
    ahora: () => reloj,
    ciclos: 1000, // rápido en pruebas
  });
});

test('valida el formato del PIN', () => {
  assert.ok(esPinValido('1234'));
  assert.ok(esPinValido('123456'));
  assert.ok(!esPinValido('123'));
  assert.ok(!esPinValido('1234567'));
  assert.ok(!esPinValido('12a4'));
  assert.ok(!esPinValido(null));
});

test('la espera empieza al quinto fallo y se duplica', () => {
  assert.equal(esperaPara(0), 0);
  assert.equal(esperaPara(MAX_FALLOS - 1), 0);
  assert.equal(esperaPara(5), 30000);
  assert.equal(esperaPara(6), 60000);
  assert.equal(esperaPara(7), 120000);
});

test('activar y verificar; nunca se guarda el PIN en claro', async () => {
  assert.ok(!pinActivo());
  assert.deepEqual(await verificarPin('0000'), { ok: true }); // sin PIN no bloquea
  await activarPin('4821', 5);
  assert.ok(pinActivo());
  assert.equal(largoPin(), 4);
  assert.equal(minutosBloqueo(), 5);
  assert.ok(![...datos.values()].some((v) => v.includes('4821')));
  assert.equal((await verificarPin('4821')).ok, true);
  assert.equal((await verificarPin('1111')).ok, false);
  await assert.rejects(() => activarPin('12'), /4 a 6/);
});

test('después de 5 fallos hay que esperar, incluso con el PIN correcto', async () => {
  await activarPin('4821');
  for (let i = 1; i < MAX_FALLOS; i++) {
    const r = await verificarPin('0000');
    assert.equal(r.espera, 0);
    assert.equal(r.fallos, i);
  }
  const quinto = await verificarPin('0000');
  assert.equal(quinto.espera, 30000);
  const bloqueado = await verificarPin('4821');
  assert.equal(bloqueado.ok, false);
  assert.ok(bloqueado.espera > 0);
  reloj += 30000;
  const sexto = await verificarPin('9999');
  assert.equal(sexto.espera, 60000);
  reloj += 60000;
  assert.equal((await verificarPin('4821')).ok, true);
  assert.equal(estadoIntentos().fallos, 0);
});

test('cambiar y desactivar exigen el PIN actual', async () => {
  await activarPin('4821', 15);
  await assert.rejects(() => cambiarPin('0000', '5555'), /actual/);
  await cambiarPin('4821', '555555');
  assert.equal(largoPin(), 6);
  assert.equal(minutosBloqueo(), 15); // conserva el tiempo
  assert.equal((await verificarPin('555555')).ok, true);
  await assert.rejects(() => desactivarPin('4821'), /actual/);
  await desactivarPin('555555');
  assert.ok(!pinActivo());
});

test('tiempo de bloqueo y quitar el PIN', async () => {
  await activarPin('4821', 1);
  definirMinutos(0);
  assert.equal(minutosBloqueo(), 0);
  definirMinutos(7); // no permitido: se ignora
  assert.equal(minutosBloqueo(), 0);
  quitarPin();
  assert.ok(!pinActivo());
});

test('cuándo bloquear al volver', () => {
  assert.equal(debeBloquear(null, 5000, 1), false);
  assert.equal(debeBloquear(0, 59999, 1), false);
  assert.equal(debeBloquear(0, 60000, 1), true);
  assert.equal(debeBloquear(1000, 1000, 0), true); // inmediato
});
