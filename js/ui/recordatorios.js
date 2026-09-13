// Recordatorios en Outlook: activarlos en este dispositivo, elegir qué y cuándo avisa, probar la
// alarma y ver lo que se va a recordar en los próximos 60 días.
import { store, aviso, nombrePersona, confirmar } from '../store.js';
import * as od from '../onedrive.js';
import { AVISOS_RECORDATORIO, ALCANCES_RECORDATORIO, CALENDARIOS_RECORDATORIO, DIAS_RECORDATORIOS } from '../core/recordatorios.js';
import { fechaCorta, diaDeSemana, DIAS_CORTOS } from '../core/util.js';
import {
  configDe, personaDelDispositivo, recordatoriosDe, trabajaEnEsteDispositivo, activarRecordatorios, actualizarRecordatorios, cambiarRecordatorios,
  apagarRecordatorios, probarAlarma, borrarPrueba,
} from '../recordatorios.js';

const { computed } = Vue;

const hora = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });
const fechaHora = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const VistaRecordatorios = {
  template: `
  <section class="pila">
    <p class="nota">La app pone en tu calendario de Outlook lo que vence en los próximos {{ dias }} días: partidas con día, cuotas de préstamos, pagos anuales y pagos de tarjeta. Cada evento trae alarma y se borra solo cuando se registra el pago. Los eventos no llevan montos, solo el nombre.</p>

    <div v-if="!persona" class="aviso-banner"><p>Elige primero quién usa este dispositivo.</p><a class="btn" href="#/personas">Personas</a></div>
    <div v-else-if="!store.usuario" class="aviso-banner"><p>Conecta tu cuenta de Microsoft para usar los recordatorios.</p><a class="btn primario" href="#/datos">Datos y OneDrive</a></div>

    <article v-else class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Tu calendario</h2>
        <span class="chip" :class="estado.clase">{{ estado.texto }}</span>
      </div>
      <p class="nota chica">{{ store.usuario.email || store.usuario.nombre }} · recordatorios de {{ persona.nombre }}</p>
      <p v-if="c.activo && !permiso" class="nota" style="margin-top: 8px">Están activos para {{ persona.nombre }}, pero este dispositivo no tiene permiso del calendario. Otro dispositivo tuyo con permiso los mantiene al día; para hacerlo también desde aquí, toca Activar.</p>

      <div class="campo" style="margin-top: 14px">
        <span>Qué recordar</span>
        <div class="segmentos envuelve" role="group" aria-label="Qué recordar">
          <button v-for="(n, k) in alcances" :key="k" type="button" :class="{ activo: c.alcance === k }" :aria-pressed="c.alcance === k" :disabled="st.trabajando" @click="cambiar({ alcance: k })">{{ n }}</button>
        </div>
      </div>
      <div class="campo" style="margin-top: 12px">
        <span>Cuándo avisa</span>
        <div class="segmentos envuelve" role="group" aria-label="Cuándo avisa">
          <button v-for="(n, k) in avisos" :key="k" type="button" :class="{ activo: c.aviso === k }" :aria-pressed="c.aviso === k" :disabled="st.trabajando" @click="cambiar({ aviso: k })">{{ n }}</button>
        </div>
      </div>
      <div class="campo" style="margin-top: 12px">
        <span>En qué calendario</span>
        <div class="segmentos envuelve" role="group" aria-label="En qué calendario">
          <button v-for="(n, k) in calendarios" :key="k" type="button" :class="{ activo: c.calendario === k }" :aria-pressed="c.calendario === k" :disabled="st.trabajando" @click="cambiar({ calendario: k })">{{ n }}</button>
        </div>
      </div>

      <p v-if="st.trabajando" class="nota" style="margin-top: 12px">Actualizando el calendario…</p>
      <p v-else-if="st.error" class="error" style="margin-top: 12px" role="alert">{{ st.error }}</p>
      <p v-else-if="c.activo && st.ultima" class="nota chica" style="margin-top: 12px">{{ textoUltima }}</p>

      <div class="botones">
        <button v-if="!c.activo || !permiso" type="button" class="btn primario" @click="activar">Activar recordatorios</button>
        <template v-else>
          <button type="button" class="btn" :disabled="st.trabajando" @click="actualizar">Actualizar ahora</button>
          <button type="button" class="btn" :disabled="st.trabajando" @click="probar">Probar la alarma</button>
          <button type="button" class="btn peligro" :disabled="st.trabajando" @click="apagar">Apagar y borrar</button>
        </template>
      </div>
      <p v-if="!c.activo || !permiso" class="nota chica" style="margin-top: 8px">Microsoft te pedirá permiso para ver y editar tu calendario. La app solo crea, cambia y borra sus propios eventos.</p>
      <div v-if="st.prueba" class="caja-corte" style="margin-top: 12px">
        <span>Evento de prueba creado: la alarma debe sonar a las {{ horaPrueba }}.</span>
        <button type="button" class="btn-link" style="align-self: flex-start" @click="quitarPrueba">Borrar la prueba</button>
      </div>
    </article>

    <article v-if="persona" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Próximos recordatorios</h2>
        <span class="tenue" style="font-size: 0.85rem">{{ lista.length }}</span>
      </div>
      <p class="nota chica" style="margin-top: 4px">Con las opciones de arriba{{ c.alcance === 'mio' ? ': lo de ' + persona.nombre + ' y lo del hogar' : '' }}.</p>
      <ul v-if="lista.length" class="lista" style="margin-top: 8px">
        <li v-for="r in lista" :key="r.clave" class="fila compacta">
          <div class="agenda-fecha" style="padding-top: 0; width: 42px"><div class="num" style="font-size: 1.1rem">{{ Number(r.fecha.slice(8)) }}</div><div class="dia">{{ diaCorto(r.fecha) }}</div></div>
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.92rem">{{ r.asunto }}</span><span class="fila-sub">{{ fechaCorta(r.fecha) }}</span></div>
        </li>
      </ul>
      <p v-else class="vacio" style="padding: 8px 0">Nada que recordar en los próximos {{ dias }} días.</p>
    </article>

    <p class="nota chica">Si la alarma no suena en el celular: en la app de Outlook abre la lista de calendarios y marca "Gastos del hogar", y revisa que Outlook tenga permiso para notificaciones. Si aun así no suena, elige tu calendario principal.</p>
  </section>`,
  setup() {
    const st = computed(() => store.recordatorios);
    const persona = computed(personaDelDispositivo);
    const c = computed(() => configDe(persona.value));
    const permiso = computed(() => {
      void store.usuario;
      void store.rev;
      return od.tienePermisoCalendario();
    });
    const lista = computed(() => (persona.value ? recordatoriosDe(persona.value) : []));
    const estado = computed(() => {
      if (!c.value.activo) return { texto: 'Apagados', clase: '' };
      if (!permiso.value) return { texto: 'Sin permiso aquí', clase: 'aviso' };
      if (st.value.error) return { texto: 'Con error', clase: 'mal' };
      return { texto: 'Activos', clase: 'ok' };
    });
    const textoUltima = computed(() => {
      const r = st.value.resultado;
      const cuando = st.value.ultima ? fechaHora.format(new Date(st.value.ultima)) : '';
      if (!r) return `Última revisión: ${cuando}.`;
      const cambios = [r.creados ? `${r.creados} ${r.creados === 1 ? 'nuevo' : 'nuevos'}` : '', r.actualizados ? `${r.actualizados} ${r.actualizados === 1 ? 'cambiado' : 'cambiados'}` : '', r.borrados ? `${r.borrados} ${r.borrados === 1 ? 'borrado' : 'borrados'}` : ''].filter(Boolean);
      return `Última revisión: ${cuando} · ${r.total} ${r.total === 1 ? 'recordatorio' : 'recordatorios'}${cambios.length ? ` (${cambios.join(', ')})` : ''}.`;
    });
    const horaPrueba = computed(() => (st.value.prueba ? hora.format(new Date(st.value.prueba.alarma)) : ''));
    const diaCorto = (fecha) => DIAS_CORTOS[diaDeSemana(fecha)];

    const intentar = async (fn, exito) => {
      try {
        const r = await fn();
        if (exito) aviso(typeof exito === 'function' ? exito(r) : exito, 'ok', 5000);
      } catch (e) {
        aviso(e.message, 'error', 8000);
      }
    };
    return {
      store, st, persona, c, permiso, lista, estado, textoUltima, horaPrueba, diaCorto, fechaCorta, nombrePersona, dias: DIAS_RECORDATORIOS,
      alcances: ALCANCES_RECORDATORIO, avisos: AVISOS_RECORDATORIO, calendarios: CALENDARIOS_RECORDATORIO, trabajaEnEsteDispositivo,
      activar: () => intentar(activarRecordatorios),
      actualizar: () => intentar(() => actualizarRecordatorios({ forzar: true }), () => (store.recordatorios.error ? '' : 'Calendario al día.')),
      cambiar: (cambios) => intentar(() => cambiarRecordatorios(cambios)),
      probar: () => intentar(() => probarAlarma(10), (p) => `Listo: la alarma debe sonar a las ${hora.format(p.alarma)}.`),
      quitarPrueba: () => intentar(borrarPrueba, 'Evento de prueba borrado.'),
      apagar: async () => {
        if (!await confirmar('Se apagan los recordatorios y se borran sus eventos del calendario de Outlook.',
          { titulo: '¿Apagar los recordatorios?', aceptar: 'Apagar', peligro: true })) return;
        intentar(apagarRecordatorios, (n) => `Recordatorios apagados${n ? `: se borraron ${n} ${n === 1 ? 'evento' : 'eventos'}` : ''}.`);
      },
    };
  },
};
