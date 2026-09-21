import { store, cerrarModal, cerrarAviso, responderConfirmacion, personas, buscar, personaFiltro, colorPersona, fmtMoneda } from '../store.js';
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
  repetir: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0 0 8h1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 0-8h-1',
  medidor: 'M4 19a8 8 0 1 1 16 0M12 19l4-6',
  basura: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5',
  escudo: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  linea: 'M3 3v18h18M7 14l4-4 3 3 5-6',
  lupa: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  microfono: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6',
  pegar: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4',
  rayo: 'M13 3 5 13h5l-1 8 8-10h-5z',
  imprimir: 'M7 9V4h10v5M7 18H5v-7h14v7h-2M7 14h10v6H7z',
  huella: 'M12 4a8 8 0 0 0-8 8v3M20 12a8 8 0 0 0-4-6.9M8 20a8 8 0 0 1-1-4v-4a5 5 0 0 1 10 0v4M12 12v5a5 5 0 0 0 .6 2.4',
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

// El foco de un diálogo. `showModal()` ya lo atrapa en los navegadores actuales, pero no todos
// lo devuelven a donde estaba al cerrarse, y quien abre un formulario desde una fila de una lista
// se queda sin saber dónde iba. Además, si el diálogo queda vacío un instante (Vue lo vuelve a
// dibujar), el Tab se escapa al fondo, así que la vuelta se hace a mano.
export function usarFoco() {
  let previo = null;
  const enfocables = (d) => [...d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  return {
    recordar() {
      previo = document.activeElement;
    },
    devolver() {
      // Solo si el elemento sigue en la página: puede haberse borrado con lo que se guardó.
      if (previo?.isConnected) previo.focus?.();
      previo = null;
    },
    // Tab en el último lleva al primero, y Shift+Tab en el primero al último.
    atrapar(e, d) {
      if (e.key !== 'Tab' || !d) return;
      const lista = enfocables(d);
      if (!lista.length) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      }
    },
  };
}

export const ModalHost = {
  components: { Icono },
  template: `<dialog ref="dlg" class="modal" aria-labelledby="titulo-modal" @cancel.prevent="cerrarModal" @close="alCerrar" @click="fuera" @keydown="foco.atrapar($event, dlg)">
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
    const foco = usarFoco();
    watch(() => store.modal, async (m, antes) => {
      // Se recuerda antes del nextTick: después, el foco ya se movió.
      if (m && !antes) foco.recordar();
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
      if (!m && d.open) {
        d.close();
        foco.devolver();
      }
    });
    const fuera = (e) => {
      if (e.target === dlg.value) cerrarModal();
    };
    // Algunos navegadores cierran el diálogo con Escape sin avisar con "cancel".
    const alCerrar = () => {
      if (store.modal) cerrarModal();
      foco.devolver();
    };
    return { store, dlg, foco, cerrarModal, fuera, alCerrar };
  },
};

// Diálogo de las preguntas de sí o no (ver confirmar en store.js). Va aparte del ModalHost para
// poder abrirse encima de un formulario, y fuera del marco para servir también en la pantalla del PIN.
export const ConfirmHost = {
  template: `<dialog ref="dlg" class="modal confirmar" aria-labelledby="titulo-confirmar"
                     @cancel.prevent="responder(false)" @close="alCerrar" @click="fuera" @keydown="foco.atrapar($event, dlg)">
    <div v-if="c" class="modal-caja">
      <header class="modal-cab"><h2 id="titulo-confirmar">{{ c.titulo }}</h2></header>
      <p style="margin-bottom: 16px">{{ c.texto }}</p>
      <div class="acciones">
        <span class="espacio"></span>
        <button ref="btnNo" type="button" class="btn" @click="responder(false)">Cancelar</button>
        <button ref="btnSi" type="button" class="btn" :class="c.peligro ? 'peligro' : 'primario'" @click="responder(true)">{{ c.aceptar }}</button>
      </div>
    </div>
  </dialog>`,
  setup() {
    const dlg = ref(null);
    const btnSi = ref(null);
    const btnNo = ref(null);
    const c = computed(() => store.confirmacion);
    const foco = usarFoco();
    watch(c, async (actual, antes) => {
      if (actual && !antes) foco.recordar();
      await nextTick();
      const d = dlg.value;
      if (!d) return;
      if (actual && !d.open) {
        d.showModal();
        // En lo que se puede deshacer, el botón de seguir; en lo que no, Cancelar.
        (actual.peligro ? btnNo : btnSi).value?.focus();
      }
      if (!actual && d.open) {
        d.close();
        foco.devolver();
      }
    });
    const responder = (valor) => responderConfirmacion(valor);
    const fuera = (e) => {
      if (e.target === dlg.value) responder(false);
    };
    // Escape en algunos navegadores cierra el diálogo sin pasar por "cancel".
    const alCerrar = () => {
      responder(false);
      foco.devolver();
    };
    return { c, dlg, btnSi, btnNo, foco, responder, fuera, alCerrar };
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

// "L1,300.00 y US$100.00", sin la moneda que está en cero.
export const dosMonedas = (o, { cero = 'nada' } = {}) => [o.L ? fmtMoneda(o.L, 'L') : '', o.USD ? fmtMoneda(o.USD, 'USD') : ''].filter(Boolean).join(' y ') || cero;

export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Campo de etiquetas: se escriben, se confirman con Enter o coma y quedan como fichas que se
// pueden quitar. Debajo, las que el hogar ya usó, porque escribir "roatán" dos veces distinto
// parte el total en dos y el campo deja de servir para lo que es.
export const CampoEtiquetas = {
  components: { Icono },
  props: { modelValue: { type: Array, default: () => [] }, sugerencias: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  template: `
  <div class="campo">
    <span :id="idEtiqueta">Etiquetas</span>
    <div class="fichas" @click="enfocar">
      <span v-for="e in modelValue" :key="e" class="ficha">
        {{ e }}
        <button type="button" class="ficha-x" :aria-label="'Quitar ' + e" @click.stop="quitar(e)"><icono n="x" :t="12" :g="2.4"/></button>
      </span>
      <input ref="campo" v-model="texto" type="text" class="ficha-campo" :maxlength="largo" autocomplete="off"
             :aria-labelledby="idEtiqueta" :placeholder="modelValue.length ? '' : 'viaje a Roatán, remodelación…'"
             @keydown.enter.prevent="agregar()" @keydown="alTeclear" @blur="agregar()">
    </div>
    <div v-if="visibles.length" class="chips-filtro" role="group" aria-label="Etiquetas ya usadas">
      <button v-for="x in visibles" :key="x.etiqueta" type="button" class="chip-filtro" @click="agregar(x.etiqueta)">{{ x.etiqueta }}</button>
    </div>
    <p v-if="lleno" class="nota chica">Ocho etiquetas es el máximo: más que eso deja de clasificar.</p>
  </div>`,
  setup(props, { emit }) {
    const texto = ref('');
    const campo = ref(null);
    const idEtiqueta = `etiquetas-${Math.random().toString(36).slice(2, 8)}`;
    const lleno = computed(() => props.modelValue.length >= 8);
    const visibles = computed(() => props.sugerencias.slice(0, 8));
    const enfocar = () => campo.value?.focus();
    function agregar(valor = texto.value) {
      const limpio = String(valor ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 30).toLowerCase();
      texto.value = '';
      if (!limpio || lleno.value) return;
      const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (props.modelValue.some((e) => sinTildes(e) === sinTildes(limpio))) return;
      emit('update:modelValue', [...props.modelValue, limpio]);
    }
    const quitar = (e) => emit('update:modelValue', props.modelValue.filter((x) => x !== e));
    function alTeclear(e) {
      if (e.key === ',') {
        e.preventDefault();
        agregar();
      } else if (e.key === 'Backspace' && !texto.value && props.modelValue.length) {
        quitar(props.modelValue[props.modelValue.length - 1]);
      }
    }
    return { texto, campo, idEtiqueta, lleno, visibles, enfocar, agregar, quitar, alTeclear, largo: 30 };
  },
};

// Dictado por voz para un campo de texto. El reconocimiento de voz del navegador no está en
// todos (en iOS solo en Safari), así que `hay` dice si se puede y el botón se esconde si no.
// El texto llega en trozos: se va pegando al final de lo que ya hubiera escrito.
export function dictado({ alTexto, alTerminar } = {}) {
  const Motor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Motor) return { hay: false, empezar: () => {}, parar: () => {} };
  let motor = null;
  const parar = () => {
    motor?.stop();
    motor = null;
  };
  function empezar() {
    if (motor) return parar();
    motor = new Motor();
    motor.lang = 'es-HN';
    motor.interimResults = false;
    motor.continuous = false;
    motor.onresult = (e) => {
      const texto = [...e.results].map((r) => r[0].transcript).join(' ').trim();
      if (texto) alTexto?.(texto);
    };
    motor.onend = () => {
      motor = null;
      alTerminar?.();
    };
    motor.onerror = () => {
      motor = null;
      alTerminar?.();
    };
    motor.start();
  }
  return { hay: true, empezar, parar };
}

// Un reporte para guardar o mandar por correo: el navegador ya sabe imprimir y guardar en PDF,
// así que basta una hoja de estilos y un encabezado que diga qué es y de cuándo.
// El botón no sale impreso (es un `.btn`) y el encabezado no se ve en pantalla.
export const Imprimir = {
  components: { Icono },
  props: { titulo: { type: String, required: true }, detalle: { type: String, default: '' } },
  template: `
  <div class="fila-imprimir">
    <div class="solo-imprimir">
      <h1>{{ titulo }}</h1>
      <p v-if="detalle">{{ detalle }}</p>
    </div>
    <button type="button" class="btn" @click="imprimir"><icono n="imprimir" :t="17"/> Imprimir o guardar en PDF</button>
  </div>`,
  setup: () => ({ imprimir: () => globalThis.print?.() }),
};
