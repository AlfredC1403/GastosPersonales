// Interpretación del aviso que manda el banco, con textos como los que llegan de verdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarAviso, numeroDeTexto, fechaDeTexto, comercioDeTexto, cuentaDelAviso, comercioDelAviso } from '../js/core/avisos-banco.js';
import { crearIndice } from '../js/core/asientos.js';
import { docVacio } from '../js/core/modelo.js';

const HOY = '2026-09-21';
const leer = (texto) => interpretarAviso(texto, { hoy: HOY });

test('un número escrito de cualquiera de las dos maneras es el mismo número', () => {
  assert.equal(numeroDeTexto('1,234.56'), 1234.56);
  assert.equal(numeroDeTexto('1.234,56'), 1234.56);
  assert.equal(numeroDeTexto('850.00'), 850);
  assert.equal(numeroDeTexto('300'), 300);
  assert.equal(numeroDeTexto('12,500'), 12500);
  assert.equal(numeroDeTexto('sin números'), null);
});

test('la fecha sale en cualquiera de los formatos que usan los bancos', () => {
  assert.equal(fechaDeTexto('el 21/09/2026 a las 14:32', HOY), '2026-09-21');
  assert.equal(fechaDeTexto('fecha 03-09-26', HOY), '2026-09-03');
  assert.equal(fechaDeTexto('2026-09-21 14:32', HOY), '2026-09-21');
  assert.equal(fechaDeTexto('el 5 de septiembre de 2026', HOY), '2026-09-05');
  assert.equal(fechaDeTexto('sin fecha', HOY), null);
  // Un aviso de un mes que todavía no llega es del año pasado.
  assert.equal(fechaDeTexto('15 dic', HOY), '2025-12-15');
  assert.equal(fechaDeTexto('15 ago', HOY), '2026-08-15');
});

test('el comercio se corta donde empieza otra pieza del aviso', () => {
  assert.equal(comercioDeTexto('Compra por L850.00 en FARMACIA KIELSA, tarjeta ****5678'), 'FARMACIA KIELSA');
  assert.equal(comercioDeTexto('comercio: PIZZA HUT TGU tarjeta 9012'), 'PIZZA HUT');
  assert.equal(comercioDeTexto('en SUPERMERCADO LA COLONIA el día 21/09/2026'), 'SUPERMERCADO LA COLONIA');
  assert.equal(comercioDeTexto('Compra aprobada'), null);
});

test('BAC: compra en lempiras con tarjeta y fecha', () => {
  const a = leer('BAC Credomatic le informa: Compra por L1,234.56 en SUPERMERCADO LA COLONIA con tarjeta terminada en 1234 el 21/09/2026 14:32');
  assert.equal(a.bancoId, 'bac');
  assert.equal(a.tipo, 'gasto');
  assert.equal(a.monto, 1234.56);
  assert.equal(a.moneda, 'L');
  assert.equal(a.comercio, 'SUPERMERCADO LA COLONIA');
  assert.equal(a.ultimos4, '1234');
  assert.equal(a.fecha, '2026-09-21');
  assert.equal(a.periodo, '2026-09');
  assert.equal(a.confianza, 100);
});

test('BAC: una compra en dólares queda en dólares', () => {
  const a = leer('BAC: Transaccion aprobada por USD 45.00 en NETFLIX.COM, Tarjeta *1234');
  assert.equal(a.moneda, 'USD');
  assert.equal(a.monto, 45);
  assert.equal(a.comercio, 'NETFLIX.COM');
  assert.equal(a.ultimos4, '1234');
  assert.equal(a.fecha, HOY, 'sin fecha en el aviso, la de hoy');
  assert.equal(a.fechaDelAviso, null, 'pero se sabe que el aviso no la traía');
});

test('Ficohsa, Atlántida y Banpaís se leen igual de bien', () => {
  const fico = leer('Ficohsa: Se realizo una compra por L 850.00 en FARMACIA KIELSA, tarjeta ****5678, 21/09/2026');
  assert.deepEqual([fico.bancoId, fico.monto, fico.comercio, fico.ultimos4], ['ficohsa', 850, 'FARMACIA KIELSA', '5678']);

  const atl = leer('Banco Atlantida informa: Compra POS L2,500.00 comercio PIZZA HUT TGU tarjeta 9012 fecha 21/09/2026');
  assert.deepEqual([atl.bancoId, atl.monto, atl.comercio, atl.ultimos4], ['atlantida', 2500, 'PIZZA HUT', '9012']);

  const bp = leer('BANPAIS: Compra por L 300.00 en UBER, tarjeta terminada en 3456.');
  assert.deepEqual([bp.bancoId, bp.monto, bp.comercio, bp.ultimos4], ['banpais', 300, 'UBER', '3456']);
});

test('reconoce qué clase de movimiento anuncia el aviso', () => {
  assert.equal(leer('BAC: Retiro en cajero por L2,000.00 en ATM MALL MULTIPLAZA tarjeta 1234').tipo, 'retiro');
  assert.equal(leer('Ficohsa: Deposito por L15,000.00 acreditado a su cuenta').tipo, 'ingreso');
  assert.equal(leer('BAC: Pago a su tarjeta terminada en 1234 por L5,000.00 aplicado').tipo, 'pago_tarjeta');
  assert.equal(leer('Compra por L100.00 en PULPERIA').tipo, 'gasto');
  // En un depósito o un pago no se busca comercio: "en su cuenta" no es un comercio.
  assert.equal(leer('Ficohsa: Deposito por L15,000.00 en su cuenta de ahorros').comercio, null);
});

test('lo que no parece un aviso no se interpreta', () => {
  assert.equal(leer(''), null);
  assert.equal(leer('Hola, ¿vas a llegar a cenar?'), null);
  assert.equal(leer('Compra aprobada sin monto en LA COLONIA'), null, 'sin monto no hay nada que registrar');
  assert.equal(leer('x'.repeat(2500)), null);
});

test('la confianza baja cuando el aviso trae menos piezas', () => {
  const completo = leer('BAC: Compra por L500.00 en LA COLONIA con tarjeta terminada en 1234 el 21/09/2026');
  const pelado = leer('Compra por L500.00');
  assert.equal(completo.confianza, 100);
  assert.ok(pelado.confianza <= 50, `esperaba poca confianza, no ${pelado.confianza}`);
});

test('el aviso se empareja con la tarjeta y el comercio del hogar', () => {
  const doc = docVacio();
  doc.comercios = [
    { id: 'colonia', nombre: 'Supermercado La Colonia', actualizado: 't' },
    { id: 'kielsa', nombre: 'Farmacia Kielsa', actualizado: 't' },
  ];
  doc.cuentas.push({
    id: 'visa', nombre: 'Visa BAC', tipo: 'tarjeta', moneda: 'L', saldoInicial: 0, titularId: null, actualizado: 't',
    tarjeta: { banco: 'BAC', ultimos4: '1234', diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-01-01', cargos: [] },
  });
  const ix = crearIndice(doc, { hoy: HOY });

  const a = leer('BAC: Compra por L1,200.00 en LA COLONIA con tarjeta terminada en 1234 el 21/09/2026');
  assert.equal(cuentaDelAviso(ix, a).id, 'visa');
  assert.equal(comercioDelAviso(ix, a).id, 'colonia', 'el nombre corto encuentra al largo');

  const otra = leer('Compra por L100.00 en LA COLONIA con tarjeta terminada en 9999');
  assert.equal(cuentaDelAviso(ix, otra), null, 'sin coincidencia no se adivina la tarjeta');
});
