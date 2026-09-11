// Gráficos en SVG y CSS. Los colores son variables CSS, así cambian solos con el tema.
// El color sigue a la entidad: Préstamos siempre --s1, Fijos --s2, y así.
const { ref, computed } = Vue;

export const CLASES_GRAFICO = [
  { clave: 'prestamo', nombre: 'Préstamos', color: 'var(--s1)' },
  { clave: 'fijo', nombre: 'Fijos', color: 'var(--s2)' },
  { clave: 'fijo_variable', nombre: 'Fijos variables', color: 'var(--s3)' },
  { clave: 'provision', nombre: 'Pagos anuales', color: 'var(--s4)' },
  { clave: 'adicional', nombre: 'Adicionales', color: 'var(--s5)' },
];

// Barra horizontal dividida en segmentos proporcionales: [{ valor, color, titulo }].
export const BarraSegmentos = {
  props: { segmentos: { type: Array, required: true }, clase: { type: String, default: '' } },
  template: `<div class="barra-seg" :class="clase" role="img" :aria-label="etiqueta">
    <span v-for="(s, i) in visibles" :key="i" :style="{ flex: s.valor, background: s.color }" :title="s.titulo"></span>
  </div>`,
  computed: {
    visibles() {
      return this.segmentos.filter((s) => s.valor > 0);
    },
    etiqueta() {
      return this.visibles.map((s) => s.titulo).filter(Boolean).join(', ');
    },
  },
};

// Columnas apiladas por mes. `meses`: [{ periodo, etiqueta, largo, total, textoTotal, valores: [..] }].
// Al tocar o pasar el cursor por una columna se muestra su detalle debajo.
export const ColumnasApiladas = {
  props: {
    meses: { type: Array, required: true },
    series: { type: Array, required: true }, // [{ nombre, color }] en el mismo orden que `valores`
    formatear: { type: Function, required: true },
  },
  template: `
  <div>
    <svg class="grafico" viewBox="0 0 336 150" preserveAspectRatio="none" style="height: 150px"
         role="img" :aria-label="etiqueta" @mouseleave="elegido = null">
      <line v-for="y in [12, 51, 90, 129]" :key="y" x1="0" x2="336" :y1="y" :y2="y" stroke="var(--linea)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <g v-for="c in columnas" :key="c.periodo" class="clic" @click="elegir(c.i)" @mouseenter="elegido = c.i">
        <rect :x="c.xSlot" y="0" :width="slot" height="150" fill="transparent"/>
        <rect v-for="(s, j) in c.segs" :key="j" :x="c.x" :y="s.y" :width="ancho" :height="s.h" :fill="s.color"
              :opacity="elegido === null || elegido === c.i ? 1 : 0.4"/>
      </g>
    </svg>
    <div class="eje-meses" :style="{ gridTemplateColumns: 'repeat(' + meses.length + ', 1fr)' }">
      <div v-for="(m, i) in meses" :key="m.periodo" class="clic" :class="{ activo: elegido === i }" @click="elegir(i)">
        <div class="mes">{{ m.etiqueta }}</div>
        <div class="total">{{ m.textoTotal }}</div>
      </div>
    </div>
    <p class="grafico-info">{{ info }}</p>
  </div>`,
  setup(props) {
    const elegido = ref(null);
    const slot = computed(() => 336 / Math.max(1, props.meses.length));
    const ancho = computed(() => Math.min(34, slot.value * 0.62));
    const maximo = computed(() => Math.max(1, ...props.meses.map((m) => m.total)));
    const columnas = computed(() => props.meses.map((m, i) => {
      let y = 130;
      const segs = m.valores.map((v, j) => {
        const h = (v / maximo.value) * 118;
        y -= h;
        return { y: y + (h > 3 ? 1 : 0), h: Math.max(0, h - (h > 3 ? 1 : 0)), color: props.series[j].color };
      }).filter((s) => s.h > 0);
      return { i, periodo: m.periodo, segs, xSlot: slot.value * i, x: slot.value * i + (slot.value - ancho.value) / 2 };
    }));
    const info = computed(() => {
      if (elegido.value === null) return 'Toca una columna para ver el detalle del mes.';
      const m = props.meses[elegido.value];
      if (!m) return '';
      const partes = m.valores.map((v, j) => (v > 0 ? `${props.series[j].nombre} ${props.formatear(v)}` : null)).filter(Boolean);
      return `${m.largo}: ${partes.length ? partes.join(' · ') + ' · ' : ''}total ${props.formatear(m.total)}`;
    });
    const etiqueta = computed(() => `Gasto por tipo en ${props.meses.length} meses`);
    const elegir = (i) => { elegido.value = elegido.value === i ? null : i; };
    return { elegido, slot, ancho, columnas, info, etiqueta, elegir };
  },
};

// Línea pequeña de tendencia.
export const Sparkline = {
  props: { valores: { type: Array, required: true }, color: { type: String, default: 'var(--s3)' } },
  template: `<svg viewBox="0 0 120 44" preserveAspectRatio="none" style="width: 120px; height: 44px; flex: none" role="img" aria-label="Tendencia de la deuda">
    <polyline :points="puntos" fill="none" :stroke="color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`,
  computed: {
    puntos() {
      const v = this.valores;
      const max = Math.max(...v);
      const min = Math.min(...v);
      const rango = max - min || 1;
      return v.map((x, i) => `${((i * 120) / Math.max(1, v.length - 1)).toFixed(1)},${(40 - ((x - min) / rango) * 34).toFixed(1)}`).join(' ');
    },
  },
};

// Saldo de las deudas mes a mes: sin plan (punteada) y con el plan (línea y área).
// `periodos` en formato 'YYYY-MM'. Al tocar o pasar el cursor se muestran los valores del mes.
export const LineaPlan = {
  props: {
    periodos: { type: Array, required: true },
    sin: { type: Array, required: true },
    con: { type: Array, required: true },
    formatearMes: { type: Function, required: true },
    formatear: { type: Function, required: true },
  },
  template: `
  <div>
    <svg ref="lienzo" class="grafico" viewBox="0 0 336 170" preserveAspectRatio="none" style="height: 180px; touch-action: pan-y"
         role="img" aria-label="Saldo total de las deudas con y sin plan" @pointermove="mover" @pointerdown="mover" @pointerleave="indice = null">
      <line v-for="y in [10, 47.5, 85, 122.5, 160]" :key="y" x1="0" x2="336" :y1="y" :y2="y" stroke="var(--linea)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <polygon :points="area" fill="var(--acento)" opacity="0.1"/>
      <polyline :points="lineaSin" fill="none" stroke="var(--tinta3)" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      <polyline :points="lineaCon" fill="none" stroke="var(--acento)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line v-if="indice !== null" :x1="x(indice)" :x2="x(indice)" y1="0" y2="170" stroke="var(--tinta2)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="eje-anios"><span v-for="a in anios" :key="a">{{ a }}</span></div>
    <p class="grafico-info">{{ info }}</p>
  </div>`,
  setup(props) {
    const lienzo = ref(null);
    const indice = ref(null);
    const n = computed(() => props.periodos.length);
    const tope = computed(() => Math.max(1, props.sin[0] || 0, props.con[0] || 0) * 1.05);
    const x = (i) => (n.value > 1 ? (i * 336) / (n.value - 1) : 0);
    const y = (v) => 160 - ((v || 0) / tope.value) * 150;
    const puntos = (serie) => serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lineaSin = computed(() => puntos(props.sin));
    const lineaCon = computed(() => puntos(props.con));
    const area = computed(() => `0,160 ${lineaCon.value} ${x(n.value - 1).toFixed(1)},160`);
    const anios = computed(() => {
      if (!n.value) return [];
      const desde = Number(props.periodos[0].slice(0, 4));
      const hasta = Number(props.periodos[n.value - 1].slice(0, 4));
      const total = hasta - desde + 1;
      const paso = Math.max(1, Math.ceil(total / 7));
      const lista = [];
      for (let a = desde; a <= hasta; a += paso) lista.push(a);
      if (lista[lista.length - 1] !== hasta) lista.push(hasta);
      return lista;
    });
    function mover(e) {
      const r = lienzo.value.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left) / r.width) * (n.value - 1));
      indice.value = Math.min(n.value - 1, Math.max(0, i));
    }
    const info = computed(() => {
      const i = indice.value;
      if (i === null) return 'Toca o pasa el cursor sobre el gráfico para ver el saldo de cada mes.';
      return `${props.formatearMes(props.periodos[i])} · sin plan ${props.formatear(props.sin[i])} · con el plan ${props.formatear(props.con[i])}`;
    });
    return { lienzo, indice, x, lineaSin, lineaCon, area, anios, mover, info };
  },
};
