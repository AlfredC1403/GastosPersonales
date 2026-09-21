import {
  store, aviso, guardarConfig, importar, exportar, borrarDatosLocales, usarMiOneDrive, usarEnlace, sincronizar, desconectar, infoAlmacen,
  respaldarAhora, listarRespaldos, anioCargado, confirmar, guardar, borrar, vivos,
} from '../store.js';
import { hoy, nombrePeriodo, periodoDe } from '../core/util.js';
import { idTasa, ultimaTasaAnotada, mesesSinAnotar } from '../core/tasas.js';
import { esPristino } from '../core/modelo.js';
import { claveDeNombre, PRINCIPAL } from '../core/anios.js';
import * as od from '../onedrive.js';
import { CONFIG } from '../config.js';
import { descargar, Icono } from './componentes.js';

const { ref, reactive, computed, onMounted } = Vue;
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function tamano(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const VistaDatos = {
  components: { Icono },
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
      <p class="nota" style="margin-top: 12px">Importar combina el archivo con lo que ya hay: no borra nada. Los movimientos se exportan a CSV desde su pantalla.
        <template v-if="store.sync.ubicacion"> El respaldo lleva los años que están en este dispositivo; los anteriores ya están en OneDrive.</template></p>
      <div class="fila-campos" style="margin-top: 14px">
        <label class="campo"><span>Símbolo de moneda</span><input :value="store.doc.config.moneda" maxlength="4" @change="guardarConfig({ moneda: $event.target.value.trim() || 'L' })"></label>
        <label class="campo"><span>Mes de inicio del registro</span><input :value="store.doc.config.inicio" type="month" @change="$event.target.value && guardarConfig({ inicio: $event.target.value })"></label>
      </div>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>Tasa del dólar</h2>
        <span v-if="estadoTasa" class="chip" :class="estadoTasa.clase">{{ estadoTasa.texto }}</span>
      </div>
      <p class="nota" style="margin-top: 8px">Cada mes tiene su tasa (lempiras por US$). Así un reporte de hace dos años no se valora con la tasa de hoy.
        Un mes sin tasa propia usa la última anterior.</p>

      <div class="fila-campos" style="margin-top: 14px">
        <label class="campo"><span>Mes</span><input v-model="nueva.periodo" type="month"></label>
        <label class="campo"><span>Lempiras por US$</span>
          <input v-model.number="nueva.valor" type="number" inputmode="decimal" step="0.0001" min="0" :placeholder="ultima ? String(ultima.valor) : 'Por ejemplo 24.65'"></label>
      </div>
      <p v-if="errorTasa" class="error" role="alert">{{ errorTasa }}</p>
      <div class="botones" style="margin-top: 10px">
        <button type="button" class="btn primario" :disabled="!nueva.valor" @click="anotarTasa">{{ yaAnotada ? 'Cambiar la tasa del mes' : 'Anotar la tasa' }}</button>
      </div>

      <table v-if="lista.length" class="tabla" style="margin-top: 16px">
        <caption class="oculto-visual">Tasa anotada de cada mes</caption>
        <thead><tr><th scope="col">Mes</th><th scope="col" class="num">Lempiras por US$</th><th scope="col"><span class="oculto-visual">Quitar</span></th></tr></thead>
        <tbody>
          <tr v-for="t in lista" :key="t.id">
            <td>{{ nombrePeriodo(t.periodo) }}</td>
            <td class="num cifra">{{ t.valor }}</td>
            <td class="num">
              <button type="button" class="btn-icono" :aria-label="'Quitar la tasa de ' + nombrePeriodo(t.periodo)" @click="quitarTasa(t)"><icono n="x" :t="16"/></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="nota chica" style="margin-top: 12px">Todavía no hay ninguna tasa anotada.</p>
      <p v-if="masViejas" class="nota chica" style="margin-top: 8px">
        <button type="button" class="btn-enlace" @click="todas = !todas">{{ todas ? 'Ver solo los últimos 12 meses' : 'Ver las ' + total + ' tasas' }}</button>
      </p>
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
    const nueva = reactive({ periodo: periodoDe(store.hoy), valor: null });
    const errorTasa = ref('');
    const todas = ref(false);
    const respaldos = ref(null);
    const archivos = computed(() => [...store.carpeta]
      .filter((a) => claveDeNombre(a.nombre))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((a) => {
        const clave = claveDeNombre(a.nombre);
        const partes = [clave === PRINCIPAL ? 'configuración y catálogos' : `movimientos de ${clave}${anioCargado(clave) ? '' : ' (no está en este dispositivo)'}`];
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

    // Las tasas anotadas, de la más nueva a la más vieja. Por defecto solo el último año:
    // un hogar con varios años de registro tendría una tabla que no se acaba.
    const anotadas = computed(() => vivos('tasas')
      .filter((t) => Number(t.valor) > 0 && /^\d{4}-\d{2}$/.test(t.periodo || ''))
      .sort((a, b) => (a.periodo < b.periodo ? 1 : a.periodo > b.periodo ? -1 : 0)));
    const lista = computed(() => (todas.value ? anotadas.value : anotadas.value.slice(0, 12)));
    const ultima = computed(() => ultimaTasaAnotada(store.doc));
    const yaAnotada = computed(() => anotadas.value.some((t) => t.periodo === nueva.periodo));

    // Una tasa vieja distorsiona en silencio todo lo que está en dólares y no se ha pagado.
    const estadoTasa = computed(() => {
      const meses = mesesSinAnotar(store.doc, store.hoy);
      if (meses == null) return { texto: 'Sin anotar', clase: 'aviso' };
      if (meses <= 0) return { texto: 'Al día', clase: 'ok' };
      return { texto: meses === 1 ? 'Falta la de este mes' : `Faltan ${meses} meses`, clase: 'aviso' };
    });

    function anotarTasa() {
      errorTasa.value = '';
      if (!/^\d{4}-\d{2}$/.test(nueva.periodo || '')) return (errorTasa.value = 'Elige el mes de la tasa.');
      const valor = Number(nueva.valor);
      if (!(valor > 0)) return (errorTasa.value = 'Escribe cuántos lempiras vale un dólar.');
      const anterior = anotadas.value.find((t) => t.periodo === nueva.periodo);
      guardar('tasas', { ...(anterior || {}), id: anterior?.id || idTasa(nueva.periodo), periodo: nueva.periodo, valor, nota: anterior?.nota || '' });
      // La configuración sigue guardando la última tasa: es el respaldo de lo que todavía no
      // mira la lista (la estimación de una tarjeta, por ejemplo) y de un archivo sin tasas.
      if (!ultima.value || nueva.periodo >= ultima.value.periodo) guardarConfig({ tasaReferencia: valor, tasaReferenciaDesde: store.hoy });
      aviso(`Tasa de ${nombrePeriodo(nueva.periodo)}: ${valor}`, 'ok');
      nueva.valor = null;
    }

    async function quitarTasa(t) {
      if (!await confirmar(`¿Quitar la tasa de ${nombrePeriodo(t.periodo)}? Ese mes pasará a usar la del mes anterior.`, { titulo: 'Quitar la tasa', peligro: true })) return;
      borrar('tasas', t.id);
    }

    return {
      store, ocupado, enlace, idApp, configurado, chipEstado, fechaHora, importarArchivo, guardarConfig, info, tamano, archivos, respaldos,
      nueva, errorTasa, todas, lista, ultima, yaAnotada, estadoTasa, anotarTasa, quitarTasa, nombrePeriodo,
      masViejas: computed(() => anotadas.value.length > 12), total: computed(() => anotadas.value.length),
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
      usarMio: async () => {
        const ok = !esPristino(store.doc) || await confirmar(
          'Este dispositivo no tiene datos. Si otra persona del hogar ya tiene el archivo, usa mejor el enlace de su carpeta.',
          { titulo: '¿Usar tu OneDrive igual?', aceptar: 'Usar mi OneDrive' },
        );
        if (ok) ejecutar(usarMiOneDrive);
      },
      usarCompartido: () => ejecutar(() => usarEnlace(enlace.value)),
      sincronizarAhora: () => ejecutar(sincronizar),
      salir: async () => {
        const ok = await confirmar('Este dispositivo deja de sincronizar. Los datos siguen en OneDrive.',
          { titulo: '¿Desconectar OneDrive?', aceptar: 'Desconectar' });
        if (ok) desconectar();
      },
      respaldo: () => descargar(`gastos-respaldo-${hoy()}.json`, exportar(), 'application/json'),
      borrarTodo: async () => {
        const ok = await confirmar('Se borran los datos de este navegador, incluido el PIN. Lo que está en OneDrive no se toca.',
          { titulo: '¿Borrar los datos de este navegador?', aceptar: 'Borrar', peligro: true });
        if (ok) borrarDatosLocales();
      },
    };
  },
};
