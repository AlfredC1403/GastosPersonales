import { store, indice, avisos, abrirModal, aviso, buscar } from '../store.js';
import { CUANDO } from '../core/avisos.js';
import { reciboSugerido } from '../core/nomina.js';
import { sumarDias } from '../core/util.js';
import { posponerAviso, descartarAviso, mostrarAviso } from '../tema.js';
import {
  ReciboForm, itemsDelMes, marcarItem, abrirDetalle, completarDeducciones, cerrarPartidaDelMes, pasarAlSiguiente,
} from './formularios.js';
import { pagarTarjeta } from './formularios-tarjetas.js';

const { computed } = Vue;

// Ejecuta la acción de un aviso (registrar un pago, completar deducciones, cerrar una partida…).
export function ejecutarAccionAviso(accion) {
  if (accion.tipo === 'ruta') {
    location.hash = accion.ruta;
    return;
  }
  if (accion.tipo === 'registrarRecibo') {
    const ingreso = buscar('ingresos', accion.ingresoId);
    if (ingreso) abrirModal(`Registrar: ${ingreso.nombre}`, ReciboForm, { inicial: reciboSugerido(indice(), ingreso, accion.pago, { hoy: store.hoy }) });
    return;
  }
  if (accion.tipo === 'renovar') {
    // A demanda: la pantalla de renovaciones no hace falta para abrir la app.
    import('./renovaciones.js').then((m) => m.marcarRenovada(accion.renovacionId)).catch(() => aviso('No se pudo cargar esto. Revisa tu conexión.', 'error'));
    return;
  }
  if (accion.tipo === 'pagarTarjeta') {
    pagarTarjeta(accion.tarjetaId);
    return;
  }
  if (accion.tipo === 'completarDeducciones') {
    const r = buscar('recibos', accion.reciboId);
    if (r) completarDeducciones(r);
    return;
  }
  const it = itemsDelMes(accion.periodo).find((x) => x.clave === accion.clave);
  if (!it) {
    aviso('Esto ya no aplica.', 'info');
    return;
  }
  if (accion.tipo === 'cerrarPartida') cerrarPartidaDelMes(it, accion.periodo);
  else if (accion.tipo === 'pasarAlSiguiente') pasarAlSiguiente(it, accion.periodo);
  else if (it.hecho || it.planilla) abrirDetalle(it, accion.periodo);
  else marcarItem(it, accion.periodo);
}

export const VistaAvisos = {
  template: `
  <section class="pila">
    <p v-if="!lista.length" class="vacio">No hay avisos: todo está al día.</p>
    <template v-for="g in grupos" :key="g.cuando">
      <h2 class="etiqueta">{{ g.titulo }}</h2>
      <article v-for="a in g.avisos" :key="a.id" class="tarjeta aviso-tarjeta" :class="a.cuando">
        <h3>{{ a.titulo }}</h3>
        <p class="nota" style="margin-top: 4px">{{ a.texto }}</p>
        <div class="botones">
          <button v-for="(x, i) in a.acciones" :key="i" type="button" class="btn" :class="{ primario: i === 0 }" @click="ejecutarAccionAviso(x)">{{ x.texto }}</button>
          <span class="espacio"></span>
          <button type="button" class="btn-link" @click="posponer(a)">Mañana</button>
          <button type="button" class="btn-link" @click="descartar(a)">Descartar</button>
        </div>
      </article>
    </template>
    <p class="nota chica">"Mañana" y "Descartar" se guardan solo en este dispositivo.</p>
  </section>`,
  setup() {
    const lista = computed(avisos);
    const grupos = computed(() => Object.entries(CUANDO)
      .map(([cuando, titulo]) => ({ cuando, titulo, avisos: lista.value.filter((a) => a.cuando === cuando) }))
      .filter((g) => g.avisos.length));
    function posponer(a) {
      posponerAviso(a.id, sumarDias(store.hoy, 1));
      aviso('Vuelve a aparecer mañana.', 'info', 5000, { texto: 'Deshacer', fn: () => mostrarAviso(a.id) });
    }
    function descartar(a) {
      descartarAviso(a.id);
      aviso('Aviso descartado.', 'info', 5000, { texto: 'Deshacer', fn: () => mostrarAviso(a.id) });
    }
    return { lista, grupos, posponer, descartar, ejecutarAccionAviso };
  },
};
