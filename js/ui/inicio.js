import { store, fmt, vivos, cuentas, nombrePersona, nombreCategoria } from '../store.js';
import { resumenMes, saldosCuentas, historial, estadoPrestamo } from '../core/finanzas.js';
import { nombrePeriodo, redondear, mesesEntre } from '../core/util.js';
import { ChartBox } from './componentes.js';
import { barrasHorizontales, columnasApiladas, serie, violeta, CLASES_GRAFICO } from './graficos.js';
import { registrarCompromiso } from './formularios.js';

const { computed } = Vue;

export const VistaInicio = {
  components: { ChartBox },
  template: `
  <section>
    <div v-if="sinPersonas" class="banner">
      <p>Para empezar, importa tu archivo de datos o agrega a las personas del hogar.</p>
      <a class="btn primario" href="#/ajustes">Ir a Ajustes</a>
    </div>
    <div v-else-if="faltan.length" class="banner aviso">
      <p>Faltan montos por definir: {{ faltan.map((t) => t.nombre).join(', ') }}.</p>
      <a class="btn chico" href="#/presupuesto">Definirlos</a>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Ingresos</span><strong>{{ fmt(r.ingresoReal) }}</strong><small>de {{ fmt(r.ingresoEsperado) }} esperados</small></div>
      <div class="kpi"><span>Compromisos pagados</span><strong>{{ fmt(r.pagado) }}</strong><small>faltan {{ fmt(r.pendiente) }}</small></div>
      <div class="kpi"><span>Gastos adicionales</span><strong>{{ fmt(r.adicionales) }}</strong><small>fuera de los compromisos</small></div>
      <div class="kpi"><span>Libre del mes</span><strong :class="{ negativo: r.libre < 0 }">{{ fmt(r.libre) }}</strong><small>ingresos − compromisos − adicionales</small></div>
    </div>

    <div class="tarjetas">
      <article class="tarjeta">
        <header><h2>Cuentas</h2><a class="btn texto chico" href="#/cuentas">Ver</a></header>
        <ul class="lista">
          <li v-for="c in listaCuentas" :key="c.id">
            <div class="info">
              <span class="titulo">{{ c.nombre }}</span>
              <div v-if="c.meta" class="progreso acento" role="img" :aria-label="'Avance de la meta: ' + pct(c) + '%'"><div :style="{ width: pct(c) + '%' }"></div></div>
            </div>
            <div class="derecha"><span class="monto" :class="{ negativo: c.saldo < 0 }">{{ fmt(c.saldo) }}</span>
              <small v-if="c.meta">meta {{ fmt(c.meta) }}</small></div>
          </li>
        </ul>
        <div class="total-fila"><span>Total</span><span class="monto">{{ fmt(totalCuentas) }}</span></div>
      </article>

      <article class="tarjeta">
        <header><h2>Pendientes del mes</h2><a class="btn texto chico" href="#/mes">Ver todo</a></header>
        <p v-if="!r.pendientes.length" class="vacio">Todo lo del mes está registrado.</p>
        <ul v-else class="lista">
          <li v-for="it in pendientes" :key="it.clave" class="clic" @click="registrar(it)">
            <button type="button" class="check" :aria-label="'Registrar ' + it.nombre" @click.stop="registrar(it)"></button>
            <div class="info"><span class="titulo">{{ it.nombre }}</span>
              <span class="sub"><span class="chip">{{ nombrePersona(it.responsableId) }}</span><span v-if="it.dia">día {{ it.dia }}</span></span></div>
            <span class="monto">{{ fmt(it.esperado) }}</span>
          </li>
        </ul>
        <p v-if="r.pendientes.length > pendientes.length" class="nota">y {{ r.pendientes.length - pendientes.length }} más en la pestaña Mes.</p>
      </article>

      <article class="tarjeta">
        <header><h2>Gasto del mes por tipo</h2><span class="monto tenue">{{ fmt(r.gastoReal) }}</span></header>
        <chart-box :config="cfgClases" :alto="210" etiqueta="Gasto del mes por tipo" vacio="Aún no hay gastos registrados este mes."/>
      </article>

      <article class="tarjeta">
        <header><h2>Gasto por categoría</h2></header>
        <chart-box :config="cfgCategorias" :alto="230" etiqueta="Gasto del mes por categoría" vacio="Aún no hay gastos registrados este mes."/>
      </article>

      <article class="tarjeta ancha">
        <header><h2>Mes a mes</h2></header>
        <div class="leyenda"><span v-for="(c, i) in clases" :key="c[0]"><i :style="{ background: color(i) }"></i>{{ c[1] }}</span></div>
        <chart-box :config="cfgHistorial" :alto="250" etiqueta="Gasto por tipo en los últimos seis meses" vacio="Cuando registres gastos, aquí verás cómo cambian mes a mes."/>
      </article>

      <article class="tarjeta">
        <header><h2>Deudas</h2><a class="btn texto chico" href="#/prestamos">Plan</a></header>
        <p class="grande monto">{{ fmt(deudas.total) }}</p>
        <p class="nota" v-if="deudas.n">{{ deudas.n }} préstamos activos · el próximo termina en {{ nombrePeriodo(deudas.proximo) }}.</p>
        <p class="nota" v-else>No hay préstamos activos.</p>
      </article>
    </div>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(store.doc, store.periodo));
    const saldos = computed(() => saldosCuentas(store.doc));
    const listaCuentas = computed(() => cuentas().map((c) => ({ ...c, saldo: saldos.value[c.id] || 0 })));
    const totalCuentas = computed(() => listaCuentas.value.reduce((a, c) => a + c.saldo, 0));
    const pendientes = computed(() => r.value.pendientes.slice(0, 6));
    const faltan = computed(() => vivos('plantillas').filter((t) => t.activo !== false && !Number(t.clase === 'provision' ? t.montoAnual : t.monto)));
    const sinPersonas = computed(() => !vivos('personas').length);
    const deudas = computed(() => {
      const activos = vivos('prestamos').map((p) => estadoPrestamo(p, store.doc.movimientos)).filter((e) => !e.pagado);
      return {
        n: activos.length,
        total: activos.reduce((a, e) => a + e.saldo, 0),
        proximo: activos.map((e) => e.finEstimado).filter(Boolean).sort()[0],
      };
    });
    const pct = (c) => Math.max(0, Math.min(100, Math.round((c.saldo / c.meta) * 100)));

    const cfgClases = () => {
      const valores = CLASES_GRAFICO.map(([k]) => redondear(r.value.porClase[k]));
      if (!valores.some(Boolean)) return null;
      return barrasHorizontales(CLASES_GRAFICO.map((c) => c[1]), valores, CLASES_GRAFICO.map((_, i) => serie(i)));
    };
    const cfgCategorias = () => {
      const filas = Object.entries(r.value.porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (!filas.length) return null;
      return barrasHorizontales(filas.map(([id]) => nombreCategoria(id)), filas.map(([, v]) => redondear(v)), violeta());
    };
    // Hasta 6 meses, sin mostrar los anteriores al inicio del registro.
    const hist = computed(() => {
      const desdeInicio = mesesEntre(store.doc.config.inicio || store.periodo, store.periodo) + 1;
      return historial(store.doc, store.periodo, Math.min(6, Math.max(1, desdeInicio)));
    });
    const cfgHistorial = () => {
      const h = hist.value;
      if (!h.some((m) => m.gastoReal > 0)) return null;
      return columnasApiladas(
        h.map((m) => nombrePeriodo(m.periodo, true)),
        CLASES_GRAFICO.map(([k, nombre]) => ({ nombre, valores: h.map((m) => redondear(m.porClase[k])) })),
      );
    };

    return {
      r, listaCuentas, totalCuentas, pendientes, faltan, sinPersonas, deudas, pct, cfgClases, cfgCategorias, cfgHistorial,
      clases: CLASES_GRAFICO, color: serie, fmt, nombrePersona, nombrePeriodo,
      registrar: (it) => registrarCompromiso(it, store.periodo),
    };
  },
};
