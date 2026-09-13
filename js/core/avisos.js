// Avisos: lo que conviene atender hoy, esta semana o cuando se pueda. Se calculan cada vez;
// en el dispositivo solo se guarda qué avisos se pospusieron o se descartaron.
import { vivo, TIPOS_RECIBO } from './modelo.js';
import { periodoDe, sumarMeses, sumarDias, fechaEnMes, ultimoDia, fechaCorta, nombrePeriodo, dinero } from './util.js';
import { resumenMes } from './reportes.js';
import { pagosSinRegistrar, estadoRecibo, netoEsperadoDe } from './nomina.js';
import { resumenTarjeta, proximoCobro, fechaSaldoDe } from './tarjetas.js';

export const CUANDO = { hoy: 'Hoy', semana: 'Esta semana', revisar: 'Para revisar' };

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// `sync`: estado de la sincronización (para avisar si falla). Cada aviso: { id, cuando, tipo,
// titulo, texto, personaId, acciones: [{ tipo, texto, ... }] }. El id cambia con cada
// ocurrencia, así un aviso descartado no esconde el del mes siguiente.
export function calcularAvisos(ix, { hoy, sync = null } = {}) {
  const out = [];
  const L = (n) => dinero(n, { simbolo: ix.config.moneda || 'L' });
  const USD = (n) => dinero(n, { simbolo: ix.config.simboloExt || 'US$' });
  const actual = periodoDe(hoy);
  const anterior = sumarMeses(actual, -1);
  const inicio = ix.config.inicio || actual;
  const agregar = (aviso) => out.push({ personaId: null, acciones: [], ...aviso });

  if (sync?.ubicacion && (sync.estado === 'error' || sync.estado === 'sesion')) {
    agregar({
      id: `sync:${sync.estado}:${hoy}`, cuando: 'hoy', tipo: 'sync',
      titulo: sync.estado === 'sesion' ? 'La sesión de Microsoft venció' : 'No se pudo sincronizar con OneDrive',
      texto: sync.estado === 'sesion' ? 'Los cambios siguen guardados en este dispositivo hasta que vuelvas a conectar.' : sync.mensaje || 'Los cambios siguen guardados en este dispositivo.',
      acciones: [{ tipo: 'ruta', ruta: '#/datos', texto: 'Ver' }],
    });
  }

  // Pagos de salario que ya pasaron y no se registraron (con dos días de gracia).
  for (const { ingreso, pago } of pagosSinRegistrar(ix, { hoy, desde: inicio })) {
    const que = pago.tipo === 'ordinario' ? `el pago del ${fechaCorta(pago.ocurrencia)}` : TIPOS_RECIBO[pago.tipo].toLowerCase();
    agregar({
      id: `pago:${ingreso.id}|${pago.tipo}|${pago.ocurrencia}`, cuando: 'hoy', tipo: 'pago', personaId: ingreso.personaId || null,
      titulo: `Registrar ${que} de ${ingreso.nombre}`,
      texto: `Se esperaban ${L(netoEsperadoDe(ingreso, pago.tipo))} el ${fechaCorta(pago.fecha)}.`,
      acciones: [{ tipo: 'registrarRecibo', ingresoId: ingreso.id, pago, texto: 'Registrar' }],
    });
  }

  // Recibos con deducciones sin monto, de los últimos tres meses.
  for (const p of [sumarMeses(actual, -2), anterior, actual]) {
    for (const r of ix.recibosPorPeriodo.get(p) || []) {
      const e = estadoRecibo(r);
      if (!e.pendientes) continue;
      const ingreso = ix.ingresos.get(r.ingresoId);
      const nombres = (r.deducciones || []).filter((d) => !d.noAplica && (d.monto === null || d.monto === undefined || d.monto === '')).map((d) => d.nombre);
      agregar({
        id: `deducciones:${r.id}`, cuando: 'revisar', tipo: 'deducciones', personaId: r.personaId || ingreso?.personaId || null,
        titulo: `${e.pendientes === 1 ? 'Falta' : 'Faltan'} ${plural(e.pendientes, 'deducción', 'deducciones')} de ${ingreso?.nombre || 'un salario'}`,
        texto: `Pago del ${fechaCorta(r.ocurrencia || r.fecha)}: ${nombres.join(', ')}.`,
        acciones: [{ tipo: 'completarDeducciones', reciboId: r.id, texto: 'Completar' }],
      });
    }
  }

  // Partidas y cuotas con día: vencidas este mes o que vencen en los próximos 3 días.
  const r = resumenMes(ix, actual);
  if (actual >= inicio) {
    for (const it of r.plan) {
      if (!it.dia || it.hecho || !(it.esperado > 0) || it.forma === 'abonos') continue;
      const vence = fechaEnMes(actual, it.dia);
      const base = { personaId: it.responsableId, acciones: [{ tipo: 'item', periodo: actual, clave: it.clave, texto: 'Registrar' }] };
      const falta = it.estado === 'parcial' ? `Quedan ${L(it.queda)}.` : `${L(it.esperado)} sin registrar.`;
      if (vence < hoy) agregar({ ...base, id: `vencida:${it.clave}:${actual}`, cuando: 'hoy', tipo: 'vencida', titulo: `${it.nombre} vencía el ${fechaCorta(vence)}`, texto: falta });
      else if (vence <= sumarDias(hoy, 3)) agregar({ ...base, id: `vence:${it.clave}:${actual}`, cuando: 'semana', tipo: 'vence', titulo: `${it.nombre} vence el ${fechaCorta(vence)}`, texto: falta });
    }
  }

  // Partidas en abonos todavía abiertas: las del mes anterior y, en los últimos 3 días, las de este mes.
  const abiertas = (periodo, cuando) => {
    for (const it of resumenMes(ix, periodo).partidas) {
      if (it.forma !== 'abonos' || it.estado !== 'parcial') continue;
      const siguiente = sumarMeses(periodo, 1);
      agregar({
        id: `abonos:${it.clave}:${periodo}`, cuando, tipo: 'abonos', personaId: it.responsableId,
        titulo: `${it.nombre} quedó abierta en ${nombrePeriodo(periodo)}`,
        texto: `Se pagaron ${L(it.real)} de ${L(it.esperado)}; quedan ${L(it.queda)}.`,
        acciones: [
          { tipo: 'cerrarPartida', periodo, clave: it.clave, texto: 'Cerrar' },
          { tipo: 'pasarAlSiguiente', periodo, clave: it.clave, texto: `Pasar ${L(it.queda)} a ${nombrePeriodo(siguiente).split(' ')[0]}` },
        ],
      });
    }
  };
  if (anterior >= inicio) abiertas(anterior, 'revisar');
  if (Number(hoy.slice(8, 10)) >= ultimoDia(actual) - 2) abiertas(actual, 'semana');

  // Cuotas incompletas del mes anterior (por ejemplo, solo se descontó una quincena).
  if (anterior >= inicio) {
    for (const it of resumenMes(ix, anterior).cuotas) {
      if (it.estado !== 'parcial') continue;
      agregar({
        id: `cuota:${it.clave}:${anterior}`, cuando: 'revisar', tipo: 'cuota', personaId: it.responsableId,
        titulo: `${it.nombre}: cuota incompleta en ${nombrePeriodo(anterior)}`,
        texto: it.planilla ? `Se descontaron ${L(it.real)} de ${L(it.esperado)} por planilla.` : `Se pagaron ${L(it.real)} de ${L(it.esperado)}.`,
        acciones: [{ tipo: 'item', periodo: anterior, clave: it.clave, texto: 'Ver' }],
      });
    }
  }

  // Pagos anuales de este mes y del siguiente.
  for (const it of r.partidas) {
    if (it.parte !== 'pagar' || it.hecho) continue;
    agregar({
      id: `anual:${it.partida.id}:${actual}`, cuando: 'semana', tipo: 'anual', personaId: it.responsableId,
      titulo: `Este mes se paga ${it.partida.nombre}`, texto: `${L(it.esperado)}, de lo apartado en ${ix.cuentas.get(it.medioId)?.nombre || 'Reservas'}.`,
      acciones: [{ tipo: 'item', periodo: actual, clave: it.clave, texto: 'Registrar' }],
    });
  }
  const siguiente = sumarMeses(actual, 1);
  for (const it of resumenMes(ix, siguiente).partidas) {
    if (it.parte !== 'pagar') continue;
    agregar({
      id: `anual:${it.partida.id}:${siguiente}`, cuando: 'revisar', tipo: 'anual', personaId: it.responsableId,
      titulo: `${it.partida.nombre} se paga en ${nombrePeriodo(siguiente)}`, texto: `${L(it.esperado)}.`,
      acciones: [{ tipo: 'ruta', ruta: '#/cuentas', texto: 'Ver cuentas' }],
    });
  }

  // Tarjetas: el pago del último corte (vencido, que vence en 3 días o parcial) y los cargos
  // anuales que se cobran el mes siguiente.
  for (const { cuenta } of ix.tarjetas.values()) {
    const e = resumenTarjeta(ix, cuenta).ultimo;
    const base = { tipo: 'tarjeta', personaId: cuenta.titularId || null, acciones: [{ tipo: 'pagarTarjeta', tarjetaId: cuenta.id, texto: 'Pagar' }] };
    if (e.corte >= fechaSaldoDe(cuenta) && (e.pendiente.L > 0 || e.pendiente.USD > 0)) {
      const falta = [e.pendiente.L ? L(e.pendiente.L) : '', e.pendiente.USD ? USD(e.pendiente.USD) : ''].filter(Boolean).join(' y ');
      if (e.situacion === 'vencido') {
        agregar({ ...base, id: `tarjeta-vencida:${cuenta.id}:${e.corte}`, cuando: 'hoy', titulo: `El pago de ${cuenta.nombre} venció el ${fechaCorta(e.limite)}`, texto: `Faltan ${falta}.` });
      } else if (e.limite <= sumarDias(hoy, 3)) {
        agregar({ ...base, id: `tarjeta-vence:${cuenta.id}:${e.corte}`, cuando: 'semana', titulo: `El pago de ${cuenta.nombre} vence el ${fechaCorta(e.limite)}`, texto: e.situacion === 'parcial' ? `Quedan ${falta}.` : `Pago de contado: ${falta}.` });
      } else if (e.situacion === 'parcial') {
        agregar({ ...base, id: `tarjeta-parcial:${cuenta.id}:${e.corte}`, cuando: 'revisar', titulo: `${cuenta.nombre}: pago parcial del corte del ${fechaCorta(e.corte)}`, texto: `Quedan ${falta}; vence el ${fechaCorta(e.limite)}.` });
      }
    }
    for (const cargo of cuenta.tarjeta?.cargos || []) {
      const cobro = proximoCobro(cuenta, cargo, siguiente);
      if (!cobro || periodoDe(cobro) !== siguiente) continue;
      agregar({
        id: `cargo:${cuenta.id}:${cargo.id}:${cobro}`, cuando: 'revisar', tipo: 'tarjeta', personaId: cuenta.titularId || null,
        titulo: `${cargo.nombre} de ${cuenta.nombre} se cobra en ${nombrePeriodo(siguiente)}`,
        texto: `${cargo.moneda === 'USD' ? USD(cargo.monto) : L(cargo.monto)} en el corte del ${fechaCorta(cobro)}.`,
        acciones: [{ tipo: 'ruta', ruta: `#/tarjeta/${cuenta.id}`, texto: 'Ver tarjeta' }],
      });
    }
  }

  // Configuración incompleta.
  const sinMonto = [
    ...(ix.doc.partidas || []).filter((p) => vivo(p) && p.activo !== false && !Number(p.tipo === 'anual' ? p.montoAnual : p.monto)).map((p) => p.nombre),
    ...(ix.doc.ingresos || []).filter((i) => vivo(i) && i.activo !== false && !Number(i.netoEsperado)).map((i) => i.nombre),
  ];
  if (sinMonto.length) {
    agregar({
      id: `sin-monto:${[...sinMonto].sort().join('|')}`, cuando: 'revisar', tipo: 'configuracion',
      titulo: `Faltan montos en ${plural(sinMonto.length, 'partida o salario', 'partidas o salarios')}`, texto: `${sinMonto.join(', ')}.`,
      acciones: [{ tipo: 'ruta', ruta: '#/presupuesto', texto: 'Definir' }],
    });
  }

  return out;
}

// Avisos que se muestran: sin los descartados ni los pospuestos hasta después de hoy.
// `ocultos`: { [id]: 'siempre' | 'AAAA-MM-DD' (visible de nuevo desde ese día) }.
export function avisosVisibles(avisos, ocultos = {}, hoy) {
  return avisos.filter((a) => {
    const o = ocultos[a.id];
    return !o || (o !== 'siempre' && o <= hoy);
  });
}
