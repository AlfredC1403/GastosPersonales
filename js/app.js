import { store, iniciar, sincronizar, soyYo, aviso, personas, buscar, vivos } from './store.js';
import { nombrePeriodo, sumarMeses, periodoActual, hoy } from './core/util.js';
import * as od from './onedrive.js';
import { esOscuro, alternarTema } from './tema.js';
import { Icono, ModalHost, Avisos } from './ui/componentes.js';
import { nuevoMovimiento } from './ui/formularios.js';
import { VistaInicio } from './ui/inicio.js';
import { VistaMes } from './ui/mes.js';
import { VistaMovimientos } from './ui/movimientos.js';
import { VistaPrestamos } from './ui/prestamos.js';
import { VistaPresupuesto } from './ui/presupuesto.js';
import { VistaCuentas } from './ui/cuentas.js';
import { VistaAjustes } from './ui/ajustes.js';
import { VistaMas } from './ui/mas.js';

const { createApp, ref, computed, markRaw } = Vue;

// `nav`: qué botón de la barra inferior queda marcado. `atras`: muestra la flecha para volver a Más.
const VISTAS = [
  { id: 'inicio', nombre: 'Inicio', componente: VistaInicio, porMes: true, nav: 'inicio' },
  { id: 'mes', nombre: 'Mes', componente: VistaMes, porMes: true, nav: 'mes' },
  { id: 'movimientos', nombre: 'Movimientos', componente: VistaMovimientos, porMes: true, nav: 'movimientos' },
  { id: 'mas', nombre: 'Más', componente: VistaMas, nav: 'mas' },
  { id: 'prestamos', nombre: 'Préstamos', componente: VistaPrestamos, nav: 'mas', atras: true },
  { id: 'presupuesto', nombre: 'Presupuesto', componente: VistaPresupuesto, nav: 'mas', atras: true },
  { id: 'cuentas', nombre: 'Cuentas', componente: VistaCuentas, nav: 'mas', atras: true },
  { id: 'ajustes', nombre: 'Ajustes', componente: VistaAjustes, nav: 'mas', atras: true },
].map((v) => ({ ...v, componente: markRaw(v.componente) }));

const NAV = [
  { id: 'inicio', nombre: 'Inicio', icono: 'casa' },
  { id: 'mes', nombre: 'Mes', icono: 'calendario' },
  null, // botón +
  { id: 'movimientos', nombre: 'Movimientos', icono: 'flechas' },
  { id: 'mas', nombre: 'Más', icono: 'puntos', grosor: 2.2 },
];

const rutaActual = () => {
  const id = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return VISTAS.some((v) => v.id === id) ? id : 'inicio';
};

const App = {
  components: { Icono, ModalHost, Avisos },
  template: `
  <header class="cabecera">
    <div class="cab-dentro">
      <template v-if="vista.porMes">
        <button type="button" class="btn-icono" aria-label="Mes anterior" @click="mover(-1)"><icono n="izq" :t="20"/></button>
        <div class="cab-titulos">
          <span class="cab-titulo">{{ nombrePeriodo(store.periodo) }}</span>
          <span class="cab-sub">{{ subtituloMes }}</span>
        </div>
        <button type="button" class="btn-icono" aria-label="Mes siguiente" @click="mover(1)"><icono n="der" :t="20"/></button>
        <button v-if="store.periodo !== actual" type="button" class="btn-hoy" @click="store.periodo = actual">Hoy</button>
      </template>
      <template v-else>
        <a v-if="vista.atras" class="btn-icono" href="#/mas" aria-label="Volver a Más"><icono n="izq" :t="20"/></a>
        <span class="cab-titulo">{{ vista.nombre }}</span>
      </template>
      <span class="cab-espacio"></span>
      <button type="button" class="pill-sync con-texto" :class="sync.clase" :title="sync.detalle || sync.texto" :aria-label="sync.texto" @click="tocarSync">
        <icono :n="sync.icono" :t="15"/><span>{{ sync.texto }}</span>
      </button>
      <button type="button" class="btn-redondo" :aria-label="oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'" @click="alternarTema">
        <icono :n="oscuro ? 'sol' : 'luna'" :t="17"/>
      </button>
    </div>
  </header>

  <main class="contenido">
    <div v-if="preguntarQuien" class="aviso-banner" style="margin-bottom: 16px">
      <p>¿Quién usa este dispositivo? Así cada registro queda firmado.</p>
      <button v-for="p in listaPersonas" :key="p.id" type="button" class="btn" @click="soyYo(p.id)">{{ p.nombre }}</button>
    </div>
    <component :is="vista.componente" :key="vista.id"/>
  </main>

  <nav class="navbar" aria-label="Secciones">
    <div class="navbar-dentro">
      <template v-for="(n, i) in nav" :key="i">
        <div v-if="!n" class="nav-fab">
          <button type="button" class="fab" aria-label="Registrar un gasto o ingreso" @click="nuevo"><icono n="mas" :t="26" :g="2"/></button>
        </div>
        <a v-else class="nav-item" :class="{ activo: vista.nav === n.id }" :href="'#/' + n.id" :aria-current="vista.nav === n.id ? 'page' : null">
          <icono :n="n.icono" :t="22" :g="n.grosor || 1.7"/><span>{{ n.nombre }}</span>
        </a>
      </template>
    </div>
  </nav>

  <modal-host/>
  <avisos/>`,
  setup() {
    const ruta = ref(rutaActual());
    window.addEventListener('hashchange', () => {
      ruta.value = rutaActual();
      window.scrollTo(0, 0);
    });
    const vista = computed(() => VISTAS.find((v) => v.id === ruta.value));
    const listaPersonas = computed(personas);
    const preguntarQuien = computed(() => !buscar('personas', store.yo) && listaPersonas.value.length > 0);
    const actual = periodoActual();

    const subtituloMes = computed(() => {
      const p = store.periodo;
      if (p === actual) {
        const [y, m] = p.split('-').map(Number);
        return `día ${Number(hoy().slice(8))} de ${new Date(y, m, 0).getDate()}`;
      }
      if (p > actual) return 'por venir';
      const n = vivos('movimientos').filter((x) => x.periodo === p).length;
      return n ? `${n} ${n === 1 ? 'movimiento' : 'movimientos'}` : 'sin registros';
    });

    const sync = computed(() => {
      const s = store.sync;
      if (!s.ubicacion) return { texto: 'Solo este dispositivo', icono: 'nubeNo', clase: '' };
      if (s.estado === 'sincronizando') return { texto: 'Sincronizando', icono: 'sync', clase: 'ok girando' };
      if (s.estado === 'error') return { texto: 'Error al sincronizar', icono: 'nubeNo', clase: 'mal', detalle: s.mensaje };
      if (s.estado === 'sesion') return { texto: 'Reconectar', icono: 'nubeNo', clase: 'aviso' };
      if (s.estado === 'offline') return { texto: 'Sin conexión', icono: 'nubeNo', clase: 'aviso' };
      if (s.pendiente) return { texto: 'Por subir', icono: 'nube', clase: 'aviso' };
      return { texto: 'Sincronizado', icono: 'nube', clase: 'ok' };
    });
    function tocarSync() {
      const s = store.sync;
      if (!s.ubicacion) location.hash = '#/ajustes';
      else if (s.estado === 'sesion') od.iniciarSesion({ silenciosa: true });
      else {
        if (s.estado === 'error') aviso(s.mensaje, 'error', 8000);
        sincronizar();
      }
    }

    return {
      store, vista, nav: NAV, listaPersonas, preguntarQuien, actual, subtituloMes, sync, tocarSync, soyYo, nombrePeriodo,
      oscuro: computed(esOscuro), alternarTema,
      mover: (n) => { store.periodo = sumarMeses(store.periodo, n); },
      nuevo: () => nuevoMovimiento({ fecha: store.periodo === actual ? undefined : `${store.periodo}-01` }),
    };
  },
};

createApp(App).mount('#app');
iniciar();
