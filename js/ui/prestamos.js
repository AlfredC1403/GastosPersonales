import { store, fmt, fmtEntero, fmtCorto, indice, vivos, nombrePersona, guardarConfig, filtro, personaFiltro } from '../store.js';
import { estadoDe, prestamosParaSimular, simularDeudas, ordenarPrioridad } from '../core/prestamos.js';
import { planillaDe } from '../core/nomina.js';
import { coincidePersona } from '../core/filtro.js';
import { nombrePeriodo, sumarMeses, mesesEntre, duracion, periodoActual } from '../core/util.js';
import { Icono } from './componentes.js';
import { BarraSegmentos, LineaPlan } from './graficos.js';
import { nuevoMovimiento, editarPrestamo } from './formularios.js';

const { reactive, computed, watch, onBeforeUnmount } = Vue;

const PLAN_INICIAL = { estrategia: 'bola', extraMensual: 0, extraJunio: 0, extraDiciembre: 0, excluidos: [], orden: [] };
const copia = (x) => JSON.parse(JSON.stringify(x));

// "−10 m", "−2 a", "−21 a 8 m"
function antesCorto(meses) {
  if (!(meses > 0)) return '';
  if (meses < 12) return `−${meses} m`;
  const a = Math.floor(meses / 12);
  const m = meses % 12;
  return `−${a} a${m ? ` ${m} m` : ''}`;
}

// ---------------------------------------------------------------- Simulador bola de nieve

export const Simulador = {
  components: { Icono, LineaPlan },
  template: `
  <div class="pila">
    <div style="margin-top: 8px">
      <h2 class="cifra" style="font-size: 1.5rem">Plan bola de nieve</h2>
      <p class="nota" style="margin-top: 4px">Cada mes se paga lo mismo que hoy ({{ fmt(cuotasIncluidas) }} en cuotas) más lo extra.
        Cuando un préstamo se termina, su cuota completa pasa al siguiente.</p>
    </div>

    <article class="tarjeta">
      <div class="segmentos" role="group" aria-label="Estrategia">
        <button v-for="e in estrategias" :key="e.id" type="button" :class="{ activo: plan.estrategia === e.id }" :aria-pressed="plan.estrategia === e.id" @click="plan.estrategia = e.id">{{ e.nombre }}</button>
      </div>
      <p class="nota" style="margin-top: 10px">{{ estrategiaActual.ayuda }}</p>
      <div class="fila-campos" style="margin-top: 14px">
        <label class="campo"><span>Extra cada mes</span><input v-model.number="plan.extraMensual" type="number" min="0" step="500" inputmode="decimal"></label>
        <label class="campo"><span>Extra en junio</span><input v-model.number="plan.extraJunio" type="number" min="0" step="1000" inputmode="decimal"></label>
        <label class="campo"><span>Extra en diciembre</span><input v-model.number="plan.extraDiciembre" type="number" min="0" step="1000" inputmode="decimal"></label>
      </div>
      <p class="nota chica" style="margin-top: 8px">Junio y diciembre sirven para simular abonos con el décimo cuarto y el décimo tercer mes.</p>
      <h3 class="titulo-grupo" style="margin-top: 18px">Orden de pago</h3>
      <ol class="lista" style="margin-top: 6px">
        <li v-for="(p, i) in listaOrden" :key="p.id" class="fila">
          <span class="num-circulo" :class="{ fuera: fuera(p.id) }">{{ fuera(p.id) ? '–' : i + 1 }}</span>
          <span class="fila-titulo" :class="{ tenue: fuera(p.id) }" style="flex: 1; min-width: 0; font-size: 0.92rem">{{ p.nombre }}</span>
          <span class="tenue" style="font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap">{{ fmtEntero(p.saldo) }} · {{ p.tasa }}%</span>
          <template v-if="plan.estrategia === 'personalizado' && !fuera(p.id)">
            <button type="button" class="btn-icono" :aria-label="'Subir ' + p.nombre" @click="mover(p.id, -1)"><icono n="arriba" :t="16"/></button>
            <button type="button" class="btn-icono" :aria-label="'Bajar ' + p.nombre" @click="mover(p.id, 1)"><icono n="abajo" :t="16"/></button>
          </template>
          <button type="button" class="interruptor chico" :class="{ on: !fuera(p.id) }" role="switch" :aria-checked="!fuera(p.id)"
                  :aria-label="(fuera(p.id) ? 'Incluir ' : 'Sacar del plan ') + p.nombre" @click="alternar(p.id)"><span></span></button>
        </li>
      </ol>
    </article>

    <p v-if="!incluidos.length" class="vacio">Activa al menos un préstamo para simular.</p>
    <template v-else>
      <div class="kpis">
        <div class="kpi destacado"><div class="kpi-et">Con el plan terminan en</div><div class="kpi-val">{{ nombrePeriodo(con.fin) }}</div><div class="kpi-nota">{{ duracion(con.meses) }} desde hoy</div></div>
        <div class="kpi"><div class="kpi-et">Sin plan</div><div class="kpi-val">{{ nombrePeriodo(sin.fin) }}</div><div class="kpi-nota">{{ mesesAntes > 0 ? duracion(mesesAntes) + ' más tarde' : 'lo mismo' }}</div></div>
        <div class="kpi"><div class="kpi-et">Se ahorran</div><div class="kpi-val positivo">{{ fmtEntero(ahorro) }}</div><div class="kpi-nota">en intereses y seguros</div></div>
        <div class="kpi"><div class="kpi-et">Pago mensual</div><div class="kpi-val">{{ fmt(con.presupuesto) }}</div><div class="kpi-nota">{{ extrasAnuales ? '+ ' + fmtEntero(extrasAnuales) + ' al año en junio y diciembre' : 'cuotas actuales + extra' }}</div></div>
      </div>

      <article class="tarjeta">
        <div class="leyenda" style="margin: 0 0 12px">
          <span><i class="linea-sin"></i>Sin plan</span>
          <span><i class="linea-con"></i>Con el plan</span>
        </div>
        <linea-plan :periodos="grafico.periodos" :sin="grafico.sin" :con="grafico.con" :formatear-mes="(p) => nombrePeriodo(p)" :formatear="fmtCorto"/>
        <div class="envoltura-tabla">
          <table class="tabla">
            <thead><tr><th>Préstamo</th><th class="num">Saldo</th><th>Sin plan</th><th>Con el plan</th></tr></thead>
            <tbody>
              <tr v-for="f in filas" :key="f.id">
                <td>{{ f.nombre }}</td>
                <td class="num">{{ fmtEntero(f.saldo) }}</td>
                <td class="tenue">{{ nombrePeriodo(f.finSin, true) }}</td>
                <td><b style="font-weight: 600">{{ nombrePeriodo(f.finCon, true) }}</b><span v-if="f.antes > 0" class="positivo" style="display: block; font-size: 0.74rem">{{ antesCorto(f.antes) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="plan.excluidos.length && con.fin" class="nota" style="margin-top: 14px">Desde {{ nombrePeriodo(sumarMeses(con.fin, 1)) }} quedarían libres
          {{ fmt(con.presupuesto) }} al mes; los préstamos fuera del plan siguen su calendario normal.</p>
        <p class="nota chica" style="margin-top: 14px">Supuestos: tasas fijas, sin penalidades y con abonos a capital permitidos.
          Es una simulación, no asesoría financiera. El plan se guarda y lo ven todos en el hogar.</p>
      </article>
    </template>
  </div>`,
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

    const todos = computed(() => prestamosParaSimular(indice()));
    const fuera = (id) => plan.excluidos.includes(id);
    const incluidos = computed(() => todos.value.filter((p) => !fuera(p.id)));
    const cuotasIncluidas = computed(() => incluidos.value.reduce((a, p) => a + p.cuota, 0));
    const desde = computed(() => {
      const ultimos = todos.value.map((p) => p.ultimoPeriodo).sort();
      return ultimos.length ? sumarMeses(ultimos[ultimos.length - 1], 1) : sumarMeses(periodoActual(), 1);
    });
    const ordenManual = computed(() => (plan.orden.length ? plan.orden : ordenarPrioridad(incluidos.value, 'bola').map((p) => p.id)));
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
      ...todos.value.filter((p) => fuera(p.id)),
    ].filter(Boolean));
    const filas = computed(() => con.value.orden.map((id) => {
      const c = con.value.prestamos.find((p) => p.id === id);
      const s = sin.value.prestamos.find((p) => p.id === id);
      return { id, nombre: c.nombre, saldo: c.saldoInicial, finSin: s?.fin, finCon: c.fin, antes: s?.fin && c.fin ? mesesEntre(c.fin, s.fin) : 0 };
    }));

    // El gráfico cubre hasta que termina el plan (unos meses más para ver la línea en cero).
    const grafico = computed(() => {
      const total = incluidos.value.reduce((a, p) => a + p.saldo, 0);
      const n = Math.min(sin.value.serie.length, con.value.meses + 6) + 1;
      const periodos = Array.from({ length: n }, (_, i) => sumarMeses(desde.value, i - 1));
      const valores = (serie) => periodos.map((_, i) => (i === 0 ? total : serie[i - 1]?.total ?? 0));
      return { periodos, sin: valores(sin.value.serie), con: valores(con.value.serie) };
    });

    function alternar(id) {
      plan.excluidos = fuera(id) ? plan.excluidos.filter((x) => x !== id) : [...plan.excluidos, id];
    }
    function mover(id, delta) {
      const ids = ordenarPrioridad(incluidos.value, 'personalizado', ordenManual.value).map((p) => p.id);
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      plan.orden = ids;
    }

    const estrategias = [
      { id: 'bola', nombre: 'Bola de nieve', ayuda: 'Primero el préstamo con menor saldo: se terminan deudas más rápido y se ve el avance.' },
      { id: 'avalancha', nombre: 'Avalancha', ayuda: 'Primero el préstamo con la tasa más alta: suele ahorrar más en intereses.' },
      { id: 'personalizado', nombre: 'Mi orden', ayuda: 'Ustedes eligen el orden con las flechas.' },
    ];
    const estrategiaActual = computed(() => estrategias.find((e) => e.id === plan.estrategia) || estrategias[0]);

    return {
      plan, incluidos, cuotasIncluidas, sin, con, mesesAntes, ahorro, extrasAnuales, listaOrden, filas, grafico, fuera, alternar, mover,
      estrategias, estrategiaActual, fmt, fmtEntero, fmtCorto, nombrePeriodo, duracion, sumarMeses, antesCorto,
    };
  },
};

// ---------------------------------------------------------------- Vista de préstamos

export const VistaPrestamos = {
  components: { BarraSegmentos, Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Deuda total</p>
      <p class="hero-num">{{ fmt(totales.saldo) }}</p>
      <p class="hero-texto">{{ activos.length }} {{ activos.length === 1 ? 'préstamo activo' : 'préstamos activos' }} · {{ fmt(totales.cuotas) }} al mes · {{ fmt(totales.interes) }} de eso es interés.</p>
    </div>

    <article v-for="x in lista" :key="x.p.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ x.p.nombre }}</h2>
        <span class="chip">{{ nombrePersona(x.p.responsableId) }}</span>
        <span v-if="x.planilla" class="chip acento">{{ x.planilla }}</span>
        <span v-if="x.e.pagado" class="chip ok">Pagado</span>
      </div>
      <p class="hero-num" style="font-size: 1.85rem; margin-top: 8px">{{ fmt(x.e.saldo) }}</p>
      <p class="nota chica" style="margin: 6px 0 14px">{{ x.p.tasa }}% anual · cuota {{ fmt(x.p.cuota) }}{{ x.e.pagado ? '' : ' · ' + x.e.restantes + ' cuotas' }}</p>
      <template v-if="!x.e.pagado">
        <barra-segmentos clase="fina" :segmentos="partes(x)"/>
        <div class="leyenda">
          <span v-for="s in partes(x)" :key="s.nombre"><i class="punto" :style="{ background: s.color, border: s.borde }"></i>{{ s.nombre }} {{ fmtEntero(s.valor) }}</span>
        </div>
        <dl class="datos">
          <dt>Termina</dt><dd>{{ nombrePeriodo(x.e.finEstimado) }}</dd>
          <dt>Cuotas que faltan</dt><dd>{{ x.e.restantes }}</dd>
          <dt>Seguro en la cuota</dt><dd>{{ fmt(x.e.seguro) }}{{ x.p.seguro == null ? ' (estimado)' : '' }}</dd>
          <dt>Saldo según</dt><dd>cuota de {{ nombrePeriodo(x.p.saldoPeriodo, true) }}{{ x.e.cuotasPagadas ? ' + ' + x.e.cuotasPagadas + (x.e.cuotasPagadas === 1 ? ' cuota' : ' cuotas') : '' }}</dd>
          <template v-if="x.e.parciales.length"><dt>Cuotas incompletas</dt><dd>{{ x.e.parciales.map((m) => nombrePeriodo(m, true)).join(', ') }}</dd></template>
        </dl>
      </template>
      <div class="botones">
        <button v-if="!x.e.pagado" type="button" class="btn" @click="abonar(x.p)">Abonar a capital</button>
        <button type="button" class="btn" @click="editarPrestamo(x.p)">Editar</button>
      </div>
    </article>
    <p v-if="!lista.length" class="vacio">{{ personaFiltro() ? 'No hay préstamos a nombre de ' + nombrePersona(personaFiltro()) + '.' : 'No hay préstamos registrados.' }}</p>
    <button type="button" class="btn-punteado" @click="editarPrestamo()">+ Nuevo préstamo</button>

    <a v-if="activos.length" class="tarjeta enlace-tarjeta" href="#/plan-deudas">
      <div class="fila-info">
        <span style="font-weight: 600">Plan de deudas</span>
        <span class="fila-sub envuelve">Simula cuánto pagar de ahora en adelante y en qué fecha terminan.</span>
      </div>
      <icono n="der" :t="20"/>
    </a>
  </section>`,
  setup() {
    const lista = computed(() => vivos('prestamos')
      .filter((p) => coincidePersona(p.responsableId, filtro()))
      .map((p) => {
        const planilla = planillaDe(indice(), p.id);
        const texto = planilla ? `Por planilla · ${planilla.veces === 2 ? 'mitad en cada pago' : 'en un pago'}` : '';
        return { p, e: estadoDe(indice(), p), planilla: texto };
      })
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
        { nombre: 'Interés', valor: x.e.interesMes, color: 'var(--s2)', titulo: `Interés ${fmt(x.e.interesMes)}` },
        { nombre: 'Capital', valor: capital, color: 'var(--s3)', titulo: `Capital ${fmt(capital)}` },
        { nombre: 'Seguro', valor: x.e.seguro, color: 'var(--sup2)', borde: '1px solid var(--linea2)', titulo: `Seguro ${fmt(x.e.seguro)}` },
      ];
    };
    const abonar = (p) => nuevoMovimiento({ tipo: 'abono', prestamoId: p.id, cuentaId: p.cuentaId || 'gastos', personaId: store.yo });
    return { lista, activos, totales, partes, abonar, editarPrestamo, fmt, fmtEntero, nombrePersona, nombrePeriodo, personaFiltro };
  },
};

// ---------------------------------------------------------------- Plan de deudas

// El plan es del hogar: no se filtra por persona.
export const VistaPlanDeudas = {
  components: { Simulador },
  template: `
  <div class="pila">
    <p v-if="personaFiltro()" class="nota">El plan de deudas incluye los préstamos de todo el hogar, aunque tengas un filtro de persona.</p>
    <simulador v-if="hayPrestamos"/>
    <p v-else class="vacio">No hay préstamos activos para simular. <a href="#/prestamos">Agrega uno</a>.</p>
  </div>`,
  setup() {
    const hayPrestamos = computed(() => prestamosParaSimular(indice()).length > 0);
    return { hayPrestamos, personaFiltro };
  },
};
