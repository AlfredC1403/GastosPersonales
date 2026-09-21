// Proyección del flujo de caja, simulador, cierre proyectado del mes y costo de la deuda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proyectar, simular, saldoLiquido, ajusteDeFinanciamiento } from '../js/core/proyeccion.js';
import { cierreProyectado, costoDeLaDeuda, sugerirMonto } from '../js/core/reportes.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const HOY = '2026-09-15'; // mitad de un mes de 30 días
const cerca = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const partida = (id, monto, extra = {}) => ({
  id, nombre: id, tipo: 'gasto', forma: 'fijo', categoriaId: 'servicios', responsableId: 'moises',
  monto, moneda: 'L', meses: [], medioPagoId: 'gastos', activo: true, acumula: false, sePagaCon: 'auto',
  creado: '2026-01-01T00:00:00Z', actualizado: 't', ...extra,
});

const salario = (id, neto, extra = {}) => ({
  id, nombre: id, personaId: 'moises', frecuencia: 'mensual', diasPago: [30], finDeSemana: 'igual',
  cuentaId: 'gastos', categoriaId: 'salario', netoEsperado: neto, meses: [], decimo13: false, decimo14: false,
  vigenteDesde: null, activo: true, deducciones: [], creado: '2026-01-01T00:00:00Z', actualizado: 't', ...extra,
});

const gasto = (id, fecha, monto, extra = {}) => ({
  id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), monto, cuentaId: 'gastos', moneda: 'L', categoriaId: 'servicios',
  creado: `${fecha}T12:00:00Z`, actualizado: `${fecha}T12:00:00Z`, ...extra,
});

function ix(datos = {}, hoy = HOY) {
  const doc = { ...docVacio(), ...datos };
  doc.config = { ...doc.config, inicio: '2026-01', tasaReferencia: 25, tasaReferenciaDesde: '2026-01-01' };
  doc.personas = [{ id: 'moises', nombre: 'Moises', actualizado: 't' }];
  doc.cuentas = doc.cuentas.map((c) => (c.id === 'gastos' ? { ...c, saldoInicial: 10000, actualizado: 't' } : c));
  return crearIndice(doc, { hoy });
}

// ---------------------------------------------------------------- Saldo de arranque

test('el saldo de arranque son las cuentas líquidas, sin las tarjetas', () => {
  const i = ix({ movimientos: [gasto('g1', '2026-09-02', 1500)] });
  assert.equal(saldoLiquido(i), 8500);
});

// ---------------------------------------------------------------- Proyección

test('la proyección arrastra el saldo mes a mes', () => {
  const i = ix({ partidas: [partida('luz', 2000)], ingresos: [salario('sueldo', 20000)] });
  const p = proyectar(i, { meses: 3 });

  assert.deepEqual(p.meses.map((m) => m.periodo), ['2026-09', '2026-10', '2026-11']);
  // Octubre y noviembre: entran 20,000 y salen 2,000.
  cerca(p.meses[1].entra, 20000);
  cerca(p.meses[1].sale, 2000);
  cerca(p.meses[1].neto, 18000);
  cerca(p.meses[2].saldoFin, p.meses[1].saldoFin + 18000);
  assert.deepEqual(p.mesesEnRojo, []);
});

test('el mes en curso solo cuenta lo que falta por pagar', () => {
  const i = ix({
    partidas: [partida('luz', 2000)],
    ingresos: [salario('sueldo', 20000)],
    // La luz de septiembre ya se pagó: no debe volver a salir del saldo proyectado.
    movimientos: [gasto('g1', '2026-09-02', 2000, { partidaId: 'luz' })],
  });
  const [septiembre] = proyectar(i, { meses: 1 }).meses;
  cerca(septiembre.sale, 0, 0.01);
});

test('un mes en rojo se marca y se explica con lo que más pesa', () => {
  const i = ix({
    partidas: [partida('colegio', 30000, { meses: [11] })], // solo en noviembre
    ingresos: [salario('sueldo', 5000)],
  });
  const p = proyectar(i, { meses: 3 });
  assert.deepEqual(p.mesesEnRojo, ['2026-11']);
  assert.equal(p.minimo.periodo, '2026-11');
  assert.equal(p.meses[2].hitos[0].nombre, 'colegio');
  cerca(p.meses[2].hitos[0].monto, 30000);
});

test('una renovación que vence en un mes futuro sale en ese mes', () => {
  const i = ix({
    ingresos: [salario('sueldo', 20000)],
    renovaciones: [{ id: 'seguro', nombre: 'Seguro del carro', vence: '2026-11-10', monto: 18000, moneda: 'L', repetir: 'meses', cadaMeses: 12, activo: true, actualizado: 't' }],
  });
  const p = proyectar(i, { meses: 3 });
  cerca(p.meses[2].sale, 18000);
  assert.equal(p.meses[2].hitos[0].nombre, 'Seguro del carro');
});

test('una partida que ya terminó su vigencia deja de salir', () => {
  const i = ix({
    partidas: [partida('curso', 3000, { hasta: '2026-10' })],
    ingresos: [salario('sueldo', 20000)],
  });
  const p = proyectar(i, { meses: 3 });
  cerca(p.meses[1].sale, 3000);
  cerca(p.meses[2].sale, 0, 0.01);
});

// ---------------------------------------------------------------- Simulador

test('cancelar una suscripción se ve en el saldo del final', () => {
  const i = ix({ partidas: [partida('netflix', 500), partida('luz', 2000)], ingresos: [salario('sueldo', 20000)] });
  const s = simular(i, { meses: 6 }, [{ tipo: 'quitarPartida', partidaId: 'netflix', desde: '2026-10' }]);
  // Cinco meses sin los 500 de Netflix (octubre a febrero).
  cerca(s.diferencia.alFinal, 2500);
  assert.equal(s.diferencia.mesesEnRojoDespues, 0);
});

test('un gasto nuevo puede meter meses en rojo, y el simulador lo dice', () => {
  const i = ix({ ingresos: [salario('sueldo', 12000)], partidas: [partida('casa', 10000)] });
  const s = simular(i, { meses: 6 }, [{ tipo: 'gasto', nombre: 'Carro', monto: 8000, desde: '2026-10' }]);
  assert.equal(s.diferencia.mesesEnRojoAntes, 0);
  assert.ok(s.diferencia.mesesEnRojoDespues > 0, 'el gasto nuevo deja meses en rojo');
  assert.ok(s.diferencia.alFinal < 0);
});

test('un financiamiento se simula con su cuota y su plazo', () => {
  const a = ajusteDeFinanciamiento({ nombre: 'Refri', total: 24000, meses: 12, desde: '2026-10' });
  assert.equal(a.tipo, 'gasto');
  cerca(a.monto, 2000);
  assert.equal(a.hasta, '2027-09');
  // Con intereses la cuota es mayor que dividir entre los meses.
  const conInteres = ajusteDeFinanciamiento({ nombre: 'Refri', total: 24000, meses: 12, desde: '2026-10', interesAnual: 24 });
  assert.ok(conInteres.monto > 2000, `${conInteres.monto} debería pasar de 2000`);
});

// ---------------------------------------------------------------- Cierre proyectado del mes

test('a mitad de mes, lo variable se proyecta al ritmo que lleva', () => {
  const i = ix({
    partidas: [partida('super', 6000, { forma: 'variable' }), partida('luz', 2000)],
    ingresos: [salario('sueldo', 20000)],
    // A mitad de mes lleva 4,000 de súper: al ritmo cerraría en 8,000.
    movimientos: [gasto('g1', '2026-09-05', 4000, { partidaId: 'super' })],
  });
  const c = cierreProyectado(i, '2026-09');
  cerca(c.ritmo.fraccion, 0.5, 0.01);
  cerca(c.proyectado, 10000, 10); // 8,000 de súper + 2,000 de luz
  assert.equal(c.excesos[0].nombre, 'super');
  cerca(c.excesos[0].proyectado, 8000, 10);
  cerca(c.cierre, 10000, 10);
  assert.equal(c.arriba, true);
});

test('lo que se gasta fuera del plan también se proyecta', () => {
  const i = ix({
    ingresos: [salario('sueldo', 20000)],
    movimientos: [gasto('g1', '2026-09-05', 3000, { categoriaId: 'restaurantes' })],
  });
  const c = cierreProyectado(i, '2026-09');
  cerca(c.fueraDelPlan, 6000, 10);
  cerca(c.cierre, 14000, 10);
});

test('el cierre proyectado solo existe en el mes en curso', () => {
  const i = ix({ ingresos: [salario('sueldo', 20000)] });
  assert.equal(cierreProyectado(i, '2026-08'), null);
  assert.equal(cierreProyectado(i, '2026-10'), null);
});

// ---------------------------------------------------------------- Costo de la deuda

test('cuánto costó deber: intereses y comisiones de tarjeta', () => {
  const i = ix({
    ingresos: [salario('sueldo', 20000)],
    movimientos: [
      gasto('c1', '2026-03-10', 450, { categoriaId: 'cargos-tarjeta' }),
      gasto('c2', '2026-07-10', 800, { categoriaId: 'cargos-tarjeta' }),
      gasto('c3', '2025-07-10', 900, { categoriaId: 'cargos-tarjeta' }), // de otro año
      gasto('g1', '2026-07-11', 5000),
    ],
  });
  const c = costoDeLaDeuda(i, '2026-01', '2026-12');
  assert.equal(c.tarjetas, 1250);
  assert.equal(c.total, 1250);
  assert.equal(costoDeLaDeuda(i, '2026-04', '2026-12').tarjetas, 800, 'el rango se respeta');
});

// ---------------------------------------------------------------- Monto sugerido

test('el monto sugerido sale de los meses completos anteriores', () => {
  const i = ix({
    movimientos: [
      gasto('g1', '2026-06-05', 3000, { categoriaId: 'comida' }),
      gasto('g2', '2026-07-05', 3500, { categoriaId: 'comida' }),
      gasto('g3', '2026-08-05', 10000, { categoriaId: 'comida' }), // un mes raro
      gasto('g4', '2026-09-05', 500, { categoriaId: 'comida' }), // el mes en curso no cuenta
    ],
  });
  const s = sugerirMonto(i, { categoriaId: 'comida', meses: 3 });
  assert.equal(s.meses, 3);
  assert.equal(s.mesesConGasto, 3);
  cerca(s.promedio, 5500);
  assert.equal(s.mediana, 3500, 'la mediana aguanta el mes raro');
  assert.equal(s.maximo, 10000);
  assert.equal(sugerirMonto(i, { categoriaId: 'comida', meses: 3, hasta: '2026-01' }), null, 'sin historia no se propone nada');
});
