import {
  store, iniciar, sincronizar, soyYo, aviso, confirmar, personas, buscar, vivos, avisos, anioCargado, aniosDeLaCarpeta, abrirAnio, editarAnio,
  cerrarAniosAbiertos, abrirModal,
} from './store.js';
import { nombrePeriodo, sumarMeses, periodoActual, hoy, periodoDe } from './core/util.js';
import { estadoVisible } from './sincronizacion.js';
import * as od from './onedrive.js';
import { prefs, alternarMenuContraido } from './tema.js';
import { pinActivo, minutosBloqueo, debeBloquear } from './bloqueo.js';
import { Icono, ModalHost, Avisos, ConfirmHost, SelectorPersona, FranjaPersona } from './ui/componentes.js';
import { PantallaBloqueo } from './ui/bloqueo.js';
import { MenuLateral } from './ui/menu.js';
import { nuevoMovimiento, abrirRegistro } from './ui/formularios.js';
import { VistaInicio } from './ui/inicio.js';
import { VistaMes } from './ui/mes.js';
import { VistaMovimientos } from './ui/movimientos.js';
import { VistaAvisos } from './ui/avisos.js';
import { iniciarRecordatorios } from './recordatorios.js';
import { guardarAgenda, avisarAlAbrir } from './notificaciones.js';

const { createApp, ref, computed, watch, nextTick, markRaw, defineAsyncComponent } = Vue;

// Vistas que se traen al entrar en ellas. Inicio, Mes y Movimientos van en la carga inicial (son
// las de la barra de abajo); las demás dejan fuera 19 archivos y unos 170 KB que no hacen falta
// para abrir la app. Después se precargan solas (ver precargarVistas) y el service worker las
// guarda, así que sin conexión se siguen abriendo igual que antes.
const Cargando = { template: '<p class="cargando">Cargando…</p>' };
const NoCargo = { template: '<p class="vacio">No se pudo cargar esta pantalla. Revisa tu conexión y vuelve a intentar.</p>' };

const cargadores = [];

const aDemanda = (cargar, nombre) => {
  cargadores.push(cargar);
  return defineAsyncComponent({
    loader: () => cargar().then((m) => m[nombre]),
    loadingComponent: Cargando,
    errorComponent: NoCargo,
    delay: 150, // sin parpadeo cuando el archivo ya está en caché
    timeout: 20000,
  });
};

// Cuando el navegador queda ocioso se traen las pantallas que faltan. Así la app abre rápido y, a
// los pocos segundos, todas quedan en la caché del service worker y se pueden abrir sin conexión
// (que es como funcionaba antes, cuando todo se cargaba de una).
function precargarVistas() {
  const cuandoPueda = window.requestIdleCallback || ((fn) => setTimeout(fn, 3000));
  cuandoPueda(() => {
    for (const cargar of cargadores) cargar().catch(() => {}); // sin conexión se reintenta al entrar
  });
}

const VISTAS = [
  { id: 'inicio', nombre: 'Inicio', componente: VistaInicio, porMes: true },
  { id: 'mes', nombre: 'Mes', componente: VistaMes, porMes: true },
  { id: 'movimientos', nombre: 'Movimientos', componente: VistaMovimientos, porMes: true },
  { id: 'avisos', nombre: 'Avisos', componente: VistaAvisos },
  { id: 'rapido', nombre: 'Registro rápido', componente: aDemanda(() => import('./ui/rapido.js'), 'VistaRapido') },
  { id: 'salarios', nombre: 'Salarios y deducciones', componente: aDemanda(() => import('./ui/salarios.js'), 'VistaSalarios') },
  { id: 'cuentas', nombre: 'Cuentas', componente: aDemanda(() => import('./ui/cuentas.js'), 'VistaCuentas') },
  { id: 'tarjetas', nombre: 'Tarjetas', componente: aDemanda(() => import('./ui/tarjetas.js'), 'VistaTarjetas') },
  // #/tarjeta/<id>/<corte>: el estado de cuenta de una tarjeta; en el menú se marca Tarjetas.
  { id: 'tarjeta', nombre: 'Tarjeta', componente: aDemanda(() => import('./ui/tarjetas.js'), 'VistaTarjeta'), conParametros: true, menu: 'tarjetas', titulo: ([id]) => buscar('cuentas', id)?.nombre },
  { id: 'financiamientos', nombre: 'Financiamientos', componente: aDemanda(() => import('./ui/financiamientos.js'), 'VistaFinanciamientos') },
  { id: 'prestamos', nombre: 'Préstamos', componente: aDemanda(() => import('./ui/prestamos.js'), 'VistaPrestamos') },
  { id: 'presupuesto', nombre: 'Presupuesto', componente: aDemanda(() => import('./ui/presupuesto.js'), 'VistaPresupuesto') },
  { id: 'topes', nombre: 'Topes', componente: aDemanda(() => import('./ui/topes.js'), 'VistaTopes'), porMes: true },
  { id: 'renovaciones', nombre: 'Renovaciones', componente: aDemanda(() => import('./ui/renovaciones.js'), 'VistaRenovaciones') },
  { id: 'proyeccion', nombre: 'Proyección', componente: aDemanda(() => import('./ui/proyeccion.js'), 'VistaProyeccion') },
  { id: 'suscripciones', nombre: 'Suscripciones', componente: aDemanda(() => import('./ui/suscripciones.js'), 'VistaSuscripciones') },
  { id: 'plan-deudas', nombre: 'Plan de deudas', componente: aDemanda(() => import('./ui/prestamos.js'), 'VistaPlanDeudas') },
  { id: 'metas', nombre: 'Metas', componente: aDemanda(() => import('./ui/metas.js'), 'VistaMetas') },
  { id: 'reparto', nombre: 'Reparto de gastos', componente: aDemanda(() => import('./ui/reparto.js'), 'VistaReparto') },
  { id: 'resumen', nombre: 'Resumen anual', componente: aDemanda(() => import('./ui/resumen.js'), 'VistaResumen'), porAnio: true },
  // #/comparar/<año>/<año>
  { id: 'comparar', nombre: 'Comparar años', componente: aDemanda(() => import('./ui/comparar.js'), 'VistaComparar'), conParametros: true },
  { id: 'anios', nombre: 'Años anteriores', componente: aDemanda(() => import('./ui/anios.js'), 'VistaAnios') },
  { id: 'personas', nombre: 'Personas', componente: aDemanda(() => import('./ui/personas.js'), 'VistaPersonas') },
  { id: 'recordatorios', nombre: 'Recordatorios', componente: aDemanda(() => import('./ui/recordatorios.js'), 'VistaRecordatorios') },
  { id: 'categorias', nombre: 'Categorías y grupos', componente: aDemanda(() => import('./ui/categorias.js'), 'VistaCategorias') },
  { id: 'comercios', nombre: 'Comercios', componente: aDemanda(() => import('./ui/comercios.js'), 'VistaComercios') },
  { id: 'configurar', nombre: 'Revisar configuración', componente: aDemanda(() => import('./ui/configurar.js'), 'VistaConfigurar') },
  { id: 'seguridad', nombre: 'Seguridad', componente: aDemanda(() => import('./ui/seguridad.js'), 'VistaSeguridad') },
  { id: 'datos', nombre: 'Datos y OneDrive', componente: aDemanda(() => import('./ui/datos.js'), 'VistaDatos') },
  { id: 'papelera', nombre: 'Papelera', componente: aDemanda(() => import('./ui/papelera.js'), 'VistaPapelera') },
  { id: 'apariencia', nombre: 'Apariencia', componente: aDemanda(() => import('./ui/apariencia.js'), 'VistaApariencia') },
].map((v) => ({ ...v, componente: markRaw(v.componente) }));

// Pastilla de la cabecera para cada estado de la sincronización (ver estadoVisible).
const PASTILLAS_SYNC = {
  local: { texto: 'Solo este dispositivo', icono: 'nubeNo', clase: '' },
  sincronizando: { texto: 'Sincronizando', icono: 'sync', clase: 'ok girando' },
  error: { texto: 'Error al sincronizar', icono: 'nubeNo', clase: 'mal' },
  sesion: { texto: 'Reconectar', icono: 'nubeNo', clase: 'aviso' },
  offline: { texto: 'Sin conexión', icono: 'nubeNo', clase: 'aviso' },
  pendiente: { texto: 'Por subir', icono: 'nube', clase: 'aviso' },
  ok: { texto: 'Sincronizado', icono: 'nube', clase: 'ok' },
};

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

// '#/registrar[/tipo/id/fecha]' no es una pantalla: abre el formulario que toca (el enlace de un
// recordatorio de Outlook, o el acceso directo del icono) y deja la app donde corresponda.
// Se resuelve antes de pintar la ruta, y sustituye la entrada del historial para que el botón
// «atrás» no vuelva a abrir el formulario.
function atenderRegistro() {
  const [primero, ...resto] = partesRuta();
  if (primero !== 'registrar') return false;
  // Con datos de otro mes, primero se cambia de mes: el formulario se abre sobre el mes correcto.
  const fecha = resto[2];
  if (fecha) store.periodo = periodoDe(fecha);
  const destino = abrirRegistro(resto) || '#/inicio';
  history.replaceState(null, '', destino);
  // replaceState no dispara hashchange: se avisa para que la pantalla siga a la dirección nueva.
  // No se repite, porque la dirección ya no empieza por 'registrar'.
  window.dispatchEvent(new Event('hashchange'));
  return true;
}

const rutaActual = () => {
  const id = partesRuta()[0];
  if (REDIRECCIONES[id]) {
    history.replaceState(null, '', `#/${REDIRECCIONES[id]}`);
    return REDIRECCIONES[id];
  }
  return VISTAS.some((v) => v.id === id) ? id : 'inicio';
};

const App = {
  components: { Icono, ModalHost, Avisos, ConfirmHost, PantallaBloqueo, MenuLateral, SelectorPersona, FranjaPersona },
  template: `
  <pantalla-bloqueo v-if="store.bloqueada" @desbloqueado="store.bloqueada = false"/>
  <p v-else-if="!store.listo" class="cargando">Cargando…</p>
  <div v-else class="marco" :class="{ 'con-menu-fijo': escritorio, 'menu-contraido': escritorio && prefs.menuContraido }">
    <aside v-if="escritorio" class="menu-fijo">
      <menu-lateral fijo :contraido="prefs.menuContraido" :ruta="vista.menu || ruta" :sin-nuevo="store.soloLectura" @nuevo="nuevo" @contraer="alternarMenuContraido"/>
    </aside>

    <header class="cabecera">
      <div class="cab-dentro">
        <button type="button" class="btn-icono" :aria-label="escritorio ? (prefs.menuContraido ? 'Expandir menú' : 'Contraer menú') : 'Abrir menú'"
                :aria-expanded="escritorio ? !prefs.menuContraido : menuAbierto" @click="tocarMenu"><icono n="menu" :t="22"/></button>
        <template v-if="vista.porMes">
          <button type="button" class="btn-icono" aria-label="Mes anterior" @click="mover(-1)"><icono n="izq" :t="20"/></button>
          <div class="cab-titulos">
            <!-- Mes corto: «septiembre 2027» no cabe en la cabecera del teléfono y se comía el año. -->
            <span class="cab-titulo">{{ nombrePeriodo(store.periodo, true) }}</span>
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
        <button type="button" class="btn-icono" aria-label="Buscar en todo" title="Buscar (/)" @click="abrirBuscador"><icono n="lupa" :t="18"/></button>
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
          ? 'Los datos se guardaron con una versión más nueva de la app. Hasta que actualices no se puede registrar ni cambiar nada, para no pisarlos.'
          : 'Hay una versión nueva de la app.' }}</p>
        <button type="button" class="btn primario" @click="actualizar">Actualizar</button>
      </div>
      <div v-if="anioAbierto" class="aviso-banner ambar" style="margin-bottom: 16px" role="status">
        <p>{{ editandoAnio ? 'Editando ' + anioAbierto + ': los saldos de los años siguientes se recalculan.' : 'Estás viendo ' + anioAbierto + '.' }}{{ store.anios.cargando ? ' Bajando de OneDrive…' : '' }}</p>
        <button v-if="!editandoAnio" type="button" class="btn" @click="editarEsteAnio">Editar este año</button>
        <button type="button" class="btn primario" @click="volverAHoy">Volver a hoy</button>
      </div>
      <div v-else-if="anioNoCargado" class="aviso-banner" style="margin-bottom: 16px" role="status">
        <p>{{ anioNoCargado }} está en OneDrive, no en este dispositivo{{ vista.porAnio ? ': se ve su resumen guardado.' : '.' }}</p>
        <button type="button" class="btn primario" :disabled="!!store.anios.cargando" @click="abrirAqui(anioNoCargado)">{{ store.anios.cargando ? 'Bajando…' : 'Abrir ' + anioNoCargado }}</button>
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
            <button type="button" class="fab" :disabled="store.soloLectura"
                    :aria-label="store.soloLectura ? 'No se puede registrar: actualiza la app' : 'Registrar un gasto o ingreso'"
                    @click="nuevo"><icono n="mas" :t="26" :g="2"/></button>
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
  <confirm-host/>
  <avisos/>`,
  setup() {
    const ruta = ref(rutaActual());
    const parametros = ref(parametrosActuales());
    const menuAbierto = ref(false);
    const dlgMenu = ref(null);
    window.addEventListener('hashchange', () => {
      if (atenderRegistro()) return; // ya redirigió y volvió a avisar con la dirección nueva
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

    // Años anteriores: el abierto en modo lectura (o edición) y el de la pantalla, si no está en el dispositivo.
    const anioAbierto = computed(() => store.anios.abiertos[0] || '');
    const editandoAnio = computed(() => store.anios.editar.includes(anioAbierto.value));
    const anioNoCargado = computed(() => {
      if (!store.sync.ubicacion) return '';
      const anio = vista.value.porMes ? store.periodo.slice(0, 4) : vista.value.porAnio ? store.anio : '';
      return anio && !anioCargado(anio) && aniosDeLaCarpeta().includes(anio) ? anio : '';
    });
    async function editarEsteAnio() {
      const ok = await confirmar(`Lo que cambies en ${anioAbierto.value} cambia los saldos de los años siguientes.`,
        { titulo: `¿Editar ${anioAbierto.value}?`, aceptar: 'Editar' });
      if (ok) editarAnio(anioAbierto.value);
    }
    // Abre el año de la pantalla sin cambiar de pantalla ni de mes.
    const abrirAqui = (anio) => abrirAnio(anio).catch((e) => aviso(e.message, 'error', 7000));
    function volverAHoy() {
      cerrarAniosAbiertos();
      store.periodo = actual;
      store.anio = actual.slice(0, 4);
    }

    const sync = computed(() => {
      const s = store.sync;
      const pastilla = { ...PASTILLAS_SYNC[estadoVisible(s)] };
      if (pastilla.clase === 'mal') pastilla.detalle = s.mensaje;
      return pastilla;
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

    // El buscador se trae cuando se abre: no hace falta para arrancar la app.
    function abrirBuscador() {
      import('./ui/buscador.js')
        .then((m) => abrirModal('Buscar', m.Buscador))
        .catch(() => aviso('No se pudo abrir el buscador. Revisa tu conexión.', 'error'));
    }
    // "/" en cualquier parte, y Ctrl/⌘+K en la computadora. Se ignora si se está escribiendo.
    document.addEventListener('keydown', (e) => {
      if (store.bloqueada || store.modal) return;
      const en = e.target?.tagName;
      if (en === 'INPUT' || en === 'TEXTAREA' || en === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        abrirBuscador();
      } else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        abrirBuscador();
      }
    });

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
      anioAbierto, editandoAnio, anioNoCargado, editarEsteAnio, volverAHoy, abrirAqui, abrirBuscador,
      actualizar: () => location.reload(),
      mover: (n) => { store.periodo = sumarMeses(store.periodo, n); },
      anioActual: actual.slice(0, 4),
      moverAnio: (n) => { store.anio = String(Math.min(Number(actual.slice(0, 4)), Number(store.anio) + n)); },
      nuevo: () => nuevoMovimiento({ fecha: store.periodo === actual ? undefined : `${store.periodo}-01` }),
    };
  },
};

// La agenda que lee sw.js para avisar: se rehace al abrir, al cambiar el día y unos segundos
// después de cada edición (registrar un pago quita lo que ya no hay que recordar).
let esperaAgenda = null;
function refrescarAgenda() {
  clearTimeout(esperaAgenda);
  esperaAgenda = setTimeout(() => guardarAgenda(), 4000);
}

createApp(App).mount('#app');
// Con los datos ya cargados se puede resolver '#/registrar/...' de la dirección con la que se abrió.
iniciar().then(() => {
  atenderRegistro();
  guardarAgenda();
  avisarAlAbrir();
  watch(() => [store.hoy, store.rev], refrescarAgenda);
  return iniciarRecordatorios();
});
precargarVistas();
