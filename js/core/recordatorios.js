// Recordatorios en Outlook: qué eventos debería tener el calendario de una persona en los
// próximos 60 días y qué hay que crear, cambiar o borrar para llegar ahí. Los eventos no
// llevan montos: solo el nombre de lo que vence. Cada uno guarda una clave propia
// (`gh1|tipo|id|fecha#huella`) en una propiedad extendida, así nunca se duplican.
import { periodoDe, sumarMeses, sumarDias, fechaEnMes } from './util.js';
import { resumenMes } from './reportes.js';
import { pagosDeTarjetas } from './tarjetas.js';

export const VERSION_CLAVE = 'gh1';
export const DIAS_RECORDATORIOS = 60;
export const ZONA_HORARIA = 'Central America Standard Time';
// Propiedad extendida de Outlook con la clave del recordatorio (GUID fijo de la app).
export const PROPIEDAD_RECORDATORIO = 'String {6f1c8a52-3b7e-4d0a-9c5e-2a8f41d7b3e9} Name gastosHogar';
export const NOMBRE_CALENDARIO = 'Gastos del hogar';

export const AVISOS_RECORDATORIO = { dia_antes_8: 'El día anterior a las 8:00', mismo_dia_7: 'El mismo día a las 7:00' };
export const ALCANCES_RECORDATORIO = { mio: 'Lo mío y lo del hogar', hogar: 'Todo el hogar' };
export const CALENDARIOS_RECORDATORIO = { propio: 'Uno aparte: "Gastos del hogar"', principal: 'Mi calendario principal' };
export const RECORDATORIOS_INICIAL = { activo: false, alcance: 'mio', aviso: 'dia_antes_8', calendario: 'propio', calendarioId: null };

// FNV-1a de 32 bits: una huella corta para saber si un evento cambió.
export function huellaDe(texto) {
  let h = 0x811c9dc5;
  for (const ch of String(texto)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Cuerpo del evento para Microsoft Graph. Con 'dia_antes_8', un evento de todo el día con la
// alarma 16 horas antes (8:00 del día anterior); con 'mismo_dia_7', un evento de 7:00 a 7:15
// con la alarma a esa hora (un evento de todo el día no puede avisar el mismo día por la mañana).
export function eventoDeRecordatorio(r, { aviso = 'dia_antes_8', enlace = '' } = {}) {
  const cuerpo = `Recordatorio de Gastos del hogar: ${r.detalle}.${enlace ? ` Regístralo en ${enlace}` : ''}`;
  const comun = {
    subject: r.asunto, body: { contentType: 'text', content: cuerpo }, showAs: 'free', sensitivity: 'private', isReminderOn: true,
  };
  const horario = aviso === 'mismo_dia_7'
    ? { isAllDay: false, start: { dateTime: `${r.fecha}T07:00:00`, timeZone: ZONA_HORARIA }, end: { dateTime: `${r.fecha}T07:15:00`, timeZone: ZONA_HORARIA }, reminderMinutesBeforeStart: 0 }
    : { isAllDay: true, start: { dateTime: `${r.fecha}T00:00:00`, timeZone: ZONA_HORARIA }, end: { dateTime: `${sumarDias(r.fecha, 1)}T00:00:00`, timeZone: ZONA_HORARIA }, reminderMinutesBeforeStart: 960 };
  const huella = huellaDe(JSON.stringify([comun.subject, cuerpo, horario]));
  return { huella, evento: { ...comun, ...horario, singleValueExtendedProperties: [{ id: PROPIEDAD_RECORDATORIO, value: `${r.clave}#${huella}` }] } };
}

// Lo que vence entre hoy y dentro de `dias` días y sigue pendiente: partidas y cuotas con día
// (sin las que se pagan con tarjeta ni las cuotas por planilla), pagos anuales (el primer día de su
// mes) y pagos de tarjeta (en su fecha límite). `alcance`: 'mio' (lo de la persona y lo del hogar)
// u 'hogar' (todo). Cada uno: { clave, tipo, id, fecha, asunto, detalle, huella, evento }.
export function recordatoriosDeseados(ix, { hoy, personaId = null, alcance = 'mio', aviso = 'dia_antes_8', enlace = '', dias = DIAS_RECORDATORIOS } = {}) {
  const hasta = sumarDias(hoy, dias);
  const lista = [];
  const agregar = (tipo, id, fecha, asunto, detalle, responsableId) => {
    if (!fecha || fecha < hoy || fecha > hasta) return;
    if (alcance !== 'hogar' && responsableId && responsableId !== personaId) return;
    const r = { clave: `${VERSION_CLAVE}|${tipo}|${id}|${fecha}`, tipo, id, fecha, asunto, detalle };
    lista.push({ ...r, ...eventoDeRecordatorio(r, { aviso, enlace }) });
  };

  for (let p = periodoDe(hoy); p <= periodoDe(hasta); p = sumarMeses(p, 1)) {
    const r = resumenMes(ix, p);
    for (const it of [...r.cuotas, ...r.partidas]) {
      if (it.hecho || it.planilla || !(it.esperado > 0) || ix.esTarjeta(it.medioId)) continue;
      if (it.tipoItem === 'prestamo') {
        if (it.dia) agregar('prestamo', it.prestamo.id, fechaEnMes(p, it.dia), `Cuota: ${it.nombre}`, `cuota de ${it.nombre}`, it.responsableId);
      } else if (it.parte === 'pagar') {
        agregar('anual', it.partida.id, `${p}-01`, `Pagar este mes: ${it.partida.nombre}`, `este mes se paga ${it.partida.nombre}`, it.responsableId);
      } else if (it.dia) {
        const aparte = it.parte === 'apartar' || it.tipo === 'aporte';
        const nombre = it.partida.nombre;
        agregar('partida', it.clave, fechaEnMes(p, it.dia), aparte ? `Transferir: ${nombre}` : `Pagar: ${nombre}`, aparte ? `transferir ${nombre}` : `pagar ${nombre}`, it.responsableId);
      }
    }
  }
  for (const it of pagosDeTarjetas(ix, hoy, hasta)) {
    if (it.hecho || !(it.esperado > 0)) continue;
    agregar('tarjeta', `${it.tarjeta.id}:${it.corte}`, it.limite, `Pagar tarjeta: ${it.tarjeta.nombre}`, `vence el pago de la tarjeta ${it.tarjeta.nombre}`, it.responsableId);
  }
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.asunto.localeCompare(b.asunto));
}

// Huella de todos los recordatorios con las opciones: si no cambia, no hace falta volver a
// revisar el calendario ese día.
export const huellaDeRecordatorios = (lista, opciones = {}) => huellaDe(JSON.stringify([opciones.calendario, opciones.calendarioId, lista.map((r) => `${r.clave}#${r.huella}`)]));

// Qué hacer con el calendario. `existentes`: los eventos que ya están, [{ id, valor }], donde
// `valor` es la propiedad extendida (los eventos sin ella no son de la app y no se tocan).
// Los eventos de prueba ('gh1|prueba|…') tampoco se tocan.
export function planRecordatorios(deseados, existentes) {
  const porClave = new Map();
  for (const e of existentes) {
    const [clave, huella = ''] = String(e.valor || '').split('#');
    if (!clave.startsWith(`${VERSION_CLAVE}|`) || clave.split('|')[1] === 'prueba') continue;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push({ id: e.id, huella });
  }
  const crear = [];
  const actualizar = [];
  const borrar = [];
  const vistas = new Set();
  for (const d of deseados) {
    if (vistas.has(d.clave)) continue;
    vistas.add(d.clave);
    // Si hay varios con la misma clave, se conserva el que ya está al día.
    const [primero, ...repetidos] = [...(porClave.get(d.clave) || [])].sort((x, y) => Number(y.huella === d.huella) - Number(x.huella === d.huella));
    if (!primero) crear.push(d);
    else if (primero.huella !== d.huella) actualizar.push({ id: primero.id, deseado: d });
    borrar.push(...repetidos.map((x) => x.id));
  }
  for (const [clave, lista] of porClave) if (!vistas.has(clave)) borrar.push(...lista.map((x) => x.id));
  return { crear, actualizar, borrar };
}
