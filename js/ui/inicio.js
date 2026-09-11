import { store, fmt, fmtEntero, fmtCorto, simbolo, vivos, cuentas, nombrePersona, nombreCategoria } from '../store.js';
import { resumenMes, saldosCuentas, historial, estadoPrestamo, deudaAl, presupuestoMensual } from '../core/finanzas.js';
import { nombrePeriodo, redondear, mesesEntre, sumarMeses, mesDe } from '../core/util.js';
import { prefs } from '../tema.js';
import { BarraSegmentos, ColumnasApiladas, Sparkline, CLASES_GRAFICO } from './graficos.js';
import { Icono } from './componentes.js';
import { marcarCompromiso, registrarCompromiso, abrirCompromiso } from './formularios.js';

const { computed } = Vue;

const DIA_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const COLOR_CLASE = { prestamo: 'var(--s1)', fijo: 'var(--s2)', fijo_variable: 'var(--s3)', provision: 'var(--s4)', aporte: 'var(--tinta3)', ingreso: 'var(--ok)' };
const MAX_PENDIENTES = 6;

export const VistaInicio = {
  components: { BarraSegmentos, ColumnasApiladas, Sparkline, Icono },
  template: `
  <section class="pila amplia">
    <div v-if="sinPersonas" class="aviso-banner">
      <p>Para empezar, importa tu archivo de datos o agrega a las personas del hogar.</p>
      <a class="btn primario" href="#/ajustes">Ir a Ajustes</a>
    </div>
    <div v-else-if="faltan.length" class="aviso-banner ambar">
      <p>Faltan montos por definir: {{ faltan.map((t) => t.nombre).join(', ') }}.</p>
      <a class="btn" href="#/presupuesto">Definirlos</a>
    </div>

    <div>
      <p class="etiqueta">{{ r.libre < 0 ? 'Faltan este mes' : 'Libre este mes' }}</p>
      <p class="hero-num xl" :class="{ negativo: r.libre < 0 }">{{ fmt(Math.abs(r.libre)) }}</p>
      <p v-if="!r.ingresoEsperado" class="hero-texto">Todavía no hay ingresos definidos. <a href="#/presupuesto">Agrégalos</a> para ver cuánto queda libre.</p>
      <p v-else-if="r.libre >= 0" class="hero-texto">De {{ fmt(r.ingresoEsperado) }} de ingresos quedan {{ fmt(r.libre) }} después de compromisos y gastos adicionales.</p>
      <p v-else class="hero-texto">De {{ fmt(r.ingresoEsperado) }} de ingresos faltan {{ fmt(-r.libre) }} para cubrir compromisos y gastos adicionales.</p>
      <barra-segmentos :segmentos="flujo" style="margin-top: 14px"/>
      <div class="leyenda">
        <span v-for="f in flujo" :key="f.nombre"><i class="punto" :style="{ background: f.color }"></i>{{ f.nombre }} <b>{{ fmtEntero(f.valor) }}</b></span>
      </div>
    </div>

    <article class="tarjeta">
      <div class="tarjeta-cab">
        <h2>Avance del mes</h2>
        <span class="monto" style="font-size: 1.05rem">{{ fmt(r.pagado) }}</span>
        <span class="tenue" style="font-size: 0.85rem">de {{ fmt(r.comprometido) }}</span>
      </div>
      <div class="progreso" role="img" :aria-label="'Pagado ' + Math.round(pct) + '%'"><div :style="{ width: pct + '%' }"></div></div>
      <p class="nota" style="margin-top: 10px">{{ avanceTexto }}</p>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Pendientes del mes</h2>
        <a class="btn-link" href="#/mes">Ver todo</a>
      </div>
      <p v-if="!r.pendientes.length" class="vacio">Todo lo del mes está registrado.</p>
      <ul v-else-if="prefs.pendientes === 'lista'" class="lista" style="margin-top: 8px">
        <li v-for="it in pendientes" :key="it.clave" class="fila">
          <button type="button" class="check" :aria-label="'Registrar ' + it.nombre" @click="marcar(it)"></button>
          <div class="fila-info clic" @click="registrar(it)">
            <span class="fila-titulo">{{ it.nombre }}</span>
            <span class="fila-sub">{{ nombrePersona(it.responsableId) }}{{ it.dia ? ' · día ' + it.dia : '' }}</span>
          </div>
          <span class="monto">{{ fmt(it.esperado) }}</span>
        </li>
      </ul>
      <div v-else style="display: flex; flex-direction: column; gap: 2px; margin-top: 10px">
        <div v-for="d in agenda" :key="d.clave" class="agenda-dia">
          <div class="agenda-fecha"><div class="num">{{ d.num }}</div><div class="dia">{{ d.nombreDia }}</div></div>
          <div class="agenda-linea"></div>
          <div class="agenda-items">
            <div v-for="it in d.items" :key="it.clave" class="agenda-item" @click="registrar(it)">
              <span class="punto" :style="{ background: color(it.clase), borderRadius: '50%' }"></span>
              <div style="flex: 1; min-width: 0">
                <div class="fila-titulo" style="font-size: 0.93rem">{{ it.nombre }}</div>
                <div class="fila-sub">{{ nombrePersona(it.responsableId) }}</div>
              </div>
              <span class="monto">{{ fmt(it.esperado) }}</span>
            </div>
          </div>
        </div>
      </div>
      <p v-if="r.pendientes.length > pendientes.length && prefs.pendientes === 'lista'" class="nota chica" style="margin-top: 8px">
        y {{ r.pendientes.length - pendientes.length }} más en la pestaña Mes.</p>
    </article>

    <article class="tarjeta">
      <h2>A dónde va cada {{ simbolo() }}100</h2>
      <p class="nota chica" style="margin: 3px 0 14px">De {{ fmt(r.gastoReal) }} gastados en {{ nombrePeriodo(store.periodo) }}.</p>
      <p v-if="!r.gastoReal" class="vacio" style="padding: 8px 0">Aún no hay gastos registrados este mes.</p>
      <template v-else>
        <barra-segmentos clase="alta" :segmentos="reparto"/>
        <ul class="lista" style="margin-top: 14px">
          <li v-for="x in reparto" :key="x.nombre" class="fila compacta">
            <i class="punto" :style="{ background: x.color }"></i>
            <span style="flex: 1; min-width: 0; font-size: 0.92rem">{{ x.nombre }}</span>
            <span class="monto">{{ fmtEntero(x.valor) }}</span>
            <span class="tenue" style="width: 44px; text-align: right; font-size: 0.85rem; font-variant-numeric: tabular-nums">{{ x.pct }}</span>
          </li>
        </ul>
      </template>
    </article>

    <article class="tarjeta">
      <h2>Mes a mes</h2>
      <p class="nota chica" style="margin: 3px 0 14px">Gasto registrado por tipo{{ meses.length > 1 ? ', últimos ' + meses.length + ' meses' : '' }}.</p>
      <p v-if="!hayHistorial" class="vacio" style="padding: 8px 0">Cuando registres gastos, aquí verás cómo cambian mes a mes.</p>
      <template v-else>
        <columnas-apiladas :meses="meses" :series="clases" :formatear="fmtCorto"/>
        <div class="leyenda-grafico">
          <span v-for="c in clases" :key="c.clave"><i class="punto" :style="{ background: c.color }"></i>{{ c.nombre }}</span>
        </div>
      </template>
    </article>

    <article v-if="variables.length" class="tarjeta">
      <div class="tarjeta-cab"><h2>Fijos variables contra lo estimado</h2></div>
      <ul class="lista">
        <li v-for="v in variables" :key="v.clave" class="fila compacta clic" @click="abrir(v.item)">
          <span class="fila-titulo" style="flex: 1; min-width: 0; font-size: 0.92rem">{{ v.nombre }}</span>
          <span class="tenue" style="font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap">est. {{ fmtEntero(v.esperado) }}</span>
          <span :class="v.clase" style="min-width: 86px; text-align: right; font-size: 0.85rem; font-variant-numeric: tabular-nums; white-space: nowrap">{{ v.texto }}</span>
        </li>
      </ul>
      <p class="nota" style="margin-top: 12px">{{ resumenVariables }}</p>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>Deudas</h2>
        <a class="btn-link" href="#/prestamos">Ver el plan</a>
      </div>
      <div style="display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap">
        <div style="flex: 1 1 auto; min-width: 0">
          <p class="hero-num" style="font-size: 2rem">{{ fmt(deuda.hoy) }}</p>
          <p style="margin-top: 6px; font-size: 0.84rem" :class="deuda.baja > 0 ? 'positivo' : 'tenue'">{{ deuda.texto }}</p>
        </div>
        <sparkline v-if="deuda.serie.length > 1" :valores="deuda.serie"/>
      </div>
      <div v-if="deuda.cuotas" class="caja-ambar">
        De cada {{ simbolo() }}100 de cuota, <b>{{ simbolo() }}{{ deuda.pct }}</b> son intereses y seguros. Este mes: {{ fmt(deuda.costo) }} de {{ fmt(deuda.cuotas) }}.
      </div>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Cuentas</h2>
        <a class="monto" href="#/cuentas" style="color: var(--tinta)">{{ fmt(totalCuentas) }}</a>
      </div>
      <ul class="lista" style="margin-top: 8px">
        <li v-for="c in listaCuentas" :key="c.id" class="fila">
          <div class="fila-info">
            <span style="font-size: 0.93rem">{{ c.nombre }}</span>
            <div v-if="c.pct !== null" class="progreso fino acento"><div :style="{ width: c.pct + '%' }"></div></div>
            <span v-if="c.nota" class="fila-sub" style="margin-top: 4px">{{ c.nota }}</span>
          </div>
          <span class="monto" :class="{ negativo: c.saldo < 0 }">{{ fmt(c.saldo) }}</span>
        </li>
      </ul>
    </article>

    <article v-if="categoriasMes.length" class="tarjeta">
      <h2 style="margin-bottom: 12px">Gasto por categoría</h2>
      <ul class="lista" style="display: flex; flex-direction: column; gap: 12px">
        <li v-for="c in categoriasMes" :key="c.id">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px">
            <span class="fila-titulo" style="flex: 1; min-width: 0; font-size: 0.9rem">{{ c.nombre }}</span>
            <span class="monto" style="font-size: 0.95rem">{{ fmt(c.valor) }}</span>
          </div>
          <div class="progreso"><div :style="{ width: c.pct + '%', background: 'var(--s1)' }"></div></div>
        </li>
      </ul>
    </article>
  </section>`,
  setup() {
    const r = computed(() => resumenMes(store.doc, store.periodo));
    const compromisos = computed(() => r.value.items.filter((i) => i.clase !== 'ingreso'));
    const pct = computed(() => (r.value.comprometido ? Math.min(100, (r.value.pagado / r.value.comprometido) * 100) : 0));
    const avanceTexto = computed(() => {
      const hechos = compromisos.value.filter((i) => i.hecho).length;
      const total = compromisos.value.length;
      if (!total) return 'No hay compromisos para este mes.';
      return r.value.pendiente > 0
        ? `${hechos} de ${total} compromisos registrados. Faltan ${fmt(r.value.pendiente)}.`
        : `Los ${total} compromisos del mes están registrados.`;
    });
    const flujo = computed(() => [
      { nombre: 'Compromisos', valor: r.value.comprometido, color: 'var(--s1)', titulo: `Compromisos ${fmt(r.value.comprometido)}` },
      { nombre: 'Adicionales', valor: r.value.adicionales, color: 'var(--s5)', titulo: `Adicionales ${fmt(r.value.adicionales)}` },
      r.value.libre >= 0
        ? { nombre: 'Libre', valor: r.value.libre, color: 'var(--s3)', titulo: `Libre ${fmt(r.value.libre)}` }
        : { nombre: 'Faltan', valor: -r.value.libre, color: 'var(--mal)', titulo: `Faltan ${fmt(-r.value.libre)}` },
    ]);

    const pendientes = computed(() => r.value.pendientes.slice(0, MAX_PENDIENTES));
    const agenda = computed(() => {
      const [y, m] = store.periodo.split('-').map(Number);
      const grupos = new Map();
      for (const it of [...r.value.pendientes].sort((a, b) => (a.dia || 99) - (b.dia || 99))) {
        const clave = it.dia || 'sin';
        if (!grupos.has(clave)) {
          grupos.set(clave, {
            clave,
            num: it.dia || '—',
            nombreDia: it.dia ? DIA_SEMANA[new Date(y, m - 1, Math.min(it.dia, 28)).getDay()] : 'sin día',
            items: [],
          });
        }
        grupos.get(clave).items.push(it);
      }
      return [...grupos.values()];
    });

    const reparto = computed(() => {
      const total = r.value.gastoReal || 1;
      return CLASES_GRAFICO
        .map((c) => ({ nombre: c.nombre, color: c.color, valor: redondear(r.value.porClase[c.clave]) }))
        .filter((x) => x.valor > 0)
        .sort((a, b) => b.valor - a.valor)
        .map((x) => ({ ...x, pct: `${Math.round((x.valor / total) * 100)}%`, titulo: `${x.nombre} ${fmt(x.valor)}` }));
    });

    const meses = computed(() => {
      const desdeInicio = mesesEntre(store.doc.config.inicio || store.periodo, store.periodo) + 1;
      return historial(store.doc, store.periodo, Math.min(6, Math.max(1, desdeInicio))).map((h) => {
        const valores = CLASES_GRAFICO.map((c) => redondear(h.porClase[c.clave]));
        const total = valores.reduce((a, v) => a + v, 0);
        return { periodo: h.periodo, etiqueta: nombrePeriodo(h.periodo, true).slice(0, 3), largo: nombrePeriodo(h.periodo), total, textoTotal: fmtCorto(total), valores };
      });
    });
    const hayHistorial = computed(() => meses.value.some((m) => m.total > 0));

    const variables = computed(() => r.value.items.filter((i) => i.clase === 'fijo_variable').map((i) => {
      const d = i.hecho ? redondear(i.real - i.esperado) : null;
      return {
        clave: i.clave, item: i, nombre: i.nombre, esperado: i.esperado,
        texto: d === null ? 'pendiente' : d === 0 ? 'exacto' : `${d > 0 ? '+' : ''}${fmt(d)}`,
        clase: d === null || d === 0 ? 'tenue' : d > 0 ? 'negativo' : 'positivo',
        dif: d,
      };
    }));
    const resumenVariables = computed(() => {
      const registrados = variables.value.filter((v) => v.dif !== null);
      const faltan = variables.value.filter((v) => v.dif === null).map((v) => v.nombre.toLowerCase());
      const exceso = redondear(registrados.reduce((a, v) => a + v.dif, 0));
      let texto = !registrados.length ? 'Todavía no hay fijos variables registrados este mes'
        : exceso > 0 ? `Van ${fmt(exceso)} por encima de lo estimado`
          : exceso < 0 ? `Van ${fmt(-exceso)} por debajo de lo estimado` : 'Van justo en lo estimado';
      if (registrados.length && faltan.length) {
        const lista = faltan.length > 1 ? `${faltan.slice(0, -1).join(', ')} y ${faltan[faltan.length - 1]}` : faltan[0];
        texto += `, con ${lista} todavía sin registrar`;
      }
      return `${texto}.`;
    });

    const deuda = computed(() => {
      const inicio = store.doc.config.inicio || store.periodo;
      const hoy = deudaAl(store.doc, store.periodo);
      const alInicio = deudaAl(store.doc, inicio);
      const baja = redondear(alInicio - hoy);
      const desde = mesesEntre(inicio, store.periodo) > 5 ? sumarMeses(store.periodo, -5) : inicio;
      const n = Math.max(0, mesesEntre(desde, store.periodo)) + 1;
      const serie = store.periodo >= inicio ? Array.from({ length: n }, (_, i) => deudaAl(store.doc, sumarMeses(desde, i))) : [];
      const activos = vivos('prestamos').map((p) => ({ p, e: estadoPrestamo(p, store.doc.movimientos) })).filter((x) => !x.e.pagado);
      const cuotas = activos.reduce((a, x) => a + x.p.cuota, 0);
      const costo = activos.reduce((a, x) => a + x.e.interesMes + x.e.seguro, 0);
      const texto = baja > 0 ? `↓ ${fmt(baja)} menos que en ${nombrePeriodo(inicio)}`
        : store.periodo <= inicio ? 'Saldo al empezar el registro' : `Sin cambios desde ${nombrePeriodo(inicio)}`;
      return { hoy, baja, texto, serie, cuotas, costo, pct: cuotas ? Math.round((costo / cuotas) * 100) : 0 };
    });

    const saldos = computed(() => saldosCuentas(store.doc));
    const esenciales = computed(() => presupuestoMensual(store.doc, store.periodo).esenciales);
    const listaCuentas = computed(() => cuentas().map((c) => {
      const saldo = saldos.value[c.id] || 0;
      let objetivo = c.meta || null;
      let nota = c.nota || '';
      if (c.meta) nota = `${Math.round((saldo / c.meta) * 100)}% de la meta de ${fmt(c.meta)}`;
      else if (c.tipo === 'emergencias' && esenciales.value) {
        objetivo = esenciales.value * 3;
        nota = `${Math.round((saldo / objetivo) * 100)}% de 3 meses de gastos`;
      } else if (c.tipo === 'gastos' && !nota) nota = 'Cuenta del día a día';
      else if (c.tipo === 'reservas' && !nota) {
        const anuales = vivos('plantillas').filter((t) => t.clase === 'provision' && t.activo !== false).map((t) => t.nombre.toLowerCase());
        if (anuales.length) nota = `Para ${anuales.length > 1 ? anuales.slice(0, -1).join(', ') + ' y ' + anuales[anuales.length - 1] : anuales[0]}`;
      }
      const pctMeta = objetivo ? Math.max(0, Math.min(100, Math.round((saldo / objetivo) * 100))) : null;
      return { id: c.id, nombre: c.nombre, saldo, nota, pct: pctMeta };
    }));
    const totalCuentas = computed(() => listaCuentas.value.reduce((a, c) => a + c.saldo, 0));

    const categoriasMes = computed(() => {
      const filas = Object.entries(r.value.porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 7);
      const max = filas.length ? filas[0][1] : 1;
      return filas.map(([id, valor]) => ({ id, nombre: nombreCategoria(id), valor, pct: Math.max(2, (valor / max) * 100) }));
    });

    const faltan = computed(() => vivos('plantillas').filter((t) => t.activo !== false && !Number(t.clase === 'provision' ? t.montoAnual : t.monto)));
    const sinPersonas = computed(() => !vivos('personas').length);

    return {
      store, prefs, r, pct, avanceTexto, flujo, pendientes, agenda, reparto, meses, hayHistorial, variables, resumenVariables,
      deuda, listaCuentas, totalCuentas, categoriasMes, faltan, sinPersonas, clases: CLASES_GRAFICO,
      fmt, fmtEntero, fmtCorto, simbolo, nombrePersona, nombrePeriodo, mesDe,
      color: (clase) => COLOR_CLASE[clase] || 'var(--tinta3)',
      marcar: (it) => marcarCompromiso(it, store.periodo),
      registrar: (it) => registrarCompromiso(it, store.periodo),
      abrir: (it) => abrirCompromiso(it, store.periodo),
    };
  },
};
