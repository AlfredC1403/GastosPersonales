import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { crearIndice } from '../js/core/asientos.js';
import { estadoMeta, estadoMetas } from '../js/core/metas.js';
import { calcularAvisos } from '../js/core/avisos.js';

const T = (fecha) => `${fecha}T12:00:00Z`;

function indice({ metas = [], movimientos = [], ingresos = [] }, hoy) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ruth', nombre: 'Ruth' }];
  Object.assign(doc, { metas, movimientos, ingresos });
  return crearIndice(doc, { hoy });
}
const transferencia = (id, fecha, monto, extra = {}) => ({
  id, tipo: 'transferencia', fecha, periodo: fecha.slice(0, 7), cuentaId: 'gastos', cuentaDestinoId: 'ahorro', monto, creado: T(fecha), ...extra,
});
const salario = (personaId, frecuencia) => ({
  id: `sal-${personaId}`, nombre: 'Salario', personaId, frecuencia, diasPago: [15, 31], netoEsperado: 10000, cuentaId: 'gastos', activo: true, deducciones: [],
});

test('meta sin cuenta: saldo inicial más aportes menos retiros, con el aporte sugerido por mes y por quincena', () => {
  const viaje = { id: 'viaje', nombre: 'Viaje', montoObjetivo: 12000, fechaObjetivo: '2027-08', cuentaId: null, responsableId: 'ruth', saldoInicial: 1000, activo: true, creado: T('2026-09-01') };
  const movimientos = [
    transferencia('aporte', '2026-09-10', 2000, { metaId: 'viaje' }),
    { id: 'retiro', tipo: 'gasto', fecha: '2026-09-12', periodo: '2026-09', cuentaId: 'gastos', monto: 500, metaId: 'viaje', creado: T('2026-09-12') },
    transferencia('sin-meta', '2026-09-11', 900),
  ];
  const e = estadoMeta(indice({ metas: [viaje], movimientos, ingresos: [salario('ruth', 'quincenal')] }, '2026-09-15'), viaje);
  assert.deepEqual([e.porCuenta, e.ahorrado, e.falta, e.mesesRestantes], [false, 2500, 9500, 12]);
  // L9,500 en 12 meses (septiembre incluido), y la mitad en cada quincena.
  assert.deepEqual([e.aporteMensual, e.aportePorPago, e.pagos], [791.67, 395.84, 2]);
  assert.deepEqual([e.esteMes, e.situacion], [1500, 'al-dia']);
});

test('meta con cuenta propia: lo ahorrado es el saldo de la cuenta, y va al día o atrasada según un ritmo parejo', () => {
  const fondo = { id: 'fondo', nombre: 'Fondo', montoObjetivo: 12000, fechaObjetivo: '2027-08', cuentaId: 'ahorro', responsableId: null, saldoInicial: 0, activo: true, creado: T('2026-09-01') };
  const movimientos = [transferencia('t1', '2026-09-10', 1000), transferencia('t2', '2026-10-10', 1000), transferencia('t3', '2026-11-10', 500)];
  let e = estadoMeta(indice({ metas: [fondo], movimientos }, '2026-12-05'), fondo);
  // Pasaron 3 de 12 meses: a ritmo parejo deberían llevar L3,000 y llevan L2,500.
  assert.deepEqual([e.porCuenta, e.ahorrado, e.ritmo, e.situacion, e.aportePorPago], [true, 2500, 3000, 'atrasada', null]);
  const aviso = calcularAvisos(indice({ metas: [fondo], movimientos }, '2026-12-05'), { hoy: '2026-12-05' }).find((a) => a.tipo === 'meta');
  assert.deepEqual([aviso.id, aviso.cuando, aviso.texto], ['meta-atrasada:fondo:2026-12', 'revisar', 'Lleva L2,500.00 de L12,000.00. Para llegar en agosto 2027 hacen falta L1,055.56 al mes.']);
  e = estadoMeta(indice({ metas: [fondo], movimientos: [...movimientos, transferencia('t4', '2026-12-01', 500)] }, '2026-12-05'), fondo);
  assert.deepEqual([e.situacion, e.esteMes], ['al-dia', 500]);

  // Dos metas en la misma cuenta: cada una cuenta sus aportes marcados.
  const otra = { ...fondo, id: 'otra', nombre: 'Otra' };
  const ix = indice({ metas: [fondo, otra], movimientos: [...movimientos, transferencia('t5', '2026-12-02', 700, { metaId: 'otra' })] }, '2026-12-05');
  assert.deepEqual([estadoMeta(ix, fondo).porCuenta, estadoMeta(ix, otra).ahorrado], [false, 700]);
  // Un retiro desde la cuenta de la meta resta.
  const conRetiro = indice({ metas: [fondo, otra], movimientos: [transferencia('t6', '2026-12-02', 700, { metaId: 'otra' }), transferencia('t7', '2026-12-03', 200, { metaId: 'otra', cuentaId: 'ahorro', cuentaDestinoId: 'gastos' })] }, '2026-12-05');
  assert.equal(estadoMeta(conRetiro, otra).ahorrado, 500);
});

test('meta lograda, meta que pasó la fecha y filtro por persona', () => {
  const meta = { id: 'm', nombre: 'Meta', montoObjetivo: 1000, fechaObjetivo: '2026-10', cuentaId: null, responsableId: null, saldoInicial: 0, activo: true, creado: T('2026-09-01') };
  assert.equal(estadoMeta(indice({ metas: [meta], movimientos: [transferencia('a', '2026-09-10', 1000, { metaId: 'm' })] }, '2026-09-15'), meta).situacion, 'lograda');
  const e = estadoMeta(indice({ metas: [meta], movimientos: [transferencia('a', '2026-09-10', 400, { metaId: 'm' })] }, '2026-11-02'), meta);
  assert.deepEqual([e.situacion, e.mesesRestantes, e.aporteMensual, e.falta], ['vencida', 0, 0, 600]);
  const ix = indice({ metas: [meta, { ...meta, id: 'r', responsableId: 'ruth', fechaObjetivo: null }] }, '2026-09-15');
  assert.deepEqual(estadoMetas(ix, { personaId: 'ruth' }).map((x) => [x.meta.id, x.situacion]), [['r', 'sin-fecha']]);
  assert.equal(estadoMetas(ix).length, 2);
});
