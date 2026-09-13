import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sincronizarCarpeta, marcarPendiente } from '../js/sincronizacion.js';
import { docVacio, sellar, COLECCIONES } from '../js/core/modelo.js';
import { migrar } from '../js/core/migraciones.js';
import { archivoDe, unirAnios, claveDeNombre, contenidoArchivo, PRINCIPAL } from '../js/core/anios.js';

// Carpeta de OneDrive simulada: eTag nuevo en cada escritura, 412 si el eTag no coincide y
// 409 al crear un archivo que ya existe. Cada operación espera un turno para que dos
// dispositivos puedan intercalarse.
class Carpeta {
  constructor() {
    this.archivos = new Map();
    this.respaldos = new Map();
    this.n = 0;
    this.registro = []; // [operación, nombre] de cada descarga, subida o creación
  }
  poner(nombre, contenido) {
    const item = { nombre, itemId: `id-${nombre}`, eTag: `"${++this.n}"`, texto: JSON.stringify(contenido) };
    this.archivos.set(nombre, item);
    return item;
  }
  leer(nombre) {
    return JSON.parse(this.archivos.get(nombre).texto);
  }
  ops({ fallarRespaldo = false } = {}) {
    const turno = () => new Promise((ok) => setImmediate(ok));
    return {
      listar: async () => {
        await turno();
        return [...this.archivos.values()].map(({ nombre, itemId, eTag }) => ({ nombre, itemId, eTag }));
      },
      descargar: async (a) => {
        await turno();
        this.registro.push(['bajar', a.nombre]);
        return this.leer(a.nombre);
      },
      subir: async (a, contenido, eTag) => {
        await turno();
        this.registro.push(['subir', a.nombre]);
        if (this.archivos.get(a.nombre)?.eTag !== eTag) throw Object.assign(new Error('412'), { status: 412 });
        const { itemId, eTag: nuevo } = this.poner(a.nombre, contenido);
        return { itemId, eTag: nuevo };
      },
      crear: async (nombre, contenido) => {
        await turno();
        this.registro.push(['crear', nombre]);
        if (this.archivos.has(nombre)) throw Object.assign(new Error('409'), { status: 409 });
        const { itemId, eTag } = this.poner(nombre, contenido);
        return { itemId, eTag };
      },
      respaldar: async (nombre, contenido) => {
        await turno();
        if (fallarRespaldo) throw new Error('sin permiso');
        this.respaldos.set(nombre, JSON.stringify(contenido));
      },
    };
  }
  // Documento que resulta de leer todos los archivos.
  unido() {
    const anios = {};
    for (const nombre of this.archivos.keys()) {
      const clave = claveDeNombre(nombre);
      if (clave && clave !== PRINCIPAL) anios[clave] = this.leer(nombre);
    }
    return unirAnios(this.leer('finanzas.json'), anios);
  }
}

// Dispositivo: documento en memoria, contadores de cambios y estado de sincronización.
function dispositivo(carpeta, persona, opciones) {
  let doc = docVacio();
  const contadores = new Map();
  const estado = { archivos: {}, pendientes: [] };
  const libro = { doc: () => doc, adoptar: (d) => { doc = d; }, cambios: (k) => contadores.get(k) || 0 };
  let reloj = 0;
  return {
    estado,
    doc: () => doc,
    guardar(coleccion, registro) {
      const r = sellar(registro, persona, `2026-09-20T10:00:${String(reloj++).padStart(2, '0')}.000Z${persona}`);
      const antes = doc[coleccion].find((x) => x.id === r.id);
      doc = { ...doc, [coleccion]: [...doc[coleccion].filter((x) => x.id !== r.id), r] };
      for (const clave of new Set([antes && archivoDe(doc, coleccion, antes), archivoDe(doc, coleccion, r)].filter(Boolean))) {
        contadores.set(clave, (contadores.get(clave) || 0) + 1);
        marcarPendiente(estado, clave);
      }
      return r;
    },
    // Apertura recalculada en este dispositivo: se guarda en el documento y se sube con su año.
    adoptarApertura(clave, apertura) {
      doc = { ...doc, aperturas: { ...(doc.aperturas || {}), [clave]: apertura } };
      contadores.set(clave, (contadores.get(clave) || 0) + 1);
      marcarPendiente(estado, clave);
    },
    sincronizar: (desde = null) => sincronizarCarpeta({ libro, estado, ops: carpeta.ops(opciones), sello: '2026-09-20-1000', desde }),
  };
}

const ordenado = (d) => {
  const out = {};
  for (const c of COLECCIONES) out[c] = [...(d[c] || [])].sort((a, b) => a.id.localeCompare(b.id));
  return out;
};

const T = '2026-09-11T03:13:52.425Z';
const s = { creado: T, creadoPor: 'moises', actualizado: T, actualizadoPor: 'moises' };
function archivoV1() {
  return {
    esquema: 1,
    config: { moneda: 'L', inicio: '2026-09', actualizado: T },
    personas: [{ id: 'moises', nombre: 'Moises', ...s }],
    cuentas: [{ id: 'gastos', nombre: 'Gastos', tipo: 'gastos', saldoInicial: 0, meta: null, ...s }],
    categorias: [{ id: 'comida', nombre: 'Comida', ...s }],
    plantillas: [
      { id: 'super', nombre: 'Súper', clase: 'fijo_variable', monto: 6000, meses: [], cuentaId: 'gastos', categoriaId: 'comida', responsableId: 'moises', activo: true, ...s },
      { id: 'sal', nombre: 'Salario', clase: 'ingreso', monto: 30000, meses: [], cuentaId: 'gastos', categoriaId: 'salario', responsableId: 'moises', activo: true, ...s },
    ],
    prestamos: [],
    movimientos: [
      { id: 'm1', tipo: 'gasto', fecha: '2026-09-12', periodo: '2026-09', cuentaId: 'gastos', monto: 2000, categoriaId: 'comida', plantillaId: 'super', parte: 'principal', ...s },
      { id: 'm2', tipo: 'ingreso', fecha: '2026-09-30', periodo: '2026-09', cuentaId: 'gastos', monto: 30000, categoriaId: 'salario', plantillaId: 'sal', parte: 'principal', ...s },
      { id: 'm0', tipo: 'gasto', fecha: '2025-12-20', periodo: '2025-12', cuentaId: 'gastos', monto: 100, categoriaId: 'comida', ...s },
    ],
  };
}

test('un archivo del esquema 1 se respalda, se reparte por año y el principal queda en el esquema 2', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises');
  await a.sincronizar();

  assert.deepEqual([...carpeta.respaldos.keys()], ['finanzas-e1-2026-09-20-1000.json']);
  assert.deepEqual(JSON.parse(carpeta.respaldos.get('finanzas-e1-2026-09-20-1000.json')), archivoV1());
  assert.deepEqual([...carpeta.archivos.keys()].sort(), ['finanzas-2025.json', 'finanzas-2026.json', 'finanzas.json']);
  const principal = carpeta.leer('finanzas.json');
  assert.equal(principal.esquema, 2);
  assert.equal(principal.movimientos, undefined);
  assert.equal(principal.plantillas, undefined);
  assert.deepEqual(carpeta.leer('finanzas-2026.json').recibos.map((r) => r.id), ['m2']);
  assert.deepEqual(ordenado(carpeta.unido()), ordenado(a.doc()));
  const esperado = migrar(archivoV1());
  assert.deepEqual(ordenado(carpeta.unido()).movimientos, ordenado(esperado).movimientos);
  assert.deepEqual(a.estado.pendientes, []);

  // Una segunda pasada no baja ni sube nada.
  const eTags = [...carpeta.archivos.values()].map((x) => x.eTag);
  await a.sincronizar();
  assert.deepEqual([...carpeta.archivos.values()].map((x) => x.eTag), eTags);
});

test('sin respaldo confirmado no se sube nada', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises', { fallarRespaldo: true });
  await assert.rejects(a.sincronizar(), /sin permiso/);
  assert.deepEqual([...carpeta.archivos.keys()], ['finanzas.json']);
  assert.equal(carpeta.leer('finanzas.json').esquema, 1);
});

test('dos celulares que migran a la vez llegan al mismo resultado', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises');
  const b = dispositivo(carpeta, 'ruth');
  await Promise.all([a.sincronizar(), b.sincronizar()]);
  await a.sincronizar();
  await b.sincronizar();
  assert.equal(carpeta.leer('finanzas.json').esquema, 2);
  assert.deepEqual(ordenado(a.doc()), ordenado(b.doc()));
  assert.deepEqual(ordenado(carpeta.unido()), ordenado(a.doc()));
});

test('cambios de dos personas al mismo tiempo se fusionan (412)', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises');
  const b = dispositivo(carpeta, 'ruth');
  await a.sincronizar();
  await b.sincronizar();

  a.guardar('movimientos', { id: 'x', tipo: 'gasto', fecha: '2026-09-21', periodo: '2026-09', cuentaId: 'gastos', monto: 50 });
  b.guardar('movimientos', { id: 'y', tipo: 'gasto', fecha: '2026-09-22', periodo: '2026-09', cuentaId: 'gastos', monto: 70 });
  b.guardar('partidas', { ...b.doc().partidas.find((p) => p.id === 'super'), monto: 6500 });
  await a.sincronizar();
  await b.sincronizar();
  await a.sincronizar();

  const ids = carpeta.leer('finanzas-2026.json').movimientos.map((m) => m.id).sort();
  assert.deepEqual(ids, ['m1', 'x', 'y']);
  assert.equal(carpeta.leer('finanzas.json').partidas.find((p) => p.id === 'super').monto, 6500);
  assert.deepEqual(ordenado(a.doc()), ordenado(b.doc()));
});

test('un movimiento que cambia de año pasa de archivo y queda vivo en uno solo', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises');
  const b = dispositivo(carpeta, 'ruth');
  await a.sincronizar();
  a.guardar('movimientos', { id: 'dic', tipo: 'gasto', fecha: '2026-12-31', periodo: '2026-12', cuentaId: 'gastos', monto: 300 });
  await a.sincronizar();
  await b.sincronizar();

  a.guardar('movimientos', { ...a.doc().movimientos.find((m) => m.id === 'dic'), fecha: '2027-01-01', periodo: '2027-01' });
  assert.deepEqual([...a.estado.pendientes].sort(), ['2026', '2027']);
  await a.sincronizar();
  assert.ok(!carpeta.leer('finanzas-2026.json').movimientos.some((m) => m.id === 'dic'));
  assert.deepEqual(carpeta.leer('finanzas-2027.json').movimientos.map((m) => m.id), ['dic']);

  await b.sincronizar();
  const copias = b.doc().movimientos.filter((m) => m.id === 'dic');
  assert.equal(copias.length, 1);
  assert.equal(copias[0].fecha, '2027-01-01');
});

test('un archivo de año con una copia vieja se vuelve a subir limpio', async () => {
  const carpeta = new Carpeta();
  carpeta.poner('finanzas.json', archivoV1());
  const a = dispositivo(carpeta, 'moises');
  await a.sincronizar();
  const viejo = { id: 'mv', tipo: 'gasto', fecha: '2026-12-30', periodo: '2026-12', cuentaId: 'gastos', monto: 1, actualizado: '2026-09-01T00:00:00Z' };
  const nuevo = { ...viejo, fecha: '2027-01-02', periodo: '2027-01', actualizado: '2026-09-02T00:00:00Z' };
  const archivo2026 = carpeta.leer('finanzas-2026.json');
  carpeta.poner('finanzas-2026.json', { ...archivo2026, movimientos: [...archivo2026.movimientos, viejo] });
  carpeta.poner('finanzas-2027.json', { esquema: 2, anio: 2027, apertura: null, movimientos: [nuevo], recibos: [], ajustesPartida: [] });

  await a.sincronizar();
  assert.ok(!carpeta.leer('finanzas-2026.json').movimientos.some((m) => m.id === 'mv'));
  assert.equal(a.doc().movimientos.filter((m) => m.id === 'mv').length, 1);
});

// Carpeta con 2025, 2026 y 2027. 2026 y 2027 traen su apertura (salvo que se pida lo contrario).
function carpetaConAnios({ apertura2026 = true } = {}) {
  const carpeta = new Carpeta();
  const base = docVacio();
  base.config = { ...base.config, inicio: '2025-01', actualizado: T };
  base.personas = [{ id: 'moises', nombre: 'Moises', ...s }];
  carpeta.poner('finanzas.json', contenidoArchivo(base, PRINCIPAL));
  const mov = (id, fecha) => ({ id, tipo: 'gasto', fecha, periodo: fecha.slice(0, 7), cuentaId: 'gastos', monto: 100, ...s });
  const apertura = (anio) => ({
    version: 1, anio, fecha: `${anio - 1}-12-31`, cuentas: { gastos: -100 * (anio - 2024) * 100 }, tarjetas: {}, prestamos: {}, metas: {}, partidas: {},
    registros: { movimientos: [], recibos: [] }, actualizado: T,
  });
  const anio = (y, ap) => ({ esquema: 2, anio: y, apertura: ap, movimientos: [mov(`m${y}`, `${y}-05-01`)], recibos: [], ajustesPartida: [] });
  carpeta.poner('finanzas-2025.json', anio(2025, null));
  carpeta.poner('finanzas-2026.json', anio(2026, apertura2026 ? apertura(2026) : null));
  carpeta.poner('finanzas-2027.json', anio(2027, apertura(2027)));
  carpeta.registro = [];
  return carpeta;
}
const nombres = (registro, op) => registro.filter(([o]) => o === op).map(([, n]) => n).sort();

test('con el año anterior como el más viejo, 2025 no se baja ni se sube', async () => {
  const carpeta = carpetaConAnios();
  const a = dispositivo(carpeta, 'moises');
  const r = await a.sincronizar('2026');
  assert.deepEqual(nombres(carpeta.registro, 'bajar'), ['finanzas-2026.json', 'finanzas-2027.json', 'finanzas.json']);
  assert.deepEqual([r.anios, r.desde, a.estado.cargados], [['2025', '2026', '2027'], '2026', ['2026', '2027']]);
  assert.deepEqual(a.doc().movimientos.map((m) => m.id).sort(), ['m2026', 'm2027']);
  assert.equal(a.doc().aperturas['2026'].anio, 2026);

  // Un cambio de 2027 sube solo ese archivo.
  carpeta.registro = [];
  a.guardar('movimientos', { id: 'nuevo', tipo: 'gasto', fecha: '2027-06-01', periodo: '2027-06', cuentaId: 'gastos', monto: 5 });
  await a.sincronizar('2026');
  assert.deepEqual(carpeta.registro, [['subir', 'finanzas-2027.json']]);
  assert.equal(carpeta.leer('finanzas-2027.json').apertura.anio, 2027); // la apertura se conserva
  assert.deepEqual(carpeta.leer('finanzas-2025.json').movimientos.map((m) => m.id), ['m2025']);
});

test('si el año más viejo no trae apertura, se baja también el anterior', async () => {
  const carpeta = carpetaConAnios({ apertura2026: false });
  const a = dispositivo(carpeta, 'moises');
  const r = await a.sincronizar('2026');
  assert.equal(r.desde, '2025');
  assert.deepEqual(a.estado.cargados, ['2025', '2026', '2027']);
  assert.ok(nombres(carpeta.registro, 'bajar').includes('finanzas-2025.json'));
});

test('abrir un año viejo lo baja, y un año con cambios por subir se baja antes de subirlo', async () => {
  const carpeta = carpetaConAnios();
  const a = dispositivo(carpeta, 'moises');
  await a.sincronizar('2026');
  await a.sincronizar('2025');
  assert.deepEqual(a.estado.cargados, ['2025', '2026', '2027']);
  a.guardar('movimientos', { ...a.doc().movimientos.find((m) => m.id === 'm2025'), monto: 250 });
  await a.sincronizar('2026');
  assert.equal(carpeta.leer('finanzas-2025.json').movimientos[0].monto, 250);

  // Un dispositivo que tiene 2025 pendiente sin haberlo bajado (no debería pasar) primero lo baja:
  // lo que ya había en OneDrive no se pierde.
  const b = dispositivo(carpeta, 'ruth');
  await b.sincronizar('2026');
  b.guardar('movimientos', { id: 'viejo', tipo: 'gasto', fecha: '2025-07-01', periodo: '2025-07', cuentaId: 'gastos', monto: 9 });
  await b.sincronizar('2026');
  assert.deepEqual(carpeta.leer('finanzas-2025.json').movimientos.map((m) => m.id).sort(), ['m2025', 'viejo']);
});

test('un año que sigue en el documento se mantiene al día aunque ya no haga falta', async () => {
  const carpeta = carpetaConAnios();
  const a = dispositivo(carpeta, 'moises');
  const b = dispositivo(carpeta, 'ruth');
  await a.sincronizar('2025');
  await b.sincronizar('2025');
  b.guardar('movimientos', { ...b.doc().movimientos.find((m) => m.id === 'm2025'), monto: 777 });
  await b.sincronizar('2025');
  carpeta.registro = [];
  await a.sincronizar('2026');
  assert.deepEqual(carpeta.registro, [['bajar', 'finanzas-2025.json']]);
  assert.equal(a.doc().movimientos.find((m) => m.id === 'm2025').monto, 777);
});

test('la apertura calculada en un dispositivo llega al otro', async () => {
  const carpeta = carpetaConAnios();
  const a = dispositivo(carpeta, 'moises');
  const b = dispositivo(carpeta, 'ruth');
  await a.sincronizar('2026');
  await b.sincronizar('2026');
  const nueva = { ...a.doc().aperturas['2027'], cuentas: { gastos: 123 }, actualizado: '2027-02-01T00:00:00.000Z' };
  a.adoptarApertura('2027', nueva);
  await a.sincronizar('2026');
  assert.deepEqual(carpeta.leer('finanzas-2027.json').apertura, nueva);
  await b.sincronizar('2026');
  assert.deepEqual(b.doc().aperturas['2027'], nueva);
});
