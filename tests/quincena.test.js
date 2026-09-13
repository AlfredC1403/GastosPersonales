import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tramosDePago, tramoDeFecha } from '../js/core/quincena.js';
import { calcularAvisos, avisosVisibles } from '../js/core/avisos.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const prestamo = (id, cuota, ultimaCuota, extra = {}) => ({
  id, nombre: id, tasa: 12, cuota, saldo: 100000, saldoPeriodo: '2026-08', fechaSaldo: '2026-08-10', ultimaCuota, responsableId: 'ruth', cuentaId: 'gastos', categoriaId: 'prestamos', dia: Number(ultimaCuota.slice(8)), ...extra,
});
const partida = (id, datos) => ({ id, nombre: id, tipo: 'gasto', forma: 'fijo', categoriaId: 'servicios', responsableId: 'ruth', meses: [], medioPagoId: 'gastos', activo: true, creado: '2026-08-01T00:00:00Z', ...datos });
const salario = (id, personaId, neto, deducciones = []) => ({
  id, nombre: `Salario ${personaId}`, personaId, frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'igual', cuentaId: 'gastos', netoEsperado: neto, activo: true, deducciones,
});

function hogar(hoy = '2026-09-20', extra = {}) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'ruth', nombre: 'Ruth' }, { id: 'moises', nombre: 'Moises' }];
  doc.ingresos = [
    salario('sal-ruth', 'ruth', 14250),
    salario('sal-moises', 'moises', 15000, [{ id: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', aplicaEn: 'ambas' }]),
  ];
  doc.prestamos = [prestamo('carro', 8400, '2028-06-02'), prestamo('casa', 13000, '2054-06-07', { responsableId: 'moises' }), prestamo('rap', 1500.05, '2029-06-02', { responsableId: 'moises' })];
  doc.partidas = [
    partida('super', { forma: 'abonos', monto: 6000, categoriaId: 'comida' }),
    partida('internet', { monto: 1250, dia: 20, responsableId: 'moises' }),
    partida('colegio', { monto: 4500, sePagaCon: 'q1', categoriaId: 'educacion' }),
  ];
  doc.movimientos = [{ id: 'ropa', tipo: 'gasto', fecha: '2026-09-20', periodo: '2026-09', cuentaId: 'gastos', monto: 800, categoriaId: 'ropa', personaId: 'ruth' }];
  Object.assign(doc, extra);
  return crearIndice(doc, { hoy });
}

const itemsDe = (t) => t.items.map((x) => [x.it.clave, x.periodo, x.fecha, x.esperado / 100]);

test('los tramos van de un día de pago al día antes del siguiente, aunque crucen de mes', () => {
  const tramos = tramosDePago(hogar(), '2026-09');
  assert.deepEqual(tramos.map((t) => [t.inicio, t.fin]), [['2026-08-31', '2026-09-14'], ['2026-09-15', '2026-09-29'], ['2026-09-30', '2026-10-14']]);
  assert.equal(tramos[1].entra, 29250);
  assert.equal(tramoDeFecha(hogar(), '2026-09-20').inicio, '2026-09-15');
});

test('la cuota del día 7 cae en el tramo del pago anterior; la partida sin día se reparte y la de "primer pago" va en el del 15', () => {
  const [, del15, del30] = tramosDePago(hogar(), '2026-09');
  assert.deepEqual(itemsDe(del15), [
    ['internet:principal', '2026-09', '2026-09-20', 1250],
    ['colegio:principal', '2026-09', null, 4500],
    ['super:principal', '2026-09', null, 3000],
  ]);
  assert.deepEqual(itemsDe(del30), [
    ['prestamo:carro', '2026-10', '2026-10-02', 8400],
    ['prestamo:casa', '2026-10', '2026-10-07', 13000],
    ['super:principal', '2026-09', null, 3000],
  ]);
  // El préstamo por planilla no sale de la cuenta: no aparece en ningún tramo.
  assert.ok(![del15, del30].some((t) => t.items.some((x) => x.it.clave === 'prestamo:rap')));
});

test('el disponible del tramo descuenta el plan y lo gastado fuera del plan en esas fechas', () => {
  const [, del15] = tramosDePago(hogar(), '2026-09');
  assert.equal(del15.sale, 1250 + 4500 + 3000);
  assert.equal(del15.fueraDelPlan, 800);
  assert.equal(del15.disponible, 29250 - (1250 + 4500 + 3000) - 800);
  const soloRuth = tramosDePago(hogar(), '2026-09', { personaId: 'ruth' })[1];
  assert.equal(soloRuth.entra, 14250);
  assert.equal(soloRuth.sale, 4500 + 3000);
});

test('sin salarios con monto no hay tramos', () => {
  assert.deepEqual(tramosDePago(hogar('2026-09-20', { ingresos: [] }), '2026-09'), []);
});

test('avisos: pago sin registrar, deducciones pendientes, vencidas, por vencer, abonos abiertos y cuota incompleta', () => {
  const hoy = '2026-10-20';
  const ix = hogar(hoy, {
    partidas: [
      partida('super', { forma: 'abonos', monto: 6000, categoriaId: 'comida' }),
      partida('internet', { monto: 1250, dia: 10, responsableId: 'moises' }),
      partida('luz', { forma: 'variable', monto: 1800, dia: 22 }),
      partida('tasa', { tipo: 'anual', monto: 400, montoAnual: 4800, mesPago: 11, cuentaDestinoId: 'reservas' }),
      partida('gas', { monto: 0 }),
    ],
    recibos: [
      { id: 'r1', ingresoId: 'sal-moises', tipo: 'ordinario', ocurrencia: '2026-09-15', periodo: '2026-09', fecha: '2026-09-15', cuentaId: 'gastos', neto: 14100, deducciones: [{ deduccionId: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', monto: 750.02 }] },
      { id: 'r2', ingresoId: 'sal-moises', tipo: 'ordinario', ocurrencia: '2026-10-15', periodo: '2026-10', fecha: '2026-10-15', cuentaId: 'gastos', neto: 14100, deducciones: [{ deduccionId: 'isr', nombre: 'ISR', monto: null }] },
      ...['2026-09-15', '2026-09-30', '2026-10-15'].map((o) => ({ id: `ruth-${o}`, ingresoId: 'sal-ruth', tipo: 'ordinario', ocurrencia: o, periodo: o.slice(0, 7), fecha: o, cuentaId: 'gastos', neto: 14250, deducciones: [] })),
    ],
    movimientos: [{ id: 's1', tipo: 'gasto', fecha: '2026-09-10', periodo: '2026-09', cuentaId: 'gastos', monto: 2000, partidaId: 'super', categoriaId: 'comida' }],
  });
  const avisos = calcularAvisos(ix, { hoy, sync: { ubicacion: {}, estado: 'error', mensaje: 'OneDrive respondió 500' } });
  const porId = Object.fromEntries(avisos.map((a) => [a.id, a]));
  assert.ok(porId['sync:error:2026-10-20']);
  assert.equal(porId['pago:sal-moises|ordinario|2026-09-30'].cuando, 'hoy');
  assert.ok(!porId['pago:sal-ruth|ordinario|2026-09-30']);
  assert.equal(porId['deducciones:r2'].texto, 'Pago del 15 oct: ISR.');
  assert.equal(porId['vencida:internet:principal:2026-10'].cuando, 'hoy');
  assert.equal(porId['vence:luz:principal:2026-10'].cuando, 'semana');
  assert.deepEqual(porId['abonos:super:principal:2026-09'].acciones.map((x) => x.tipo), ['cerrarPartida', 'pasarAlSiguiente']);
  assert.equal(porId['cuota:prestamo:rap:2026-09'].texto, 'Se descontaron L750.02 de L1,500.05 por planilla.');
  assert.ok(porId['anual:tasa:2026-11']);
  assert.ok(Object.keys(porId).some((id) => id.startsWith('sin-monto:')));
  // Las cuotas con día que no son por planilla también avisan.
  assert.ok(porId['vencida:prestamo:carro:2026-10']);
  assert.ok(!porId['vencida:prestamo:rap:2026-10']);
});

test('un aviso pospuesto vuelve al día siguiente; uno descartado no vuelve', () => {
  const avisos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ocultos = { a: '2026-10-21', b: 'siempre' };
  assert.deepEqual(avisosVisibles(avisos, ocultos, '2026-10-20').map((x) => x.id), ['c']);
  assert.deepEqual(avisosVisibles(avisos, ocultos, '2026-10-21').map((x) => x.id), ['a', 'c']);
});
