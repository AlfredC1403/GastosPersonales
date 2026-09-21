import { store, recuperarPin, confirmar, abrirConPin } from '../store.js';
import { verificarPin, largoPin, estadoIntentos, cifradoActivo, MAX_FALLOS } from '../bloqueo.js';
import { biometriaActiva, entrar as entrarConHuella } from '../biometria.js';
import { Icono } from './componentes.js';

const { ref, computed, onMounted, onBeforeUnmount } = Vue;

// Pantalla que tapa la app hasta que se escribe el PIN. Mientras está visible, el resto de
// la app no se dibuja (ver js/app.js).
export const PantallaBloqueo = {
  components: { Icono },
  emits: ['desbloqueado'],
  template: `
  <div class="bloqueo" role="dialog" aria-modal="true" aria-labelledby="titulo-bloqueo">
    <div class="bloqueo-caja">
      <img src="icon.svg" alt="" width="56" height="56">
      <h1 id="titulo-bloqueo" class="cifra">Gastos del hogar</h1>
      <p class="nota" aria-live="polite">{{ mensaje }}</p>
      <div class="puntos-pin" :class="{ sacudir }" aria-hidden="true">
        <span v-for="i in largo" :key="i" :class="{ lleno: i <= pin.length }"></span>
      </div>
      <div class="teclado-pin">
        <button v-for="n in [1, 2, 3, 4, 5, 6, 7, 8, 9]" :key="n" type="button" :disabled="bloqueadoPorEspera || comprobando" @click="tecla(n)">{{ n }}</button>
        <span></span>
        <button type="button" :disabled="bloqueadoPorEspera || comprobando" @click="tecla(0)">0</button>
        <button type="button" class="borrar" aria-label="Borrar un número" :disabled="!pin.length" @click="pin = pin.slice(0, -1)"><icono n="izq" :t="22"/></button>
      </div>
      <button v-if="conHuella" type="button" class="btn" :disabled="comprobando" @click="huella">
        <icono n="huella" :t="18"/> Entrar con huella
      </button>
      <button type="button" class="btn-link" :disabled="!store.listo" @click="olvide">Olvidé mi PIN</button>
    </div>
  </div>`,
  setup(props, { emit }) {
    const largo = largoPin() || 6;
    const pin = ref('');
    const comprobando = ref(false);
    const sacudir = ref(false);
    const espera = ref(estadoIntentos().espera);
    const error = ref('');
    const conHuella = computed(() => biometriaActiva());
    let reloj = null;

    const bloqueadoPorEspera = computed(() => espera.value > 0);
    const mensaje = computed(() => {
      if (espera.value > 0) return `Demasiados intentos. Espera ${Math.ceil(espera.value / 1000)} segundos.`;
      return error.value || 'Escribe tu PIN';
    });

    function contarEspera() {
      clearInterval(reloj);
      reloj = setInterval(() => {
        espera.value = estadoIntentos().espera;
        if (espera.value <= 0) clearInterval(reloj);
      }, 500);
    }

    async function comprobar() {
      comprobando.value = true;
      const r = await verificarPin(pin.value);
      if (r.ok) {
        // Con el cifrado activado, el PIN también abre lo guardado en este dispositivo.
        try {
          await abrirConPin(pin.value);
        } catch (e) {
          comprobando.value = false;
          error.value = e.message;
          pin.value = '';
          return;
        }
        comprobando.value = false;
        emit('desbloqueado');
        return;
      }
      comprobando.value = false;
      pin.value = '';
      sacudir.value = true;
      setTimeout(() => { sacudir.value = false; }, 400);
      if (r.espera > 0) {
        espera.value = r.espera;
        contarEspera();
      } else {
        const quedan = MAX_FALLOS - r.fallos;
        error.value = `PIN incorrecto. ${quedan === 1 ? 'Queda 1 intento' : `Quedan ${quedan} intentos`} antes de tener que esperar.`;
      }
    }

    // La huella abre la app; si además se pudo guardar el PIN al registrarla, abre el cifrado.
    // Se pide solo al tocar el botón: Safari no deja llamar a WebAuthn sin un toque del usuario.
    async function huella() {
      error.value = '';
      comprobando.value = true;
      const r = await entrarConHuella();
      if (!r.ok) {
        comprobando.value = false;
        error.value = 'No se reconoció la huella. Escribe tu PIN.';
        return;
      }
      if (cifradoActivo() && !r.pin) {
        comprobando.value = false;
        error.value = 'Los datos están cifrados: para abrirlos hace falta el PIN.';
        return;
      }
      try {
        if (r.pin) await abrirConPin(r.pin);
      } catch (e) {
        comprobando.value = false;
        error.value = e.message;
        return;
      }
      comprobando.value = false;
      emit('desbloqueado');
    }

    function tecla(n) {
      if (bloqueadoPorEspera.value || comprobando.value || pin.value.length >= largo) return;
      pin.value += String(n);
      if (pin.value.length === largo) comprobar();
    }

    function teclado(e) {
      if (/^\d$/.test(e.key)) tecla(Number(e.key));
      else if (e.key === 'Backspace') pin.value = pin.value.slice(0, -1);
    }

    async function olvide() {
      const conOneDrive = !!store.sync.ubicacion;
      const pregunta = conOneDrive
        ? {
          texto: 'Vas a iniciar sesión con Microsoft y te pedirá tu contraseña. Si la cuenta es de alguien del hogar, se quita el PIN y puedes crear uno nuevo.',
          titulo: '¿Recuperar con Microsoft?', aceptar: 'Continuar',
        }
        : {
          texto: 'Este dispositivo no está conectado a OneDrive. La única forma de entrar es borrar los datos guardados en este navegador.',
          titulo: '¿Borrar los datos de este navegador?', aceptar: 'Borrar', peligro: true,
        };
      const { texto, ...opciones } = pregunta;
      if (await confirmar(texto, opciones)) recuperarPin();
    }

    onMounted(() => {
      window.addEventListener('keydown', teclado);
      if (espera.value > 0) contarEspera();
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', teclado);
      clearInterval(reloj);
    });

    return { store, largo, pin, comprobando, sacudir, bloqueadoPorEspera, mensaje, tecla, olvide, conHuella, huella };
  },
};
