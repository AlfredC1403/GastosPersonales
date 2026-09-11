import { store, fmt, nombrePersona } from '../store.js';
import { resumenMes, ORDEN_CLASES } from '../core/finanzas.js';
import { CLASES } from '../core/modelo.js';
import { nombrePeriodo, fechaCorta, redondear } from '../core/util.js';
import { Icono } from './componentes.js';
import { marcarCompromiso, abrirCompromiso } from './formularios.js';

const { computed } = Vue;

export const VistaMes = {
  components: { Icono },
  template: `
  <section class="pila">
    <div v-if="antesDelInicio" class="aviso-banner"><p>Este mes es anterior al inicio del registro ({{ nombrePeriodo(store.doc.config.inicio) }}).</p></div>

    <div>
      <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">
        <p class="hero-num md">{{ fmt(r.pagado) }}</p>
        <span class="tenue" style="font-size: 0.9rem">de {{ fmt(r.comprometido) }}</span>
      </div>
      <div class="progreso" style="margin-top: 12px" role="img" :aria-label="'Pagado ' + Math.round(pct) + '%'"><div :style="{ width: pct + '%' }"></div></div>
      <p class="nota" style="margin-top: 10px">{{ avanceTexto }} Toca el círculo para registrar con el monto de siempre, o el nombre para cambiarlo.</p>
    </div>

    <p v-if="!r.items.length" class="vacio">No hay compromisos para este mes. Agrégalos en <a href="#/presupuesto">Presupuesto</a>.</p>

    <article v-for="g in grupos" :key="g.clase" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo">{{ g.titulo }}</h2>
        <span class="monto texto2">{{ fmt(g.esperado) }}</span>
      </div>
      <ul class="lista">
        <li v-for="it in g.items" :key="it.clave" class="fila" :class="{ hecho: it.hecho }">
          <button type="button" class="check" :aria-pressed="it.hecho" :aria-label="(it.hecho ? 'Ver ' : 'Registrar ') + it.nombre" @click="marcar(it)">
            <icono v-if="it.hecho" n="check" :t="15" :g="2.4"/>
          </button>
          <div class="fila-info clic" @click="abrir(it)">
            <span class="fila-titulo">{{ it.nombre }}</span>
            <span class="fila-sub">{{ detalle(it) }}</span>
          </div>
          <div class="derecha">
            <div class="monto">{{ fmt(it.hecho ? it.real : it.esperado) }}</div>
            <div v-if="diferencia(it)" class="dif" :class="diferencia(it) > 0 ? 'negativo' : 'positivo'">{{ diferencia(it) > 0 ? '+' : '' }}{{ fmt(diferencia(it)) }}</div>
          </div>
        </li>
      </ul>
    </article>

    <p class="nota chica">Lo que no está en esta lista (ropa, farmacia, regalos) regístralo con el botón +. Cuenta como gasto adicional.</p>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(store.doc, store.periodo));
    const grupos = computed(() =>
      ORDEN_CLASES.map((clase) => {
        const items = r.value.items.filter((i) => i.clase === clase);
        return { clase, titulo: CLASES[clase], items, esperado: items.reduce((a, i) => a + i.esperado, 0) };
      }).filter((g) => g.items.length));
    const compromisos = computed(() => r.value.items.filter((i) => i.clase !== 'ingreso'));
    const pct = computed(() => (r.value.comprometido ? Math.min(100, (r.value.pagado / r.value.comprometido) * 100) : 0));
    const avanceTexto = computed(() => {
      const hechos = compromisos.value.filter((i) => i.hecho).length;
      const total = compromisos.value.length;
      return r.value.pendiente > 0 ? `${hechos} de ${total} compromisos registrados. Faltan ${fmt(r.value.pendiente)}.`
        : total ? `Los ${total} compromisos del mes están registrados.` : '';
    });
    const antesDelInicio = computed(() => store.periodo < store.doc.config.inicio);

    function detalle(it) {
      if (!it.hecho) return `${nombrePersona(it.responsableId)}${it.dia ? ' · día ' + it.dia : ''}`;
      const m = it.movimientos[0];
      const verbo = it.clase === 'ingreso' ? 'recibió' : 'pagó';
      const partes = [fechaCorta(m.fecha), `${verbo} ${nombrePersona(m.personaId)}`];
      if (m.creadoPor && m.creadoPor !== m.personaId) partes.push(`anotó ${nombrePersona(m.creadoPor)}`);
      if (it.movimientos.length > 1) partes.push(`${it.movimientos.length} pagos`);
      return partes.join(' · ');
    }
    const diferencia = (it) => (it.hecho && it.clase === 'fijo_variable' ? redondear(it.real - it.esperado) : 0);

    return {
      store, r, grupos, pct, avanceTexto, antesDelInicio, detalle, diferencia, fmt, nombrePeriodo,
      marcar: (it) => marcarCompromiso(it, store.periodo),
      abrir: (it) => abrirCompromiso(it, store.periodo),
    };
  },
};
