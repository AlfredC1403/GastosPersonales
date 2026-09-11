import { store, iniciar, sincronizar, soyYo, aviso, personas, buscar } from './store.js';
import { nombrePeriodo, sumarMeses, periodoActual } from './core/util.js';
import * as od from './onedrive.js';
import { Icono, ModalHost, Avisos } from './ui/componentes.js';
import { prepararChart } from './ui/graficos.js';
import { nuevoMovimiento } from './ui/formularios.js';
import { VistaInicio } from './ui/inicio.js';
import { VistaMes } from './ui/mes.js';
import { VistaMovimientos } from './ui/movimientos.js';
import { VistaPrestamos } from './ui/prestamos.js';
import { VistaPresupuesto } from './ui/presupuesto.js';
import { VistaCuentas } from './ui/cuentas.js';
import { VistaAjustes } from './ui/ajustes.js';

const { createApp, ref, computed, markRaw } = Vue;

const VISTAS = [
  { id: 'inicio', nombre: 'Inicio', componente: VistaInicio, porMes: true },
  { id: 'mes', nombre: 'Mes', componente: VistaMes, porMes: true },
  { id: 'movimientos', nombre: 'Movimientos', componente: VistaMovimientos, porMes: true },
  { id: 'prestamos', nombre: 'Préstamos', componente: VistaPrestamos },
  { id: 'presupuesto', nombre: 'Presupuesto', componente: VistaPresupuesto },
  { id: 'cuentas', nombre: 'Cuentas', componente: VistaCuentas },
  { id: 'ajustes', nombre: 'Ajustes', componente: VistaAjustes },
].map((v) => ({ ...v, componente: markRaw(v.componente) }));

const rutaActual = () => {
  const id = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return VISTAS.some((v) => v.id === id) ? id : 'inicio';
};

const App = {
  components: { Icono, ModalHost, Avisos },
  template: `
  <header class="cabecera">
    <div class="cab-fila">
      <a class="marca" href="#/inicio">Gastos del hogar</a>
      <button type="button" class="estado-sync" :class="sync.clase" :title="sync.detalle || sync.texto" @click="tocarSync">
        <icono :n="sync.icono" :t="16"/><span>{{ sync.texto }}</span>
      </button>
      <a v-if="yo" class="chip-usuario" href="#/ajustes" :title="'Registras como ' + yo.nombre"><icono n="usuario" :t="16"/>{{ yo.nombre }}</a>
    </div>
    <nav class="pestanas" aria-label="Secciones">
      <a v-for="v in vistas" :key="v.id" :href="'#/' + v.id" :class="{ activa: v.id === ruta }" :aria-current="v.id === ruta ? 'page' : null">{{ v.nombre }}</a>
    </nav>
  </header>

  <main class="contenido">
    <div v-if="preguntarQuien" class="banner">
      <p>¿Quién usa este dispositivo? Así cada registro queda firmado.</p>
      <button v-for="p in listaPersonas" :key="p.id" type="button" class="btn" @click="soyYo(p.id)">{{ p.nombre }}</button>
    </div>
    <div v-if="vista.porMes" class="barra-mes">
      <button type="button" class="icono-btn" aria-label="Mes anterior" @click="mover(-1)"><icono n="izq"/></button>
      <h1>{{ nombrePeriodo(store.periodo) }}</h1>
      <button type="button" class="icono-btn" aria-label="Mes siguiente" @click="mover(1)"><icono n="der"/></button>
      <button v-if="store.periodo !== actual" type="button" class="btn texto chico" @click="store.periodo = actual">Volver a hoy</button>
    </div>
    <h1 v-else class="titulo-vista">{{ vista.nombre }}</h1>
    <component :is="vista.componente" :key="vista.id"/>
  </main>

  <button type="button" class="fab" aria-label="Registrar un gasto o ingreso" @click="nuevo"><icono n="mas" :t="26"/></button>
  <modal-host/>
  <avisos/>`,
  setup() {
    const ruta = ref(rutaActual());
    window.addEventListener('hashchange', () => {
      ruta.value = rutaActual();
      window.scrollTo(0, 0);
    });
    const vista = computed(() => VISTAS.find((v) => v.id === ruta.value));
    const yo = computed(() => buscar('personas', store.yo));
    const listaPersonas = computed(personas);
    const preguntarQuien = computed(() => !yo.value && listaPersonas.value.length > 0);
    const actual = periodoActual();

    const sync = computed(() => {
      const s = store.sync;
      if (!s.ubicacion) return { texto: 'Solo este dispositivo', icono: 'nubeNo', clase: '' };
      if (s.estado === 'sincronizando') return { texto: 'Sincronizando…', icono: 'sync', clase: 'girando' };
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
      store, vistas: VISTAS, ruta, vista, yo, listaPersonas, preguntarQuien, actual, sync, tocarSync, soyYo, nombrePeriodo,
      mover: (n) => { store.periodo = sumarMeses(store.periodo, n); },
      nuevo: () => nuevoMovimiento({ fecha: store.periodo === actual ? undefined : `${store.periodo}-01` }),
    };
  },
};

prepararChart();
createApp(App).mount('#app');
iniciar();
