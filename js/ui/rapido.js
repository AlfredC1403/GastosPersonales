// Registro rápido: el gasto de siempre en dos toques.
// El formulario completo sabe de todo y por eso pide de todo. Aquí se anota lo que ya se sabe:
// el comercio propone su monto, su cuenta y su categoría, y solo hay que confirmar.
import {
  store, fmtMoneda, simboloDe, guardar, aviso, indice, filtro, nombreCuenta, nombreCategoria, nombrePartida,
} from '../store.js';
import { comerciosFrecuentes, gastoSugerido, MESES } from '../core/frecuentes.js';
import { fechaCorta } from '../core/util.js';
import { nuevoMovimiento } from './formularios.js';
import { Icono } from './componentes.js';

const { ref, computed } = Vue;

export const VistaRapido = {
  components: { Icono },
  template: `
  <section class="pila">
    <p class="nota">Los lugares donde más se compró en los últimos {{ meses }} meses, con el monto de siempre. Toca uno, revisa el monto y listo.</p>

    <p v-if="!lista.length" class="vacio">Todavía no hay comercios que se repitan. Anota unos cuantos gastos con su comercio y aparecen aquí.</p>

    <div v-else class="rejilla-rapido">
      <button v-for="f in lista" :key="f.comercioId" type="button" class="ficha-rapida" :class="{ elegida: elegido && elegido.comercioId === f.comercioId }"
              :aria-pressed="!!elegido && elegido.comercioId === f.comercioId" @click="elegir(f)">
        <span class="ficha-rapida-nombre">{{ f.nombre }}</span>
        <span class="ficha-rapida-monto cifra">{{ fmtMoneda(f.monto, f.moneda) }}</span>
        <span class="ficha-rapida-sub">{{ f.veces }} {{ f.veces === 1 ? 'vez' : 'veces' }} · {{ nombreCuenta(f.cuentaId) }}</span>
      </button>
    </div>

    <article v-if="elegido" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>{{ elegido.nombre }}</h2>
        <button type="button" class="btn-icono" aria-label="Cancelar" @click="elegido = null"><icono n="x" :t="18"/></button>
      </div>
      <div class="fila-campos" style="margin-top: 10px">
        <label class="campo"><span>Monto ({{ simboloDe(elegido.moneda) }})</span>
          <input ref="campoMonto" v-model.number="monto" type="number" inputmode="decimal" step="0.01" min="0" @keyup.enter="registrar"></label>
        <label class="campo"><span>Fecha</span><input v-model="fecha" type="date"></label>
      </div>
      <p class="nota chica" style="margin-top: 8px">{{ detalle }}</p>
      <div class="botones" style="margin-top: 12px">
        <button type="button" class="btn primario" :disabled="!(monto > 0)" @click="registrar">Registrar</button>
        <button type="button" class="btn" @click="abrirCompleto">Cambiar algo más</button>
      </div>
    </article>

    <button type="button" class="btn-punteado" @click="otro">+ Otro gasto</button>
  </section>`,
  setup() {
    const elegido = ref(null);
    const monto = ref(0);
    const fecha = ref(store.hoy);
    const campoMonto = ref(null);
    const lista = computed(() => comerciosFrecuentes(indice(), { filtro: filtro() }));
    const detalle = computed(() => {
      const f = elegido.value;
      if (!f) return '';
      const partes = [nombreCuenta(f.cuentaId), f.categoriaId ? nombreCategoria(f.categoriaId) : 'Sin categoría'];
      if (f.partidaId) partes.push(nombrePartida(f.partidaId));
      else partes.push('fuera del plan');
      if (f.ultima) partes.push(`la última vez el ${fechaCorta(f.ultima)}`);
      return partes.join(' · ');
    });

    function elegir(f) {
      elegido.value = f;
      monto.value = f.monto;
      fecha.value = store.hoy;
      // El monto es lo único que suele cambiar, así que queda listo para escribirse encima.
      Vue.nextTick(() => campoMonto.value?.select?.());
    }
    const sugerido = () => ({ ...gastoSugerido(elegido.value, { fecha: fecha.value, personaId: store.yo }), monto: Number(monto.value) || 0 });
    function registrar() {
      if (!(Number(monto.value) > 0)) return;
      guardar('movimientos', sugerido());
      aviso(`${elegido.value.nombre}: ${fmtMoneda(Number(monto.value), elegido.value.moneda)}`, 'ok');
      elegido.value = null;
    }
    function abrirCompleto() {
      const m = sugerido();
      elegido.value = null;
      nuevoMovimiento(m);
    }
    return {
      store, lista, elegido, monto, fecha, campoMonto, detalle, elegir, registrar, abrirCompleto, meses: MESES,
      fmtMoneda, simboloDe, nombreCuenta, otro: () => nuevoMovimiento({ tipo: 'gasto' }),
    };
  },
};
