import { store, fmt, guardar, borrar, aviso, nombrePersona } from '../store.js';
import { resumenMes, movimientoParaCompromiso, ORDEN_CLASES } from '../core/finanzas.js';
import { CLASES } from '../core/modelo.js';
import { nombrePeriodo, fechaCorta, redondear } from '../core/util.js';
import { Icono } from './componentes.js';
import { registrarCompromiso, editarMovimiento } from './formularios.js';

const { computed } = Vue;

// Lo que se marca con un toque usa el monto de siempre; lo variable abre el formulario.
const necesitaMonto = (it) => it.clase === 'fijo_variable' || (it.clase === 'provision' && it.parte === 'pagar');

export const VistaMes = {
  components: { Icono },
  template: `
  <section>
    <div v-if="antesDelInicio" class="banner"><p>Este mes es anterior al inicio del registro ({{ nombrePeriodo(store.doc.config.inicio) }}).</p></div>

    <div class="tarjeta" style="margin-bottom: 14px">
      <div class="cab-tarjeta"><h2>Avance del mes</h2><span class="monto">{{ fmt(r.pagado) }} de {{ fmt(r.comprometido) }}</span></div>
      <div class="progreso" role="img" :aria-label="'Pagado ' + Math.round(pct) + '%'"><div :style="{ width: pct + '%' }"></div></div>
      <p class="nota">{{ hechos }} de {{ r.items.length }} registrados. Toca el círculo para registrar con el monto de siempre,
        o el nombre para cambiar monto, fecha o quién pagó.</p>
    </div>

    <p v-if="!r.items.length" class="vacio">No hay compromisos para este mes. Agrégalos en <a href="#/presupuesto">Presupuesto</a>.</p>

    <div class="tarjetas">
      <article v-for="g in grupos" :key="g.clase" class="tarjeta">
        <header><h2>{{ g.titulo }}</h2><span class="monto tenue">{{ fmt(g.esperado) }}</span></header>
        <ul class="lista">
          <li v-for="it in g.items" :key="it.clave" :class="{ hecho: it.hecho }">
            <button type="button" class="check" :aria-pressed="it.hecho" :aria-label="(it.hecho ? 'Ver ' : 'Registrar ') + it.nombre" @click="marcar(it)">
              <icono v-if="it.hecho" n="check" :t="16"/>
            </button>
            <div class="info clic" @click="abrir(it)">
              <span class="titulo">{{ it.nombre }}</span>
              <span class="sub">
                <span class="chip">{{ nombrePersona(it.responsableId) }}</span>
                <span v-if="it.dia && !it.hecho">día {{ it.dia }}</span>
                <span v-if="it.hecho">{{ detalle(it) }}</span>
              </span>
            </div>
            <div class="derecha">
              <span class="monto">{{ fmt(it.hecho ? it.real : it.esperado) }}</span>
              <small v-if="diferencia(it)" :class="diferencia(it) > 0 ? 'negativo' : 'positivo'">{{ diferencia(it) > 0 ? '+' : '' }}{{ fmt(diferencia(it)) }} vs estimado</small>
            </div>
          </li>
        </ul>
      </article>
    </div>
    <p class="nota">Lo que no está en esta lista (ropa, farmacia, regalos…) regístralo con el botón +: cuenta como gasto adicional.</p>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(store.doc, store.periodo));
    const grupos = computed(() =>
      ORDEN_CLASES.map((clase) => {
        const items = r.value.items.filter((i) => i.clase === clase);
        return { clase, titulo: CLASES[clase], items, esperado: items.reduce((a, i) => a + i.esperado, 0) };
      }).filter((g) => g.items.length));
    const hechos = computed(() => r.value.items.filter((i) => i.hecho).length);
    const pct = computed(() => (r.value.comprometido ? Math.min(100, (r.value.pagado / r.value.comprometido) * 100) : 0));
    const antesDelInicio = computed(() => store.periodo < store.doc.config.inicio);

    function marcar(it) {
      if (it.hecho) return editarMovimiento(it.movimientos[0]);
      if (necesitaMonto(it)) return registrarCompromiso(it, store.periodo);
      const m = guardar('movimientos', movimientoParaCompromiso(it, store.periodo));
      aviso(`Registrado: ${it.nombre}, ${fmt(it.esperado)}`, 'ok', 6000, { texto: 'Deshacer', fn: () => borrar('movimientos', m.id) });
    }
    const abrir = (it) => (it.hecho ? editarMovimiento(it.movimientos[0]) : registrarCompromiso(it, store.periodo));
    function detalle(it) {
      const m = it.movimientos[0];
      const partes = [fechaCorta(m.fecha), `pagó ${nombrePersona(m.personaId)}`];
      if (m.creadoPor && m.creadoPor !== m.personaId) partes.push(`anotó ${nombrePersona(m.creadoPor)}`);
      if (it.movimientos.length > 1) partes.push(`${it.movimientos.length} pagos`);
      return partes.join(' · ');
    }
    const diferencia = (it) => (it.hecho && it.clase === 'fijo_variable' ? redondear(it.real - it.esperado) : 0);

    return { store, r, grupos, hechos, pct, antesDelInicio, marcar, abrir, detalle, diferencia, fmt, nombrePersona, nombrePeriodo };
  },
};
