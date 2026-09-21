// Cifrado del documento guardado en este dispositivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salNueva, claveDesde, cifrar, descifrar, esSobre } from '../js/cifrado.js';

const CICLOS = 1000; // rápido en pruebas; en la app son 210,000

test('lo que se cifra se vuelve a abrir igual con el mismo PIN', async () => {
  const sal = salNueva();
  const clave = await claveDesde('1234', sal, CICLOS);
  const texto = JSON.stringify({ esquema: 4, movimientos: [{ id: 'm1', monto: 1234.56, nota: 'súper' }] });
  const sobre = await cifrar(clave, texto);

  assert.ok(esSobre(sobre));
  assert.ok(!sobre.includes('súper')); // nada del contenido queda a la vista
  assert.equal(await descifrar(clave, sobre), texto);

  // La misma sal y el mismo PIN dan la misma clave: otra sesión puede abrirlo.
  assert.equal(await descifrar(await claveDesde('1234', sal, CICLOS), sobre), texto);
});

test('con otro PIN no se abre', async () => {
  const sal = salNueva();
  const sobre = await cifrar(await claveDesde('1234', sal, CICLOS), 'hola');
  const otra = await claveDesde('4321', sal, CICLOS);
  await assert.rejects(() => descifrar(otra, sobre), (e) => e.codigo === 'clave_mala');
});

test('con otra sal tampoco, aunque el PIN sea el mismo', async () => {
  const sobre = await cifrar(await claveDesde('1234', salNueva(), CICLOS), 'hola');
  const otra = await claveDesde('1234', salNueva(), CICLOS);
  await assert.rejects(() => descifrar(otra, sobre), (e) => e.codigo === 'clave_mala');
});

test('cada vez sale un sobre distinto, aunque el contenido sea el mismo', async () => {
  const clave = await claveDesde('1234', salNueva(), CICLOS);
  const a = await cifrar(clave, 'hola');
  const b = await cifrar(clave, 'hola');
  assert.notEqual(a, b); // el vector de inicialización cambia en cada escritura
  assert.equal(await descifrar(clave, a), await descifrar(clave, b));
});

test('un sobre alterado no se abre', async () => {
  const clave = await claveDesde('1234', salNueva(), CICLOS);
  const s = JSON.parse(await cifrar(clave, 'hola que tal'));
  s.datos = `A${s.datos.slice(1)}`;
  await assert.rejects(() => descifrar(clave, JSON.stringify(s)), (e) => e.codigo === 'clave_mala');
});

test('un texto en claro no se confunde con un sobre', () => {
  assert.ok(!esSobre('{"esquema":4,"movimientos":[]}'));
  assert.ok(!esSobre(null));
  assert.ok(!esSobre(undefined));
});

test('un sobre de una versión más nueva se rechaza con su propio código', async () => {
  const clave = await claveDesde('1234', salNueva(), CICLOS);
  const s = JSON.parse(await cifrar(clave, 'hola'));
  await assert.rejects(
    () => descifrar(clave, JSON.stringify({ ...s, cifrado: 99 })),
    (e) => e.codigo === 'sobre_nuevo',
  );
});
