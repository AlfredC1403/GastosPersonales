import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  separarPorAnio, unirAnios, contenidoArchivo, archivoDe, claveDeNombre, nombreArchivo, tieneCopiasViejas, aniosDelDoc, normalizarAnio, PRINCIPAL,
} from '../js/core/anios.js';
import { docVacio, COLECCIONES, fusionarEn, COLECCIONES_ANIO, ESQUEMA } from '../js/core/modelo.js';

const mov = (id, fecha, actualizado = '2026-09-20T00:00:00Z', extra = {}) => ({ id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto: 100, cuentaId: 'gastos', actualizado, ...extra });

function doc() {
  const d = docVacio();
  d.config = { ...d.config, inicio: '2026-09' };
  d.partidas = [{ id: 'super', nombre: 'Súper', actualizado: 't' }];
  d.movimientos = [mov('a', '2026-09-10'), mov('b', '2026-12-31'), mov('c', '2027-01-02')];
  d.recibos = [{ id: 'r', ingresoId: 'sal', tipo: 'ordinario', ocurrencia: '2026-12-31', fecha: '2027-01-02', neto: 1000, actualizado: 't' }];
  d.ajustesPartida = [{ id: 'super:2027-02', partidaId: 'super', periodo: '2027-02', monto: 5000, actualizado: 't' }];
  return d;
}

const ordenado = (d) => {
  const out = { ...d };
  for (const c of COLECCIONES) out[c] = [...(d[c] || [])].sort((a, b) => a.id.localeCompare(b.id));
  return out;
};

test('nombres de archivo', () => {
  assert.equal(nombreArchivo(PRINCIPAL), 'finanzas.json');
  assert.equal(nombreArchivo('2027'), 'finanzas-2027.json');
  assert.equal(claveDeNombre('finanzas.json'), PRINCIPAL);
  assert.equal(claveDeNombre('finanzas-2026.json'), '2026');
  assert.equal(claveDeNombre('finanzas-e1-2026-09-20.json'), null);
  assert.equal(claveDeNombre('otra cosa.json'), null);
});

test('cada registro va al archivo del año de su fecha; los catálogos, al principal', () => {
  const d = doc();
  assert.equal(archivoDe(d, 'partidas', d.partidas[0]), PRINCIPAL);
  assert.equal(archivoDe(d, 'movimientos', d.movimientos[1]), '2026');
  assert.equal(archivoDe(d, 'recibos', d.recibos[0]), '2027'); // la fecha en que llegó el dinero
  assert.equal(archivoDe(d, 'ajustesPartida', d.ajustesPartida[0]), '2027');
  assert.equal(archivoDe(d, 'movimientos', { id: 'x', creado: '2025-05-01T00:00:00Z' }), '2025');
  assert.deepEqual(aniosDelDoc(d), ['2026', '2027']);
  const principal = contenidoArchivo(d, PRINCIPAL);
  assert.equal(principal.movimientos, undefined);
  assert.equal(principal.partidas.length, 1);
  assert.deepEqual(contenidoArchivo(d, '2026').movimientos.map((m) => m.id), ['a', 'b']);
});

test('separar por año y volver a unir devuelve el documento original', () => {
  const d = doc();
  const { principal, anios } = separarPorAnio(d);
  assert.deepEqual(Object.keys(anios), ['2026', '2027']);
  assert.equal(anios['2027'].anio, 2027);
  assert.equal(anios['2027'].apertura, null);
  assert.deepEqual(ordenado(unirAnios(principal, anios)), ordenado(d));
});

test('un movimiento que pasa de diciembre a enero queda vivo en un solo archivo', () => {
  const antes = doc();
  const archivos = separarPorAnio(antes).anios;

  // Se edita la fecha: del 31 de diciembre al 1 de enero.
  const despues = { ...antes, movimientos: antes.movimientos.map((m) => (m.id === 'b' ? mov('b', '2027-01-01', '2026-09-21T00:00:00Z') : m)) };
  assert.deepEqual(contenidoArchivo(despues, '2026').movimientos.map((m) => m.id), ['a']);
  assert.deepEqual(contenidoArchivo(despues, '2027').movimientos.map((m) => m.id).sort(), ['b', 'c']);

  // Otro dispositivo todavía tiene el archivo 2026 con la copia vieja: se detecta para volver a subirlo.
  assert.ok(tieneCopiasViejas(despues, '2026', archivos['2026']));
  assert.ok(!tieneCopiasViejas(despues, '2026', contenidoArchivo(despues, '2026')));

  // Al leer los dos archivos, gana la copia más reciente y queda una sola.
  const unido = unirAnios(contenidoArchivo(despues, PRINCIPAL), { 2026: archivos['2026'], 2027: contenidoArchivo(despues, '2027') });
  const copias = unido.movimientos.filter((m) => m.id === 'b');
  assert.equal(copias.length, 1);
  assert.equal(copias[0].fecha, '2027-01-01');
  const fusionado = fusionarEn(despues, archivos['2026'], COLECCIONES_ANIO);
  assert.equal(fusionado.movimientos.find((m) => m.id === 'b').fecha, '2027-01-01');
});

test('un archivo de año se valida y se completa', () => {
  assert.deepEqual(normalizarAnio({ esquema: 2, movimientos: [mov('a', '2026-01-01')] }, '2026').recibos, []);
  assert.throws(() => normalizarAnio({ esquema: ESQUEMA + 1 }, '2026'), (e) => e.codigo === 'esquema_nuevo');
  assert.throws(() => normalizarAnio(null, '2026'));
});
