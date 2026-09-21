// Proyección del flujo de caja y simulador de "¿qué pasa si…?".
// Contesta la pregunta que obligaba a hacer cuentas a mano: ¿me va a alcanzar en diciembre,
// cuando caen el seguro del carro, la matrícula y el aguinaldo?
import { store, fmt, fmtEntero, indice, filtro, partidas, nombrePartida, simbolo } from '../store.js';
import { simular, ajusteDeFinanciamiento, MESES_POR_DEFECTO } from '../core/proyeccion.js';
import { nombrePeriodo, redondear, sumarMeses } from '../core/util.js';
import { definirVista, prefs } from '../tema.js';
import { CurvaSaldo } from './graficos.js';
import { Icono } from './componentes.js';

const { reactive, computed } = Vue;

const PLAZOS = { 6: '6 meses', 12: '12 meses', 24: '24 meses' }; // las claves son cadenas (ver VISTAS en tema.js)
const TIPOS_CAMBIO = {
  quitarPartida: 'Cancelar una partida',
  gasto: 'Un gasto nuevo',
  ingreso: 'Un ingreso nuevo',
  financiamiento: 'Tomar un financiamiento',
};

const CAMBIO_VACIO = () => ({
  tipo: 'gasto', partidaId: null, nombre: '', monto: null, cuotas: 12, interesAnual: 0, desde: '', unaVez: false,
});

export const VistaProyeccion = {
  components: { CurvaSaldo, Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Saldo dentro de {{ meses }} meses</p>
      <p class="hero-num" :class="{ negativo: alFinal < 0 }">{{ fmt(alFinal) }}</p>
      <p class="hero-texto">{{ resumen }}</p>
    </div>

    <div class="segmentos" role="group" aria-label="Cuántos meses proyectar">
      <button v-for="(n, k) in plazos" :key="k" type="button" :class="{ activo: String(meses) === k }"
              :aria-pressed="String(meses) === k" @click="definirVista('mesesProyeccion', k)">{{ n }}</button>
    </div>

    <article class="tarjeta">
      <div class="tarjeta-cab"><h2>El saldo mes a mes</h2></div>
      <curva-saldo :periodos="periodos" :serie="serie" :serie2="serieBase" :formatear-mes="mesCorto" :formatear="fmtEntero"/>
      <p v-if="hayCambios" class="nota chica">La línea llena es el escenario; la punteada, cómo va hoy.</p>
    </article>

    <div v-if="p.mesesEnRojo.length" class="aviso-banner ambar" role="status">
      <p>{{ textoRojo }}</p>
    </div>

    <article class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>¿Qué pasa si…?</h2>
        <span v-if="hayCambios" class="chip" :class="s.diferencia.alFinal >= 0 ? 'ok' : 'mal'">
          {{ s.diferencia.alFinal >= 0 ? '+' : '' }}{{ fmtEntero(s.diferencia.alFinal) }}</span>
      </div>

      <div v-for="(c, i) in cambios" :key="i" class="fila-cambio">
        <div class="fila-campos">
          <label class="campo"><span>Cambio</span>
            <select v-model="c.tipo"><option v-for="(n, k) in tipos" :key="k" :value="k">{{ n }}</option></select></label>
          <label v-if="c.tipo === 'quitarPartida'" class="campo"><span>Cuál</span>
            <select v-model="c.partidaId"><option :value="null">Elegir…</option>
              <option v-for="pa in listaPartidas" :key="pa.id" :value="pa.id">{{ pa.nombre }}</option></select></label>
          <label v-else class="campo"><span>Nombre</span><input v-model.trim="c.nombre" maxlength="40" :placeholder="marcador(c)"></label>
        </div>

        <div v-if="c.tipo !== 'quitarPartida'" class="fila-campos">
          <label class="campo"><span>{{ c.tipo === 'financiamiento' ? 'Total de la compra' : 'Cuánto al mes' }}</span>
            <input v-model.number="c.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
          <label v-if="c.tipo === 'financiamiento'" class="campo"><span>Cuotas</span>
            <input v-model.number="c.cuotas" type="number" inputmode="numeric" min="2" max="60"></label>
          <label v-else class="campo"><span>Desde</span><input v-model="c.desde" type="month" :min="primerMes" :max="ultimoMes"></label>
        </div>
        <div v-if="c.tipo === 'financiamiento'" class="fila-campos">
          <label class="campo"><span>Interés anual (%)</span><input v-model.number="c.interesAnual" type="number" inputmode="decimal" step="0.01" min="0"></label>
          <label class="campo"><span>Desde</span><input v-model="c.desde" type="month" :min="primerMes" :max="ultimoMes"></label>
        </div>
        <label v-if="c.tipo === 'gasto' || c.tipo === 'ingreso'" class="casilla"><input v-model="c.unaVez" type="checkbox"> Solo ese mes</label>

        <p v-if="textoCambio(c)" class="nota chica">{{ textoCambio(c) }}</p>
        <div class="botones"><button type="button" class="btn-enlace" @click="cambios.splice(i, 1)">Quitar este cambio</button></div>
      </div>

      <button type="button" class="btn-punteado" @click="agregar">+ Agregar un cambio</button>
      <p v-if="hayCambios" class="nota" style="margin-top: 12px">{{ textoDiferencia }}</p>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab"><h2>Mes a mes</h2></div>
      <ul class="lista">
        <li v-for="m in p.meses" :key="m.periodo" class="fila" :class="{ tenue: !m.entra && !m.sale }">
          <div class="fila-info">
            <span class="fila-titulo">{{ nombrePeriodo(m.periodo) }}</span>
            <span class="fila-sub">{{ detalle(m) }}</span>
          </div>
          <div class="derecha">
            <div class="monto" :class="m.saldoFin < 0 ? 'negativo' : m.neto > 0 ? 'positivo' : ''">{{ fmtEntero(m.saldoFin) }}</div>
            <div class="dif tenue">{{ m.neto >= 0 ? '+' : '' }}{{ fmtEntero(m.neto) }}</div>
          </div>
        </li>
      </ul>
    </article>

    <p class="nota chica">Sale del plan que ya está configurado: partidas con su vigencia, salarios con sus días de pago,
      cuotas de préstamo y de financiamiento, suscripciones con su ciclo, pagos anuales y renovaciones. El mes en curso
      cuenta solo lo que falta por pagar. No adivina lo que se gasta fuera del plan.</p>
  </section>`,
  setup() {
    const cambios = reactive([]);
    const ix = computed(indice);
    const meses = computed(() => Number(prefs.mesesProyeccion) || MESES_POR_DEFECTO);
    const primerMes = computed(() => store.hoy.slice(0, 7));
    const ultimoMes = computed(() => sumarMeses(primerMes.value, meses.value - 1));

    // Un cambio a medio escribir no se aplica: el gráfico no debe saltar mientras se teclea.
    const ajustes = computed(() => cambios.map((c) => {
      const desde = c.desde || primerMes.value;
      if (c.tipo === 'quitarPartida') return c.partidaId ? { tipo: 'quitarPartida', partidaId: c.partidaId, desde } : null;
      if (!(Number(c.monto) > 0)) return null;
      if (c.tipo === 'financiamiento') {
        const n = Math.round(Number(c.cuotas) || 0);
        if (!(n >= 2)) return null;
        return ajusteDeFinanciamiento({ nombre: c.nombre || 'Financiamiento nuevo', total: Number(c.monto), meses: n, desde, interesAnual: c.interesAnual });
      }
      const base = { tipo: c.tipo, nombre: c.nombre || (c.tipo === 'gasto' ? 'Gasto nuevo' : 'Ingreso nuevo'), monto: Number(c.monto) };
      return c.unaVez ? { ...base, periodo: desde } : { ...base, desde };
    }).filter(Boolean));

    const hayCambios = computed(() => ajustes.value.length > 0);
    const opciones = computed(() => ({ meses: meses.value, filtro: filtro() }));
    const s = computed(() => simular(ix.value, opciones.value, ajustes.value));
    const p = computed(() => (hayCambios.value ? s.value.escenario : s.value.base));

    const periodos = computed(() => p.value.meses.map((m) => m.periodo));
    const serie = computed(() => p.value.meses.map((m) => m.saldoFin));
    const serieBase = computed(() => (hayCambios.value ? s.value.base.meses.map((m) => m.saldoFin) : null));
    const alFinal = computed(() => (serie.value.length ? serie.value[serie.value.length - 1] : p.value.saldoInicial));

    const resumen = computed(() => {
      const hoy = `Hoy hay ${fmt(p.value.saldoInicial)} en las cuentas.`;
      if (!p.value.mesesEnRojo.length) return `${hoy} Ningún mes queda en rojo.`;
      return `${hoy} ${p.value.mesesEnRojo.length === 1 ? 'Un mes queda' : p.value.mesesEnRojo.length + ' meses quedan'} en rojo.`;
    });
    const textoRojo = computed(() => {
      const m = p.value.minimo;
      const peor = `Lo más bajo es ${nombrePeriodo(m.periodo)}, con ${fmt(m.saldoFin)}.`;
      const causa = m.hitos.length ? ` Lo que más pesa ese mes: ${m.hitos.slice(0, 3).map((h) => `${h.nombre} (${fmtEntero(h.monto)})`).join(', ')}.` : '';
      return `${peor}${causa}`;
    });
    const textoDiferencia = computed(() => {
      const d = s.value.diferencia;
      const signo = d.alFinal >= 0 ? 'más' : 'menos';
      const rojo = d.mesesEnRojoDespues === d.mesesEnRojoAntes
        ? ''
        : d.mesesEnRojoDespues > d.mesesEnRojoAntes
          ? ` Mete ${d.mesesEnRojoDespues - d.mesesEnRojoAntes} ${d.mesesEnRojoDespues - d.mesesEnRojoAntes === 1 ? 'mes' : 'meses'} en rojo.`
          : ` Saca ${d.mesesEnRojoAntes - d.mesesEnRojoDespues} ${d.mesesEnRojoAntes - d.mesesEnRojoDespues === 1 ? 'mes' : 'meses'} del rojo.`;
      return `Con estos cambios, dentro de ${meses.value} meses habría ${fmt(Math.abs(d.alFinal))} ${signo}.${rojo}`;
    });

    function detalle(m) {
      if (!m.entra && !m.sale) return 'Sin movimientos previstos';
      const partes = [`entra ${fmtEntero(m.entra)}`, `sale ${fmtEntero(m.sale)}`];
      if (m.hitos.length) partes.push(m.hitos[0].nombre);
      return partes.join(' · ');
    }
    const marcador = (c) => (c.tipo === 'financiamiento' ? 'Refrigeradora, llantas…' : c.tipo === 'ingreso' ? 'Aumento, trabajo extra…' : 'Carro, colegiatura…');
    function textoCambio(c) {
      const a = ajustes.value[cambios.indexOf(c)];
      if (c.tipo === 'financiamiento' && Number(c.monto) > 0 && Number(c.cuotas) >= 2) {
        const f = ajusteDeFinanciamiento({ nombre: '', total: Number(c.monto), meses: Math.round(c.cuotas), desde: c.desde || primerMes.value, interesAnual: c.interesAnual });
        const total = redondear(f.monto * Math.round(c.cuotas));
        return `${fmt(f.monto)} al mes hasta ${nombrePeriodo(f.hasta)}. En total ${fmt(total)}${total > Number(c.monto) ? `, ${fmt(total - Number(c.monto))} más que de contado` : ''}.`;
      }
      if (c.tipo === 'quitarPartida' && c.partidaId) return `Sin ${nombrePartida(c.partidaId)} desde ${nombrePeriodo(c.desde || primerMes.value)}.`;
      return a ? '' : 'Falta algún dato para aplicar este cambio.';
    }
    const agregar = () => cambios.push({ ...CAMBIO_VACIO(), desde: primerMes.value });

    return {
      store, cambios, meses, p, s, hayCambios, periodos, serie, serieBase, alFinal, resumen, textoRojo, textoDiferencia,
      detalle, marcador, textoCambio, agregar, primerMes, ultimoMes, definirVista,
      plazos: PLAZOS, tipos: TIPOS_CAMBIO, listaPartidas: computed(partidas), String,
      fmt, fmtEntero, simbolo, nombrePeriodo, nombrePartida, mesCorto: (p2) => nombrePeriodo(p2, true),
    };
  },
};
