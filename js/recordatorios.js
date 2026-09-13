// Recordatorios en Outlook de quien usa este dispositivo: activarlos (pidiendo el permiso del
// calendario), mantener los eventos al día y apagarlos. Una pasada revisa el calendario como mucho
// una vez al día, o antes si cambió algo que se recuerda (una fecha, un pago, las opciones).
// El estado de las pasadas vive en este dispositivo (store.recordatorios); las opciones, en la persona.
import { store, indice, buscar, guardar, aviso, guardarEstadoRecordatorios } from './store.js';
import * as od from './onedrive.js';
import * as cal from './calendario.js';
import { recordatoriosDeseados, planRecordatorios, huellaDeRecordatorios, RECORDATORIOS_INICIAL, DIAS_RECORDATORIOS } from './core/recordatorios.js';
import { sumarDias } from './core/util.js';

const { watch } = Vue;

const INTENCION = 'gastos.activarRecordatorios';
const ESPERA = 20000;

export const enlaceApp = () => location.origin + location.pathname.replace(/index\.html$/, '');
export const configDe = (persona) => ({ ...RECORDATORIOS_INICIAL, ...(persona?.recordatorios || {}) });
export const personaDelDispositivo = () => {
  const p = buscar('personas', store.yo);
  return p && !p.borrado ? p : null;
};

export function recordatoriosDe(persona, hoy = store.hoy) {
  const c = configDe(persona);
  return recordatoriosDeseados(indice(), { hoy, personaId: persona?.id || null, alcance: c.alcance, aviso: c.aviso, enlace: enlaceApp() });
}

// Este dispositivo mantiene los recordatorios si está conectado a Microsoft con el permiso del
// calendario y la persona los tiene activos.
export const trabajaEnEsteDispositivo = () => !!(store.usuario && od.tienePermisoCalendario() && configDe(personaDelDispositivo()).activo);

function guardarConfigDe(persona, cambios) {
  const actual = buscar('personas', persona.id) || persona;
  return guardar('personas', { ...actual, recordatorios: { ...configDe(actual), ...cambios } });
}

async function calendarioDe(persona) {
  const c = configDe(persona);
  const id = await cal.prepararCalendario(c);
  if (c.calendario === 'propio' && id !== c.calendarioId) guardarConfigDe(persona, { calendarioId: id });
  return id;
}

function avisarPermiso() {
  const permiso = od.avisoPermisoCalendario();
  if (permiso === 'negado') aviso('Microsoft no dio permiso para usar tu calendario: los recordatorios siguen apagados.', 'error', 9000);
  if (permiso === 'perdido') aviso('Se quitó el permiso del calendario: los recordatorios de Outlook dejaron de actualizarse en este dispositivo.', 'error', 9000);
}

// Una pasada: calcula lo que debería haber, lee el calendario y crea, cambia o borra eventos.
export async function actualizarRecordatorios({ forzar = false } = {}) {
  const persona = personaDelDispositivo();
  const st = store.recordatorios;
  if (!persona || !trabajaEnEsteDispositivo() || st.trabajando || !navigator.onLine) return;
  const c = configDe(persona);
  const hoy = store.hoy;
  const deseados = recordatoriosDe(persona, hoy);
  if (!forzar && !st.error && st.dia === hoy && st.huella === huellaDeRecordatorios(deseados, c)) return;
  st.trabajando = true;
  try {
    const calendarioId = await calendarioDe(persona);
    const existentes = await cal.listarRecordatorios(calendarioId, hoy, sumarDias(hoy, DIAS_RECORDATORIOS));
    const plan = planRecordatorios(deseados, existentes);
    for (const d of plan.crear) await cal.crearEvento(calendarioId, d.evento);
    for (const x of plan.actualizar) await cal.actualizarEvento(x.id, x.deseado.evento);
    for (const id of plan.borrar) await cal.borrarEvento(id);
    Object.assign(st, {
      ultima: new Date().toISOString(), dia: hoy, error: '', huella: huellaDeRecordatorios(deseados, configDe(personaDelDispositivo())),
      resultado: { total: deseados.length, creados: plan.crear.length, actualizados: plan.actualizar.length, borrados: plan.borrar.length },
    });
  } catch (e) {
    st.error = e.necesitaSesion ? 'La sesión de Microsoft venció: los recordatorios se actualizan al volver a conectar.' : e.message;
    avisarPermiso();
  } finally {
    st.trabajando = false;
    guardarEstadoRecordatorios();
  }
}

// Programa una pasada. Si ya hay una para antes, se respeta (un cambio en los datos no atrasa la
// pasada que pidió un cambio de opciones).
let temporizador = null;
let proxima = 0;
function programar(ms = ESPERA) {
  const cuando = Date.now() + ms;
  if (temporizador && proxima <= cuando) return;
  clearTimeout(temporizador);
  proxima = cuando;
  temporizador = setTimeout(() => {
    temporizador = null;
    actualizarRecordatorios();
  }, ms);
}

// Después de cargar los datos: termina de activar si se volvió de pedir el permiso y vigila los cambios.
export function iniciarRecordatorios() {
  avisarPermiso();
  if (sessionStorage.getItem(INTENCION) === '1') {
    sessionStorage.removeItem(INTENCION);
    const persona = personaDelDispositivo();
    if (persona && od.tienePermisoCalendario()) {
      guardarConfigDe(persona, { activo: true });
      aviso('Recordatorios activados: en un momento aparecen en tu calendario de Outlook.', 'ok', 6000);
      setTimeout(() => actualizarRecordatorios({ forzar: true }), 1500);
    }
  }
  watch(() => [store.rev, store.hoy, store.yo, store.usuario?.email], () => programar());
  programar(5000);
}

// Activa los recordatorios de quien usa este dispositivo. Si falta el permiso del calendario, la
// página va a Microsoft y, al volver, iniciarRecordatorios termina de activarlos.
export async function activarRecordatorios() {
  const persona = personaDelDispositivo();
  if (!persona) throw new Error('Elige primero quién usa este dispositivo.');
  if (!store.usuario) throw new Error('Conecta tu cuenta de Microsoft en Datos y OneDrive.');
  if (od.tienePermisoCalendario()) {
    guardarConfigDe(persona, { activo: true });
    return actualizarRecordatorios({ forzar: true });
  }
  sessionStorage.setItem(INTENCION, '1');
  return od.pedirPermisoCalendario();
}

// Borra los eventos de la app en el calendario de `config` (no toca los de prueba).
async function borrarEventos(config) {
  if (config.calendario === 'propio' && !config.calendarioId) return 0;
  const calendarioId = config.calendario === 'principal' ? null : config.calendarioId;
  const hoy = store.hoy;
  const existentes = await cal.listarRecordatorios(calendarioId, sumarDias(hoy, -1), sumarDias(hoy, DIAS_RECORDATORIOS + 31));
  const nuestros = existentes.filter((e) => !e.valor.includes('|prueba|'));
  for (const e of nuestros) await cal.borrarEvento(e.id);
  return nuestros.length;
}

// Cambia las opciones. Si se cambia de calendario, los eventos del anterior se borran.
export async function cambiarRecordatorios(cambios) {
  const persona = personaDelDispositivo();
  if (!persona) return;
  const antes = configDe(persona);
  if (cambios.calendario && cambios.calendario !== antes.calendario && antes.activo && trabajaEnEsteDispositivo()) {
    store.recordatorios.trabajando = true;
    try {
      await borrarEventos(antes);
    } finally {
      store.recordatorios.trabajando = false;
    }
  }
  guardarConfigDe(persona, cambios);
  programar(1000);
}

export async function apagarRecordatorios() {
  const persona = personaDelDispositivo();
  if (!persona) return 0;
  let borrados = 0;
  if (trabajaEnEsteDispositivo()) {
    store.recordatorios.trabajando = true;
    try {
      borrados = await borrarEventos(configDe(persona));
    } finally {
      store.recordatorios.trabajando = false;
    }
  }
  guardarConfigDe(persona, { activo: false });
  Object.assign(store.recordatorios, { dia: '', huella: '', error: '', resultado: null });
  guardarEstadoRecordatorios();
  return borrados;
}

// Evento de prueba en el calendario elegido, con la alarma en `minutos` minutos.
export async function probarAlarma(minutos = 10) {
  const persona = personaDelDispositivo();
  if (!persona || !store.usuario || !od.tienePermisoCalendario()) throw new Error('Activa primero los recordatorios en este dispositivo.');
  const calendarioId = await calendarioDe(persona);
  const prueba = await cal.crearPrueba(calendarioId, { minutos, enlace: enlaceApp() });
  store.recordatorios.prueba = { id: prueba.id, alarma: prueba.alarma.toISOString() };
  return prueba;
}

export async function borrarPrueba() {
  const prueba = store.recordatorios.prueba;
  if (prueba) await cal.borrarEvento(prueba.id);
  store.recordatorios.prueba = null;
}
