// Buscador global: una caja que cruza todo y lleva a donde sea de un toque.
// Se abre desde la lupa de la cabecera o con la tecla "/" (y Ctrl/⌘+K en la computadora).
import { store, indice, fmtMoneda, cerrarModal } from '../store.js';
import { buscarEnTodo, enOrden } from '../core/busqueda.js';
import { Icono } from './componentes.js';

const { ref, computed, onMounted, nextTick } = Vue;

const ICONOS = {
  pantalla: 'flechas', movimiento: 'billete', partida: 'pastel', etiqueta: 'etiqueta', cuenta: 'banco',
  comercio: 'tienda', prestamo: 'tendencia', meta: 'bandera', renovacion: 'escudo', persona: 'usuario', categoria: 'etiqueta',
};

export const Buscador = {
  components: { Icono },
  emits: ['listo'],
  template: `
  <div class="busqueda-caja">
    <div class="buscador">
      <input ref="campo" v-model="texto" type="search" placeholder="Buscar en todo…" aria-label="Buscar en todo"
             :aria-activedescendant="activoId" aria-controls="resultados-busqueda" role="combobox" aria-expanded="true" autocomplete="off"
             @keydown.down.prevent="mover(1)" @keydown.up.prevent="mover(-1)" @keydown.enter.prevent="abrir(planos[activo])">
    </div>

    <div v-if="texto.trim().length < 2" class="busqueda-vacio">
      Escribe al menos dos letras. Busca movimientos, partidas, etiquetas, cuentas, tarjetas,
      comercios, préstamos, metas, renovaciones, personas y las propias pantallas.
    </div>
    <p v-else-if="!planos.length" class="busqueda-vacio">Nada con «{{ texto.trim() }}».</p>

    <div id="resultados-busqueda" role="listbox" aria-label="Resultados">
      <div v-for="g in grupos" :key="g.tipo" class="busqueda-grupo">
        <p>{{ g.titulo }}</p>
        <a v-for="r in g.resultados" :id="'res-' + planos.indexOf(r)" :key="r.tipo + ':' + r.id" :href="r.ruta"
           class="busqueda-item" :class="{ activo: planos[activo] === r }" role="option" :aria-selected="planos[activo] === r"
           @click="abrir(r)" @mouseenter="activo = planos.indexOf(r)">
          <icono :n="iconos[r.tipo] || 'flechas'" :t="17"/>
          <div class="fila-info">
            <span class="fila-titulo">{{ r.nombre }}</span>
            <span v-if="r.detalle" class="fila-sub">{{ r.detalle }}</span>
          </div>
          <span v-if="r.monto" class="monto">{{ fmtMoneda(r.monto, r.moneda) }}</span>
        </a>
      </div>
    </div>
  </div>`,
  setup(props, { emit }) {
    const texto = ref('');
    const campo = ref(null);
    const activo = ref(0);
    const grupos = computed(() => buscarEnTodo(indice(), texto.value));
    const planos = computed(() => enOrden(grupos.value));
    const activoId = computed(() => (planos.value.length ? `res-${Math.min(activo.value, planos.value.length - 1)}` : null));

    onMounted(() => nextTick(() => campo.value?.focus()));
    function mover(paso) {
      if (!planos.value.length) return;
      activo.value = (activo.value + paso + planos.value.length) % planos.value.length;
      document.getElementById(`res-${activo.value}`)?.scrollIntoView({ block: 'nearest' });
    }
    function abrir(r) {
      if (!r) return;
      location.hash = r.ruta;
      emit('listo');
    }
    return { store, texto, campo, activo, activoId, grupos, planos, mover, abrir, fmtMoneda, iconos: ICONOS, cerrarModal };
  },
};
