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
  <section class="pila">
    <article class="tarjeta">
      <h2>Quién usa este dispositivo</h2>
      <p class="nota" style="margin: 3px 0 12px">Tus registros quedan firmados con este nombre.</p>
      <div class="opciones">
        <button v-for="p in listaPersonas" :key="p.id" type="button" class="opcion" :class="{ activa: store.yo === p.id }" :aria-pressed="store.yo === p.id" @click="elegirYo(p.id)">{{ p.nombre }}</button>
      </div>
      <ul class="lista" style="margin-top: 16px">
        <li v-for="p in listaPersonas" :key="p.id" class="fila clic" @click="editarPersona(p)">
          <span class="avatar">{{ p.nombre.slice(0, 1).toUpperCase() }}</span>
          <div class="fila-info">
            <span style="font-size: 0.93rem">{{ p.nombre }}</span>
            <span class="fila-sub">{{ p.email || 'sin correo de Microsoft' }}</span>
          </div>
        </li>
      </ul>
      <p v-if="store.usuario" class="nota chica" style="margin-top: 8px">Cuenta de Microsoft en este dispositivo: {{ store.usuario.nombre }} ({{ store.usuario.email }})</p>
      <button type="button" class="btn-punteado" style="margin-top: 14px" @click="editarPersona()">+ Agregar persona</button>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>OneDrive</h2>
        <span class="chip" :class="chipEstado.clase">{{ chipEstado.texto }}</span>
      </div>

      <template v-if="!configurado">
        <p class="nota">Para que ambos vean los mismos datos, registra la app en Azure (paso 4 de la guía de despliegue) y pega aquí el
          ID de aplicación (cliente). La URI de redirección de tipo SPA debe ser exactamente:</p>
        <p style="margin: 10px 0"><code>{{ retorno }}</code></p>
        <label class="campo"><span>ID de aplicación</span><input v-model.trim="idApp" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <div class="botones"><button type="button" class="btn primario" :disabled="!idApp" @click="guardarId">Guardar</button></div>
      </template>

      <template v-else-if="!store.usuario">
        <p class="nota">Conecta tu cuenta de Microsoft para guardar los datos en OneDrive y compartirlos con el hogar.</p>
        <div class="botones"><button type="button" class="btn primario" :disabled="ocupado" @click="conectar">Conectar con Microsoft</button></div>
      </template>

      <template v-else-if="!store.sync.ubicacion">
        <p class="nota">Conectado como {{ store.usuario.nombre }}. ¿De dónde salen los datos?</p>
        <h3 style="margin-top: 14px">Soy quien guarda el archivo</h3>
        <p class="nota" style="margin-top: 4px">Se usa (o se crea) <code>{{ rutaArchivo }}</code> en tu OneDrive, con los datos de este dispositivo.</p>
        <div class="botones"><button type="button" class="btn primario" :disabled="ocupado" @click="usarMio">Usar mi OneDrive</button></div>
        <h3 style="margin-top: 18px">Me compartieron el archivo</h3>
        <label class="campo" style="margin-top: 8px"><span>Enlace de la carpeta {{ carpeta }} que te compartieron</span>
          <input v-model.trim="enlace" type="url" placeholder="https://1drv.ms/…"></label>
        <div class="botones"><button type="button" class="btn" :disabled="ocupado || !enlace" @click="usarCompartido">Abrir archivo compartido</button></div>
      </template>

      <template v-else>
        <dl class="datos sin-linea">
          <dt>Archivo</dt><dd>{{ carpeta }}/{{ store.sync.ubicacion.nombre }}</dd>
          <dt>Dueño</dt><dd>{{ store.sync.ubicacion.propio ? 'tu OneDrive' : (store.sync.ubicacion.dueno || 'otra persona') }}</dd>
          <dt>Última sincronización</dt><dd>{{ store.sync.ultima ? fechaHora.format(new Date(store.sync.ultima)) : '—' }}</dd>
        </dl>
        <p v-if="store.sync.mensaje" class="error" style="margin-top: 10px">{{ store.sync.mensaje }}</p>
        <div class="botones">
          <button type="button" class="btn" :disabled="store.sync.estado === 'sincronizando'" @click="sincronizarAhora">Sincronizar ahora</button>
          <button v-if="store.sync.estado === 'sesion'" type="button" class="btn primario" @click="conectar">Reconectar</button>
          <button type="button" class="btn peligro" @click="salir">Desconectar</button>
        </div>
        <p v-if="store.sync.ubicacion.propio" class="nota" style="margin-top: 12px">Para que otra persona lo use: comparte la carpeta {{ carpeta }} con su correo,
          con permiso para editar, y mándale el enlace. Esa persona abre esta app, conecta su cuenta y pega el enlace.</p>
      </template>
    </article>

    <article class="tarjeta">
      <h2 style="margin-bottom: 12px">Datos</h2>
      <div class="botones" style="margin-top: 0">
        <button type="button" class="btn" @click="respaldo">Descargar respaldo (JSON)</button>
        <label class="btn">Importar archivo<input type="file" accept=".json,application/json" class="oculto-visual" @change="importarArchivo"></label>
      </div>
      <p class="nota" style="margin-top: 12px">Importar combina el archivo con lo que ya hay: no borra nada. Los movimientos se exportan a CSV desde su pestaña.</p>
      <div class="fila-campos" style="margin-top: 14px">
        <label class="campo"><span>Símbolo de moneda</span><input :value="store.doc.config.moneda" maxlength="4" @change="guardarConfig({ moneda: $event.target.value.trim() || 'L' })"></label>
        <label class="campo"><span>Mes de inicio del registro</span><input :value="store.doc.config.inicio" type="month" @change="$event.target.value && guardarConfig({ inicio: $event.target.value })"></label>
      </div>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>Categorías</h2>
        <button type="button" class="btn-link" @click="editarCategoria()">+ Agregar</button>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px">
        <button v-for="c in listaCategorias" :key="c.id" type="button" class="chip clic" style="border: 0" @click="editarCategoria(c)">{{ c.nombre }}</button>
      </div>
    </article>

    <article class="tarjeta">
      <h2>Este navegador</h2>
      <p class="nota" style="margin: 3px 0 14px">Borra los datos guardados aquí y cierra la sesión de Microsoft. Lo que está en OneDrive no se toca.</p>
      <button type="button" class="btn peligro" @click="borrarTodo">Borrar datos de este navegador</button>
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
    const chipEstado = computed(() => {
      if (!configurado.value) return { texto: 'Sin configurar', clase: '' };
      if (!store.sync.ubicacion) return { texto: store.usuario ? 'Sin archivo' : 'Sin conectar', clase: '' };
      return ({
        ok: { texto: 'Sincronizado', clase: 'ok' }, sincronizando: { texto: 'Sincronizando…', clase: 'acento' },
        pendiente: { texto: 'Cambios por subir', clase: 'aviso' }, offline: { texto: 'Sin conexión', clase: 'aviso' },
        sesion: { texto: 'Sesión vencida', clase: 'aviso' }, error: { texto: 'Error', clase: 'aviso' },
      })[store.sync.estado] || { texto: 'Conectado', clase: 'ok' };
    });

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
      store, ocupado, enlace, idApp, configurado, chipEstado, fechaHora, importarArchivo, guardarConfig, editarPersona, editarCategoria,
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
