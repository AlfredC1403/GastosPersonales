import { store, fmtEntero, indice, vivos, cuentasDinero, tarjetas, buscar, filtro, bloquear, avisos } from '../store.js';
import { saldosCuentas, enLempirasAprox } from '../core/reportes.js';
import { presupuestoMensual } from '../core/presupuesto.js';
import { estadoSuscripciones, resumenSuscripciones } from '../core/suscripciones.js';
import { deudaAl } from '../core/prestamos.js';
import { coincidePersona } from '../core/filtro.js';
import { resumenTarjeta, comprometidoEnCuotas } from '../core/tarjetas.js';
import { estadoMetas } from '../core/metas.js';
import { RECORDATORIOS_INICIAL } from '../core/recordatorios.js';
import { VERSION } from '../version.js';
import { Icono } from './componentes.js';

const { computed } = Vue;

// Grupos del menú. Cada id es una ruta de js/app.js; las opciones de fases futuras se agregan aquí.
export const GRUPOS_MENU = [
  { nombre: 'Día a día', items: [
    { id: 'inicio', nombre: 'Inicio', icono: 'casa' },
    { id: 'mes', nombre: 'Mes', icono: 'calendario' },
    { id: 'movimientos', nombre: 'Movimientos', icono: 'flechas' },
    { id: 'avisos', nombre: 'Avisos', icono: 'campana', valor: 'avisos' },
  ] },
  { nombre: 'Dinero', items: [
    { id: 'cuentas', nombre: 'Cuentas', icono: 'banco', valor: 'cuentas' },
    { id: 'tarjetas', nombre: 'Tarjetas', icono: 'tarjeta', valor: 'tarjetas' },
    { id: 'financiamientos', nombre: 'Financiamientos', icono: 'reloj', valor: 'financiamientos' },
    { id: 'prestamos', nombre: 'Préstamos', icono: 'tendencia', valor: 'deuda' },
  ] },
  { nombre: 'Planificar', items: [
    { id: 'presupuesto', nombre: 'Presupuesto', icono: 'pastel', valor: 'presupuesto' },
    { id: 'suscripciones', nombre: 'Suscripciones', icono: 'repetir', valor: 'suscripciones' },
    { id: 'plan-deudas', nombre: 'Plan de deudas', icono: 'objetivo' },
    { id: 'metas', nombre: 'Metas', icono: 'bandera', valor: 'metas' },
    { id: 'reparto', nombre: 'Reparto de gastos', icono: 'balanza' },
  ] },
  { nombre: 'Reportes', items: [
    { id: 'resumen', nombre: 'Resumen anual', icono: 'barras' },
    { id: 'comparar', nombre: 'Comparar años', icono: 'comparar' },
    { id: 'anios', nombre: 'Años anteriores', icono: 'archivo' },
  ] },
  { nombre: 'Configuración', items: [
    { id: 'configurar', nombre: 'Revisar configuración', icono: 'check' },
    { id: 'salarios', nombre: 'Salarios y deducciones', icono: 'billete' },
    { id: 'categorias', nombre: 'Categorías y grupos', icono: 'etiqueta' },
    { id: 'comercios', nombre: 'Comercios', icono: 'tienda' },
    { id: 'personas', nombre: 'Personas', icono: 'personas' },
    { id: 'recordatorios', nombre: 'Recordatorios', icono: 'reloj', valor: 'recordatorios' },
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
  // sinNuevo: el documento está en solo lectura, no se puede registrar nada (ver store.soloLectura).
  props: { fijo: Boolean, contraido: Boolean, ruta: { type: String, default: '' }, sinNuevo: Boolean },
  emits: ['cerrar', 'nuevo', 'contraer'],
  template: `
  <nav class="menu" :class="{ contraido }" aria-label="Menú principal">
    <div class="menu-cab">
      <img src="icon.svg" width="30" height="30" alt="">
      <span v-if="!contraido" class="menu-marca cifra">Gastos del hogar</span>
      <span class="espacio"></span>
      <button v-if="!fijo" type="button" class="btn-icono" aria-label="Cerrar menú" @click="$emit('cerrar')"><icono n="x"/></button>
    </div>

    <button v-if="fijo" type="button" class="btn primario menu-nuevo" :disabled="sinNuevo"
            :title="sinNuevo ? 'No se puede registrar: actualiza la app' : contraido ? 'Registrar' : null" @click="$emit('nuevo')">
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
      const lista = cuentasDinero().filter((c) => coincidePersona(c.titularId || null, f));
      const deTarjetas = tarjetas().filter((c) => coincidePersona(c.titularId || null, f)).reduce((a, c) => a + resumenTarjeta(ix, c).deudaEnL, 0);
      const deuda = vivos('prestamos').length ? deudaAl(ix, '9999-12', f) : 0;
      // Lo que falta por pagar en cuotas de financiamientos, de las tarjetas que se estén viendo.
      const enCuotas = tarjetas().filter((c) => coincidePersona(c.titularId || null, f))
        .reduce((a, c) => a + comprometidoEnCuotas(ix, { cuentaId: c.id }).total, 0);
      return {
        cuentas: lista.length ? fmtEntero(lista.reduce((a, c) => a + enLempirasAprox(ix, c.id, saldos[c.id] || 0), 0)) : '',
        deuda: deuda ? fmtEntero(deuda) : '',
        tarjetas: deTarjetas > 0 ? fmtEntero(deTarjetas) : '',
        financiamientos: enCuotas > 0 ? fmtEntero(enCuotas) : '',
        recordatorios: { ...RECORDATORIOS_INICIAL, ...(buscar('personas', store.yo)?.recordatorios || {}) }.activo ? (store.recordatorios.error ? 'error' : 'activos') : '',
        metas: (() => {
          const lista = estadoMetas(ix, f);
          const objetivo = lista.reduce((a, e) => a + e.objetivo, 0);
          return objetivo ? `${Math.round((lista.reduce((a, e) => a + Math.min(e.ahorrado, e.objetivo), 0) / objetivo) * 100)}%` : '';
        })(),
        presupuesto: `${fmtEntero(presupuestoMensual(ix, store.periodo, f).egresos)}/mes`,
        suscripciones: (() => {
          const r = resumenSuscripciones(estadoSuscripciones(ix, { hoy: store.hoy, filtro: f, periodo: store.periodo }));
          return r.cuantas ? `${fmtEntero(r.alMes)}/mes` : '';
        })(),
        avisos: avisos().length ? String(avisos().length) : '',
      };
    });
    const bloquearAhora = () => {
      emit('cerrar');
      bloquear();
    };
    return { grupos: GRUPOS_MENU, yo, textoYo, textoSync, valores, conPin: computed(() => store.conPin), bloquearAhora, version: VERSION };
  },
};
