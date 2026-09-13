import { store, cerrarModal, cerrarAviso, personas, buscar, personaFiltro, colorPersona } from '../store.js';
import { definirPersona } from '../tema.js';

const { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

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
  casa: 'M4 11l8-6 8 6M6.5 10v9h11v-9',
  calendario: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  flechas: 'M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3',
  puntos: 'M5 12h.01M12 12h.01M19 12h.01',
  sol: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  luna: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  tendencia: 'M3 7l6 6 4-4 8 8M21 17h-5M21 17v-5',
  pastel: 'M12 3a9 9 0 1 0 9 9h-9z',
  banco: 'M3 7h18v12H3zM3 7l3-4h12l3 4M3 12h18',
  ajustes: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  personas: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.2A6.5 6.5 0 0 1 21.5 20',
  etiqueta: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
  candado: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  objetivo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  paleta: 'M12 3a9 9 0 1 0 0 18c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.8 17 3 12 3zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01',
  contraer: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  expandir: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  campana: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9zM10.2 20.5a2 2 0 0 0 3.6 0',
  billete: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 10v.01M17.5 14v.01',
  tarjeta: 'M3 6h18v12H3zM3 10h18M7 14.5h4',
  tienda: 'M4 9l1.5-5h13L20 9M4 9h16M5 9v11h14V9M10 20v-5h4v5',
  bandera: 'M5 21V4M5 4h12l-2.5 4 2.5 4H5',
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  balanza: 'M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z',
  barras: 'M5 20v-9M10 20V5M15 20v-6M20 20V9M3 20h18',
  comparar: 'M4 20v-7M8 20V8M14 20v-5M18 20V6M2 20h20',
  archivo: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
};

export const Icono = {
  props: {
    n: { type: String, required: true },
    t: { type: Number, default: 18 },
    g: { type: Number, default: 1.8 },
  },
  template: `<svg :width="t" :height="t" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="g"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="trazo"/></svg>`,
  computed: {
    trazo() {
      return TRAZOS[this.n] || '';
    },
  },
};

export const ModalHost = {
  components: { Icono },
  template: `<dialog ref="dlg" class="modal" aria-labelledby="titulo-modal" @cancel.prevent="cerrarModal" @close="alCerrar" @click="fuera">
    <div v-if="store.modal" class="modal-caja">
      <header class="modal-cab">
        <h2 id="titulo-modal">{{ store.modal.titulo }}</h2>
        <button type="button" class="btn-icono" aria-label="Cerrar" @click="cerrarModal"><icono n="x"/></button>
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

// Botón de la cabecera para ver todo el hogar o solo lo de una persona.
export const SelectorPersona = {
  components: { Icono },
  template: `
  <div class="selector-persona" ref="raiz">
    <button type="button" class="btn-persona" :class="{ activo: !!actual }" :aria-expanded="abierto" aria-haspopup="true"
            :aria-label="actual ? 'Viendo lo de ' + actual.nombre + '. Cambiar' : 'Viendo todo el hogar. Cambiar'" @click="abierto = !abierto">
      <span v-if="actual" class="inicial">{{ actual.nombre.slice(0, 1).toUpperCase() }}</span>
      <icono v-else n="casa" :t="17"/>
    </button>
    <div v-if="abierto" class="popover" role="menu">
      <p class="popover-titulo">Ver</p>
      <button type="button" role="menuitemradio" :aria-checked="!actual" @click="elegir(null)">
        <icono n="casa" :t="16"/><span>Todo el hogar</span><icono v-if="!actual" n="check" :t="16" class="marca"/>
      </button>
      <button v-for="p in lista" :key="p.id" type="button" role="menuitemradio" :aria-checked="actual?.id === p.id" @click="elegir(p.id)">
        <span class="inicial chica" :style="{ background: colorPersona(p.id) }">{{ p.nombre.slice(0, 1).toUpperCase() }}</span>
        <span>Solo {{ p.nombre }}</span><icono v-if="actual?.id === p.id" n="check" :t="16" class="marca"/>
      </button>
    </div>
  </div>`,
  setup() {
    const abierto = ref(false);
    const raiz = ref(null);
    const lista = computed(personas);
    const actual = computed(() => buscar('personas', personaFiltro()));
    const elegir = (id) => {
      definirPersona(id);
      abierto.value = false;
    };
    const fuera = (e) => {
      if (abierto.value && raiz.value && !raiz.value.contains(e.target)) abierto.value = false;
    };
    const escape = (e) => {
      if (e.key === 'Escape') abierto.value = false;
    };
    onMounted(() => {
      document.addEventListener('pointerdown', fuera);
      document.addEventListener('keydown', escape);
    });
    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', escape);
    });
    return { abierto, raiz, lista, actual, elegir, colorPersona };
  },
};

// Franja que avisa que hay un filtro de persona activo.
export const FranjaPersona = {
  props: { nota: { type: String, default: '' } },
  template: `
  <div v-if="actual" class="franja-persona" role="status">
    <span>Viendo solo lo de {{ actual.nombre }}<template v-if="nota"> · {{ nota }}</template></span>
    <button type="button" class="btn-link" @click="definirPersona(null)">Ver el hogar</button>
  </div>`,
  setup() {
    const actual = computed(() => buscar('personas', personaFiltro()));
    return { actual, definirPersona };
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
