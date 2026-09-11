import { store, cerrarModal, cerrarAviso } from '../store.js';

const { ref, watch, watchEffect, onBeforeUnmount, nextTick } = Vue;

const TRAZOS = {
  mas: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  izq: 'M15 6l-6 6 6 6',
  der: 'M9 6l6 6-6 6',
  arriba: 'M12 19V5M6 11l6-6 6 6',
  abajo: 'M12 5v14M6 13l6 6 6-6',
  nube: 'M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z',
  nubeNo: 'M3 3l18 18M8 18h9M18.8 14.9A4 4 0 0 0 17.6 10a6 6 0 0 0-8.8-4.3M6.3 8.6A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18',
  sync: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  descargar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  subir: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  usuario: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
};

export const Icono = {
  props: { n: { type: String, required: true }, t: { type: Number, default: 18 } },
  template: `<svg :width="t" :height="t" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="trazo"/></svg>`,
  computed: {
    trazo() {
      return TRAZOS[this.n] || '';
    },
  },
};

// Envuelve un gráfico de Chart.js. `config` es una función que devuelve la configuración
// (o null si no hay datos); el gráfico se rehace cuando cambian los datos que usa.
export const ChartBox = {
  props: {
    config: { type: Function, required: true },
    alto: { type: Number, default: 220 },
    etiqueta: { type: String, default: '' },
    vacio: { type: String, default: 'Sin datos todavía.' },
  },
  template: `<div class="grafico" :style="{ height: alto + 'px' }">
    <canvas v-show="!sinDatos" ref="lienzo" role="img" :aria-label="etiqueta"></canvas>
    <div v-if="sinDatos" class="grafico-vacio">{{ vacio }}</div>
  </div>`,
  setup(props) {
    const lienzo = ref(null);
    const sinDatos = ref(false);
    let grafico = null;
    const detener = watchEffect(() => {
      const cfg = props.config();
      grafico?.destroy();
      grafico = null;
      const vacio = !cfg || !window.Chart;
      sinDatos.value = vacio;
      if (!vacio && lienzo.value) grafico = new Chart(lienzo.value, cfg);
    }, { flush: 'post' });
    onBeforeUnmount(() => {
      detener();
      grafico?.destroy();
    });
    return { lienzo, sinDatos };
  },
};

export const ModalHost = {
  components: { Icono },
  template: `<dialog ref="dlg" class="modal" aria-labelledby="titulo-modal" @cancel.prevent="cerrarModal" @close="alCerrar" @click="fuera">
    <div v-if="store.modal" class="modal-caja">
      <header class="modal-cab">
        <h2 id="titulo-modal">{{ store.modal.titulo }}</h2>
        <button type="button" class="icono-btn" aria-label="Cerrar" @click="cerrarModal"><icono n="x"/></button>
      </header>
      <component :is="store.modal.componente" :key="store.modal.id" v-bind="store.modal.props" @listo="cerrarModal"/>
    </div>
  </dialog>`,
  setup() {
    const dlg = ref(null);
    watch(() => store.modal, async (m) => {
      await nextTick();
      const d = dlg.value;
      if (!d) return;
      if (m && !d.open) {
        d.showModal();
        // Enfoca el primer campo y selecciona su valor: al escribir se reemplaza el monto sugerido.
        const campo = d.querySelector('.formulario input:not([type="checkbox"]):not([type="file"]), .formulario select');
        campo?.focus();
        campo?.select?.();
      }
      if (!m && d.open) d.close();
    });
    const fuera = (e) => {
      if (e.target === dlg.value) cerrarModal();
    };
    // Algunos navegadores cierran el diálogo con Escape sin avisar con "cancel".
    const alCerrar = () => {
      if (store.modal) cerrarModal();
    };
    return { store, dlg, cerrarModal, fuera, alCerrar };
  },
};

export const Avisos = {
  template: `<div class="avisos" role="status" aria-live="polite">
    <div v-for="a in store.avisos" :key="a.id" class="aviso-item" :class="a.tipo">
      <span>{{ a.texto }}</span>
      <button v-if="a.accion" type="button" @click="ejecutar(a)">{{ a.accion.texto }}</button>
    </div>
  </div>`,
  setup() {
    const ejecutar = (a) => {
      a.accion.fn();
      cerrarAviso(a.id);
    };
    return { store, ejecutar };
  },
};

export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
