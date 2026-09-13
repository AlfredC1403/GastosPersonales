// Calendario de Outlook con Microsoft Graph: el calendario "Gastos del hogar" (o el principal),
// los eventos de recordatorio de la app y un evento de prueba. Las solicitudes van de una en una
// y, si Microsoft pide esperar (429 o 503), se espera lo que indique Retry-After.
import { pedirGraph } from './onedrive.js';
import { PROPIEDAD_RECORDATORIO, NOMBRE_CALENDARIO, ZONA_HORARIA, VERSION_CLAVE } from './core/recordatorios.js';

const MAX_ESPERA = 30; // segundos
// Hora de Honduras (Central America Standard Time no cambia de horario): así el rango del calendario
// empieza a la medianoche de aquí y no incluye el evento de todo el día de ayer.
const DESFASE = '-06:00';
const esperar = (segundos) => new Promise((r) => setTimeout(r, segundos * 1000));
const errorCon = (mensaje, extra = {}) => Object.assign(new Error(mensaje), extra);

async function llamar(ruta, opciones = {}, intentos = 3) {
  const res = await pedirGraph(ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Prefer: `outlook.timezone="${ZONA_HORARIA}"`, ...(opciones.headers || {}) },
  });
  if ((res.status === 429 || res.status === 503 || res.status === 504) && intentos > 1) {
    await esperar(Math.min(MAX_ESPERA, Number(res.headers.get('Retry-After')) || 5));
    return llamar(ruta, opciones, intentos - 1);
  }
  return res;
}

async function respuesta(res, que) {
  if (res.ok) return res.status === 204 ? null : res.json();
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    throw errorCon('Microsoft no dio permiso para usar tu calendario. Vuelve a activar los recordatorios.', { codigo: 'sin_permiso', status: res.status });
  }
  const detalle = j.error?.message ? ` (${j.error.message})` : '';
  throw errorCon(`Outlook respondió ${res.status} al ${que}${detalle}.`, { status: res.status });
}

// Ruta del calendario: el propio de la app (por id) o el principal de la cuenta.
const base = (calendarioId) => (calendarioId ? `/me/calendars/${encodeURIComponent(calendarioId)}` : '/me/calendar');

// Id del calendario "Gastos del hogar": el guardado si todavía existe, el que tenga ese nombre o
// uno nuevo. Con `principal`, null (se usa el calendario principal).
export async function prepararCalendario({ calendario = 'propio', calendarioId = null } = {}) {
  if (calendario === 'principal') return null;
  if (calendarioId) {
    const res = await llamar(`/me/calendars/${encodeURIComponent(calendarioId)}?$select=id`);
    if (res.ok) return calendarioId;
    if (res.status !== 404) await respuesta(res, 'buscar el calendario');
  }
  const lista = await respuesta(await llamar('/me/calendars?$select=id,name&$top=100'), 'listar los calendarios');
  const existente = (lista.value || []).find((c) => c.name === NOMBRE_CALENDARIO);
  if (existente) return existente.id;
  const nuevo = await respuesta(await llamar('/me/calendars', { method: 'POST', body: JSON.stringify({ name: NOMBRE_CALENDARIO }) }), 'crear el calendario');
  return nuevo.id;
}

// Eventos de la app entre `desde` y `hasta` (fechas): [{ id, valor, asunto, inicio }]. Los que no
// tienen la propiedad de la app no se devuelven.
export async function listarRecordatorios(calendarioId, desde, hasta) {
  const filtro = encodeURIComponent(`id eq '${PROPIEDAD_RECORDATORIO}'`);
  let ruta = `${base(calendarioId)}/calendarView?startDateTime=${desde}T00:00:00${DESFASE}&endDateTime=${hasta}T23:59:59${DESFASE}`
    + `&$select=id,subject,start&$top=100&$expand=singleValueExtendedProperties($filter=${filtro})`;
  const out = [];
  while (ruta) {
    const pagina = await respuesta(await llamar(ruta), 'leer el calendario');
    for (const e of pagina.value || []) {
      // El $expand ya filtra por la propiedad de la app: si viene, es la nuestra.
      const valor = (e.singleValueExtendedProperties || [])[0]?.value;
      if (valor) out.push({ id: e.id, valor, asunto: e.subject, inicio: e.start?.dateTime || '' });
    }
    ruta = pagina['@odata.nextLink'] || null;
  }
  return out;
}

export const crearEvento = async (calendarioId, evento) =>
  respuesta(await llamar(`${base(calendarioId)}/events`, { method: 'POST', body: JSON.stringify(evento) }), 'crear un recordatorio');

export const actualizarEvento = async (id, evento) =>
  respuesta(await llamar(`/me/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(evento) }), 'cambiar un recordatorio');

// Borrar un evento que ya no existe no es un error.
export async function borrarEvento(id) {
  const res = await llamar(`/me/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.status === 404) return;
  await respuesta(res, 'borrar un recordatorio');
}

// Evento de prueba para comprobar que la alarma suena: de `minutos + 5` a `minutos + 20` minutos
// desde ahora, con la alarma 5 minutos antes (suena en `minutos` minutos).
export async function crearPrueba(calendarioId, { minutos = 10, enlace = '' } = {}) {
  const inicio = new Date(Date.now() + (minutos + 5) * 60000);
  const fin = new Date(inicio.getTime() + 15 * 60000);
  const utc = (d) => d.toISOString().slice(0, 19);
  const evento = await crearEvento(calendarioId, {
    subject: 'Prueba de recordatorio (se puede borrar)',
    body: { contentType: 'text', content: `Si suena esta alarma, los recordatorios de Gastos del hogar funcionan en este calendario.${enlace ? ` ${enlace}` : ''}` },
    start: { dateTime: utc(inicio), timeZone: 'UTC' }, end: { dateTime: utc(fin), timeZone: 'UTC' },
    showAs: 'free', sensitivity: 'private', isReminderOn: true, reminderMinutesBeforeStart: 5,
    singleValueExtendedProperties: [{ id: PROPIEDAD_RECORDATORIO, value: `${VERSION_CLAVE}|prueba|${Date.now()}|${utc(inicio).slice(0, 10)}#prueba` }],
  });
  return { id: evento.id, alarma: new Date(inicio.getTime() - 5 * 60000) };
}
