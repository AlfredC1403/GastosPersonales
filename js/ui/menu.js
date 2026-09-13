import { store, fmtEntero, indice, vivos, cuentas, buscar, filtro, bloquear } from '../store.js';
import { saldosCuentas, enLempirasAprox } from '../core/reportes.js';
import { presupuestoMensual } from '../core/presupuesto.js';
import { deudaAl } from '../core/prestamos.js';
import { coincidePersona } from '../core/filtro.js';
import { VERSION } from '../version.js';
import { Icono } from './componentes.js';

const { computed } = Vue;

// Grupos del menú. Cada id es una ruta de js/app.js; las opciones de fases futuras se agregan aquí.
export const GRUPOS_MENU = [
  { nombre: 'Día a día', items: [
    { id: 'inicio', nombre: 'Inicio', icono: 'casa' },
    { id: 'mes', nombre: 'Mes', icono: 'calendario' },
    { id: 'movimientos', nombre: 'Movimientos', icono: 'flechas' },
  ] },
  { nombre: 'Dinero', items: [
    { id: 'cuentas', nombre: 'Cuentas', icono: 'banco', valor: 'cuentas' },
    { id: 'prestamos', nombre: 'Préstamos', icono: 'tendencia', valor: 'deuda' },
  ] },
  { nombre: 'Planificar', items: [
    { id: 'presupuesto', nombre: 'Presupuesto', icono: 'pastel', valor: 'presupuesto' },
    { id: 'plan-deudas', nombre: 'Plan de deudas', icono: 'objetivo' },
  ] },
  { nombre: 'Configuración', items: [
    { id: 'configurar', nombre: 'Revisar configuración', icono: 'check' },
    { id: 'categorias', nombre: 'Categorías y grupos', icono: 'etiqueta' },
    { id: 'personas', nombre: 'Personas', icono: 'personas' },
    { id: 'seguridad', nombre: 'Seguridad', icono: 'candado' },
    { id: 'datos', nombre: 'Datos y OneDrive', icono: 'nube' },
    { id: 'apariencia', nombre: 'Apariencia', icono: 'paleta' },
  ] },
];

const TEXTO_SYNC = {
  ok: 'Sincronizado con OneDrive', sincronizando: 'Sincronizando…', pendiente: 'Cambios por subir', offline: 'Sin conexión',
  sesion: 'La sesión de Microsoft venció', error: 'Error al sincronizar', local: 'Solo en este dispositivo',
};

// `fijo`: menú lateral permanente (computadora). Si no, panel que se abre y se cierra (celular).
export const MenuLateral = {
  components: { Icono },
  props: { fijo: Boolean, contraido: Boolean, ruta: { type: String, default: '' } },
  emits: ['cerrar', 'nuevo', 'contraer'],
  template: `
  <nav class="menu" :class="{ contraido }" aria-label="Menú principal">
    <div class="menu-cab">
      <img src="icon.svg" width="30" height="30" alt="">
      <span v-if="!contraido" class="menu-marca cifra">Gastos del hogar</span>
      <span class="espacio"></span>
      <button v-if="!fijo" type="button" class="btn-icono" aria-label="Cerrar menú" @click="$emit('cerrar')"><icono n="x"/></button>
    </div>

    <button v-if="fijo" type="button" class="btn primario menu-nuevo" :title="contraido ? 'Registrar' : null" @click="$emit('nuevo')">
      <icono n="mas" :t="18" :g="2.2"/><span v-if="!contraido">Registrar</span>
    </button>

    <div v-for="g in grupos" :key="g.nombre" class="menu-grupo">
      <p v-if="!contraido" class="menu-grupo-titulo">{{ g.nombre }}</p>
      <a v-for="it in g.items" :key="it.id" :href="'#/' + it.id" class="menu-item" :class="{ activo: it.id === ruta }"
         :aria-current="it.id === ruta ? 'page' : null" :title="contraido ? it.nombre : null" :aria-label="contraido ? it.nombre : null"
         @click="$emit('cerrar')">
        <icono :n="it.icono" :t="20" :g="1.7"/>
        <template v-if="!contraido">
          <span class="menu-nombre">{{ it.nombre }}</span>
          <span v-if="valores[it.valor]" class="menu-valor">{{ valores[it.valor] }}</span>
        </template>
      </a>
    </div>

    <div class="menu-pie">
      <a href="#/personas" class="menu-item" :title="contraido ? textoYo : null" @click="$emit('cerrar')">
        <span class="avatar chico">{{ yo ? yo.nombre.slice(0, 1).toUpperCase() : '?' }}</span>
        <span v-if="!contraido" class="menu-nombre">{{ textoYo }}</span>
      </a>
      <button v-if="conPin" type="button" class="menu-item" :title="contraido ? 'Bloquear ahora' : null" @click="bloquearAhora">
        <icono n="candado" :t="20" :g="1.7"/><span v-if="!contraido" class="menu-nombre">Bloquear ahora</span>
      </button>
      <button v-if="fijo" type="button" class="menu-item" :aria-label="contraido ? 'Expandir menú' : 'Contraer menú'" @click="$emit('contraer')">
        <icono :n="contraido ? 'expandir' : 'contraer'" :t="20" :g="1.7"/><span v-if="!contraido" class="menu-nombre">Contraer menú</span>
      </button>
      <p v-if="!contraido" class="meta menu-meta">{{ textoSync }} · versión {{ version }}</p>
    </div>
  </nav>`,
  setup(props, { emit }) {
    const yo = computed(() => buscar('personas', store.yo));
    const textoYo = computed(() => (yo.value ? `Registras como ${yo.value.nombre}` : 'Elegir quién usa este dispositivo'));
    const textoSync = computed(() => (store.sync.ubicacion ? TEXTO_SYNC[store.sync.estado] || 'Conectado' : TEXTO_SYNC.local));
    const valores = computed(() => {
      const f = filtro();
      const ix = indice();
      const saldos = saldosCuentas(ix);
      const lista = cuentas().filter((c) => coincidePersona(c.titularId || null, f));
      const deuda = vivos('prestamos').length ? deudaAl(ix, '9999-12', f) : 0;
      return {
        cuentas: lista.length ? fmtEntero(lista.reduce((a, c) => a + enLempirasAprox(ix, c.id, saldos[c.id] || 0), 0)) : '',
        deuda: deuda ? fmtEntero(deuda) : '',
        presupuesto: `${fmtEntero(presupuestoMensual(ix, store.periodo, f).egresos)}/mes`,
      };
    });
    const bloquearAhora = () => {
      emit('cerrar');
      bloquear();
    };
    return { grupos: GRUPOS_MENU, yo, textoYo, textoSync, valores, conPin: computed(() => store.conPin), bloquearAhora, version: VERSION };
  },
};
