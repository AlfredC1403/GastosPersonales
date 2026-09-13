import { store, fmt, indice, nombrePersona, nombreCuenta, filtro, personaFiltro } from '../store.js';
import { resumenMes, colorGrupo } from '../core/reportes.js';
import { tramosDePago } from '../core/quincena.js';
import { pagosDeTarjetas } from '../core/tarjetas.js';
import { SIN_RESPONSABLE } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { nombrePeriodo, fechaCorta, redondear, periodoDe, fechaEnMes } from '../core/util.js';
import { prefs, definirOrdenMes } from '../tema.js';
import { Icono } from './componentes.js';
import { marcarItem, abrirItem } from './formularios.js';

const { ref, computed, watch } = Vue;

const ORDENES = { grupo: 'Por grupo', fecha: 'Por fecha', medio: 'Por medio' };

// Fila de algo que se paga o se recibe en el mes, con su círculo. `parte`: la mitad que toca
// en un pago cuando la partida se reparte entre las dos quincenas.
export const FilaItem = {
  components: { Icono },
  props: { it: { type: Object, required: true }, periodo: String, parte: { type: Number, default: null } },
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
    const claseCheck = computed(() => ({ parcial: props.it.estado === 'parcial', omitida: props.it.estado === 'omitida', planilla: !!props.it.planilla }));
    const estiloCheck = computed(() => (props.it.estado === 'parcial' ? { '--pct': pct.value } : null));
    const montoPrincipal = computed(() => {
      if (props.parte !== null) return props.parte;
      return props.it.hecho && props.it.estado !== 'omitida' ? props.it.real : props.it.esperado;
    });
    const otroMes = computed(() => (props.periodo && props.periodo !== store.periodo ? nombrePeriodo(props.periodo).split(' ')[0] : ''));
    const detalle = computed(() => {
      const it = props.it;
      const partes = [];
      if (it.estado === 'omitida') partes.push('Omitida este mes');
      else if (it.tipoItem === 'tarjeta') {
        partes.push(`Corte del ${fechaCorta(it.corte)}`);
        if (it.situacion === 'abierto') partes.push(`abierto, se paga hasta el ${fechaCorta(it.limite)}`);
        else if (it.hecho) partes.push(it.estadoCuenta.tarde ? 'pagado tarde' : 'pagado');
        else {
          if (it.real > 0) partes.push(`pagado ${fmt(it.real)}`);
          partes.push(`${it.situacion === 'vencido' ? 'venció' : 'vence'} el ${fechaCorta(it.limite)}`);
        }
      } else if (it.tipoItem === 'ingreso') {
        if (!it.hecho) partes.push(`${nombrePersona(it.responsableId)} · se espera el ${fechaCorta(it.fecha)}`);
        else {
          const r = it.recibos[0];
          partes.push(fechaCorta(r.fecha), nombreCuenta(r.cuentaId));
          if (it.faltanDeducciones) partes.push(it.faltanDeducciones === 1 ? 'falta 1 deducción' : `faltan ${it.faltanDeducciones} deducciones`);
          else if (r.creadoPor) partes.push(`anotó ${nombrePersona(r.creadoPor)}`);
        }
      } else if (it.planilla) {
        partes.push(`Planilla de ${it.planilla.ingreso.nombre}: ${it.planilla.descontados} de ${it.planilla.esperados}`);
      } else if (it.estado === 'parcial') {
        partes.push(`${fmt(it.real)} de ${fmt(it.esperado)}`, `${it.pagos.length} ${it.pagos.length === 1 ? 'pago' : 'pagos'}`);
      } else if (!it.hecho) {
        partes.push(nombrePersona(it.responsableId));
        if (it.dia) partes.push(`día ${it.dia}`);
        if (it.forma === 'abonos') partes.push('en abonos');
        if (it.arrastre > 0) partes.push(`+${fmt(it.arrastre)} del mes pasado`);
      } else {
        const m = it.pagos[it.pagos.length - 1];
        partes.push(fechaCorta(m.fecha), `pagó ${nombrePersona(m.personaId)}`);
        if (m.creadoPor && m.creadoPor !== m.personaId) partes.push(`anotó ${nombrePersona(m.creadoPor)}`);
        if (it.pagos.length > 1) partes.push(`${it.pagos.length} pagos`);
      }
      if (otroMes.value) partes.push(`de ${otroMes.value}`);
      return partes.join(' · ');
    });
    const nota = computed(() => {
      const it = props.it;
      if (props.parte !== null && props.parte !== it.esperado) return { texto: `mitad de ${fmt(it.esperado)}`, clase: 'tenue' };
      if (it.tipoItem === 'tarjeta') {
        if (it.estado === 'parcial') return { texto: `quedan ${fmt(it.queda)}`, clase: it.situacion === 'vencido' ? 'negativo' : 'tenue' };
        return it.estimado && !it.hecho ? { texto: it.situacion === 'abierto' ? 'lo que va' : '≈ con la última tasa', clase: 'tenue' } : null;
      }
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

    <div v-if="tramos.length" class="chips-filtro" role="group" aria-label="Ver por pago">
      <button type="button" class="chip-filtro" :class="{ activo: elegido === 'todo' }" :aria-pressed="elegido === 'todo'" @click="elegido = 'todo'">Todo el mes</button>
      <button v-for="t in tramos" :key="t.clave" type="button" class="chip-filtro" :class="{ activo: elegido === t.clave }" :aria-pressed="elegido === t.clave" @click="elegido = t.clave">{{ etiqueta(t) }}</button>
    </div>

    <template v-if="tramo">
      <article class="tarjeta">
        <div class="tarjeta-cab centro pegada">
          <h2>{{ tramo.sinPago ? 'Antes del primer pago' : 'Este pago' }}</h2>
          <span class="tenue" style="font-size: 0.85rem">del {{ fechaCorta(tramo.inicio) }} al {{ fechaCorta(tramo.fin) }}</span>
        </div>
        <p class="hero-num md" style="margin-top: 10px" :class="{ negativo: tramo.disponible < 0 }">{{ fmt(tramo.disponible) }}</p>
        <p class="nota">{{ tramo.disponible < 0 ? 'Faltan para cubrir lo que toca pagar con este pago.' : 'Disponible después de lo que toca pagar con este pago.' }}</p>
        <dl class="datos sin-linea" style="margin-top: 10px">
          <dt>Entra</dt><dd>{{ fmt(tramo.entra) }}<span v-if="tramo.recibido < tramo.entra" class="tenue"> · recibido {{ fmt(tramo.recibido) }}</span></dd>
          <dt>Sale (plan)</dt><dd>{{ fmt(tramo.sale) }}<span class="tenue"> · pagado {{ fmt(tramo.pagado) }}</span></dd>
          <dt>Fuera del plan</dt><dd>{{ fmt(tramo.fueraDelPlan) }}</dd>
        </dl>
      </article>

      <article v-if="tramo.ingresos.length" class="tarjeta">
        <div class="tarjeta-cab pegada"><h2 class="titulo-grupo"><i class="punto" style="background: var(--ok)"></i> Entra</h2><span class="monto texto2">{{ fmt(tramo.entra) }}</span></div>
        <ul class="lista"><fila-item v-for="it in tramo.ingresos" :key="it.clave" :it="it" :periodo="periodoDe(it.ocurrencia)"/></ul>
      </article>
      <article class="tarjeta">
        <div class="tarjeta-cab pegada"><h2 class="titulo-grupo">Sale</h2><span class="monto texto2">{{ fmt(tramo.sale) }}</span></div>
        <ul v-if="tramo.items.length" class="lista">
          <fila-item v-for="x in tramo.items" :key="x.it.clave + x.periodo + x.porcion" :it="x.it" :periodo="x.periodo" :parte="x.porcion === 1 ? null : x.esperado / 100"/>
        </ul>
        <p v-else class="vacio" style="padding: 10px 0">Nada que pagar con este pago.</p>
      </article>
      <p class="nota chica">Cada pago cubre lo que vence hasta el día antes del siguiente. Las partidas sin día se reparten entre los dos pagos del mes; en cada partida se puede elegir con cuál se paga.</p>
    </template>

    <template v-else>
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

      <a v-if="r.descontado.total" class="tarjeta enlace-tarjeta" href="#/salarios">
        <div class="fila-info">
          <span style="font-weight: 600">Descontado en planilla: {{ fmt(r.descontado.total) }}</span>
          <span class="fila-sub envuelve">{{ textoDescontado }}</span>
        </div>
        <icono n="der" :t="20"/>
      </a>
      <a v-if="pagosTarjeta.total" class="tarjeta enlace-tarjeta" href="#/tarjetas">
        <div class="fila-info">
          <span style="font-weight: 600">Pagos de tarjeta: {{ fmt(pagosTarjeta.total) }}</span>
          <span class="fila-sub envuelve">{{ pagosTarjeta.texto }}</span>
        </div>
        <icono n="der" :t="20"/>
      </a>
      <a v-if="r.fueraDelPlan" class="tarjeta enlace-tarjeta" href="#/movimientos">
        <div class="fila-info">
          <span style="font-weight: 600">Fuera del plan: {{ fmt(r.fueraDelPlan) }}</span>
          <span class="fila-sub envuelve">Gastos de este mes que no son de ninguna partida.</span>
        </div>
        <icono n="der" :t="20"/>
      </a>
      <p class="nota chica">Lo que no está en esta lista (ropa, farmacia, regalos) regístralo con el botón +. Cuenta como gasto fuera del plan.</p>
    </template>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(indice(), store.periodo, filtro()));
    const tramos = computed(() => tramosDePago(indice(), store.periodo, filtro()));
    // Por defecto, en el mes actual se ve el pago que corre hoy.
    const elegido = ref('todo');
    const elegirPorDefecto = () => {
      const actual = periodoDe(store.hoy) === store.periodo ? tramos.value.find((t) => t.inicio <= store.hoy && store.hoy <= t.fin) : null;
      elegido.value = actual ? actual.clave : 'todo';
    };
    elegirPorDefecto();
    watch(() => store.periodo, elegirPorDefecto);
    const tramo = computed(() => (elegido.value === 'todo' ? null : tramos.value.find((t) => t.clave === elegido.value) || null));
    const etiqueta = (t) => {
      if (t.sinPago) return 'Antes del pago';
      const dia = Number(t.clave.slice(8, 10));
      return periodoDe(t.clave) === store.periodo ? `Pago del ${dia}` : `Pago del ${fechaCorta(t.clave)}`;
    };

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
        const medios = [...new Set(items.map((it) => (it.planilla ? 'planilla' : it.medioId || 'sin')))];
        const titulo = (id) => (id === 'planilla' ? 'Por planilla' : id === 'sin' ? 'Sin medio de pago' : nombreCuenta(id));
        return medios
          .map((id) => armar(id, titulo(id), null, items.filter((it) => (it.planilla ? 'planilla' : it.medioId || 'sin') === id)))
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
    const textoDescontado = computed(() => {
      const d = r.value.descontado;
      const conceptos = Object.entries(d.porConcepto).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${fmt(v)}`).join(' · ');
      return d.incompletos.length ? `${conceptos}. Faltan deducciones en ${d.incompletos.length} ${d.incompletos.length === 1 ? 'pago' : 'pagos'}.` : conceptos;
    });
    const antesDelInicio = computed(() => store.periodo < store.doc.config.inicio);
    // Pagos de tarjeta con fecha límite en el mes: son salida de dinero, no gasto del mes.
    const pagosTarjeta = computed(() => {
      const items = pagosDeTarjetas(indice(), `${store.periodo}-01`, fechaEnMes(store.periodo, 31), filtro());
      const total = redondear(items.reduce((a, it) => a + (it.hecho ? it.real : it.esperado), 0));
      const texto = items.map((it) => `${it.tarjeta.nombre} ${it.hecho ? 'pagada' : `vence el ${fechaCorta(it.limite)}`}`).join(' · ');
      return { total, texto: `${texto}. Las compras ya cuentan como gasto en su mes; esto es el dinero que sale de la cuenta.` };
    });

    return {
      store, r, tramos, elegido, tramo, etiqueta, orden, ordenes: ORDENES, definirOrdenMes, sinResponsable, secciones, pct, avanceTexto, textoDescontado,
      antesDelInicio, pagosTarjeta, fmt, nombrePeriodo, fechaCorta, periodoDe,
    };
  },
};
