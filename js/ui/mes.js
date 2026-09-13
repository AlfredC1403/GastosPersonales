import { store, fmt, indice, nombrePersona, nombreCuenta, filtro, personaFiltro } from '../store.js';
import { resumenMes, colorGrupo } from '../core/reportes.js';
import { SIN_RESPONSABLE } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { nombrePeriodo, fechaCorta, redondear } from '../core/util.js';
import { prefs, definirOrdenMes } from '../tema.js';
import { Icono } from './componentes.js';
import { marcarItem, abrirItem } from './formularios.js';

const { computed } = Vue;

const ORDENES = { grupo: 'Por grupo', fecha: 'Por fecha', medio: 'Por medio' };

// Fila de algo que se paga o se recibe en el mes, con su círculo.
export const FilaItem = {
  components: { Icono },
  props: { it: { type: Object, required: true }, periodo: String },
  template: `
  <li class="fila" :class="{ hecho: it.hecho }">
    <button type="button" class="check" :class="claseCheck" :style="estiloCheck" :aria-pressed="it.hecho"
            :aria-label="(it.hecho ? 'Ver ' : 'Registrar ') + it.nombre" @click="marcarItem(it, periodo)">
      <icono v-if="it.hecho && it.estado !== 'omitida'" n="check" :t="15" :g="2.4"/>
    </button>
    <div class="fila-info clic" @click="abrirItem(it, periodo)">
      <span class="fila-titulo">{{ it.nombre }}</span>
      <span class="fila-sub">{{ detalle }}</span>
    </div>
    <div class="derecha">
      <div class="monto" :class="{ tenue: it.estado === 'omitida' }">{{ fmt(montoPrincipal) }}</div>
      <div v-if="nota" class="dif" :class="nota.clase">{{ nota.texto }}</div>
    </div>
  </li>`,
  setup(props) {
    const pct = computed(() => (props.it.esperado > 0 ? Math.min(100, Math.round((props.it.real / props.it.esperado) * 100)) : 0));
    const claseCheck = computed(() => ({ parcial: props.it.estado === 'parcial', omitida: props.it.estado === 'omitida' }));
    const estiloCheck = computed(() => (props.it.estado === 'parcial' ? { '--pct': pct.value } : null));
    const montoPrincipal = computed(() => (props.it.hecho && props.it.estado !== 'omitida' ? props.it.real : props.it.esperado));
    const detalle = computed(() => {
      const it = props.it;
      if (it.estado === 'omitida') return 'Omitida este mes';
      if (it.tipoItem === 'ingreso') {
        if (!it.hecho) return `${nombrePersona(it.responsableId)} · se espera el ${fechaCorta(it.fecha)}`;
        const r = it.recibos[0];
        return `${fechaCorta(r.fecha)} · ${nombreCuenta(r.cuentaId)}${r.creadoPor ? ' · anotó ' + nombrePersona(r.creadoPor) : ''}`;
      }
      if (it.estado === 'parcial') return `${fmt(it.real)} de ${fmt(it.esperado)} · ${it.pagos.length} ${it.pagos.length === 1 ? 'pago' : 'pagos'}`;
      if (!it.hecho) {
        const partes = [nombrePersona(it.responsableId)];
        if (it.dia) partes.push(`día ${it.dia}`);
        if (it.forma === 'abonos') partes.push('en abonos');
        if (it.arrastre > 0) partes.push(`+${fmt(it.arrastre)} del mes pasado`);
        return partes.join(' · ');
      }
      const m = it.pagos[it.pagos.length - 1];
      const partes = [fechaCorta(m.fecha), `pagó ${nombrePersona(m.personaId)}`];
      if (m.creadoPor && m.creadoPor !== m.personaId) partes.push(`anotó ${nombrePersona(m.creadoPor)}`);
      if (it.pagos.length > 1) partes.push(`${it.pagos.length} pagos`);
      return partes.join(' · ');
    });
    const nota = computed(() => {
      const it = props.it;
      if (it.tipoItem === 'ingreso') {
        const d = it.hecho && it.esperado ? redondear(it.real - it.esperado) : 0;
        return d ? { texto: `${d > 0 ? '+' : ''}${fmt(d)}`, clase: d > 0 ? 'positivo' : 'negativo' } : null;
      }
      if (it.estado === 'parcial') return { texto: `quedan ${fmt(it.queda)}`, clase: 'tenue' };
      if (it.estado === 'excedido') return { texto: `+${fmt(it.real - it.esperado)}`, clase: 'negativo' };
      if (it.sobrante > 0) return { texto: `sobran ${fmt(it.sobrante)}`, clase: 'positivo' };
      return null;
    });
    return { claseCheck, estiloCheck, montoPrincipal, detalle, nota, fmt, marcarItem, abrirItem };
  },
};

export const VistaMes = {
  components: { Icono, FilaItem },
  template: `
  <section class="pila">
    <div v-if="antesDelInicio" class="aviso-banner"><p>Este mes es anterior al inicio del registro ({{ nombrePeriodo(store.doc.config.inicio) }}).</p></div>

    <div>
      <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">
        <p class="hero-num md">{{ fmt(r.pagado) }}</p>
        <span class="tenue" style="font-size: 0.9rem">de {{ fmt(r.comprometido) }}</span>
      </div>
      <div class="progreso" style="margin-top: 12px" role="img" :aria-label="'Pagado ' + Math.round(pct) + '%'"><div :style="{ width: pct + '%' }"></div></div>
      <p class="nota" style="margin-top: 10px">{{ avanceTexto }} Toca el círculo para registrar, o el nombre para ver el detalle y cambiar el monto de este mes.</p>
      <p v-if="sinResponsable" class="nota chica" style="margin-top: 4px">No incluye {{ sinResponsable }} {{ sinResponsable === 1 ? 'partida' : 'partidas' }} del hogar sin responsable.</p>
    </div>

    <div class="segmentos" role="group" aria-label="Ordenar">
      <button v-for="(n, k) in ordenes" :key="k" type="button" :class="{ activo: orden === k }" :aria-pressed="orden === k" @click="definirOrdenMes(k)">{{ n }}</button>
    </div>

    <p v-if="!secciones.length && !r.ingresos.length" class="vacio">No hay partidas para este mes. Agrégalas en <a href="#/presupuesto">Presupuesto</a>.</p>

    <article v-if="r.ingresos.length" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo"><i class="punto" style="background: var(--ok)"></i> Ingresos</h2>
        <span class="monto texto2">{{ fmt(r.ingresoReal) }}</span><span class="tenue" style="font-size: 0.8rem">de {{ fmt(r.ingresoEsperado) }}</span>
      </div>
      <ul class="lista"><fila-item v-for="it in r.ingresos" :key="it.clave" :it="it" :periodo="store.periodo"/></ul>
    </article>

    <article v-for="s in secciones" :key="s.clave" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo"><i v-if="s.color" class="punto" :style="{ background: s.color }"></i> {{ s.titulo }}</h2>
        <span class="monto texto2">{{ fmt(s.esperado) }}</span>
      </div>
      <ul class="lista"><fila-item v-for="it in s.items" :key="it.clave" :it="it" :periodo="store.periodo"/></ul>
    </article>

    <a v-if="r.fueraDelPlan" class="tarjeta enlace-tarjeta" href="#/movimientos">
      <div class="fila-info">
        <span style="font-weight: 600">Fuera del plan: {{ fmt(r.fueraDelPlan) }}</span>
        <span class="fila-sub envuelve">Gastos de este mes que no son de ninguna partida.</span>
      </div>
      <icono n="der" :t="20"/>
    </a>
    <p class="nota chica">Lo que no está en esta lista (ropa, farmacia, regalos) regístralo con el botón +. Cuenta como gasto fuera del plan.</p>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(indice(), store.periodo, filtro()));
    const orden = computed(() => prefs.ordenMes);
    const sinResponsable = computed(() => (personaFiltro()
      ? resumenMes(indice(), store.periodo, { personaId: SIN_RESPONSABLE }).plan.filter((it) => it.esperado > 0 || it.real > 0).length
      : 0));
    const visibles = computed(() => [...r.value.cuotas, ...r.value.partidas].filter((it) => it.esperado > 0 || it.real > 0 || it.estado === 'omitida'));

    const secciones = computed(() => {
      const ix = indice();
      const items = visibles.value;
      const porNombre = (a, b) => (a.dia || 99) - (b.dia || 99) || a.nombre.localeCompare(b.nombre);
      const armar = (clave, titulo, color, lista) => ({ clave, titulo, color, items: lista.sort(porNombre), esperado: lista.reduce((a, it) => a + it.esperado, 0) });
      if (orden.value === 'fecha') {
        return items.length ? [armar('todo', 'Por día de pago', null, [...items])] : [];
      }
      if (orden.value === 'medio') {
        const medios = [...new Set(items.map((it) => it.medioId || 'sin'))];
        return medios
          .map((id) => armar(id, id === 'sin' ? 'Sin medio de pago' : nombreCuenta(id), null, items.filter((it) => (it.medioId || 'sin') === id)))
          .sort((a, b) => b.esperado - a.esperado);
      }
      const ids = [...ix.ordenGrupos, SIN_GRUPO];
      return ids
        .map((id) => armar(id, id === SIN_GRUPO ? 'Sin grupo' : ix.grupos.get(id)?.nombre || id, id === SIN_GRUPO ? 'var(--tinta3)' : colorGrupo(ix, id), items.filter((it) => it.grupoId === id)))
        .filter((s) => s.items.length);
    });

    const pct = computed(() => (r.value.comprometido ? Math.min(100, (r.value.pagado / r.value.comprometido) * 100) : 0));
    const avanceTexto = computed(() => {
      const plan = r.value.plan.filter((it) => it.esperado > 0 || it.real > 0);
      const hechos = plan.filter((it) => it.hecho).length;
      if (!plan.length) return '';
      return r.value.pendiente > 0 ? `${hechos} de ${plan.length} partidas completas. Faltan ${fmt(r.value.pendiente)}.` : `Las ${plan.length} partidas del mes están completas.`;
    });
    const antesDelInicio = computed(() => store.periodo < store.doc.config.inicio);

    return { store, r, orden, ordenes: ORDENES, definirOrdenMes, sinResponsable, secciones, pct, avanceTexto, antesDelInicio, fmt, nombrePeriodo };
  },
};
