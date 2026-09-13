import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docVacio } from '../js/core/modelo.js';
import { calcularAvisos } from '../js/core/avisos.js';
import { crearIndice } from '../js/core/asientos.js';
import {
  recordatoriosDeseados, eventoDeRecordatorio, planRecordatorios, huellaDe, huellaDeRecordatorios, PROPIEDAD_RECORDATORIO,
} from '../js/core/recordatorios.js';

const T = (fecha) => `${fecha}T12:00:00Z`;
const partida = (id, datos) => ({ id, nombre: datos.nombre || id, tipo: 'gasto', forma: 'fijo', meses: [], medioPagoId: 'gastos', categoriaId: 'servicios', activo: true, creado: T('2026-08-01'), ...datos });

function hogar(extra = {}) {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2026-09' };
  doc.personas = [{ id: 'moises', nombre: 'Moises' }, { id: 'ruth', nombre: 'Ruth' }];
  doc.cuentas = [...doc.cuentas, {
    id: 'visa', nombre: 'Visa', tipo: 'tarjeta', moneda: 'L', titularId: 'moises', saldoInicial: 0, creado: T('2026-08-01'),
    tarjeta: { diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', limite: { L: 20000, USD: null }, saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-08-31', saldoRegistrado: T('2026-08-31'), cargos: [] },
  }];
  doc.partidas = [
    partida('luz', { nombre: 'Luz', monto: 1500, dia: 20, responsableId: 'moises' }),
    partida('agua', { nombre: 'Agua', monto: 350, dia: 10, responsableId: 'ruth' }),
    partida('super', { nombre: 'Súper', monto: 6000, forma: 'abonos', responsableId: 'ruth' }),
    partida('streaming', { nombre: 'Streaming', monto: 300, dia: 5, medioPagoId: 'visa', responsableId: 'moises' }),
    partida('ahorro', { nombre: 'Ahorro', tipo: 'aporte', monto: 2000, dia: 16, responsableId: null, cuentaDestinoId: 'ahorro', categoriaId: 'ahorro' }),
    partida('tasa', { nombre: 'Tasa vehicular', tipo: 'anual', monto: 400, montoAnual: 4800, mesPago: 11, responsableId: 'moises', cuentaDestinoId: 'reservas' }),
  ];
  doc.prestamos = [
    { id: 'carro', nombre: 'Carro', tasa: 15, cuota: 8400, saldo: 150000, saldoPeriodo: '2026-08', fechaSaldo: '2026-08-31', ultimaCuota: '2028-06-02', dia: 2, responsableId: 'ruth', cuentaId: 'gastos', categoriaId: 'prestamos' },
    { id: 'rap', nombre: 'RAP', tasa: 10, cuota: 1500, saldo: 40000, saldoPeriodo: '2026-08', fechaSaldo: '2026-08-31', ultimaCuota: '2029-06-02', dia: 2, responsableId: 'moises', cuentaId: 'gastos', categoriaId: 'prestamos' },
  ];
  doc.ingresos = [{
    id: 'sal', nombre: 'Salario', personaId: 'moises', frecuencia: 'quincenal', diasPago: [15, 31], cuentaId: 'gastos', netoEsperado: 15000, activo: true,
    deducciones: [{ id: 'rap', nombre: 'RAP', naturaleza: 'prestamo', prestamoId: 'rap', aplicaEn: 'ambas' }],
  }];
  doc.movimientos = [
    { id: 'luz-sep', tipo: 'gasto', fecha: '2026-09-14', periodo: '2026-09', cuentaId: 'gastos', monto: 1500, partidaId: 'luz', categoriaId: 'servicios', creado: T('2026-09-14') },
    { id: 'compra', tipo: 'gasto', fecha: '2026-09-05', periodo: '2026-09', cuentaId: 'visa', moneda: 'L', monto: 1000, categoriaId: 'otros', creado: T('2026-09-05') },
  ];
  Object.assign(doc, extra);
  return crearIndice(doc, { hoy: '2026-09-15' });
}
const resumen = (lista) => lista.map((r) => [r.fecha, r.asunto]);

test('lo que vence en 60 días y sigue pendiente, sin montos; lo pagado con tarjeta y la cuota por planilla no', () => {
  const lista = recordatoriosDeseados(hogar(), { hoy: '2026-09-15', alcance: 'hogar' });
  assert.deepEqual(resumen(lista), [
    ['2026-09-16', 'Transferir: Ahorro'],
    ['2026-10-02', 'Cuota: Carro'],
    ['2026-10-10', 'Pagar tarjeta: Visa'],
    ['2026-10-10', 'Pagar: Agua'],
    ['2026-10-16', 'Transferir: Ahorro'],
    ['2026-10-20', 'Pagar: Luz'],
    ['2026-11-01', 'Pagar este mes: Tasa vehicular'],
    ['2026-11-02', 'Cuota: Carro'],
    ['2026-11-10', 'Pagar tarjeta: Visa'],
    ['2026-11-10', 'Pagar: Agua'],
  ]);
  assert.ok(lista.every((r) => !/\d/.test(r.asunto) && !/\d{3}/.test(r.evento.body.content.replace(/\d{4}-\d{2}-\d{2}/g, ''))));
  assert.equal(lista[0].clave, 'gh1|partida|ahorro:principal|2026-09-16');
  // Con "lo mío", Ruth ve lo suyo y lo del hogar.
  assert.deepEqual(resumen(recordatoriosDeseados(hogar(), { hoy: '2026-09-15', personaId: 'ruth', alcance: 'mio' })), [
    ['2026-09-16', 'Transferir: Ahorro'],
    ['2026-10-02', 'Cuota: Carro'],
    ['2026-10-10', 'Pagar: Agua'],
    ['2026-10-16', 'Transferir: Ahorro'],
    ['2026-11-02', 'Cuota: Carro'],
    ['2026-11-10', 'Pagar: Agua'],
  ]);
});

test('evento de todo el día con alarma el día anterior a las 8:00, o de 7:00 a 7:15 el mismo día', () => {
  const r = { clave: 'gh1|partida|luz:principal|2026-10-20', fecha: '2026-10-20', asunto: 'Pagar: Luz', detalle: 'pagar Luz' };
  const { evento, huella } = eventoDeRecordatorio(r, { enlace: 'https://ejemplo.github.io/app/' });
  assert.deepEqual([evento.isAllDay, evento.start.dateTime, evento.end.dateTime, evento.reminderMinutesBeforeStart, evento.showAs, evento.sensitivity], [true, '2026-10-20T00:00:00', '2026-10-21T00:00:00', 960, 'free', 'private']);
  assert.deepEqual(evento.singleValueExtendedProperties, [{ id: PROPIEDAD_RECORDATORIO, value: `gh1|partida|luz:principal|2026-10-20#${huella}` }]);
  assert.ok(evento.body.content.endsWith('Regístralo en https://ejemplo.github.io/app/'));
  const temprano = eventoDeRecordatorio(r, { aviso: 'mismo_dia_7' });
  assert.deepEqual([temprano.evento.isAllDay, temprano.evento.start.dateTime, temprano.evento.end.dateTime, temprano.evento.reminderMinutesBeforeStart], [false, '2026-10-20T07:00:00', '2026-10-20T07:15:00', 0]);
  assert.notEqual(temprano.huella, huella);
  assert.equal(huellaDe('abc'), huellaDe('abc'));
  assert.notEqual(huellaDe('abc'), huellaDe('abd'));
});

test('plan: crea lo que falta, cambia lo que cambió, borra lo que sobra y no toca lo ajeno ni las pruebas', () => {
  const d = (clave, huella) => ({ clave: `gh1|partida|${clave}|2026-10-20`, huella });
  const deseados = [d('a', 'h1'), d('b', 'h2'), d('c', 'h3'), d('e', 'h5')];
  const existentes = [
    { id: '1', valor: 'gh1|partida|a|2026-10-20#h1' },
    { id: '2', valor: 'gh1|partida|b|2026-10-20#viejo' },
    { id: '3', valor: 'gh1|partida|b|2026-10-20#h2' },
    { id: '4', valor: 'gh1|partida|x|2026-10-20#zz' },
    { id: '5', valor: 'otra app' },
    { id: '6', valor: 'gh1|prueba|1|2026-09-15#p' },
    { id: '7', valor: 'gh1|partida|e|2026-10-20#h4' },
  ];
  const plan = planRecordatorios(deseados, existentes);
  assert.deepEqual(plan.crear.map((x) => x.clave), ['gh1|partida|c|2026-10-20']);
  assert.deepEqual(plan.actualizar.map((x) => [x.id, x.deseado.huella]), [['7', 'h5']]);
  assert.deepEqual(plan.borrar, ['2', '4']);
  // Si nada cambió, la huella del conjunto es la misma.
  assert.equal(huellaDeRecordatorios(deseados, { calendario: 'propio' }), huellaDeRecordatorios([...deseados], { calendario: 'propio' }));
  assert.notEqual(huellaDeRecordatorios(deseados, { calendario: 'propio' }), huellaDeRecordatorios(deseados, { calendario: 'principal' }));
});

test('si los recordatorios fallan en este dispositivo, hay un aviso para hoy', () => {
  const lista = calcularAvisos(hogar(), { hoy: '2026-09-15', recordatorios: { error: 'Outlook respondió 500.' } });
  const a = lista.find((x) => x.tipo === 'recordatorios');
  assert.deepEqual([a.id, a.cuando, a.texto, a.acciones[0].ruta], ['recordatorios:error:2026-09-15', 'hoy', 'Outlook respondió 500.', '#/recordatorios']);
  assert.ok(!calcularAvisos(hogar(), { hoy: '2026-09-15', recordatorios: { error: '' } }).some((x) => x.tipo === 'recordatorios'));
});
