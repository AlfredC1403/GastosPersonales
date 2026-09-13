import { store, aviso, bloquear, actualizarEstadoPin } from '../store.js';
import {
  pinActivo, minutosBloqueo, activarPin, cambiarPin, desactivarPin, definirMinutos, esPinValido, MINUTOS,
} from '../bloqueo.js';

const { ref, reactive } = Vue;

const NOMBRE_MINUTOS = { 0: 'Inmediatamente', 1: 'Después de 1 minuto', 5: 'Después de 5 minutos', 15: 'Después de 15 minutos' };

export const VistaSeguridad = {
  template: `
  <section class="pila">
    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>PIN de este dispositivo</h2>
        <span class="chip" :class="activo ? 'ok' : ''">{{ activo ? 'Activo' : 'Sin PIN' }}</span>
      </div>
      <p class="nota">Pide un PIN para abrir la app en este dispositivo. Evita que alguien vea los datos si toma el celular, pero no cifra los datos ni reemplaza el bloqueo del teléfono. Cada dispositivo tiene su propio PIN.</p>

      <form v-if="!activo" class="formulario" style="margin-top: 14px" novalidate @submit.prevent="activar">
        <div class="fila-campos">
          <label class="campo"><span>PIN nuevo (4 a 6 números)</span>
            <input v-model="f.nuevo" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*"></label>
          <label class="campo"><span>Repite el PIN</span>
            <input v-model="f.repetido" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*"></label>
        </div>
        <label class="campo"><span>Bloquear al salir de la app</span>
          <select v-model.number="f.minutos"><option v-for="m in minutos" :key="m" :value="m">{{ nombreMinutos[m] }}</option></select></label>
        <p v-if="!store.sync.ubicacion" class="aviso-banner ambar"><span>Este dispositivo no está conectado a OneDrive. Si olvidas el PIN, tendrás que borrar los datos de este navegador.</span></p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="acciones"><span class="espacio"></span><button type="submit" class="btn primario" :disabled="ocupado">Activar PIN</button></div>
      </form>

      <template v-else>
        <label class="campo" style="margin-top: 14px"><span>Bloquear al salir de la app</span>
          <select :value="minutosActual" @change="cambiarMinutos(Number($event.target.value))">
            <option v-for="m in minutos" :key="m" :value="m">{{ nombreMinutos[m] }}</option>
          </select></label>
        <div v-if="!modo" class="botones">
          <button type="button" class="btn" @click="bloquear">Bloquear ahora</button>
          <button type="button" class="btn" @click="abrir('cambiar')">Cambiar PIN</button>
          <button type="button" class="btn peligro" @click="abrir('desactivar')">Desactivar PIN</button>
        </div>
        <form v-else class="formulario" style="margin-top: 14px" novalidate @submit.prevent="modo === 'cambiar' ? cambiar() : desactivar()">
          <label class="campo"><span>PIN actual</span>
            <input v-model="f.actual" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" pattern="[0-9]*"></label>
          <div v-if="modo === 'cambiar'" class="fila-campos">
            <label class="campo"><span>PIN nuevo</span>
              <input v-model="f.nuevo" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*"></label>
            <label class="campo"><span>Repite el PIN nuevo</span>
              <input v-model="f.repetido" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]*"></label>
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="acciones">
            <span class="espacio"></span>
            <button type="button" class="btn" @click="cerrar">Cancelar</button>
            <button type="submit" class="btn" :class="modo === 'desactivar' ? 'peligro' : 'primario'" :disabled="ocupado">{{ modo === 'cambiar' ? 'Cambiar PIN' : 'Desactivar PIN' }}</button>
          </div>
        </form>
      </template>
    </article>
  </section>`,
  setup() {
    const activo = ref(pinActivo());
    const minutosActual = ref(minutosBloqueo());
    const modo = ref(null);
    const ocupado = ref(false);
    const error = ref('');
    const f = reactive({ actual: '', nuevo: '', repetido: '', minutos: 1 });

    const limpiar = () => Object.assign(f, { actual: '', nuevo: '', repetido: '' });
    const abrir = (m) => { modo.value = m; error.value = ''; limpiar(); };
    const cerrar = () => { modo.value = null; error.value = ''; limpiar(); };

    function validarNuevo() {
      if (!esPinValido(f.nuevo)) return 'El PIN debe tener de 4 a 6 números.';
      if (f.nuevo !== f.repetido) return 'Los dos PIN no coinciden.';
      return '';
    }

    async function ejecutar(fn, texto) {
      ocupado.value = true;
      error.value = '';
      try {
        await fn();
        actualizarEstadoPin();
        activo.value = pinActivo();
        minutosActual.value = minutosBloqueo();
        cerrar();
        aviso(texto, 'ok');
      } catch (e) {
        error.value = e.message;
      } finally {
        ocupado.value = false;
      }
    }

    return {
      store, activo, minutosActual, modo, ocupado, error, f, minutos: MINUTOS, nombreMinutos: NOMBRE_MINUTOS, abrir, cerrar, bloquear,
      activar: () => {
        error.value = validarNuevo();
        if (!error.value) ejecutar(() => activarPin(f.nuevo, f.minutos), 'PIN activado en este dispositivo.');
      },
      cambiar: () => {
        error.value = validarNuevo();
        if (!error.value) ejecutar(() => cambiarPin(f.actual, f.nuevo), 'PIN cambiado.');
      },
      desactivar: () => ejecutar(() => desactivarPin(f.actual), 'PIN desactivado.'),
      cambiarMinutos: (m) => {
        definirMinutos(m);
        minutosActual.value = minutosBloqueo();
      },
    };
  },
};
