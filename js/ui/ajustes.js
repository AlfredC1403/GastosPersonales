import {
  store, aviso, personas, categorias, soyYo, definirYo, guardarConfig, importar, exportar, borrarDatosLocales,
  usarMiOneDrive, usarEnlace, sincronizar, desconectar,
} from '../store.js';
import { hoy } from '../core/util.js';
import { esPristino } from '../core/modelo.js';
import * as od from '../onedrive.js';
import { CONFIG } from '../config.js';
import { descargar } from './componentes.js';
import { editarPersona, editarCategoria } from './formularios.js';

const { ref, computed } = Vue;
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

export const VistaAjustes = {
  template: `
  <section class="tarjetas">
    <article class="tarjeta">
      <header><h2>Quién usa este dispositivo</h2></header>
      <label class="campo"><span>Tus registros quedan firmados con este nombre</span>
        <select :value="store.yo || ''" @change="elegirYo($event.target.value)">
          <option value="" disabled>Elige…</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option>
        </select></label>
      <p v-if="store.usuario" class="nota">Cuenta Microsoft: {{ store.usuario.nombre }} ({{ store.usuario.email }})</p>
      <h3 style="margin-top: 16px">Personas del hogar</h3>
      <ul class="lista">
        <li v-for="p in listaPersonas" :key="p.id" class="clic" @click="editarPersona(p)">
          <div class="info"><span class="titulo">{{ p.nombre }}</span><span class="sub">{{ p.email || 'sin correo de Microsoft' }}</span></div>
        </li>
      </ul>
      <div class="botones"><button type="button" class="btn chico" @click="editarPersona()">+ Agregar persona</button></div>
    </article>

    <article class="tarjeta">
      <header><h2>OneDrive</h2></header>
      <template v-if="!configurado">
        <p class="nota">Para que ambos vean los mismos datos, registra la app en Azure (paso 2 del README) y pega aquí el
          <strong>ID de aplicación (cliente)</strong>. En Azure, la URI de redirección de tipo SPA debe ser exactamente:</p>
        <p><code>{{ retorno }}</code></p>
        <div class="fila-campos">
          <label class="campo"><span>ID de aplicación</span><input v-model.trim="idApp" placeholder="00000000-0000-0000-0000-000000000000"></label>
        </div>
        <div class="botones"><button type="button" class="btn primario" :disabled="!idApp" @click="guardarId">Guardar</button></div>
      </template>

      <template v-else-if="!store.usuario">
        <p class="nota">Conecta tu cuenta de Microsoft para guardar los datos en OneDrive y compartirlos con el hogar.</p>
        <div class="botones"><button type="button" class="btn primario" :disabled="ocupado" @click="conectar">Conectar con Microsoft</button></div>
      </template>

      <template v-else-if="!store.sync.ubicacion">
        <p class="nota">Conectado como {{ store.usuario.nombre }}. ¿De dónde salen los datos?</p>
        <h3>Soy quien guarda el archivo</h3>
        <p class="nota">Se usa (o se crea) <code>{{ rutaArchivo }}</code> en tu OneDrive, con los datos de este dispositivo.</p>
        <div class="botones"><button type="button" class="btn primario" :disabled="ocupado" @click="usarMio">Usar mi OneDrive</button></div>
        <h3 style="margin-top: 18px">Me compartieron el archivo</h3>
        <label class="campo"><span>Enlace de la carpeta {{ carpeta }} que te compartieron</span>
          <input v-model.trim="enlace" type="url" placeholder="https://1drv.ms/…"></label>
        <div class="botones"><button type="button" class="btn" :disabled="ocupado || !enlace" @click="usarCompartido">Abrir archivo compartido</button></div>
      </template>

      <template v-else>
        <p><span class="chip" :class="store.sync.estado === 'error' ? 'aviso' : 'ok'">{{ textoEstado }}</span></p>
        <p class="nota">Archivo: {{ store.sync.ubicacion.nombre }} en {{ store.sync.ubicacion.propio ? 'tu OneDrive' : 'el OneDrive de ' + (store.sync.ubicacion.dueno || 'otra persona') }}.
          <template v-if="store.sync.ultima"> Última sincronización: {{ fechaHora.format(new Date(store.sync.ultima)) }}.</template></p>
        <p v-if="store.sync.mensaje" class="error">{{ store.sync.mensaje }}</p>
        <div class="botones">
          <button type="button" class="btn" :disabled="store.sync.estado === 'sincronizando'" @click="sincronizarAhora">Sincronizar ahora</button>
          <button v-if="store.sync.estado === 'sesion'" type="button" class="btn primario" @click="conectar">Reconectar</button>
          <button type="button" class="btn peligro" @click="salir">Desconectar</button>
        </div>
        <p v-if="store.sync.ubicacion.propio" class="nota">Para que otra persona lo use: en OneDrive, comparte la carpeta <strong>{{ carpeta }}</strong> con su correo
          (con permiso para editar) y mándale el enlace. Esa persona abre esta app, conecta su cuenta y pega el enlace.</p>
      </template>
    </article>

    <article class="tarjeta">
      <header><h2>Datos</h2></header>
      <div class="botones" style="margin-top: 0">
        <button type="button" class="btn" @click="respaldo">Descargar respaldo (JSON)</button>
        <label class="btn">Importar archivo<input type="file" accept=".json,application/json" class="oculto-visual" @change="importarArchivo"></label>
      </div>
      <p class="nota">Importar combina el archivo con lo que ya hay: no borra nada. Los movimientos se exportan a CSV desde su pestaña.</p>
      <div class="fila-campos" style="margin-top: 8px">
        <label class="campo"><span>Símbolo de moneda</span><input :value="store.doc.config.moneda" maxlength="4" @change="guardarConfig({ moneda: $event.target.value.trim() || 'L' })"></label>
        <label class="campo"><span>Mes de inicio del registro</span><input :value="store.doc.config.inicio" type="month" @change="$event.target.value && guardarConfig({ inicio: $event.target.value })"></label>
      </div>
    </article>

    <article class="tarjeta">
      <header><h2>Categorías</h2><button type="button" class="btn chico" @click="editarCategoria()">+ Agregar</button></header>
      <p class="nota" style="margin-top: 0">
        <template v-for="(c, i) in listaCategorias" :key="c.id"><a href="#" @click.prevent="editarCategoria(c)">{{ c.nombre }}</a>{{ i < listaCategorias.length - 1 ? ' · ' : '' }}</template>
      </p>
    </article>

    <article class="tarjeta">
      <header><h2>Este navegador</h2></header>
      <p class="nota" style="margin-top: 0">Borra los datos guardados en este navegador y cierra la sesión de Microsoft. Lo que está en OneDrive no se toca.</p>
      <div class="botones"><button type="button" class="btn peligro" @click="borrarTodo">Borrar datos de este navegador</button></div>
    </article>
  </section>`,
  setup() {
    const ocupado = ref(false);
    const enlace = ref('');
    const idApp = ref(od.clientId());
    const configurado = ref(od.configurado());

    async function ejecutar(fn) {
      ocupado.value = true;
      try {
        await fn();
      } catch (e) {
        aviso(e.message, 'error', 9000);
      } finally {
        ocupado.value = false;
      }
    }
    const textoEstado = computed(() => ({
      ok: 'Sincronizado', sincronizando: 'Sincronizando…', pendiente: 'Cambios por subir', offline: 'Sin conexión',
      sesion: 'La sesión venció', error: 'Error al sincronizar',
    })[store.sync.estado] || 'Conectado');

    function importarArchivo(ev) {
      const archivo = ev.target.files[0];
      if (!archivo) return;
      const lector = new FileReader();
      lector.onload = () => {
        try {
          importar(lector.result);
          aviso('Datos importados.', 'ok');
        } catch (e) {
          aviso(e.message, 'error', 8000);
        }
        ev.target.value = '';
      };
      lector.readAsText(archivo);
    }

    return {
      store, ocupado, enlace, idApp, configurado, textoEstado, fechaHora, importarArchivo, guardarConfig, editarPersona, editarCategoria,
      carpeta: CONFIG.carpeta, rutaArchivo: `${CONFIG.carpeta}/${CONFIG.archivo}`, retorno: od.direccionRetorno(),
      listaPersonas: computed(personas), listaCategorias: computed(categorias),
      elegirYo: (id) => (store.usuario ? soyYo(id) : definirYo(id)),
      guardarId: () => {
        od.guardarClientId(idApp.value);
        configurado.value = od.configurado();
        aviso('ID guardado en este dispositivo. Para publicarlo, ponlo también en js/config.js.', 'ok', 6000);
      },
      conectar: () => ejecutar(() => od.iniciarSesion()),
      usarMio: () => {
        if (esPristino(store.doc) && !confirm('Este dispositivo no tiene datos. Si otra persona ya tiene el archivo, usa mejor su enlace compartido. ¿Usar tu OneDrive igual?')) return;
        ejecutar(usarMiOneDrive);
      },
      usarCompartido: () => ejecutar(() => usarEnlace(enlace.value)),
      sincronizarAhora: () => ejecutar(sincronizar),
      salir: () => confirm('¿Desconectar OneDrive en este dispositivo? Los datos siguen en OneDrive.') && desconectar(),
      respaldo: () => descargar(`gastos-respaldo-${hoy()}.json`, exportar(), 'application/json'),
      borrarTodo: () => confirm('¿Borrar los datos de ESTE navegador? Lo que está en OneDrive no se toca.') && borrarDatosLocales(),
    };
  },
};
