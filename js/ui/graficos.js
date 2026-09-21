// Gráficos en SVG y CSS. Los colores son variables CSS, así cambian solos con el tema.
// El color sigue a la entidad: cada uno de los cinco primeros grupos tiene el suyo (--s1 a --s5).
const { ref, computed } = Vue;

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
    etiqueta: { type: String, default: 'Gasto por mes' },
  },
  template: `
  <div>
    <svg class="grafico" viewBox="0 0 336 150" preserveAspectRatio="none" style="height: 150px"
         role="img" :aria-label="descripcion" @mouseleave="elegido = null">
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
    const descripcion = computed(() => `${props.etiqueta}, ${props.meses.length} meses`);
    const elegir = (i) => { elegido.value = elegido.value === i ? null : i; };
    return { elegido, slot, ancho, columnas, info, descripcion, elegir };
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

// Dos series por mes en un solo eje: B (el año de comparación) en gris y A en el color de acento.
// `meses`: [{ etiqueta, largo, A, B }] con null en los meses que no entran en la comparación.
export const ColumnasComparadas = {
  props: {
    meses: { type: Array, required: true },
    nombreA: { type: String, required: true },
    nombreB: { type: String, required: true },
    formatear: { type: Function, required: true },
  },
  template: `
  <div>
    <svg class="grafico" viewBox="0 0 336 150" preserveAspectRatio="none" style="height: 150px"
         role="img" :aria-label="'Gasto por mes, ' + nombreA + ' y ' + nombreB" @mouseleave="elegido = null">
      <line v-for="y in [12, 51, 90, 129]" :key="y" x1="0" x2="336" :y1="y" :y2="y" stroke="var(--linea)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <g v-for="c in columnas" :key="c.i" class="clic" @click="elegir(c.i)" @mouseenter="elegido = c.i">
        <rect :x="c.xSlot" y="0" :width="slot" height="150" fill="transparent"/>
        <rect v-if="c.hB" :x="c.xB" :y="130 - c.hB" :width="ancho" :height="c.hB" fill="var(--tinta3)" :opacity="elegido === null || elegido === c.i ? 0.7 : 0.25"/>
        <rect v-if="c.hA" :x="c.xA" :y="130 - c.hA" :width="ancho" :height="c.hA" fill="var(--acento)" :opacity="elegido === null || elegido === c.i ? 1 : 0.4"/>
      </g>
    </svg>
    <div class="eje-meses" :style="{ gridTemplateColumns: 'repeat(' + meses.length + ', 1fr)' }">
      <div v-for="(m, i) in meses" :key="i" class="clic" :class="{ activo: elegido === i }" @click="elegir(i)"><div class="mes">{{ m.etiqueta }}</div></div>
    </div>
    <p class="grafico-info">{{ info }}</p>
  </div>`,
  setup(props) {
    const elegido = ref(null);
    const slot = computed(() => 336 / Math.max(1, props.meses.length));
    const ancho = computed(() => Math.min(14, slot.value * 0.34));
    const maximo = computed(() => Math.max(1, ...props.meses.flatMap((m) => [m.A || 0, m.B || 0])));
    const alto = (v) => (v ? Math.max(1.5, (v / maximo.value) * 118) : 0);
    const columnas = computed(() => props.meses.map((m, i) => {
      const centro = slot.value * i + slot.value / 2;
      return { i, xSlot: slot.value * i, xB: centro - ancho.value - 1, xA: centro + 1, hA: alto(m.A), hB: alto(m.B) };
    }));
    const info = computed(() => {
      if (elegido.value === null) return 'Toca un mes para ver los dos años.';
      const m = props.meses[elegido.value];
      const valor = (v) => (v === null || v === undefined ? 'no entra' : props.formatear(v));
      return `${m.largo}: ${props.nombreA} ${valor(m.A)} · ${props.nombreB} ${valor(m.B)}`;
    });
    const elegir = (i) => { elegido.value = elegido.value === i ? null : i; };
    return { elegido, slot, ancho, columnas, info, elegir };
  },
};

// Curva del saldo proyectado mes a mes. A diferencia de LineaPlan, el saldo puede bajar de cero
// (que es justo lo que hay que ver), así que el eje tiene la línea del cero marcada y los tramos
// en rojo se pintan aparte. `serie2`, si viene, es el escenario del simulador.
export const CurvaSaldo = {
  props: {
    periodos: { type: Array, required: true },
    serie: { type: Array, required: true },
    serie2: { type: Array, default: null },
    formatearMes: { type: Function, required: true },
    formatear: { type: Function, required: true },
    etiqueta: { type: String, default: 'Saldo proyectado mes a mes' },
  },
  template: `
  <div>
    <svg ref="lienzo" class="grafico" viewBox="0 0 336 170" preserveAspectRatio="none" style="height: 180px; touch-action: pan-y"
         role="img" :aria-label="descripcion" @pointermove="mover" @pointerdown="mover" @pointerleave="i = null">
      <line v-for="g in guias" :key="g" x1="0" x2="336" :y1="g" :y2="g" stroke="var(--linea)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <rect v-if="hayRojo" x="0" :y="yCero" width="336" :height="Math.max(0, 170 - yCero)" fill="var(--mal)" opacity="0.08"/>
      <line x1="0" x2="336" :y1="yCero" :y2="yCero" stroke="var(--mal)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
      <polyline v-if="serie2" :points="puntos2" fill="none" stroke="var(--tinta3)" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
      <polyline :points="puntos1" fill="none" stroke="var(--acento)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle v-for="p in enRojo" :key="p.i" :cx="p.x" :cy="p.y" r="3.5" fill="var(--mal)"/>
      <line v-if="i !== null" :x1="x(i)" :x2="x(i)" y1="0" y2="170" stroke="var(--tinta2)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="eje-anios"><span v-for="m in marcas" :key="m">{{ m }}</span></div>
    <p class="grafico-info">{{ info }}</p>
  </div>`,
  setup(props) {
    const lienzo = ref(null);
    const i = ref(null);
    const n = computed(() => props.periodos.length);
    const todos = computed(() => [...props.serie, ...(props.serie2 || []), 0]);
    const alto = computed(() => Math.max(...todos.value));
    const bajo = computed(() => Math.min(...todos.value));
    const rango = computed(() => Math.max(1, (alto.value - bajo.value) * 1.1));
    const x = (k) => (n.value > 1 ? (k * 336) / (n.value - 1) : 168);
    const y = (v) => 160 - (((v || 0) - bajo.value + rango.value * 0.05) / rango.value) * 150;
    const puntos = (s) => s.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const puntos1 = computed(() => puntos(props.serie));
    const puntos2 = computed(() => (props.serie2 ? puntos(props.serie2) : ''));
    const yCero = computed(() => y(0));
    const hayRojo = computed(() => props.serie.some((v) => v < 0));
    const enRojo = computed(() => props.serie.map((v, k) => ({ i: k, v, x: x(k), y: y(v) })).filter((p) => p.v < 0));
    const guias = computed(() => [10, 47.5, 85, 122.5, 160]);
    const marcas = computed(() => {
      if (!n.value) return [];
      const paso = Math.max(1, Math.ceil(n.value / 6));
      const lista = [];
      for (let k = 0; k < n.value; k += paso) lista.push(props.formatearMes(props.periodos[k]));
      return lista;
    });
    function mover(e) {
      const r = lienzo.value.getBoundingClientRect();
      const k = Math.round(((e.clientX - r.left) / r.width) * (n.value - 1));
      i.value = Math.min(n.value - 1, Math.max(0, k));
    }
    const descripcion = computed(() => {
      const meses = props.serie.filter((v) => v < 0).length;
      return `${props.etiqueta}. ${meses ? `${meses} ${meses === 1 ? 'mes queda' : 'meses quedan'} en rojo.` : 'Ningún mes queda en rojo.'}`;
    });
    const info = computed(() => {
      if (i.value === null) return 'Toca o pasa el cursor sobre el gráfico para ver cada mes.';
      const mes = props.formatearMes(props.periodos[i.value]);
      const base = `${mes} · ${props.formatear(props.serie[i.value])}`;
      return props.serie2 ? `${base} · hoy ${props.formatear(props.serie2[i.value])}` : base;
    });
    return { lienzo, i, x, puntos1, puntos2, yCero, hayRojo, enRojo, guias, marcas, mover, info, descripcion, Math };
  },
};
