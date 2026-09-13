// Datos de prueba ficticios de 2025 a 2027 para las aperturas y los resúmenes guardados (ver
// tests/cierres.test.js). También sirven para probar Años anteriores en el navegador.
import { docVacio } from '../../js/core/modelo.js';
import { sumarMeses, fechaEnMes } from '../../js/core/util.js';

// Incluyen lo que cruza de un año a otro: pagos de diciembre hechos en enero (y de enero hechos en
// diciembre), compras a cuotas, dólares pagados con otra tasa y saldo a favor, préstamos con abonos
// y mitades, partidas que acumulan y metas.
export const HOY = '2027-09-15';
const T = (fecha) => `${fecha}T12:00:00.000Z`;

export function hogar() {
  const doc = docVacio();
  doc.config = { ...doc.config, inicio: '2025-01', tasaReferencia: 25 };
  doc.personas = [{ id: 'moises', nombre: 'Moises', creado: T('2025-01-01') }, { id: 'ruth', nombre: 'Ruth', creado: T('2025-01-01') }];
  const cuenta = (id, datos) => ({ id, saldoInicial: 0, moneda: 'L', titularId: null, creado: T('2025-01-01'), ...datos });
  doc.cuentas = doc.cuentas.map((c) => (c.id === 'gastos' ? { ...c, saldoInicial: 20000 } : c));
  doc.cuentas.push(
    cuenta('banco-ruth', { nombre: 'Banco de Ruth', tipo: 'banco', titularId: 'ruth', saldoInicial: 5000 }),
    cuenta('dolares', { nombre: 'Dólares', tipo: 'banco', moneda: 'USD', titularId: 'moises', saldoInicial: 100 }),
    cuenta('visa', {
      nombre: 'Visa', tipo: 'tarjeta', titularId: 'moises',
      tarjeta: {
        diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', limite: { L: 60000, USD: 2000 }, saldoInicial: { L: 1000, USD: 50 },
        saldoFecha: '2024-12-31', saldoRegistrado: T('2024-12-31'),
        cargos: [
          { id: 'membresia', nombre: 'Membresía', tipo: 'membresia', monto: 150, moneda: 'L', periodicidad: 'mensual' },
          { id: 'seguro', nombre: 'Seguro de viaje', tipo: 'seguro', monto: 5, moneda: 'USD', periodicidad: 'meses', meses: [3, 9] },
        ],
      },
    }),
    cuenta('mc', {
      nombre: 'Mastercard', tipo: 'tarjeta', titularId: 'ruth', creado: T('2026-06-30'),
      tarjeta: { diaCorte: 31, diaPago: 15, cuentaPagoId: 'banco-ruth', limite: { L: 30000, USD: null }, saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-06-30', saldoRegistrado: T('2026-06-30'), cargos: [] },
    }),
  );
  const partida = (id, datos) => ({ id, nombre: id, tipo: 'gasto', forma: 'fijo', meses: [], medioPagoId: 'gastos', activo: true, creado: T('2025-01-01'), ...datos });
  doc.partidas = [
    partida('super', { forma: 'abonos', monto: 6000, categoriaId: 'comida', responsableId: 'ruth', acumula: true }),
    partida('luz', { forma: 'variable', monto: 1500, categoriaId: 'servicios', responsableId: 'moises', dia: 20, acumula: true }),
    partida('internet', { monto: 1250, categoriaId: 'comunicaciones', responsableId: 'moises', dia: 5, medioPagoId: 'visa' }),
    partida('viaje', { tipo: 'aporte', monto: 1000, categoriaId: 'ahorro', responsableId: null, cuentaDestinoId: 'ahorro', metaId: 'viaje' }),
    partida('tasa', { tipo: 'anual', monto: 400, montoAnual: 4800, mesPago: 11, categoriaId: 'impuestos', responsableId: 'moises', cuentaDestinoId: 'reservas' }),
  ];
  const prestamo = (id, datos) => ({ id, nombre: id, dia: 2, cuentaId: 'gastos', categoriaId: 'prestamos', creado: T('2025-01-01'), ...datos });
  doc.prestamos = [
    prestamo('carro', { tasa: 15, cuota: 8400, saldo: 150000, saldoPeriodo: '2024-12', fechaSaldo: '2024-12-31', saldoRegistrado: T('2024-12-31'), ultimaCuota: '2028-06-02', responsableId: 'ruth' }),
    prestamo('rap', { tasa: 10, cuota: 1500, saldo: 40000, saldoPeriodo: '2024-12', fechaSaldo: '2024-12-31', ultimaCuota: '2029-06-02', responsableId: 'moises' }),
    prestamo('moto', { tasa: 20, cuota: 10500, saldo: 250000, saldoPeriodo: '2026-05', fechaSaldo: '2026-05-31', ultimaCuota: '2029-06-02', dia: 10, responsableId: 'moises', creado: T('2026-06-01') }),
  ];
  doc.ingresos = [
    {
      id: 'sal-moises', nombre: 'Salario de Moises', personaId: 'moises', frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'igual', cuentaId: 'gastos',
      netoEsperado: 15000, decimo13: true, decimo14: true, activo: true, categoriaId: 'salario',
      deducciones: [
        { id: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', fija: true, montoEsperado: 480.5 },
        { id: 'isr', nombre: 'ISR', naturaleza: 'gasto', categoriaId: 'isr' },
        { id: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', aplicaEn: 'ambas' },
        { id: 'aportacion', nombre: 'Aportación RAP', naturaleza: 'ahorro', cuentaDestinoId: 'ahorro', montoEsperado: 300 },
      ],
    },
    {
      id: 'sal-ruth', nombre: 'Salario de Ruth', personaId: 'ruth', frecuencia: 'mensual', diasPago: [31], cuentaId: 'banco-ruth', netoEsperado: 22000, activo: true,
      categoriaId: 'salario', deducciones: [{ id: 'ihss-r', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', fija: true, montoEsperado: 300 }],
    },
  ];
  doc.metas = [
    { id: 'viaje', nombre: 'Viaje', montoObjetivo: 30000, fechaObjetivo: '2027-12-31', cuentaId: null, responsableId: null, saldoInicial: 500, activo: true, creado: T('2025-03-10') },
    { id: 'fondo', nombre: 'Fondo', montoObjetivo: 50000, fechaObjetivo: '2028-06-30', cuentaId: 'emergencias', responsableId: 'moises', saldoInicial: 0, activo: true, creado: T('2025-06-01') },
  ];
  doc.ajustesPartida = [
    { id: 'super:2025-12', partidaId: 'super', periodo: '2025-12', monto: 8000, creado: T('2025-12-01') },
    { id: 'luz:2026-02', partidaId: 'luz', periodo: '2026-02', omitir: true, creado: T('2026-02-01') },
  ];

  const movimientos = [];
  const recibos = [];
  const m = (tipo, fecha, datos) => {
    if (fecha <= HOY) movimientos.push({ id: `m${String(movimientos.length + 1).padStart(4, '0')}`, tipo, fecha, periodo: fecha.slice(0, 7), moneda: 'L', creado: T(fecha), actualizado: T(fecha), ...datos });
  };
  const r = (datos) => {
    if (datos.fecha <= HOY) recibos.push({ id: `r${String(recibos.length + 1).padStart(4, '0')}`, tipo: 'ordinario', extras: [], creado: T(datos.fecha), actualizado: T(datos.fecha), ...datos });
  };
  const deduccionesMoises = (i, d) => [
    { deduccionId: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', monto: 480.5 },
    { deduccionId: 'isr', nombre: 'ISR', naturaleza: 'gasto', categoriaId: 'isr', monto: (i + d) % 7 === 3 ? null : 250 + (i % 3) * 10 },
    { deduccionId: 'rap', nombre: 'Préstamo RAP', naturaleza: 'prestamo', prestamoId: 'rap', monto: 750 },
    { deduccionId: 'aportacion', nombre: 'Aportación RAP', naturaleza: 'ahorro', cuentaDestinoId: 'ahorro', monto: 300 },
  ];
  const carro = (monto) => ({ cuentaId: 'gastos', monto, categoriaId: 'prestamos', prestamoId: 'carro', personaId: 'ruth' });

  for (let i = 0, p = '2025-01'; p <= '2027-09'; i++, p = sumarMeses(p, 1)) {
    const dia = (d) => fechaEnMes(p, d);
    const siguiente = sumarMeses(p, 1);
    m('gasto', dia(5), { cuentaId: 'gastos', monto: 2000, categoriaId: 'comida', partidaId: 'super', personaId: 'ruth' });
    m('gasto', dia(20), { cuentaId: 'gastos', monto: 3000 + (i % 4) * 500, categoriaId: 'comida', partidaId: 'super', personaId: 'ruth' });
    if (p.endsWith('-12')) m('gasto', fechaEnMes(siguiente, 3), { periodo: p, cuentaId: 'gastos', monto: 1600, categoriaId: 'servicios', partidaId: 'luz', personaId: 'moises', cierra: true });
    else m('gasto', dia(22), { cuentaId: 'gastos', monto: 1400 + (i % 3) * 100, categoriaId: 'servicios', partidaId: 'luz', personaId: 'moises', cierra: i % 2 === 0 });
    if (p === '2027-01') m('gasto', '2026-12-30', { periodo: p, cuentaId: 'gastos', monto: 1250, categoriaId: 'comunicaciones', partidaId: 'internet', personaId: 'moises' });
    else m('gasto', dia(5), { cuentaId: 'visa', monto: 1250, categoriaId: 'comunicaciones', partidaId: 'internet', personaId: 'moises' });
    m('gasto', dia(12), { cuentaId: 'visa', monto: 800 + i * 10, categoriaId: 'restaurantes', personaId: 'moises' });
    m('pago_tarjeta', dia(8), { cuentaId: 'gastos', cuentaDestinoId: 'visa', monto: 2500, pagoL: 2500, pagoUSD: 0 });
    if (p === '2025-05') {
      m('gasto', dia(2), carro(4200));
      m('gasto', dia(17), carro(4200));
    } else if (p === '2025-12') {
      m('gasto', '2026-01-02', { ...carro(8400), periodo: p });
    } else {
      m('gasto', dia(2), carro(8400));
    }
    if (p >= '2026-06') m('gasto', dia(10), { cuentaId: 'gastos', monto: 10500, categoriaId: 'prestamos', prestamoId: 'moto', personaId: 'moises' });
    if (p === '2026-01') m('transferencia', '2025-12-30', { periodo: p, cuentaId: 'gastos', cuentaDestinoId: 'ahorro', monto: 1000, partidaId: 'viaje', metaId: 'viaje' });
    else m('transferencia', dia(16), { cuentaId: 'gastos', cuentaDestinoId: 'ahorro', monto: 1000, partidaId: 'viaje', metaId: 'viaje' });
    m('transferencia', dia(25), { cuentaId: 'gastos', cuentaDestinoId: 'emergencias', monto: 500 });
    m('transferencia', dia(3), { cuentaId: 'gastos', cuentaDestinoId: 'reservas', monto: 400, partidaId: 'tasa', parte: 'apartar' });
    if (p.endsWith('-11')) m('gasto', dia(15), { cuentaId: 'reservas', monto: 4800, categoriaId: 'impuestos', partidaId: 'tasa', parte: 'pagar', personaId: 'moises' });
    m('gasto', dia(18), { cuentaId: 'banco-ruth', monto: 350, categoriaId: 'salud' });
    if (p >= '2026-07') {
      m('gasto', dia(3), { cuentaId: 'mc', monto: 500 + i, categoriaId: 'ropa', personaId: 'ruth' });
      m('pago_tarjeta', dia(14), { cuentaId: 'banco-ruth', cuentaDestinoId: 'mc', monto: 400, pagoL: 400, pagoUSD: 0 });
    }
    for (const d of [15, 31]) {
      const ocurrencia = dia(d);
      let fecha = ocurrencia;
      if (p === '2026-01' && d === 15) fecha = '2025-12-31'; // pagado antes, en diciembre
      if (p === '2026-12' && d === 31) fecha = '2027-01-02'; // llegó en enero
      r({ ingresoId: 'sal-moises', ocurrencia, periodo: p, fecha, cuentaId: 'gastos', neto: 14000 + (i % 5) * 50, deducciones: deduccionesMoises(i, d) });
    }
    r({ ingresoId: 'sal-ruth', ocurrencia: dia(31), periodo: p, fecha: dia(31), cuentaId: 'banco-ruth', neto: 21700, deducciones: [{ deduccionId: 'ihss-r', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', monto: 300 }] });
    if (p.endsWith('-06')) r({ ingresoId: 'sal-moises', tipo: 'decimo14', ocurrencia: dia(30), periodo: p, fecha: dia(30), cuentaId: 'gastos', neto: 30000, deducciones: [] });
    if (p.endsWith('-12')) r({ ingresoId: 'sal-moises', tipo: 'decimo13', ocurrencia: dia(31), periodo: p, fecha: dia(20), cuentaId: 'gastos', neto: 30000, deducciones: [] });
  }

  // Dólares con la Visa. Al cierre de 2025 quedan compras sin pagar; al de 2026, US$20 a favor.
  m('gasto', '2025-11-05', { cuentaId: 'visa', moneda: 'USD', monto: 100, categoriaId: 'entretenimiento', personaId: 'moises' });
  m('gasto', '2025-12-10', { cuentaId: 'visa', moneda: 'USD', monto: 40, categoriaId: 'ropa', personaId: 'ruth' });
  m('gasto', '2025-12-28', { periodo: '2026-01', cuentaId: 'visa', moneda: 'USD', monto: 12, categoriaId: 'entretenimiento', personaId: 'moises' });
  m('gasto', '2025-10-01', { periodo: '2026-01', cuentaId: 'visa', moneda: 'USD', monto: 10, categoriaId: 'regalos', personaId: 'ruth' }); // pagada antes del cierre
  m('gasto', '2026-02-15', { cuentaId: 'visa', moneda: 'USD', monto: 30, categoriaId: 'regalos', personaId: 'moises' });
  m('gasto', '2027-05-01', { cuentaId: 'visa', moneda: 'USD', monto: 25, categoriaId: 'regalos', personaId: 'ruth' });
  for (const [fecha, usd, tasa] of [['2025-04-08', 55, 24.2], ['2025-12-05', 60, 24.5], ['2026-01-08', 110, 24.9], ['2026-04-08', 32, 25.1], ['2026-10-08', 5, 25.3], ['2026-12-20', 20, 25.4], ['2027-06-08', 10, 25.5]]) {
    m('pago_tarjeta', fecha, { cuentaId: 'gastos', cuentaDestinoId: 'visa', monto: 0, pagoL: 0, pagoUSD: usd, tasa });
  }
  // Compras a cuotas que se siguen cobrando después del cierre.
  m('gasto', '2025-10-15', { cuentaId: 'visa', monto: 12000, categoriaId: 'vivienda', personaId: 'moises', cuotas: { n: 12, tipo: 'intra', tasaAnual: 0, comision: { valor: 2, unidad: 'porcentaje', cobro: 'unica' } } });
  m('gasto', '2025-12-18', { cuentaId: 'visa', monto: 6000, categoriaId: 'comida', partidaId: 'super', personaId: 'ruth', cuotas: { n: 24, tipo: 'extra', tasaAnual: 18, comision: { valor: 50, unidad: 'monto', cobro: 'mensual' } } });
  m('gasto', '2026-11-05', { cuentaId: 'mc', monto: 9000, categoriaId: 'salud', personaId: 'ruth', cuotas: { n: 6, tipo: 'intra', cuotaBanco: 1600 } });
  // Abonos al carro (uno el 1 de enero, antes de la cuota de diciembre pagada el 2), cambio de
  // moneda, otro ingreso, ajuste, retiro de la meta y un gasto borrado.
  m('abono', '2025-08-20', { cuentaId: 'gastos', monto: 5000, prestamoId: 'carro', personaId: 'ruth' });
  m('abono', '2026-01-01', { cuentaId: 'gastos', monto: 10000, prestamoId: 'carro', personaId: 'ruth' });
  m('transferencia', '2025-06-10', { cuentaId: 'gastos', cuentaDestinoId: 'dolares', monto: 2450, montoDestino: 100 });
  m('transferencia', '2026-06-10', { cuentaId: 'gastos', cuentaDestinoId: 'dolares', monto: 2500, montoDestino: 100 });
  m('ingreso', '2026-07-01', { cuentaId: 'banco-ruth', monto: 1500, categoriaId: 'otros-ingresos', personaId: 'ruth' });
  m('ajuste', '2025-09-30', { cuentaId: 'gastos', monto: 150 });
  m('gasto', '2026-08-05', { cuentaId: 'ahorro', monto: 3000, categoriaId: 'entretenimiento', metaId: 'viaje', personaId: 'moises' });
  m('gasto', '2025-07-07', { cuentaId: 'gastos', monto: 999, categoriaId: 'otros', borrado: true });

  doc.movimientos = movimientos;
  doc.recibos = recibos;
  return doc;
}
