import { store, fmt, vivos, nombrePersona, guardarConfig } from '../store.js';
import { estadoPrestamo, prestamosParaSimular, simularDeudas, ordenarPrioridad } from '../core/finanzas.js';
import { nombrePeriodo, sumarMeses, mesesEntre, duracion, periodoActual } from '../core/util.js';
import { ChartBox, Icono } from './componentes.js';
import { lineasDeuda, violeta, gris, grisClaro, serie } from './graficos.js';
import { nuevoMovimiento, editarPrestamo } from './formularios.js';

const { reactive, computed, watch, onBeforeUnmount } = Vue;

const PLAN_INICIAL = { estrategia: 'bola', extraMensual: 0, extraJunio: 0, extraDiciembre: 0, excluidos: [], orden: [] };
const copia = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- Simulador bola de nieve

export const Simulador = {
  components: { ChartBox, Icono },
  template: `
  <section class="seccion">
    <h2>Plan bola de nieve</h2>
    <p class="nota">Simula cuánto pagarle a las deudas de ahora en adelante. Cada mes se paga lo mismo que hoy
      ({{ fmt(cuotasIncluidas) }} en cuotas) más lo extra, y cuando un préstamo se termina, su cuota completa pasa al siguiente de la lista.</p>

    <div class="tarjeta">
      <div class="segmentos" role="group" aria-label="Estrategia">
        <button v-for="e in estrategias" :key="e.id" type="button" :class="{ activo: plan.estrategia === e.id }" :aria-pressed="plan.estrategia === e.id" @click="plan.estrategia = e.id">{{ e.nombre }}</button>
      </div>
      <p class="nota">{{ estrategiaActual.ayuda }}</p>
      <div class="fila-campos">
        <label class="campo"><span>Extra cada mes</span><input v-model.number="plan.extraMensual" type="number" min="0" step="500" inputmode="decimal"></label>
        <label class="campo"><span>Extra en junio (décimo cuarto)</span><input v-model.number="plan.extraJunio" type="number" min="0" step="1000" inputmode="decimal"></label>
        <label class="campo"><span>Extra en diciembre (décimo tercero)</span><input v-model.number="plan.extraDiciembre" type="number" min="0" step="1000" inputmode="decimal"></label>
      </div>
      <h3 style="margin: 16px 0 4px">Orden de pago</h3>
      <ul class="lista">
        <li v-for="(p, i) in listaOrden" :key="p.id">
          <label class="casilla crece">
            <input type="checkbox" :checked="!plan.excluidos.includes(p.id)" @change="alternar(p.id)">
            <span><strong v-if="!plan.excluidos.includes(p.id)">{{ i + 1 }}.</strong> {{ p.nombre }}
              <span class="tenue">· {{ fmt(p.saldo) }} · {{ p.tasa }}%</span></span>
          </label>
          <template v-if="plan.estrategia === 'personalizado' && !plan.excluidos.includes(p.id)">
            <button type="button" class="icono-btn" :aria-label="'Subir ' + p.nombre" @click="mover(p.id, -1)"><icono n="arriba"/></button>
            <button type="button" class="icono-btn" :aria-label="'Bajar ' + p.nombre" @click="mover(p.id, 1)"><icono n="abajo"/></button>
          </template>
        </li>
      </ul>
    </div>

    <p v-if="!incluidos.length" class="vacio">Marca al menos un préstamo para simular.</p>
    <template v-else>
      <div class="resultado">
        <div class="kpi destacado"><span>Con el plan terminan en</span><strong>{{ nombrePeriodo(con.fin) }}</strong><small>{{ duracion(con.meses) }} desde hoy</small></div>
        <div class="kpi"><span>Sin plan terminarían en</span><strong>{{ nombrePeriodo(sin.fin) }}</strong><small>{{ mesesAntes > 0 ? duracion(mesesAntes) + ' más tarde' : 'lo mismo' }}</small></div>
        <div class="kpi"><span>Intereses y seguros que se ahorran</span><strong>{{ fmt(ahorro) }}</strong><small>{{ fmt(con.interes + con.seguros) }} con el plan</small></div>
        <div class="kpi"><span>Pago mensual a deudas</span><strong>{{ fmt(con.presupuesto) }}</strong><small v-if="extrasAnuales">+ {{ fmt(extrasAnuales) }} al año en junio y diciembre</small><small v-else>cuotas actuales + extra</small></div>
      </div>
      <div class="tarjeta">
        <div class="leyenda">
          <span><i :style="{ background: colorSin }"></i>Sin plan (línea punteada)</span>
          <span><i :style="{ background: colorCon }"></i>Con el plan</span>
        </div>
        <chart-box :config="cfg" :alto="260" etiqueta="Saldo total de las deudas mes a mes, con y sin plan"/>
        <div class="envoltura-tabla" style="margin-top: 12px">
          <table class="tabla">
            <thead><tr><th>#</th><th>Préstamo</th><th class="num">Saldo hoy</th><th>Sin plan</th><th>Con el plan</th><th class="num">Antes</th></tr></thead>
            <tbody>
              <tr v-for="f in filas" :key="f.id">
                <td>{{ f.i }}</td><td>{{ f.nombre }}</td><td class="num">{{ fmt(f.saldo) }}</td>
                <td>{{ nombrePeriodo(f.finSin, true) }}</td><td><strong>{{ nombrePeriodo(f.finCon, true) }}</strong></td>
                <td class="num">{{ f.antes > 0 ? duracion(f.antes) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="plan.excluidos.length && con.fin" class="nota">Desde {{ nombrePeriodo(sumarMeses(con.fin, 1)) }} quedarían libres {{ fmt(con.presupuesto) }} al mes;
          los préstamos fuera del plan siguen su calendario normal.</p>
        <p class="nota">Supuestos: tasas fijas, sin penalidades y con abonos a capital permitidos. Es una simulación, no asesoría financiera.
          El plan se guarda y lo ven todos en el hogar.</p>
      </div>
    </template>
  </section>`,
  setup() {
    const plan = reactive({ ...copia(PLAN_INICIAL), ...copia(store.doc.config.plan || {}) });

    // El plan vive en el documento: si la otra persona lo cambia, aquí se actualiza.
    watch(() => store.doc.config.plan, (p) => {
      if (p && JSON.stringify(p) !== JSON.stringify(plan)) Object.assign(plan, copia(p));
    });
    let temporizador = null;
    watch(plan, () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (JSON.stringify(store.doc.config.plan || {}) !== JSON.stringify(plan)) guardarConfig({ plan: copia(plan) });
      }, 800);
    }, { deep: true });
    onBeforeUnmount(() => clearTimeout(temporizador));

    const todos = computed(() => prestamosParaSimular(store.doc));
    const incluidos = computed(() => todos.value.filter((p) => !plan.excluidos.includes(p.id)));
    const cuotasIncluidas = computed(() => incluidos.value.reduce((a, p) => a + p.cuota, 0));
    const desde = computed(() => {
      const ultimos = todos.value.map((p) => p.ultimoPeriodo).sort();
      return ultimos.length ? sumarMeses(ultimos[ultimos.length - 1], 1) : sumarMeses(periodoActual(), 1);
    });
    const ordenManual = computed(() => plan.orden.length ? plan.orden : ordenarPrioridad(incluidos.value, 'bola').map((p) => p.id));
    const opciones = computed(() => ({
      desde: desde.value, estrategia: plan.estrategia, orden: ordenManual.value,
      extraMensual: Number(plan.extraMensual) || 0, extraJunio: Number(plan.extraJunio) || 0, extraDiciembre: Number(plan.extraDiciembre) || 0,
    }));
    const sin = computed(() => simularDeudas(incluidos.value, { desde: desde.value, rodar: false }));
    const con = computed(() => simularDeudas(incluidos.value, opciones.value));
    const mesesAntes = computed(() => (sin.value.fin && con.value.fin ? mesesEntre(con.value.fin, sin.value.fin) : 0));
    const ahorro = computed(() => sin.value.interes + sin.value.seguros - con.value.interes - con.value.seguros);
    const extrasAnuales = computed(() => (Number(plan.extraJunio) || 0) + (Number(plan.extraDiciembre) || 0));
    const listaOrden = computed(() => [
      ...con.value.orden.map((id) => todos.value.find((p) => p.id === id)),
      ...todos.value.filter((p) => plan.excluidos.includes(p.id)),
    ].filter(Boolean));
    const filas = computed(() => con.value.orden.map((id, i) => {
      const c = con.value.prestamos.find((p) => p.id === id);
      const s = sin.value.prestamos.find((p) => p.id === id);
      return { i: i + 1, id, nombre: c.nombre, saldo: c.saldoInicial, finSin: s?.fin, finCon: c.fin, antes: s?.fin && c.fin ? mesesEntre(c.fin, s.fin) : 0 };
    }));

    function alternar(id) {
      plan.excluidos = plan.excluidos.includes(id) ? plan.excluidos.filter((x) => x !== id) : [...plan.excluidos, id];
    }
    function mover(id, delta) {
      const ids = ordenarPrioridad(incluidos.value, 'personalizado', ordenManual.value).map((p) => p.id);
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      plan.orden = ids;
    }

    const cfg = () => {
      const s = sin.value.serie;
      const c = con.value.serie;
      if (!s.length) return null;
      const periodos = Array.from({ length: Math.max(s.length, c.length) + 1 }, (_, i) => sumarMeses(desde.value, i - 1));
      const total = incluidos.value.reduce((a, p) => a + p.saldo, 0);
      const valores = (serieSim) => periodos.map((_, i) => (i === 0 ? total : serieSim[i - 1]?.total ?? 0));
      return lineasDeuda(periodos, valores(s), valores(c), (p) => nombrePeriodo(p, true));
    };

    const estrategias = [
      { id: 'bola', nombre: 'Bola de nieve', ayuda: 'Primero el préstamo con menor saldo: se terminan deudas más rápido y se ve el avance.' },
      { id: 'avalancha', nombre: 'Avalancha', ayuda: 'Primero el préstamo con la tasa más alta: suele ahorrar más en intereses.' },
      { id: 'personalizado', nombre: 'Mi orden', ayuda: 'Ustedes eligen el orden con las flechas.' },
    ];
    const estrategiaActual = computed(() => estrategias.find((e) => e.id === plan.estrategia) || estrategias[0]);

    return {
      plan, todos, incluidos, cuotasIncluidas, sin, con, mesesAntes, ahorro, extrasAnuales, listaOrden, filas, alternar, mover, cfg,
      estrategias, estrategiaActual, fmt, nombrePeriodo, duracion, sumarMeses, colorSin: gris(), colorCon: serie(0),
    };
  },
};

// ---------------------------------------------------------------- Vista de préstamos

export const VistaPrestamos = {
  components: { Simulador },
  template: `
  <section>
    <div class="kpis">
      <div class="kpi"><span>Deuda total</span><strong>{{ fmt(totales.saldo) }}</strong><small>{{ activos.length }} préstamos activos</small></div>
      <div class="kpi"><span>Cuotas al mes</span><strong>{{ fmt(totales.cuotas) }}</strong><small>incluye seguros</small></div>
      <div class="kpi"><span>Interés este mes</span><strong>{{ fmt(totales.interes) }}</strong><small>{{ totales.cuotas ? Math.round(totales.interes / totales.cuotas * 100) : 0 }}% de las cuotas</small></div>
    </div>

    <div class="tarjetas">
      <article v-for="x in lista" :key="x.p.id" class="tarjeta">
        <header><h3>{{ x.p.nombre }}</h3><span class="chip">{{ nombrePersona(x.p.responsableId) }}</span><span v-if="x.e.pagado" class="chip ok">Pagado</span></header>
        <p class="grande monto">{{ fmt(x.e.saldo) }}</p>
        <p class="nota" style="margin-top: 2px">Saldo estimado · {{ x.p.tasa }}% anual · cuota {{ fmt(x.p.cuota) }}</p>
        <template v-if="!x.e.pagado">
          <div class="reparto" role="img" :aria-label="descripcionReparto(x)">
            <span v-for="s in partes(x)" :key="s.n" :style="{ flex: s.v, background: s.c }"></span>
          </div>
          <div class="leyenda"><span v-for="s in partes(x)" :key="s.n"><i :style="{ background: s.c }"></i>{{ s.n }} {{ fmt(s.v) }}</span></div>
          <dl class="datos">
            <dt>Termina</dt><dd>{{ nombrePeriodo(x.e.finEstimado) }}</dd>
            <dt>Cuotas que faltan</dt><dd>{{ x.e.restantes }}</dd>
            <dt>Seguro en la cuota</dt><dd>{{ fmt(x.e.seguro) }}{{ x.p.seguro == null ? ' (estimado)' : '' }}</dd>
            <dt>Saldo según</dt><dd>cuota de {{ nombrePeriodo(x.p.saldoPeriodo, true) }}{{ x.e.cuotasPagadas ? ' + ' + x.e.cuotasPagadas + ' pagos registrados' : '' }}</dd>
          </dl>
        </template>
        <div class="botones">
          <button v-if="!x.e.pagado" type="button" class="btn chico" @click="abonar(x.p)">Abonar a capital</button>
          <button type="button" class="btn chico" @click="editarPrestamo(x.p)">Editar o actualizar saldo</button>
        </div>
      </article>
    </div>
    <div class="botones"><button type="button" class="btn" @click="editarPrestamo()">+ Nuevo préstamo</button></div>

    <simulador v-if="activos.length"/>
  </section>`,
  setup() {
    const lista = computed(() => vivos('prestamos')
      .map((p) => ({ p, e: estadoPrestamo(p, store.doc.movimientos) }))
      .sort((a, b) => a.e.pagado - b.e.pagado || b.e.saldo - a.e.saldo));
    const activos = computed(() => lista.value.filter((x) => !x.e.pagado));
    const totales = computed(() => ({
      saldo: activos.value.reduce((a, x) => a + x.e.saldo, 0),
      cuotas: activos.value.reduce((a, x) => a + x.p.cuota, 0),
      interes: activos.value.reduce((a, x) => a + x.e.interesMes, 0),
    }));
    const partes = (x) => {
      const capital = Math.max(0, x.p.cuota - x.e.seguro - x.e.interesMes);
      return [
        { n: 'Interés', v: x.e.interesMes, c: violeta() },
        { n: 'Capital', v: capital, c: gris() },
        { n: 'Seguro', v: x.e.seguro, c: grisClaro() },
      ];
    };
    const descripcionReparto = (x) => partes(x).map((s) => `${s.n} ${fmt(s.v)}`).join(', ');
    const abonar = (p) => nuevoMovimiento({ tipo: 'abono', prestamoId: p.id, cuentaId: p.cuentaId || 'gastos', personaId: store.yo });
    return { lista, activos, totales, partes, descripcionReparto, abonar, editarPrestamo, fmt, nombrePersona, nombrePeriodo };
  },
};
