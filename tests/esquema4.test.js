// Esquema 4: etiquetas en los movimientos, topes, renovaciones y la tasa del dólar por mes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrar, normalizar } from '../js/core/migraciones.js';
import { docVacio, ESQUEMA, fusionar } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { tasasOrdenadas, tasaEnLista, prepararTasas, ultimaTasaAnotada, mesesSinAnotar, idTasa } from '../js/core/tasas.js';
import { estadoTopes, resumenTopes, categoriaCubierta } from '../js/core/topes.js';
import { estadoRenovaciones, renovacionesPendientes, fechaSiguiente, renovada, costoAnual, renovacionesDelMes } from '../js/core/renovaciones.js';
import { estadoPartidas } from '../js/core/presupuesto.js';

const HOY = '2026-09-13';
const tasa = (periodo, valor) => ({ id: idTasa(periodo), periodo, valor, actualizado: 't' });

function doc(datos = {}) {
  const d = { ...docVacio(), ...datos };
  d.config = { ...d.config, inicio: '2026-01', tasaReferencia: null, tasaReferenciaDesde: '', ...(datos.config || {}) };
  d.personas = [{ id: 'moises', nombre: 'Moises', actualizado: 't' }];
  return d;
}
const ix = (datos, hoy = HOY) => crearIndice(doc(datos), { hoy });

const gasto = (id, fecha, monto, categoriaId, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', moneda: 'L', categoriaId,
  creado: `${fecha}T12:00:00Z`, actualizado: `${fecha}T12:00:00Z`, ...extra,
});

// ---------------------------------------------------------------- Migración del 3 al 4

test('del 3 al 4: los movimientos llevan etiquetas y aparecen las listas nuevas', () => {
  const v3 = {
    esquema: 3,
    config: { moneda: 'L', inicio: '2026-01', tasaReferencia: 24.5, tasaReferenciaDesde: '2026-03-18' },
    cuentas: [{ id: 'gastos', nombre: 'Gastos', tipo: 'gastos', moneda: 'L', saldoInicial: 0, titularId: null, actualizado: 't' }],
    movimientos: [gasto('m1', '2026-03-05', 500, 'comida')],
  };
  const salida = migrar(v3);

  assert.equal(salida.esquema, ESQUEMA);
  assert.deepEqual(salida.movimientos[0].etiquetas, []);
  // Nada cambia de valor ni de fecha de edición.
  assert.equal(salida.movimientos[0].monto, 500);
  assert.equal(salida.movimientos[0].actualizado, '2026-03-05T12:00:00Z');
  // La tasa suelta pasa a ser la tasa de su mes.
  assert.deepEqual(salida.tasas.map((t) => [t.periodo, t.valor]), [['2026-03', 24.5]]);
  assert.equal(salida.tasas[0].actualizado, '', 'la semilla no pisa datos reales al fusionar');
});

test('del 3 al 4: migrar dos veces no cambia nada, y dos celulares llegan a lo mismo', () => {
  const v3 = {
    esquema: 3,
    config: { moneda: 'L', inicio: '2026-01', tasaReferencia: 24.5, tasaReferenciaDesde: '2026-03-18' },
    cuentas: docVacio().cuentas,
    movimientos: [gasto('m1', '2026-03-05', 500, 'comida')],
  };
  const una = normalizar(v3);
  assert.deepEqual(normalizar(una), una);
  // Un celular ya migrado y otro que migra ahora llegan al mismo documento.
  assert.deepEqual(fusionar(una, normalizar(v3)), una);
});

test('del 3 al 4: unas etiquetas ya puestas y una lista de tasas propia se respetan', () => {
  const salida = migrar({
    esquema: 4,
    config: { inicio: '2026-01', tasaReferencia: 24.5, tasaReferenciaDesde: '2026-03-18' },
    cuentas: docVacio().cuentas,
    movimientos: [gasto('m1', '2026-03-05', 500, 'comida', { etiquetas: ['roatan'] })],
    tasas: [tasa('2026-03', 25.9)],
  });
  assert.deepEqual(salida.movimientos[0].etiquetas, ['roatan']);
  // La lista del archivo manda sobre la tasa suelta de la configuración.
  assert.deepEqual(salida.tasas.map((t) => t.valor), [25.9]);
});

// ---------------------------------------------------------------- Tasa del dólar por mes

test('cada mes usa su tasa, y un mes sin tasa propia usa la última anterior', () => {
  const d = doc({ tasas: [tasa('2026-01', 24), tasa('2026-06', 26)] });
  const tasaEn = prepararTasas(d, HOY);
  assert.equal(tasaEn('2026-01'), 24);
  assert.equal(tasaEn('2026-05'), 24, 'sin tasa propia, la última anterior');
  assert.equal(tasaEn('2026-06'), 26);
  assert.equal(tasaEn('2026-09'), 26);
  assert.equal(tasaEn('2025-12'), 24, 'antes de la primera, la más antigua');
  assert.equal(tasaEn(), 26, 'sin mes, la de hoy');
});

test('sin lista de tasas se usa la de la configuración, como antes', () => {
  const d = doc({ config: { tasaReferencia: 24.5, tasaReferenciaDesde: '2026-03-18' } });
  assert.deepEqual(tasasOrdenadas(d).map((t) => [t.periodo, t.valor]), [['2026-03', 24.5]]);
  assert.equal(prepararTasas(d, HOY)('2026-08'), 24.5);
  assert.equal(tasaEnLista([], '2026-08', 19), 19, 'y sin nada, el respaldo que se le pase');
});

test('una partida en dólares se valora con la tasa de su mes, no con la de hoy', () => {
  const partida = {
    id: 'icloud', nombre: 'iCloud', tipo: 'gasto', forma: 'fijo', categoriaId: 'suscripciones', monto: 10, moneda: 'USD',
    meses: [], medioPagoId: 'gastos', activo: true, responsableId: 'moises', creado: '2024-01-01T00:00:00Z', actualizado: 't',
  };
  const i = ix({ partidas: [partida], tasas: [tasa('2024-01', 24), tasa('2026-09', 26)] });
  const en = (periodo) => estadoPartidas(i, periodo, null).find((x) => x.partida.id === 'icloud').esperado;
  assert.equal(en('2024-06'), 240, 'junio de 2024 se valora con la tasa de 2024');
  assert.equal(en('2026-09'), 260);
});

test('la última tasa anotada y cuántos meses van sin anotar', () => {
  const d = doc({ tasas: [tasa('2026-01', 24), tasa('2026-07', 26)] });
  assert.equal(ultimaTasaAnotada(d).periodo, '2026-07');
  assert.equal(mesesSinAnotar(d, '2026-09-13'), 2);
  assert.equal(mesesSinAnotar(d, '2026-07-31'), 0);
  assert.equal(mesesSinAnotar(doc(), '2026-09-13'), null, 'sin ninguna tasa, no hay nada que comparar');
});

// ---------------------------------------------------------------- Topes

const tope = (id, ambito, referenciaId, monto, extra = {}) => ({ id, ambito, referenciaId, monto, moneda: 'L', activo: true, actualizado: 't', ...extra });

test('un tope vigila también lo que se gasta fuera del plan', () => {
  const i = ix({
    topes: [tope('t1', 'categoria', 'restaurantes', 2000)],
    // Ninguno tiene partida: son gastos fuera del plan, que es donde un tope hace falta.
    movimientos: [gasto('m1', '2026-09-02', 1200, 'restaurantes'), gasto('m2', '2026-09-08', 500, 'restaurantes')],
  });
  const [t] = estadoTopes(i, '2026-09', null);
  assert.equal(t.gastado, 1700);
  assert.equal(t.queda, 300);
  assert.equal(t.pct, 85);
  assert.equal(t.estado, 'cerca', 'pasó del 80 % por defecto');
});

test('un tope de grupo suma todas las categorías del grupo', () => {
  const i = ix({
    topes: [tope('t1', 'grupo', 'personal', 1000)],
    movimientos: [gasto('m1', '2026-09-02', 700, 'ropa'), gasto('m2', '2026-09-08', 500, 'entretenimiento'), gasto('m3', '2026-09-08', 900, 'comida')],
  });
  const [t] = estadoTopes(i, '2026-09', null);
  assert.equal(t.gastado, 1200, 'ropa y entretenimiento; la comida es de otro grupo');
  assert.equal(t.estado, 'pasado');
  assert.equal(t.queda, -200);
});

test('un tope en dólares se pasa a lempiras con la tasa de su mes', () => {
  const i = ix({
    topes: [tope('t1', 'categoria', 'entretenimiento', 100, { moneda: 'USD' })],
    tasas: [tasa('2026-09', 26)],
    movimientos: [gasto('m1', '2026-09-02', 1300, 'entretenimiento')],
  });
  const [t] = estadoTopes(i, '2026-09', null);
  assert.equal(t.monto, 2600);
  assert.equal(t.pct, 50);
});

test('el aviso de un tope se puede correr, y un tope apagado o sin monto no cuenta', () => {
  const i = ix({
    topes: [
      tope('t1', 'categoria', 'restaurantes', 1000, { avisarEn: 50 }),
      tope('t2', 'categoria', 'ropa', 1000, { activo: false }),
      tope('t3', 'categoria', 'salud', 0),
    ],
    movimientos: [gasto('m1', '2026-09-02', 600, 'restaurantes'), gasto('m2', '2026-09-02', 900, 'ropa')],
  });
  const lista = estadoTopes(i, '2026-09', null);
  assert.deepEqual(lista.map((t) => t.id), ['t1']);
  assert.equal(lista[0].estado, 'cerca');
});

test('el resumen de topes cuenta los pasados y los que van cerca', () => {
  const i = ix({
    topes: [tope('t1', 'categoria', 'restaurantes', 1000), tope('t2', 'categoria', 'ropa', 1000), tope('t3', 'categoria', 'salud', 1000)],
    movimientos: [gasto('m1', '2026-09-02', 1100, 'restaurantes'), gasto('m2', '2026-09-02', 850, 'ropa'), gasto('m3', '2026-09-02', 100, 'salud')],
  });
  const r = resumenTopes(i, '2026-09', null);
  assert.equal(r.techo, 3000);
  assert.equal(r.gastado, 2050);
  assert.equal(r.pasados, 1);
  assert.equal(r.cerca, 1);
  // El tope del grupo cubre a todas sus categorías: no hace falta uno por cada una.
  const conGrupo = ix({ topes: [tope('g', 'grupo', 'personal', 5000)] });
  assert.equal(categoriaCubierta(conGrupo, 'ropa'), true);
  assert.equal(categoriaCubierta(conGrupo, 'comida'), false);
});

// ---------------------------------------------------------------- Renovaciones

const renovacion = (id, vence, extra = {}) => ({
  id, nombre: id, vence, avisarDias: 30, monto: 0, moneda: 'L', repetir: 'meses', cadaMeses: 12,
  responsableId: 'moises', activo: true, actualizado: 't', ...extra,
});

test('una renovación avisa con los días que se le pidieron', () => {
  const i = ix({
    renovaciones: [
      renovacion('seguro', '2026-10-01'), // faltan 18 días: dentro de los 30
      renovacion('licencia', '2026-12-01'), // faltan más de 30
      renovacion('extintor', '2026-09-01'), // venció hace 12
      renovacion('pasaporte', '2026-09-20', { avisarDias: 3 }), // faltan 7, pero avisa con 3
    ],
  });
  const estados = Object.fromEntries(estadoRenovaciones(i, { hoy: HOY }).map((r) => [r.id, r.estado]));
  assert.deepEqual(estados, { extintor: 'vencida', seguro: 'avisa', pasaporte: 'lejos', licencia: 'lejos' });
  assert.deepEqual(renovacionesPendientes(i, { hoy: HOY }).map((r) => r.id), ['extintor', 'seguro']);
});

test('la fecha siguiente conserva el día del mes y alcanza al presente', () => {
  const anual = renovacion('seguro', '2024-01-31');
  assert.equal(fechaSiguiente(anual, '2026-09-21'), '2027-01-31', 'olvidada tres años, propone la próxima de verdad');
  assert.equal(fechaSiguiente(renovacion('x', '2026-01-31'), '2026-09-21'), '2027-01-31');
  // Cada 6 meses, y en un mes más corto cae en el último día.
  assert.equal(fechaSiguiente(renovacion('y', '2026-08-31', { cadaMeses: 6 }), '2026-09-21'), '2027-02-28');
  assert.equal(fechaSiguiente(renovacion('z', '2026-10-01', { repetir: 'ninguna' }), '2026-09-21'), null);
});

test('renovar mueve la fecha, y una que no se repite se apaga', () => {
  assert.equal(renovada(renovacion('seguro', '2026-09-01'), HOY).vence, '2027-09-01');
  const unaVez = renovada(renovacion('pasaporte', '2026-09-01', { repetir: 'ninguna' }), HOY);
  assert.equal(unaVez.activo, false);
  assert.equal(unaVez.vence, '2026-09-01', 'la fecha queda como estaba, para saber cuándo venció');
});

test('lo que cuestan al año las renovaciones, y las que caen en un mes', () => {
  const i = ix({
    renovaciones: [
      renovacion('seguro', '2026-10-01', { monto: 18000 }),
      renovacion('dominio', '2026-11-15', { monto: 20, moneda: 'USD' }),
      renovacion('extintor', '2026-10-20', { monto: 600, cadaMeses: 6 }),
      renovacion('pasaporte', '2026-10-25', { monto: 3000, repetir: 'ninguna' }),
    ],
    tasas: [tasa('2026-01', 25)],
  });
  // 18,000 + 500 (US$20 a 25) + 1,200 (600 cada 6 meses). El pasaporte no se repite.
  assert.equal(costoAnual(i, { hoy: HOY }), 19700);
  assert.deepEqual(renovacionesDelMes(i, '2026-10').map((r) => r.id), ['seguro', 'extintor', 'pasaporte']);
});

test('las renovaciones se pueden filtrar por persona', () => {
  const i = ix({
    personas: [{ id: 'moises', nombre: 'Moises' }, { id: 'ana', nombre: 'Ana' }],
    renovaciones: [renovacion('seguro', '2026-10-01'), renovacion('licencia', '2026-10-05', { responsableId: 'ana' })],
  });
  assert.deepEqual(estadoRenovaciones(i, { hoy: HOY, filtro: { personaId: 'ana' } }).map((r) => r.id), ['licencia']);
});

// ------------------------------------------- El resumen anual valora cada mes con su propia tasa

test('el resumen anual valora lo que salió en dólares con la tasa de su mes', async () => {
  const { resumenAnual } = await import('../js/core/reportes.js');
  const enDolares = (id, fecha) => ({
    id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto: 100, cuentaId: 'dolares', moneda: 'USD',
    categoriaId: 'comida', creado: `${fecha}T12:00:00Z`, actualizado: `${fecha}T12:00:00Z`,
  });
  const datos = {
    cuentas: [
      { id: 'gastos', nombre: 'Gastos', tipo: 'gastos', moneda: 'L', saldoInicial: 0, titularId: null, actualizado: 't' },
      { id: 'dolares', nombre: 'Dólares', tipo: 'banco', moneda: 'USD', saldoInicial: 1000, titularId: null, actualizado: 't' },
    ],
    tasas: [tasa('2026-01', 20), tasa('2026-06', 30)],
    movimientos: [enDolares('d1', '2026-02-10'), enDolares('d2', '2026-07-10')],
  };
  const r = resumenAnual(ix(datos), '2026', null);
  // US$100 en febrero valen 2,000 (la tasa de enero sigue vigente) y en julio 3,000 (la de junio).
  assert.equal(r.meses[1].salidas, 2000);
  assert.equal(r.meses[6].salidas, 3000);
});
