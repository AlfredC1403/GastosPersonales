import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrar, normalizar } from '../js/core/migraciones.js';
import { docVacio, fusionar, COLECCIONES, ESQUEMA } from '../js/core/modelo.js';

const T0 = '2026-09-11T03:13:52.425Z';
const sello = (actualizado = T0) => ({ creado: T0, creadoPor: 'moises', actualizado, actualizadoPor: 'moises' });
const vacio1 = (id, datos) => ({ id, ...datos, creado: '', creadoPor: null, actualizado: '', actualizadoPor: null });

// Documento vacío tal como lo creaba la versión 1 de la app.
function docVacioV1() {
  const cats = [['vivienda', 'Vivienda'], ['servicios', 'Servicios'], ['comida', 'Comida'], ['restaurantes', 'Restaurantes'], ['transporte', 'Transporte'],
    ['salud', 'Salud'], ['ninos', 'Niños'], ['comunicaciones', 'Comunicaciones'], ['prestamos', 'Préstamos'], ['impuestos', 'Impuestos'], ['ropa', 'Ropa'],
    ['regalos', 'Regalos'], ['educacion', 'Educación'], ['entretenimiento', 'Entretenimiento'], ['salario', 'Salario'], ['otros', 'Otros']];
  return {
    esquema: 1,
    config: { moneda: 'L', inicio: '2026-09', actualizado: '' },
    personas: [],
    cuentas: [
      vacio1('gastos', { nombre: 'Gastos', tipo: 'gastos', saldoInicial: 0, meta: null }),
      vacio1('ahorro', { nombre: 'Ahorro', tipo: 'ahorro', saldoInicial: 0, meta: null }),
      vacio1('emergencias', { nombre: 'Emergencias', tipo: 'emergencias', saldoInicial: 0, meta: null }),
      vacio1('reservas', { nombre: 'Reservas (pagos anuales)', tipo: 'reservas', saldoInicial: 0, meta: null }),
    ],
    categorias: cats.map(([id, nombre]) => vacio1(id, { nombre })),
    plantillas: [],
    prestamos: [],
    movimientos: [],
  };
}

const plantilla = (id, clase, datos = {}) => ({
  id, nombre: id, clase, responsableId: 'ruth', monto: 1000, montoAnual: null, mesPago: null, meses: [], decimo13: false, decimo14: false,
  cuentaId: 'gastos', cuentaDestinoId: null, categoriaId: null, dia: null, activo: true, nota: '', ...sello(), ...datos,
});

function docV1() {
  const d = docVacioV1();
  d.config = { ...d.config, actualizado: T0, plan: { estrategia: 'bola', extraMensual: 0 } };
  d.personas = [{ id: 'ruth', nombre: 'Ruth', email: '', ...sello() }];
  d.cuentas = d.cuentas.map((c) => (c.id === 'emergencias' ? { ...c, meta: 200000, ...sello() } : c));
  d.categorias = [
    ...d.categorias.map((c) => (c.id === 'regalos' ? { ...c, borrado: true, ...sello('2026-09-12T00:00:00Z') } : c)),
    { id: 'mascotas', nombre: 'Mascotas', ...sello() },
  ];
  d.plantillas = [
    plantilla('salario-ruth', 'ingreso', { monto: 30000, decimo13: true, decimo14: true, categoriaId: 'salario' }),
    plantilla('agua', 'fijo', { monto: 350, categoriaId: 'servicios' }),
    plantilla('comida', 'fijo_variable', { monto: 6000, categoriaId: 'comida' }),
    plantilla('ahorro', 'aporte', { monto: 3000, cuentaDestinoId: 'ahorro' }),
    plantilla('tasa', 'provision', { monto: 400, montoAnual: 4800, mesPago: 12, cuentaDestinoId: 'reservas', categoriaId: 'transporte' }),
  ];
  d.prestamos = [{ id: 'carro', nombre: 'Carro', tasa: 15, cuota: 8400, saldo: 150000, saldoPeriodo: '2026-09', fechaSaldo: '2026-09-10', ultimaCuota: '2028-06-02', ...sello() }];
  d.movimientos = [
    { id: 'm-sal', tipo: 'ingreso', fecha: '2026-09-30', periodo: '2026-09', cuentaId: 'gastos', monto: 30000, categoriaId: 'salario', personaId: 'ruth', plantillaId: 'salario-ruth', parte: 'principal', nota: '', ...sello() },
    { id: 'm-d14', tipo: 'ingreso', fecha: '2026-06-20', periodo: '2026-06', cuentaId: 'gastos', monto: 30000, categoriaId: 'salario', personaId: 'ruth', plantillaId: 'salario-ruth', parte: 'decimo14', nota: '', ...sello() },
    { id: 'm-comida', tipo: 'gasto', fecha: '2026-09-12', periodo: '2026-09', cuentaId: 'gastos', monto: 2000, categoriaId: 'comida', personaId: 'ruth', plantillaId: 'comida', parte: 'principal', nota: '', ...sello() },
    { id: 'm-apartar', tipo: 'transferencia', fecha: '2026-09-12', periodo: '2026-09', cuentaId: 'gastos', cuentaDestinoId: 'reservas', monto: 400, plantillaId: 'tasa', parte: 'apartar', nota: '', ...sello() },
    { id: 'm-carro', tipo: 'gasto', fecha: '2026-09-02', periodo: '2026-09', cuentaId: 'gastos', monto: 8400, categoriaId: 'prestamos', prestamoId: 'carro', nota: '', ...sello() },
    { id: 'm-ropa', tipo: 'gasto', fecha: '2026-09-05', periodo: '2026-09', cuentaId: 'gastos', monto: 800, categoriaId: 'ropa', nota: '', ...sello() },
  ];
  return d;
}

// Las listas se comparan sin importar el orden.
function ordenado(doc) {
  const out = { ...doc };
  for (const c of COLECCIONES) out[c] = [...(doc[c] || [])].sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

test('migrar dos veces da lo mismo que una', () => {
  const una = migrar(docV1());
  assert.deepEqual(ordenado(migrar(una)), ordenado(una));
  assert.equal(una.esquema, ESQUEMA);
  assert.equal(una.plantillas, undefined);
});

test('un documento vacío de la versión 1 migrado queda igual a uno vacío nuevo', () => {
  const migrado = normalizar(docVacioV1());
  const nuevo = docVacio();
  nuevo.config = { ...nuevo.config, inicio: '2026-09', migradoDesde: 1 };
  assert.deepEqual(ordenado(migrado), ordenado(nuevo));
});

test('plantillas a partidas e ingresos; movimientos de salario a recibos', () => {
  const d = migrar(docV1());
  const partidas = Object.fromEntries(d.partidas.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(partidas).sort(), ['agua', 'ahorro', 'comida', 'tasa']);
  assert.deepEqual([partidas.agua.tipo, partidas.agua.forma], ['gasto', 'fijo']);
  assert.deepEqual([partidas.comida.tipo, partidas.comida.forma], ['gasto', 'variable']);
  assert.deepEqual([partidas.ahorro.tipo, partidas.ahorro.categoriaId, partidas.ahorro.cuentaDestinoId], ['aporte', 'ahorro', 'ahorro']);
  assert.deepEqual([partidas.tasa.tipo, partidas.tasa.montoAnual, partidas.tasa.mesPago, partidas.tasa.medioPagoId], ['anual', 4800, 12, 'gastos']);
  assert.equal(partidas.agua.actualizado, T0); // la migración no cambia la fecha de edición

  assert.equal(d.ingresos.length, 1);
  assert.deepEqual([d.ingresos[0].personaId, d.ingresos[0].netoEsperado, d.ingresos[0].frecuencia], ['ruth', 30000, 'mensual']);

  const recibos = Object.fromEntries(d.recibos.map((r) => [r.id, r]));
  assert.deepEqual([recibos['m-sal'].tipo, recibos['m-sal'].ocurrencia, recibos['m-sal'].neto], ['ordinario', '2026-09-30', 30000]);
  assert.deepEqual([recibos['m-d14'].tipo, recibos['m-d14'].ocurrencia], ['decimo14', '2026-06-30']);

  const movs = Object.fromEntries(d.movimientos.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(movs).sort(), ['m-apartar', 'm-carro', 'm-comida', 'm-ropa']);
  assert.equal(movs['m-comida'].partidaId, 'comida');
  assert.equal(movs['m-comida'].parte, undefined);
  assert.equal(movs['m-apartar'].parte, 'apartar');
  assert.equal(d.config.migradoDesde, 1);
  assert.equal(migrar(d).config.migradoDesde, 1);
  assert.equal(movs['m-ropa'].partidaId, undefined);
  assert.ok(Object.values(movs).every((m) => m.moneda === 'L' && !('plantillaId' in m)));
});

test('categorías con grupo, las del hogar a Personal; una borrada no vuelve a aparecer', () => {
  const d = normalizar(docV1());
  const cats = Object.fromEntries(d.categorias.map((c) => [c.id, c]));
  assert.equal(cats.servicios.grupoId, 'casa');
  assert.equal(cats.prestamos.grupoId, 'deudas');
  assert.equal(cats.salario.tipo, 'ingreso');
  assert.equal(cats.mascotas.grupoId, 'personal');
  assert.ok(cats.ihss && cats.ihss.grupoId === 'impuestos');
  assert.equal(cats.regalos.borrado, true);
  const conVacio = fusionar(docVacio(), d);
  assert.equal(conVacio.categorias.find((c) => c.id === 'regalos').borrado, true);
  assert.equal(conVacio.grupos.length, 10);
});

test('la meta de una cuenta pasa a Metas', () => {
  const d = migrar(docV1());
  const emergencias = d.cuentas.find((c) => c.id === 'emergencias');
  assert.ok(!('meta' in emergencias));
  assert.deepEqual([emergencias.moneda, emergencias.titularId], ['L', null]);
  assert.deepEqual(d.metas.map((m) => [m.id, m.cuentaId, m.montoObjetivo]), [['meta-emergencias', 'emergencias', 200000]]);
});

test('A migra y B edita en la versión 1 y migra después: las dos copias llegan a lo mismo', () => {
  const a = migrar(docV1());
  const b = docV1();
  b.plantillas = b.plantillas.map((t) => (t.id === 'agua' ? { ...t, monto: 400, actualizado: '2026-09-13T10:00:00Z' } : t));
  b.movimientos.push({ id: 'm-nuevo', tipo: 'gasto', fecha: '2026-09-13', periodo: '2026-09', cuentaId: 'gastos', monto: 1000, categoriaId: 'comida', plantillaId: 'comida', ...sello('2026-09-13T10:00:00Z') });
  const bMigrado = migrar(b);
  const ab = ordenado(fusionar(a, bMigrado));
  const ba = ordenado(fusionar(bMigrado, a));
  assert.deepEqual(ab, ba);
  assert.equal(ab.partidas.find((p) => p.id === 'agua').monto, 400);
  assert.equal(ab.movimientos.find((m) => m.id === 'm-nuevo').partidaId, 'comida');
});

test('un documento nuevo con restos de una versión vieja de la app los migra y se queda con lo más reciente', () => {
  const nuevo = migrar(docV1());
  nuevo.partidas = nuevo.partidas.map((p) => (p.id === 'agua' ? { ...p, monto: 500, actualizado: '2026-09-20T00:00:00Z' } : p));
  const conRestos = {
    ...nuevo,
    plantillas: [plantilla('agua', 'fijo', { monto: 380, actualizado: '2026-09-15T00:00:00Z' }), plantilla('gas', 'fijo', { monto: 250 })],
    movimientos: [...nuevo.movimientos, { id: 'm-viejo', tipo: 'gasto', fecha: '2026-09-15', periodo: '2026-09', cuentaId: 'gastos', monto: 250, plantillaId: 'gas', ...sello() }],
  };
  const d = normalizar(conRestos);
  assert.equal(d.partidas.find((p) => p.id === 'agua').monto, 500);
  assert.equal(d.partidas.find((p) => p.id === 'gas').monto, 250);
  assert.equal(d.movimientos.find((m) => m.id === 'm-viejo').partidaId, 'gas');
  assert.equal(d.plantillas, undefined);
});

// ---------------------------------------------------------------- Esquema 2 a 3

// Documento del esquema 2: las partidas no decían su moneda ni si eran suscripciones. Uno que
// nació en el 2 tampoco lleva `migradoDesde`, que es la marca de haber venido de la versión 1.
function docV2() {
  const { config, ...d } = normalizar(docV1());
  const { migradoDesde, ...restoConfig } = config;
  return {
    ...d,
    config: restoConfig,
    esquema: 2,
    partidas: d.partidas.map(({ moneda, suscripcion, ciclo, mesCobro, pruebaHasta, ...resto }) => resto),
  };
}

test('del 2 al 3: cada partida dice su moneda, sin cambiar de valor ni de fecha de edición', () => {
  const antes = docV2();
  const d = migrar(antes);
  assert.equal(d.esquema, ESQUEMA);
  assert.ok(d.partidas.length);
  for (const p of d.partidas) {
    assert.deepEqual([p.moneda, p.suscripcion, p.ciclo, p.mesCobro, p.pruebaHasta], ['L', false, null, null, null]);
    assert.equal(p.actualizado, T0); // migrar no cambia la fecha de edición
    assert.equal(p.monto, antes.partidas.find((x) => x.id === p.id).monto);
  }
  // Nada que revisar: el asistente es el del cambio de la versión 1.
  assert.equal(d.config.migradoDesde, undefined);
  assert.deepEqual(ordenado(migrar(d)), ordenado(d));
});

test('del 2 al 3: una partida que ya venía en dólares o como suscripción se respeta', () => {
  const d = docV2();
  d.partidas = [
    { ...d.partidas[0], id: 'netflix', tipo: 'gasto', moneda: 'USD', monto: 9.99, suscripcion: true, ciclo: 'mensual' },
    { ...d.partidas[0], id: 'raro', tipo: 'aporte', suscripcion: true }, // solo un gasto puede ser suscripción
  ];
  const [netflix, raro] = migrar(d).partidas;
  assert.deepEqual([netflix.moneda, netflix.monto, netflix.suscripcion, netflix.ciclo], ['USD', 9.99, true, 'mensual']);
  assert.equal(raro.suscripcion, false);
});

test('del 2 al 3: dos celulares, uno migrado y otro no, llegan a lo mismo', () => {
  const a = migrar(docV2());
  const b = docV2();
  b.partidas = b.partidas.map((p) => (p.id === 'agua' ? { ...p, monto: 420, actualizado: '2026-09-25T10:00:00Z' } : p));
  const ab = ordenado(fusionar(a, migrar(b)));
  const ba = ordenado(fusionar(migrar(b), a));
  assert.deepEqual(ab, ba);
  const agua = ab.partidas.find((p) => p.id === 'agua');
  assert.deepEqual([agua.monto, agua.moneda], [420, 'L']);
});

test('normalizar valida el formato, completa lo que falte y rechaza versiones más nuevas', () => {
  assert.throws(() => normalizar({ hola: 1 }));
  assert.throws(() => normalizar([]));
  const d = normalizar({ esquema: 1, movimientos: [{ id: '1', tipo: 'gasto', fecha: '2026-09-01', monto: 1, actualizado: 't' }] });
  assert.equal(d.cuentas.length, 4);
  assert.equal(d.movimientos.length, 1);
  assert.equal(d.config.simboloExt, 'US$');
  assert.throws(() => normalizar({ esquema: 4 }), (e) => e.codigo === 'esquema_nuevo');
});
