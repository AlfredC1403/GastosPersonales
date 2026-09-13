import {
  store, aviso, guardarConfig, importar, exportar, borrarDatosLocales, usarMiOneDrive, usarEnlace, sincronizar, desconectar, infoAlmacen,
  respaldarAhora, listarRespaldos,
} from '../store.js';
import { hoy } from '../core/util.js';
import { esPristino } from '../core/modelo.js';
import { claveDeNombre, PRINCIPAL } from '../core/anios.js';
import * as od from '../onedrive.js';
import { CONFIG } from '../config.js';
import { descargar } from './componentes.js';

const { ref, computed, onMounted } = Vue;
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function tamano(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const VistaDatos = {
  template: `
  <section class="pila">
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
        <h3 style="margin-top: 14px">Soy quien guarda los datos</h3>
        <p class="nota" style="margin-top: 4px">Se usa (o se crea) la carpeta <code>{{ carpeta }}</code> en tu OneDrive, con los datos de este dispositivo.</p>
        <div class="botones"><button type="button" class="btn primario" :disabled="ocupado" @click="usarMio">Usar mi OneDrive</button></div>
        <h3 style="margin-top: 18px">Me compartieron la carpeta</h3>
        <label class="campo" style="margin-top: 8px"><span>Enlace de la carpeta {{ carpeta }} (no el del archivo)</span>
          <input v-model.trim="enlace" type="url" placeholder="https://1drv.ms/…"></label>
        <div class="botones"><button type="button" class="btn" :disabled="ocupado || !enlace" @click="usarCompartido">Abrir carpeta compartida</button></div>
      </template>

      <template v-else>
        <dl class="datos sin-linea">
          <dt>Carpeta</dt><dd>{{ carpeta }}</dd>
          <dt>Dueño</dt><dd>{{ store.sync.ubicacion.propio ? 'tu OneDrive' : (store.sync.ubicacion.dueno || 'otra persona') }}</dd>
          <dt>Última sincronización</dt><dd>{{ store.sync.ultima ? fechaHora.format(new Date(store.sync.ultima)) : '—' }}</dd>
        </dl>
        <p v-if="store.sync.mensaje" class="error" style="margin-top: 10px">{{ store.sync.mensaje }}</p>
        <div v-if="store.sync.codigo === 'sin_carpeta'" class="caja-ambar">
          Esta conexión se hizo con el enlace de un archivo. Desconecta y vuelve a conectar con el enlace de la carpeta {{ carpeta }}.
        </div>
        <div class="botones">
          <button type="button" class="btn" :disabled="store.sync.estado === 'sincronizando'" @click="sincronizarAhora">Sincronizar ahora</button>
          <button v-if="store.sync.estado === 'sesion'" type="button" class="btn primario" @click="conectar">Reconectar</button>
          <button type="button" class="btn peligro" @click="salir">Desconectar</button>
        </div>
        <template v-if="archivos.length">
          <h3 style="margin-top: 18px">Archivos en la carpeta</h3>
          <ul class="lista" style="margin-top: 6px">
            <li v-for="a in archivos" :key="a.nombre" class="fila compacta">
              <div class="fila-info">
                <span style="font-size: 0.9rem">{{ a.nombre }}</span>
                <span class="fila-sub">{{ a.detalle }}</span>
              </div>
              <span class="tenue" style="font-size: 0.82rem">{{ tamano(a.tamano) }}</span>
            </li>
          </ul>
        </template>
        <h3 style="margin-top: 18px">Respaldos</h3>
        <p class="nota" style="margin-top: 4px">Se guardan en {{ carpeta }}/respaldos, los 10 más recientes. La app guarda uno por su cuenta antes de cambiar el formato de los datos.</p>
        <div class="botones">
          <button type="button" class="btn" :disabled="ocupado" @click="respaldar">Guardar respaldo ahora</button>
          <button type="button" class="btn" :disabled="ocupado" @click="verRespaldos">{{ respaldos ? 'Actualizar lista' : 'Ver respaldos' }}</button>
        </div>
        <ul v-if="respaldos && respaldos.length" class="lista" style="margin-top: 8px">
          <li v-for="r in respaldos" :key="r.itemId" class="fila compacta">
            <div class="fila-info"><span style="font-size: 0.88rem">{{ r.nombre }}</span><span class="fila-sub">{{ r.modificado ? fechaHora.format(new Date(r.modificado)) : '' }}</span></div>
            <span class="tenue" style="font-size: 0.82rem">{{ tamano(r.tamano) }}</span>
          </li>
        </ul>
        <p v-else-if="respaldos" class="nota chica" style="margin-top: 8px">Todavía no hay respaldos.</p>
        <p v-if="store.sync.ubicacion.propio" class="nota" style="margin-top: 12px">Para que otra persona lo use: comparte la carpeta {{ carpeta }} (la carpeta,
          no el archivo) con su correo y permiso para editar, y mándale el enlace. Esa persona abre esta app, conecta su cuenta y pega el enlace.</p>
      </template>
    </article>

    <article class="tarjeta">
      <h2 style="margin-bottom: 12px">Respaldo e importación</h2>
      <div class="botones" style="margin-top: 0">
        <button type="button" class="btn" @click="respaldo">Descargar respaldo (JSON)</button>
        <label class="btn">Importar archivo<input type="file" accept=".json,application/json" class="oculto-visual" @change="importarArchivo"></label>
      </div>
      <p class="nota" style="margin-top: 12px">Importar combina el archivo con lo que ya hay: no borra nada. Los movimientos se exportan a CSV desde su pantalla.</p>
      <div class="fila-campos" style="margin-top: 14px">
        <label class="campo"><span>Símbolo de moneda</span><input :value="store.doc.config.moneda" maxlength="4" @change="guardarConfig({ moneda: $event.target.value.trim() || 'L' })"></label>
        <label class="campo"><span>Mes de inicio del registro</span><input :value="store.doc.config.inicio" type="month" @change="$event.target.value && guardarConfig({ inicio: $event.target.value })"></label>
      </div>
      <label class="campo" style="margin-top: 10px"><span>Tasa de referencia del dólar (lempiras por US$)</span>
        <input :value="store.doc.config.tasaReferencia" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="Por ejemplo 24.65" @change="guardarTasa($event.target.value)"></label>
      <p class="nota chica" style="margin-top: 4px">Se usa para estimar en lempiras las cuentas y los gastos en dólares que no tienen su propia tasa.</p>
    </article>

    <article class="tarjeta">
      <h2>Este navegador</h2>
      <dl class="datos sin-linea" style="margin-top: 10px">
        <dt>Guardado en</dt><dd>{{ info.tipo || '—' }}</dd>
        <dt>Tamaño de los datos</dt><dd>{{ tamano(info.tamanoDoc) }}</dd>
      </dl>
      <p class="nota" style="margin: 12px 0 14px">Borra los datos guardados aquí, el PIN y la sesión de Microsoft. Lo que está en OneDrive no se toca.</p>
      <button type="button" class="btn peligro" @click="borrarTodo">Borrar datos de este navegador</button>
    </article>
  </section>`,
  setup() {
    const ocupado = ref(false);
    const enlace = ref('');
    const respaldos = ref(null);
    const archivos = computed(() => [...store.carpeta]
      .filter((a) => claveDeNombre(a.nombre))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((a) => {
        const clave = claveDeNombre(a.nombre);
        const partes = [clave === PRINCIPAL ? 'configuración y catálogos' : 'movimientos de ' + clave];
        if (a.modificado) partes.push(fechaHora.format(new Date(a.modificado)));
        if (a.modificadoPor) partes.push(a.modificadoPor);
        return { ...a, detalle: partes.join(' · ') };
      }));
    const idApp = ref(od.clientId());
    const configurado = ref(od.configurado());
    const info = ref({});
    onMounted(async () => {
      info.value = await infoAlmacen();
    });

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
      store, ocupado, enlace, idApp, configurado, chipEstado, fechaHora, importarArchivo, guardarConfig, info, tamano, archivos, respaldos,
      guardarTasa: (v) => guardarConfig({ tasaReferencia: Number(v) > 0 ? Number(v) : null }),
      respaldar: () => ejecutar(async () => {
        const nombre = await respaldarAhora();
        aviso('Respaldo guardado: respaldos/' + nombre, 'ok', 6000);
        if (respaldos.value) respaldos.value = await listarRespaldos();
      }),
      verRespaldos: () => ejecutar(async () => {
        respaldos.value = await listarRespaldos();
      }),
      carpeta: CONFIG.carpeta, retorno: od.direccionRetorno(),
      guardarId: () => {
        od.guardarClientId(idApp.value);
        configurado.value = od.configurado();
        aviso('ID guardado en este dispositivo. Para publicarlo, ponlo también en js/config.js.', 'ok', 6000);
      },
      conectar: () => ejecutar(() => od.iniciarSesion()),
      usarMio: () => {
        if (esPristino(store.doc) && !confirm('Este dispositivo no tiene datos. Si otra persona ya tiene el archivo, usa mejor el enlace de su carpeta. ¿Usar tu OneDrive igual?')) return;
        ejecutar(usarMiOneDrive);
      },
      usarCompartido: () => ejecutar(() => usarEnlace(enlace.value)),
      sincronizarAhora: () => ejecutar(sincronizar),
      salir: () => confirm('¿Desconectar OneDrive en este dispositivo? Los datos siguen en OneDrive.') && desconectar(),
      respaldo: () => descargar(`gastos-respaldo-${hoy()}.json`, exportar(), 'application/json'),
      borrarTodo: () => confirm('¿Borrar los datos de ESTE navegador, incluido el PIN? Lo que está en OneDrive no se toca.') && borrarDatosLocales(),
    };
  },
};
