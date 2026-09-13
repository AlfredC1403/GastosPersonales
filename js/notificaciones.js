// Avisos en este teléfono, sin pasar por Outlook.
//
// Una app estática no tiene servidor, así que no puede mandar push de verdad: no hay nadie que
// despierte al teléfono. Lo que sí se puede es dejar la agenda calculada en IndexedDB y pedirle al
// navegador que, cuando tenga ocasión, la revise y notifique (Periodic Background Sync, que hoy
// solo existe en Chrome/Android con la app instalada). Donde no lo haya, la agenda se revisa al
// abrir la app. Los recordatorios de Outlook siguen siendo el canal fiable y no se tocan.
import { store, indice } from './store.js';
import { prefs, definirNotificaciones } from './tema.js';
import { recordatoriosDeseados, rutaDeRecordatorio, DIAS_RECORDATORIOS } from './core/recordatorios.js';
import { fechaCorta } from './core/util.js';
import { configDe, personaDelDispositivo } from './recordatorios.js';
import * as almacen from './almacen.js';

export const ETIQUETA = 'gastos-avisos';
const TAREA = 'gastos-agenda';
const DIAS_AGENDA = 10; // con avisar de los próximos días basta: la agenda se regenera al abrir

export const soportaNotificaciones = () => 'Notification' in globalThis && 'serviceWorker' in navigator;
export const permisoNotificaciones = () => (soportaNotificaciones() ? Notification.permission : 'unsupported');

// Qué puede hacer este navegador: 'periodico' (avisa solo), 'al-abrir' (solo cuando se abre la app)
// o 'no' (no hay notificaciones).
export function alcanceNotificaciones() {
  if (!soportaNotificaciones()) return 'no';
  return 'periodicSync' in (globalThis.ServiceWorkerRegistration?.prototype || {}) ? 'periodico' : 'al-abrir';
}

// Lo que vence en los próximos días, en lo mínimo que necesita sw.js: fecha, texto y a dónde ir.
// Sale de recordatoriosDeseados, el mismo cálculo de los recordatorios de Outlook.
export function agendaDe(ix, { hoy, personaId, alcance }) {
  return recordatoriosDeseados(ix, { hoy, personaId, alcance, dias: Math.min(DIAS_AGENDA, DIAS_RECORDATORIOS) })
    .map((r) => ({ fecha: r.fecha, asunto: r.asunto, ruta: rutaDeRecordatorio(r) }));
}

// De quién avisa este teléfono: lo de su persona (con las opciones de los recordatorios) o, si
// nadie eligió quién lo usa, todo el hogar. Con 'mio' y sin persona no se avisaría de nada.
function paraQuien() {
  const persona = personaDelDispositivo();
  if (!persona) return { personaId: null, alcance: 'hogar' };
  return { personaId: persona.id, alcance: configDe(persona).alcance || 'mio' };
}

// Guarda la agenda para que sw.js la encuentre. Se llama al abrir la app, al cambiar el día y
// después de cada edición (ver refrescarAgenda en js/app.js).
export async function guardarAgenda() {
  if (!prefs.notificaciones) return;
  const agenda = agendaDe(indice(), { hoy: store.hoy, ...paraQuien() });
  await almacen.guardarAgenda({ generada: store.hoy, dias: agenda }).catch(() => {});
}

async function registroSw() {
  return 'serviceWorker' in navigator ? navigator.serviceWorker.ready : null;
}

// Pide el permiso y, donde se pueda, deja el aviso periódico registrado. Devuelve el alcance real
// conseguido, para poder decirle a la persona qué va a pasar de verdad.
export async function activarNotificaciones() {
  if (!soportaNotificaciones()) throw new Error('Este navegador no puede mostrar notificaciones.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No se dio permiso para notificar en este dispositivo.');
  definirNotificaciones(true);
  await guardarAgenda();
  const registro = await registroSw();
  let alcance = 'al-abrir';
  try {
    // Requiere la app instalada; si el navegador dice que no, queda el aviso al abrir.
    if (registro?.periodicSync) {
      await registro.periodicSync.register(TAREA, { minInterval: 12 * 60 * 60 * 1000 });
      alcance = 'periodico';
    }
  } catch {
    alcance = 'al-abrir';
  }
  return alcance;
}

export async function apagarNotificaciones() {
  definirNotificaciones(false);
  const registro = await registroSw();
  try {
    await registro?.periodicSync?.unregister(TAREA);
  } catch {
    /* no estaba registrado */
  }
  for (const n of (await registro?.getNotifications?.({ tag: ETIQUETA })) || []) n.close();
  await almacen.guardarAgenda(null).catch(() => {});
}

// Aviso al abrir la app, para los navegadores sin tarea periódica: lo que vence hoy o ya venció.
// Una vez al día, para no repetir en cada apertura.
export async function avisarAlAbrir() {
  if (!prefs.notificaciones || permisoNotificaciones() !== 'granted') return;
  if (prefs.ultimoAvisoTelefono === store.hoy) return;
  const hoyYAntes = agendaDe(indice(), { hoy: store.hoy, ...paraQuien() }).filter((x) => x.fecha <= store.hoy);
  if (!hoyYAntes.length) return;
  const registro = await registroSw();
  if (!registro) return;
  definirNotificaciones(true, store.hoy);
  const [primero] = hoyYAntes;
  const uno = hoyYAntes.length === 1;
  await registro.showNotification(uno ? primero.asunto : `${hoyYAntes.length} cosas vencen hoy`, {
    body: uno ? (primero.fecha < store.hoy ? `Venció el ${fechaCorta(primero.fecha)}.` : 'Vence hoy.') : hoyYAntes.map((x) => x.asunto).join(' · '),
    tag: ETIQUETA,
    data: { ruta: uno ? primero.ruta : '#/avisos' },
    badge: 'icon.svg',
    icon: 'icon.svg',
  }).catch(() => {});
}
