import { store, aviso, bloquear, actualizarEstadoPin, cambiarCifrado, reCifrarCon } from '../store.js';
import {
  pinActivo, minutosBloqueo, activarPin, cambiarPin, desactivarPin, definirMinutos, esPinValido, verificarPin, cifradoActivo, MINUTOS,
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

    <article v-if="activo" class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>Cifrar los datos de este dispositivo</h2>
        <span class="chip" :class="cifrado ? 'ok' : ''">{{ cifrado ? 'Cifrado' : 'En claro' }}</span>
      </div>
      <p class="nota">El PIN tapa la pantalla; el cifrado esconde los datos. Con esto activado, lo que se guarda en este navegador solo se puede leer con tu PIN.</p>
      <div class="caja-ambar">
        <p><b>Si olvidas el PIN se pierde la copia de este dispositivo.</b> La de OneDrive no se toca, así que con OneDrive conectado se vuelve a bajar todo. Sin OneDrive, no hay vuelta.</p>
        <p style="margin-top: 6px">Los avisos que llegan con la app cerrada se apagan: el aviso se prepara fuera de la app y no tiene tu PIN. Los de dentro de la app siguen igual.</p>
      </div>

      <form class="formulario" style="margin-top: 14px" novalidate @submit.prevent="alternarCifrado">
        <label class="campo"><span>Tu PIN</span>
          <input v-model="fc.pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" pattern="[0-9]*"></label>
        <p v-if="errorCifrado" class="error" role="alert">{{ errorCifrado }}</p>
        <div class="acciones">
          <span class="espacio"></span>
          <button type="submit" class="btn" :class="cifrado ? 'peligro' : 'primario'" :disabled="ocupadoCifrado || !fc.pin">
            {{ cifrado ? 'Dejar de cifrar' : 'Cifrar ahora' }}
          </button>
        </div>
      </form>
    </article>
  </section>`,
  setup() {
    const activo = ref(pinActivo());
    const minutosActual = ref(minutosBloqueo());
    const modo = ref(null);
    const ocupado = ref(false);
    const error = ref('');
    const f = reactive({ actual: '', nuevo: '', repetido: '', minutos: 1 });
    const cifrado = ref(cifradoActivo());
    const fc = reactive({ pin: '' });
    const errorCifrado = ref('');
    const ocupadoCifrado = ref(false);

    // Cifrar o dejar de cifrar vuelve a guardar el documento entero, así que primero hay que
    // estar seguros de que el PIN es el correcto: con el equivocado quedaría ilegible.
    async function alternarCifrado() {
      errorCifrado.value = '';
      ocupadoCifrado.value = true;
      try {
        const r = await verificarPin(fc.pin);
        if (!r.ok) throw new Error(r.espera ? `Demasiados intentos. Espera ${Math.ceil(r.espera / 1000)} segundos.` : 'Ese no es tu PIN.');
        const activar = !cifrado.value;
        await cambiarCifrado(activar, fc.pin);
        cifrado.value = cifradoActivo();
        fc.pin = '';
        aviso(activar ? 'Los datos de este dispositivo quedaron cifrados.' : 'Los datos de este dispositivo ya no están cifrados.', 'ok', 6000);
      } catch (e) {
        errorCifrado.value = e.message;
      } finally {
        ocupadoCifrado.value = false;
      }
    }

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
      cifrado, fc, errorCifrado, ocupadoCifrado, alternarCifrado,
      activar: () => {
        error.value = validarNuevo();
        if (!error.value) ejecutar(() => activarPin(f.nuevo, f.minutos), 'PIN activado en este dispositivo.');
      },
      cambiar: () => {
        error.value = validarNuevo();
        // Con el cifrado puesto, el PIN nuevo da una clave nueva: hay que volver a guardar.
        if (!error.value) {
          ejecutar(async () => {
            const clave = await cambiarPin(f.actual, f.nuevo);
            if (clave) await reCifrarCon(clave);
          }, 'PIN cambiado.');
        }
      },
      desactivar: () => ejecutar(async () => {
        // Sin PIN no hay clave, así que los datos vuelven a quedar en claro antes de quitarlo.
        // El PIN se comprueba primero: con el equivocado no se descifra nada.
        if (cifradoActivo()) {
          const r = await verificarPin(f.actual);
          if (!r.ok) throw new Error(r.espera ? `Demasiados intentos. Espera ${Math.ceil(r.espera / 1000)} segundos.` : 'El PIN actual no es correcto.');
          await cambiarCifrado(false, f.actual);
        }
        await desactivarPin(f.actual);
        cifrado.value = false;
      }, 'PIN desactivado.'),
      cambiarMinutos: (m) => {
        definirMinutos(m);
        minutosActual.value = minutosBloqueo();
      },
    };
  },
};
