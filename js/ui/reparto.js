// Reparto de gastos: cuánto le tocaría a cada persona y cuánto paga hoy, con sugerencias para
// acercarse. Es una sugerencia: lo único que cambia datos es "Asignar", y se puede deshacer.
import { store, fmt, indice, guardar, guardarConfig, buscar, aviso, grupos, nombrePersona, colorPersona, personaFiltro } from '../store.js';
import { calcularReparto, gruposDelReparto, METODOS_REPARTO, BASES_REPARTO, FUENTES_REPARTO, REPARTO_INICIAL } from '../core/reparto.js';
import { nombrePeriodo, periodoDe, redondear } from '../core/util.js';
import { BarraSegmentos } from './graficos.js';

const { reactive, computed, watch, onBeforeUnmount } = Vue;

const copia = (x) => JSON.parse(JSON.stringify(x ?? null));
const TIPOS_ITEM = { partida: 'Partida', categoria: 'Gasto', prestamo: 'Cuota de préstamo', aporte: 'Aporte' };

export const VistaReparto = {
  components: { BarraSegmentos },
  template: `
  <section class="pila">
    <p class="nota">Cuánto le tocaría pagar a cada uno y cuánto paga hoy. Es una sugerencia; nada cambia hasta que ustedes lo decidan.</p>
    <p v-if="personaFiltro()" class="nota chica">El reparto compara a las personas del hogar: no usa el filtro de persona.</p>
    <p v-if="r.personas.length < 2" class="vacio">El reparto necesita al menos dos personas en el hogar.</p>

    <template v-else>
      <article class="tarjeta">
        <h2>Cómo repartir</h2>
        <div class="segmentos envuelve" role="group" aria-label="Método" style="margin-top: 12px">
          <button v-for="(n, k) in metodos" :key="k" type="button" :class="{ activo: op.metodo === k }" :aria-pressed="op.metodo === k" @click="elegirMetodo(k)">{{ n }}</button>
        </div>
        <div v-if="op.metodo === 'ingresos'" class="campo" style="margin-top: 12px">
          <span>Con los ingresos</span>
          <div class="segmentos" role="group" aria-label="Ingresos">
            <button v-for="(n, k) in bases" :key="k" type="button" :class="{ activo: op.base === k }" :aria-pressed="op.base === k" @click="op.base = k">{{ n }}</button>
          </div>
        </div>
        <div v-if="op.metodo === 'propio'" class="fila-campos" style="margin-top: 12px">
          <label v-for="p in r.personas" :key="p.id" class="campo"><span>{{ p.nombre }} (%)</span>
            <input v-model.number="op.porcentajes[p.id]" type="number" inputmode="decimal" min="0" max="100" step="1"></label>
        </div>
        <p v-if="r.avisos.includes('porcentajes')" class="nota chica texto-aviso" style="margin-top: 6px">Los porcentajes suman {{ sumaPorcentajes }} %: se ajustan para que sumen 100.</p>
        <p v-if="r.avisos.includes('sin-ingresos')" class="nota chica texto-aviso" style="margin-top: 6px">No hay ingresos configurados: se reparte mitad y mitad.</p>
        <p v-if="r.estimados.length" class="nota chica" style="margin-top: 6px">Sin recibos de los últimos 3 meses de {{ r.estimados.map(nombrePersona).join(' y ') }}: se usa su neto.</p>

        <div class="campo" style="margin-top: 14px">
          <span>Qué se compara</span>
          <div class="segmentos envuelve" role="group" aria-label="Qué se compara">
            <button v-for="(n, k) in fuentes" :key="k" type="button" :class="{ activo: op.fuente === k }" :aria-pressed="op.fuente === k" @click="op.fuente = k">{{ n }}</button>
          </div>
          <p class="nota chica" style="margin-top: 6px">{{ ayudaFuente }}</p>
        </div>

        <div class="campo" style="margin-top: 14px">
          <span>Qué se reparte</span>
          <div class="chips-filtro envuelve">
            <button v-for="g in listaGrupos" :key="g.id" type="button" class="chip-filtro" :class="{ activo: gruposActivos.has(g.id) }" :aria-pressed="gruposActivos.has(g.id)" @click="alternarGrupo(g.id)">{{ g.nombre }}</button>
            <button type="button" class="chip-filtro" :class="{ activo: op.incluirPrestamos }" :aria-pressed="op.incluirPrestamos" @click="op.incluirPrestamos = !op.incluirPrestamos">Cuotas de préstamos</button>
            <button type="button" class="chip-filtro" :class="{ activo: op.incluirAportes }" :aria-pressed="op.incluirAportes" @click="op.incluirAportes = !op.incluirAportes">Aportes del hogar</button>
          </div>
        </div>
      </article>

      <article class="tarjeta">
        <div class="tarjeta-cab centro pegada">
          <h2>Por persona</h2>
          <span class="monto">{{ fmt(r.asignado) }}</span><span class="tenue" style="font-size: 0.8rem">{{ op.fuente === 'mes' ? 'en ' + nombrePeriodo(r.periodo) : '/mes' }}</span>
        </div>
        <barra-segmentos clase="media" :segmentos="barra" style="margin-top: 12px"/>
        <div class="envoltura-tabla">
          <table class="tabla">
            <thead><tr><th>Persona</th><th class="num">Ingreso</th><th class="num">Le tocaría</th><th class="num">Paga hoy</th><th class="num">Diferencia</th></tr></thead>
            <tbody>
              <tr v-for="p in r.personas" :key="p.id">
                <td><i class="punto" :style="{ background: colorPersona(p.id), borderRadius: '50%' }"></i> {{ p.nombre }} <span class="tenue">{{ p.pct }}%</span></td>
                <td class="num">{{ fmt(p.ingreso) }}</td>
                <td class="num">{{ fmt(p.leToca) }}</td>
                <td class="num">{{ fmt(p.pagaHoy) }}</td>
                <td class="num">{{ p.diferencia > 0 ? '+' : '' }}{{ fmt(p.diferencia) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="nota" style="margin-top: 10px">{{ textoDiferencia }}</p>
        <p v-if="r.sinResponsable" class="nota chica" style="margin-top: 6px">Además, {{ fmt(r.sinResponsable) }} no tienen responsable. Con los mismos porcentajes: {{ r.personas.map((p) => p.nombre + ' ' + fmt(p.parteSinResponsable)).join(' y ') }}.</p>
      </article>

      <article class="tarjeta">
        <h2>Sugerencias</h2>
        <p v-if="!r.sugerencias.length" class="vacio" style="padding: 10px 0">Lo que paga cada uno ya está cerca de lo que le tocaría.</p>
        <ul v-else class="lista" style="margin-top: 8px">
          <li v-for="(s, i) in r.sugerencias" :key="i" class="fila">
            <div class="fila-info">
              <span class="fila-titulo" style="white-space: normal; font-size: 0.93rem">{{ titulo(s) }}</span>
              <span class="fila-sub" style="white-space: normal">{{ subtitulo(s) }}</span>
            </div>
            <button v-if="s.tipo === 'mover'" type="button" class="btn" @click="asignar(s)">Asignar</button>
          </li>
        </ul>
        <p v-if="r.sugerencias.length && op.fuente !== 'presupuesto'" class="nota chica" style="margin-top: 8px">Los montos de las partidas son los del presupuesto.</p>
      </article>

      <article class="tarjeta">
        <h2>Lo que se reparte</h2>
        <ul class="lista" style="margin-top: 8px">
          <li v-for="x in r.items" :key="x.tipo + x.id + x.responsableId" class="fila compacta">
            <div class="fila-info">
              <span class="fila-titulo" style="font-size: 0.9rem">{{ x.nombre }}</span>
              <span class="fila-sub">{{ tiposItem[x.tipo] }} · {{ x.responsableId ? nombrePersona(x.responsableId) : 'sin responsable' }}</span>
            </div>
            <span class="monto">{{ fmt(x.monto) }}</span>
          </li>
        </ul>
        <p v-if="!r.items.length" class="vacio" style="padding: 8px 0">No hay nada que repartir con estas opciones.</p>
      </article>
    </template>
  </section>`,
  setup() {
    const op = reactive({ ...copia(REPARTO_INICIAL), ...copia(store.doc.config.reparto || {}) });
    op.porcentajes = { ...(op.porcentajes || {}) };

    // Las opciones viven en el documento, como el plan de deudas: si la otra persona las cambia, aquí se ven.
    watch(() => store.doc.config.reparto, (x) => {
      if (x && JSON.stringify(x) !== JSON.stringify(op)) Object.assign(op, copia(x));
    });
    let temporizador = null;
    watch(op, () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (JSON.stringify(store.doc.config.reparto || {}) !== JSON.stringify(op)) guardarConfig({ reparto: copia(op) });
      }, 800);
    }, { deep: true });
    onBeforeUnmount(() => clearTimeout(temporizador));

    const ix = computed(indice);
    const periodo = computed(() => periodoDe(store.hoy));
    const r = computed(() => calcularReparto(ix.value, periodo.value, op));
    // Los ingresos y el ahorro no son gastos que se repartan (los aportes tienen su propia opción).
    const listaGrupos = computed(() => grupos().filter((g) => g.id !== 'ingresos' && g.id !== 'ahorro'));
    const gruposActivos = computed(() => gruposDelReparto(ix.value, op));
    function alternarGrupo(id) {
      const actual = new Set(gruposActivos.value);
      if (actual.has(id)) actual.delete(id);
      else actual.add(id);
      op.grupos = [...actual];
    }
    // Al pasar a porcentajes propios, se empieza con los porcentajes de ahora.
    function elegirMetodo(k) {
      if (k === 'propio' && !Object.keys(op.porcentajes).length) {
        for (const p of r.value.personas) op.porcentajes[p.id] = Math.round(p.pct);
      }
      op.metodo = k;
    }
    const sumaPorcentajes = computed(() => redondear(r.value.personas.reduce((a, p) => a + (Number(op.porcentajes[p.id]) || 0), 0)));
    const ayudaFuente = computed(() => ({
      presupuesto: 'Paga hoy: las partidas y cuotas de cada responsable, en promedio al mes.',
      mes: `Paga hoy: lo registrado en ${nombrePeriodo(periodo.value)}, según quién pagó.`,
      tres_meses: 'Paga hoy: el promedio de los últimos 3 meses, según quién pagó.',
    })[op.fuente]);

    const barra = computed(() => r.value.personas.map((p) => ({ valor: p.pagaHoy, color: colorPersona(p.id), titulo: `${p.nombre} paga ${fmt(p.pagaHoy)}` })));
    const textoDiferencia = computed(() => {
      const orden = [...r.value.personas].sort((a, b) => b.diferencia - a.diferencia);
      const de = orden[0];
      const a = orden[orden.length - 1];
      if (!de || Math.abs(de.diferencia) < 1) return 'Cada uno paga lo que le tocaría.';
      return `${de.nombre} paga ${fmt(de.diferencia)} más de lo que le tocaría${a && a.diferencia < -1 ? `; ${a.nombre}, ${fmt(-a.diferencia)} menos` : ''}.`;
    });
    const titulo = (s) => (s.tipo === 'mover'
      ? `Pasar ${s.partidas.map((p) => `${p.nombre} (${fmt(p.monto)})`).join(' y ')} de ${nombrePersona(s.de)} a ${nombrePersona(s.a)}`
      : `${nombrePersona(s.de)} le da ${fmt(s.monto)} al mes a ${nombrePersona(s.a)}`);
    const subtitulo = (s) => {
      if (s.tipo === 'transferencia') return 'Sin cambiar quién paga cada partida.';
      if (Math.abs(s.queda) < 1) return 'Quedarían parejos.';
      return s.queda > 0 ? `${nombrePersona(s.de)} seguiría pagando ${fmt(s.queda)} de más.` : `${nombrePersona(s.a)} pasaría a pagar ${fmt(-s.queda)} de más.`;
    };
    function asignar(s) {
      const antes = s.partidas.map((x) => ({ id: x.id, responsableId: buscar('partidas', x.id)?.responsableId ?? null }));
      for (const x of s.partidas) {
        const p = buscar('partidas', x.id);
        if (p) guardar('partidas', { ...p, responsableId: s.a });
      }
      aviso(`${s.partidas.map((x) => x.nombre).join(' y ')} ${s.partidas.length === 1 ? 'pasa' : 'pasan'} a ${nombrePersona(s.a)}.`, 'ok', 8000, {
        texto: 'Deshacer',
        fn: () => antes.forEach((x) => {
          const p = buscar('partidas', x.id);
          if (p) guardar('partidas', { ...p, responsableId: x.responsableId });
        }),
      });
    }
    return {
      op, r, listaGrupos, gruposActivos, alternarGrupo, elegirMetodo, sumaPorcentajes, ayudaFuente, barra, textoDiferencia, titulo, subtitulo, asignar,
      metodos: METODOS_REPARTO, bases: BASES_REPARTO, fuentes: FUENTES_REPARTO, tiposItem: TIPOS_ITEM, fmt, nombrePeriodo, nombrePersona, colorPersona, personaFiltro,
    };
  },
};
