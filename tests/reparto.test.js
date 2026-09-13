import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { calcularReparto, sugerirCambios } from '../js/core/reparto.js';

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
