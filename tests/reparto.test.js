import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { calcularReparto, sugerirCambios, liquidacion } from '../js/core/reparto.js';

const T = (fecha) => `${fecha}T12:00:00Z`;

function hogar({ partidas = [], prestamos = [], ingresos = [], movimientos = [], recibos = [] } = {}, hoy = '2026-09-15') {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'moises', nombre: 'Moises', creado: T('2026-01-01') }, { id: 'ruth', nombre: 'Ruth', creado: T('2026-01-02') }];
  Object.assign(doc, { partidas, prestamos, ingresos, movimientos, recibos });
  return crearIndice(doc, { hoy });
}
const partida = (id, monto, responsableId, extra = {}) => ({
  id, nombre: id, tipo: 'gasto', forma: 'fijo', monto, meses: [], categoriaId: 'servicios', responsableId, medioPagoId: 'gastos', activo: true, ...extra,
});
const ingreso = (personaId, neto) => ({
  id: `sal-${personaId}`, nombre: `Salario ${personaId}`, personaId, frecuencia: 'mensual', diasPago: [31], netoEsperado: neto, cuentaId: 'gastos', activo: true,
  decimo13: false, decimo14: false, deducciones: [],
});
const carro = { id: 'carro', nombre: 'Carro', tasa: 12, cuota: 5000, saldo: 100000, saldoPeriodo: '2026-08', fechaSaldo: '2026-08-31', ultimaCuota: '2030-01-02', responsableId: 'moises', cuentaId: 'gastos' };
const BASE = {
  ingresos: [ingreso('moises', 30000), ingreso('ruth', 20000)],
  partidas: [partida('luz', 10000, 'moises'), partida('agua', 5000, 'ruth'), partida('ropa', 3000, 'ruth', { categoriaId: 'ropa' })],
  prestamos: [carro],
};
const resumen = (r) => r.personas.map((p) => [p.id, p.pct, p.leToca, p.pagaHoy, p.diferencia]);

test('según ingresos, mitad y mitad o porcentajes propios; Personal no se reparte', () => {
  const ix = hogar(BASE);
  // 60 % y 40 % de L20,000 (luz, agua y la cuota del carro; la ropa es del grupo Personal).
  assert.deepEqual(resumen(calcularReparto(ix, '2026-09')), [['moises', 60, 12000, 15000, 3000], ['ruth', 40, 8000, 5000, -3000]]);
  assert.deepEqual(resumen(calcularReparto(ix, '2026-09', { metodo: 'mitad' })), [['moises', 50, 10000, 15000, 5000], ['ruth', 50, 10000, 5000, -5000]]);
  assert.deepEqual(resumen(calcularReparto(ix, '2026-09', { metodo: 'propio', porcentajes: { moises: 70, ruth: 30 } })), [['moises', 70, 14000, 15000, 1000], ['ruth', 30, 6000, 5000, -1000]]);
  const mal = calcularReparto(ix, '2026-09', { metodo: 'propio', porcentajes: { moises: 70, ruth: 70 } });
  assert.deepEqual([mal.avisos, mal.personas[0].pct], [['porcentajes'], 50]);
  // Sin la cuota del carro y con Personal incluido.
  const r = calcularReparto(ix, '2026-09', { incluirPrestamos: false, grupos: ['casa', 'personal'] });
  assert.deepEqual([r.asignado, r.personas[1].pagaHoy], [18000, 8000]);
});

test('lo que no tiene responsable se muestra aparte y se reparte con los mismos porcentajes', () => {
  const r = calcularReparto(hogar({ ...BASE, partidas: [...BASE.partidas, partida('internet', 1000, null)] }), '2026-09');
  assert.deepEqual([r.asignado, r.sinResponsable, r.total], [20000, 1000, 21000]);
  assert.deepEqual(r.personas.map((p) => p.parteSinResponsable), [600, 400]);
});

test('con lo registrado del mes, por quién pagó; con el bruto de los recibos', () => {
  const movimientos = [
    { id: 'g1', tipo: 'gasto', fecha: '2026-09-05', periodo: '2026-09', cuentaId: 'gastos', monto: 1200, categoriaId: 'servicios', partidaId: 'luz', personaId: 'ruth', creado: T('2026-09-05') },
    { id: 'g2', tipo: 'gasto', fecha: '2026-09-06', periodo: '2026-09', cuentaId: 'gastos', monto: 800, categoriaId: 'ropa', personaId: 'moises', creado: T('2026-09-06') },
    { id: 'c1', tipo: 'gasto', fecha: '2026-09-02', periodo: '2026-09', cuentaId: 'gastos', monto: 5000, categoriaId: 'prestamos', prestamoId: 'carro', personaId: 'moises', creado: T('2026-09-02') },
  ];
  const r = calcularReparto(hogar({ ...BASE, movimientos }), '2026-09', { fuente: 'mes' });
  assert.deepEqual(resumen(r), [['moises', 60, 3720, 5000, 1280], ['ruth', 40, 2480, 1200, -1280]]);

  const recibos = [{ id: 'r1', ingresoId: 'sal-moises', ocurrencia: '2026-09-30', tipo: 'ordinario', fecha: '2026-09-30', periodo: '2026-09', cuentaId: 'gastos', neto: 14000, deducciones: [{ deduccionId: 'ihss', nombre: 'IHSS', monto: 1000 }] }];
  const bruto = calcularReparto(hogar({ ...BASE, recibos }), '2026-09', { base: 'bruto' });
  assert.deepEqual([bruto.personas.map((p) => p.ingreso), bruto.estimados, bruto.personas[0].pct], [[15000, 20000], ['ruth'], 42.9]);
});

test('la mejor sugerencia deja la diferencia más cerca de cero; también la transferencia que la iguala', () => {
  const filas = [{ id: 'moises', diferencia: 300000 }, { id: 'ruth', diferencia: -300000 }];
  const partidas = [
    { id: 'a', nombre: 'A', c: 290000, responsableId: 'moises' },
    { id: 'b', nombre: 'B', c: 100000, responsableId: 'moises' },
    { id: 'c', nombre: 'C', c: 200000, responsableId: 'moises' },
    { id: 'd', nombre: 'D', c: 50000, responsableId: 'ruth' },
  ];
  const s = sugerirCambios(filas, partidas);
  assert.deepEqual(s.map((x) => (x.tipo === 'mover' ? [x.partidas.map((p) => p.id).join('+'), x.queda] : [x.tipo, x.monto, x.de, x.a])), [
    ['b+c', 0], ['a', 100], ['a+b', -900], ['transferencia', 3000, 'ruth', 'moises'],
  ]);
  assert.deepEqual(sugerirCambios([{ id: 'moises', diferencia: 50 }, { id: 'ruth', diferencia: -50 }], partidas), []);
  // Con el presupuesto, pasar la luz (L10,000) dejaría a Ruth pagando de más: solo queda la transferencia.
  const r = calcularReparto(hogar(BASE), '2026-09');
  assert.deepEqual(r.sugerencias, [{ tipo: 'transferencia', de: 'ruth', a: 'moises', monto: 3000 }]);
});

// ---------------------------------------------------------------- Quién pagó de verdad

// El gasto lo paga quien lo registró (personaId), o el titular de la cuenta si no dice.
const gasto = (id, monto, personaId, extra = {}) => ({
  id, tipo: 'gasto', fecha: '2026-09-10', monto, cuentaId: 'gastos', categoriaId: 'servicios', personaId, actualizado: T('2026-09-10'), ...extra,
});

test('el plan y la realidad se ven por separado: quien paga no siempre es el responsable', () => {
  // Luz (L10,000) es de Moises y Agua (L5,000) de Ruth, pero este mes Ruth pagó las dos.
  const ix = hogar({
    ...BASE,
    movimientos: [gasto('g1', 10000, 'ruth', { partidaId: 'luz' }), gasto('g2', 5000, 'ruth', { partidaId: 'agua' })],
  });
  const r = calcularReparto(ix, '2026-09');
  const porId = Object.fromEntries(r.personas.map((p) => [p.id, p]));
  // El plan no cambia: a Moises le siguen asignadas L15,000 (luz + carro).
  assert.deepEqual([porId.moises.pagaHoy, porId.ruth.pagaHoy], [15000, 5000]);
  // La realidad sí: Ruth puso los L15,000 de este mes y Moises nada.
  assert.deepEqual([porId.moises.pagadoReal, porId.ruth.pagadoReal], [0, 15000]);
  // Y la diferencia que importa para cuadrar es contra lo que le tocaba (60/40 de L20,000).
  assert.deepEqual([porId.moises.diferenciaReal, porId.ruth.diferenciaReal], [-12000, 7000]);
});

test('la liquidación la paga quien puso de menos, y sale de la realidad', () => {
  const ix = hogar({
    ...BASE,
    movimientos: [gasto('g1', 10000, 'ruth', { partidaId: 'luz' }), gasto('g2', 5000, 'ruth', { partidaId: 'agua' })],
  });
  const r = calcularReparto(ix, '2026-09');
  // Ruth puso L7,000 de más: Moises le transfiere eso (no los L3,000 que dice el plan).
  assert.deepEqual(r.liquidacion, { de: 'moises', a: 'ruth', monto: 7000 });
  // Las sugerencias de mover partidas siguen mirando el plan, y ahí es Moises quien tiene de más.
  assert.equal(r.sugerencias.at(-1).tipo, 'transferencia');
  assert.deepEqual([r.sugerencias.at(-1).de, r.sugerencias.at(-1).a], ['ruth', 'moises']);
});

test('sin gastos registrados no hay nada que liquidar', () => {
  const r = calcularReparto(hogar(BASE), '2026-09');
  assert.equal(r.liquidacion, null);
  assert.equal(r.pagadoReal, 0);
  assert.deepEqual(r.personas.map((p) => p.pagadoReal), [0, 0]);
});

test('cuando cada quien pagó lo que le tocaba no se pide transferencia', () => {
  // 60/40 de L20,000: Moises L12,000 y Ruth L8,000, justo lo que les toca.
  const ix = hogar({
    ...BASE,
    movimientos: [gasto('g1', 12000, 'moises', { partidaId: 'luz' }), gasto('g2', 8000, 'ruth', { partidaId: 'agua' })],
  });
  const r = calcularReparto(ix, '2026-09');
  assert.equal(r.liquidacion, null);
  assert.deepEqual(r.personas.map((p) => p.diferenciaReal), [0, 0]);
});

test('un gasto sin dueño no se le carga a nadie en la liquidación', () => {
  const ix = hogar({
    ...BASE,
    // Sin personaId y con una cuenta sin titular: no es de nadie.
    movimientos: [gasto('g1', 9000, null, { partidaId: 'luz' })],
  });
  const r = calcularReparto(ix, '2026-09');
  assert.deepEqual(r.personas.map((p) => p.pagadoReal), [0, 0]);
  assert.equal(r.pagadoReal, 0);
  assert.equal(r.liquidacion, null);
});

test('la liquidación no depende de la fuente elegida: la realidad es la misma', () => {
  const ix = hogar({
    ...BASE,
    movimientos: [gasto('g1', 10000, 'ruth', { partidaId: 'luz' }), gasto('g2', 5000, 'ruth', { partidaId: 'agua' })],
  });
  // Con 'mes' lo que le toca se calcula sobre lo registrado, así que la liquidación cambia de monto,
  // pero lo pagado de verdad es el mismo número en las dos.
  const presupuesto = calcularReparto(ix, '2026-09');
  const mes = calcularReparto(ix, '2026-09', { fuente: 'mes' });
  assert.deepEqual(presupuesto.personas.map((p) => p.pagadoReal), mes.personas.map((p) => p.pagadoReal));
  assert.equal(mes.liquidacion.de, 'moises');
});

test('liquidacion() necesita dos personas y una diferencia que valga la pena', () => {
  assert.equal(liquidacion([{ id: 'a', diferenciaReal: 5000 }]), null);
  // Diferencias de centavos no generan una transferencia.
  assert.equal(liquidacion([{ id: 'a', diferenciaReal: 50 }, { id: 'b', diferenciaReal: -50 }]), null);
  assert.deepEqual(liquidacion([{ id: 'a', diferenciaReal: 30000 }, { id: 'b', diferenciaReal: -30000 }]), { de: 'b', a: 'a', monto: 300 });
});
