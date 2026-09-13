import { store, iniciar, sincronizar, soyYo, aviso, personas, buscar, vivos, avisos } from './store.js';
import { nombrePeriodo, sumarMeses, periodoActual, hoy } from './core/util.js';
import * as od from './onedrive.js';
import { prefs, alternarMenuContraido } from './tema.js';
import { pinActivo, minutosBloqueo, debeBloquear } from './bloqueo.js';
import { Icono, ModalHost, Avisos, SelectorPersona, FranjaPersona } from './ui/componentes.js';
import { PantallaBloqueo } from './ui/bloqueo.js';
import { MenuLateral } from './ui/menu.js';
import { nuevoMovimiento } from './ui/formularios.js';
import { VistaInicio } from './ui/inicio.js';
import { VistaMes } from './ui/mes.js';
import { VistaMovimientos } from './ui/movimientos.js';
import { VistaPrestamos, VistaPlanDeudas } from './ui/prestamos.js';
import { VistaPresupuesto } from './ui/presupuesto.js';
import { VistaCuentas } from './ui/cuentas.js';
import { VistaPersonas } from './ui/personas.js';
import { VistaCategorias } from './ui/categorias.js';
import { VistaSeguridad } from './ui/seguridad.js';
import { VistaDatos } from './ui/datos.js';
import { VistaApariencia } from './ui/apariencia.js';
import { VistaConfigurar } from './ui/configurar.js';
import { VistaAvisos } from './ui/avisos.js';
import { VistaSalarios } from './ui/salarios.js';
import { VistaTarjetas, VistaTarjeta } from './ui/tarjetas.js';
import { VistaComercios } from './ui/comercios.js';
import { VistaMetas } from './ui/metas.js';
import { VistaReparto } from './ui/reparto.js';
import { VistaResumen } from './ui/resumen.js';
import { VistaComparar } from './ui/comparar.js';
import { VistaRecordatorios } from './ui/recordatorios.js';
import { iniciarRecordatorios } from './recordatorios.js';

const { createApp, ref, computed, watch, nextTick, markRaw } = Vue;

const VISTAS = [
  { id: 'inicio', nombre: 'Inicio', componente: VistaInicio, porMes: true },
  { id: 'mes', nombre: 'Mes', componente: VistaMes, porMes: true },
  { id: 'movimientos', nombre: 'Movimientos', componente: VistaMovimientos, porMes: true },
  { id: 'avisos', nombre: 'Avisos', componente: VistaAvisos },
  { id: 'salarios', nombre: 'Salarios y deducciones', componente: VistaSalarios },
  { id: 'cuentas', nombre: 'Cuentas', componente: VistaCuentas },
  { id: 'tarjetas', nombre: 'Tarjetas', componente: VistaTarjetas },
  // #/tarjeta/<id>/<corte>: el estado de cuenta de una tarjeta; en el menú se marca Tarjetas.
  { id: 'tarjeta', nombre: 'Tarjeta', componente: VistaTarjeta, conParametros: true, menu: 'tarjetas', titulo: ([id]) => buscar('cuentas', id)?.nombre },
  { id: 'prestamos', nombre: 'Préstamos', componente: VistaPrestamos },
  { id: 'presupuesto', nombre: 'Presupuesto', componente: VistaPresupuesto },
  { id: 'plan-deudas', nombre: 'Plan de deudas', componente: VistaPlanDeudas },
  { id: 'metas', nombre: 'Metas', componente: VistaMetas },
  { id: 'reparto', nombre: 'Reparto de gastos', componente: VistaReparto },
  { id: 'resumen', nombre: 'Resumen anual', componente: VistaResumen, porAnio: true },
  // #/comparar/<año>/<año>
  { id: 'comparar', nombre: 'Comparar años', componente: VistaComparar, conParametros: true },
  { id: 'personas', nombre: 'Personas', componente: VistaPersonas },
  { id: 'recordatorios', nombre: 'Recordatorios', componente: VistaRecordatorios },
  { id: 'categorias', nombre: 'Categorías y grupos', componente: VistaCategorias },
  { id: 'comercios', nombre: 'Comercios', componente: VistaComercios },
  { id: 'configurar', nombre: 'Revisar configuración', componente: VistaConfigurar },
  { id: 'seguridad', nombre: 'Seguridad', componente: VistaSeguridad },
  { id: 'datos', nombre: 'Datos y OneDrive', componente: VistaDatos },
  { id: 'apariencia', nombre: 'Apariencia', componente: VistaApariencia },
].map((v) => ({ ...v, componente: markRaw(v.componente) }));

// Rutas de versiones anteriores que ya no existen.
const REDIRECCIONES = { ajustes: 'datos', mas: 'inicio' };
const ACCESOS = [
  { id: 'inicio', nombre: 'Inicio', icono: 'casa' },
  { id: 'mes', nombre: 'Mes', icono: 'calendario' },
  null, // botón +
  { id: 'movimientos', nombre: 'Movimientos', icono: 'flechas' },
];

const partesRuta = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/').map((x) => decodeURIComponent(x));
const parametrosActuales = () => partesRuta().slice(1).filter(Boolean);

const rutaActual = () => {
  const id = partesRuta()[0];
  if (REDIRECCIONES[id]) {
    history.replaceState(null, '', `#/${REDIRECCIONES[id]}`);
    return REDIRECCIONES[id];
  }
  return VISTAS.some((v) => v.id === id) ? id : 'inicio';
};

const App = {
  components: { Icono, ModalHost, Avisos, PantallaBloqueo, MenuLateral, SelectorPersona, FranjaPersona },
  template: `
  <pantalla-bloqueo v-if="store.bloqueada" @desbloqueado="store.bloqueada = false"/>
  <p v-else-if="!store.listo" class="cargando">Cargando…</p>
  <div v-else class="marco" :class="{ 'con-menu-fijo': escritorio, 'menu-contraido': escritorio && prefs.menuContraido }">
    <aside v-if="escritorio" class="menu-fijo">
      <menu-lateral fijo :contraido="prefs.menuContraido" :ruta="vista.menu || ruta" @nuevo="nuevo" @contraer="alternarMenuContraido"/>
    </aside>

    <header class="cabecera">
      <div class="cab-dentro">
        <button type="button" class="btn-icono" :aria-label="escritorio ? (prefs.menuContraido ? 'Expandir menú' : 'Contraer menú') : 'Abrir menú'"
                :aria-expanded="escritorio ? !prefs.menuContraido : menuAbierto" @click="tocarMenu"><icono n="menu" :t="22"/></button>
        <template v-if="vista.porMes">
          <button type="button" class="btn-icono" aria-label="Mes anterior" @click="mover(-1)"><icono n="izq" :t="20"/></button>
          <div class="cab-titulos">
            <span class="cab-titulo">{{ nombrePeriodo(store.periodo) }}</span>
            <span class="cab-sub">{{ subtituloMes }}</span>
          </div>
          <button type="button" class="btn-icono" aria-label="Mes siguiente" @click="mover(1)"><icono n="der" :t="20"/></button>
          <button v-if="store.periodo !== actual" type="button" class="btn-hoy" @click="store.periodo = actual">Hoy</button>
        </template>
        <template v-else-if="vista.porAnio">
          <button type="button" class="btn-icono" aria-label="Año anterior" @click="moverAnio(-1)"><icono n="izq" :t="20"/></button>
          <div class="cab-titulos">
            <span class="cab-titulo">{{ store.anio }}</span>
            <span class="cab-sub">{{ vista.nombre.toLowerCase() }}</span>
          </div>
          <button type="button" class="btn-icono" aria-label="Año siguiente" :disabled="store.anio >= anioActual" @click="moverAnio(1)"><icono n="der" :t="20"/></button>
          <button v-if="store.anio !== anioActual" type="button" class="btn-hoy" @click="store.anio = anioActual">Este año</button>
        </template>
        <span v-else class="cab-titulo">{{ tituloVista }}</span>
        <span class="cab-espacio"></span>
        <a href="#/avisos" class="btn-persona campana" :class="{ activo: ruta === 'avisos' }" :aria-label="cuentaAvisos ? cuentaAvisos + ' avisos' : 'Avisos'">
          <icono n="campana" :t="17"/><span v-if="cuentaAvisos" class="insignia">{{ cuentaAvisos > 9 ? '9+' : cuentaAvisos }}</span>
        </a>
        <selector-persona v-if="listaPersonas.length"/>
        <button type="button" class="pill-sync con-texto" :class="sync.clase" :title="sync.detalle || sync.texto" :aria-label="sync.texto" @click="tocarSync">
          <icono :n="sync.icono" :t="15"/><span>{{ sync.texto }}</span>
        </button>
      </div>
    </header>

    <main class="contenido">
      <div v-if="store.actualizacion" class="aviso-banner" style="margin-bottom: 16px" role="status">
        <p>{{ store.actualizacion === 'esquema'
          ? 'Los datos se guardaron con una versión más nueva de la app. Actualiza para seguir sincronizando.'
          : 'Hay una versión nueva de la app.' }}</p>
        <button type="button" class="btn primario" @click="actualizar">Actualizar</button>
      </div>
      <div v-if="preguntarQuien" class="aviso-banner" style="margin-bottom: 16px">
        <p>¿Quién usa este dispositivo? Así cada registro queda firmado.</p>
        <button v-for="p in listaPersonas" :key="p.id" type="button" class="btn" @click="soyYo(p.id)">{{ p.nombre }}</button>
      </div>
      <franja-persona/>
      <component :is="vista.componente" :key="claveVista" v-bind="vista.conParametros ? { params: parametros } : {}"/>
    </main>

    <nav v-if="!escritorio" class="navbar" aria-label="Accesos rápidos">
      <div class="navbar-dentro">
        <template v-for="(n, i) in accesos" :key="i">
          <div v-if="!n" class="nav-fab">
            <button type="button" class="fab" aria-label="Registrar un gasto o ingreso" @click="nuevo"><icono n="mas" :t="26" :g="2"/></button>
          </div>
          <a v-else class="nav-item" :class="{ activo: ruta === n.id }" :href="'#/' + n.id" :aria-current="ruta === n.id ? 'page' : null">
            <icono :n="n.icono" :t="22" :g="1.7"/><span>{{ n.nombre }}</span>
          </a>
        </template>
        <button type="button" class="nav-item" :class="{ activo: !esAcceso }" :aria-expanded="menuAbierto" @click="menuAbierto = true">
          <icono n="menu" :t="22" :g="1.7"/><span>Menú</span>
        </button>
      </div>
    </nav>

    <dialog v-if="!escritorio" ref="dlgMenu" class="menu-panel" aria-label="Menú" @cancel.prevent="menuAbierto = false" @close="menuAbierto = false" @click="fueraDelMenu">
      <menu-lateral v-if="menuAbierto" :ruta="vista.menu || ruta" @cerrar="menuAbierto = false"/>
    </dialog>

    <modal-host/>
  </div>
  <avisos/>`,
  setup() {
    const ruta = ref(rutaActual());
    const parametros = ref(parametrosActuales());
    const menuAbierto = ref(false);
    const dlgMenu = ref(null);
    window.addEventListener('hashchange', () => {
      ruta.value = rutaActual();
      parametros.value = parametrosActuales();
      menuAbierto.value = false;
      window.scrollTo(0, 0);
    });

    const consultaEscritorio = matchMedia('(min-width: 1024px)');
    const escritorio = ref(consultaEscritorio.matches);
    consultaEscritorio.addEventListener('change', (e) => {
      escritorio.value = e.matches;
      menuAbierto.value = false;
    });

    watch(menuAbierto, async (abierto) => {
      await nextTick();
      const d = dlgMenu.value;
      if (!d) return;
      if (abierto && !d.open) d.showModal();
      if (!abierto && d.open) d.close();
    });
    const fueraDelMenu = (e) => {
      if (e.target === dlgMenu.value) menuAbierto.value = false;
    };
    const tocarMenu = () => {
      if (escritorio.value) alternarMenuContraido();
      else menuAbierto.value = true;
    };

    const vista = computed(() => VISTAS.find((v) => v.id === ruta.value));
    const tituloVista = computed(() => vista.value.titulo?.(parametros.value) || vista.value.nombre);
    // Una vista con parámetros se vuelve a crear solo si cambia el primero (por ejemplo, otra tarjeta).
    const claveVista = computed(() => (vista.value.conParametros ? `${vista.value.id}/${parametros.value[0] || ''}` : vista.value.id));
    const esAcceso = computed(() => ACCESOS.some((a) => a?.id === ruta.value));
    const listaPersonas = computed(personas);
    const cuentaAvisos = computed(() => avisos().length);
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
      if (!s.ubicacion) location.hash = '#/datos';
      else if (s.estado === 'sesion') od.iniciarSesion({ silenciosa: true });
      else {
        if (s.estado === 'error') aviso(s.mensaje, 'error', 8000);
        sincronizar();
      }
    }

    // Con PIN: al salir de la app se tapa el contenido (para que no se vea en el selector de
    // apps) y al volver se bloquea si pasó el tiempo elegido.
    let ocultoDesde = null;
    document.addEventListener('visibilitychange', () => {
      const raiz = document.documentElement;
      if (!pinActivo()) {
        raiz.classList.remove('privado');
        return;
      }
      if (document.visibilityState === 'hidden') {
        ocultoDesde = Date.now();
        raiz.classList.add('privado');
        return;
      }
      if (debeBloquear(ocultoDesde, Date.now(), minutosBloqueo())) {
        store.bloqueada = true;
        menuAbierto.value = false;
      }
      ocultoDesde = null;
      raiz.classList.remove('privado');
    });

    return {
      store, prefs, vista, tituloVista, claveVista, parametros, ruta, accesos: ACCESOS, esAcceso, escritorio, menuAbierto, dlgMenu, fueraDelMenu, tocarMenu, alternarMenuContraido,
      listaPersonas, cuentaAvisos, preguntarQuien, actual, subtituloMes, sync, tocarSync, soyYo, nombrePeriodo,
      actualizar: () => location.reload(),
      mover: (n) => { store.periodo = sumarMeses(store.periodo, n); },
      anioActual: actual.slice(0, 4),
      moverAnio: (n) => { store.anio = String(Math.min(Number(actual.slice(0, 4)), Number(store.anio) + n)); },
      nuevo: () => nuevoMovimiento({ fecha: store.periodo === actual ? undefined : `${store.periodo}-01` }),
    };
  },
};

createApp(App).mount('#app');
iniciar().then(iniciarRecordatorios);
