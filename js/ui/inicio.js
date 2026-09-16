import {
  store, fmt, fmtEntero, fmtCorto, fmtMoneda, simbolo, indice, vivos, cuentasDinero, tarjetas, nombrePersona, nombreCategoria, nombreCuenta, filtro, personaFiltro, avisos,
} from '../store.js';
import { resumenTarjeta } from '../core/tarjetas.js';
import { estadoMetas, SITUACIONES_META } from '../core/metas.js';
import { tramoDeFecha } from '../core/quincena.js';
import { resumenMes, historial, seriesDeGrupos, colorGrupo, saldosCuentas, enLempirasAprox, ritmoDelMes } from '../core/reportes.js';
import { presupuestoMensual } from '../core/presupuesto.js';
import { deudaAl, estadoDe } from '../core/prestamos.js';
import { SIN_RESPONSABLE, coincidePersona } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { PASOS_ASISTENTE } from '../core/catalogos.js';
import { nombrePeriodo, redondear, mesesEntre, sumarMeses, fechaCorta, periodoDe, cuandoVence, DIAS_CORTOS } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { BarraSegmentos, ColumnasApiladas, Sparkline } from './graficos.js';
import { Icono, dosMonedas } from './componentes.js';
import { marcarItem, abrirItem, completarDeducciones } from './formularios.js';
import { ejecutarAccionAviso } from './avisos.js';

// El formulario de pago de tarjeta se trae al tocar "Pagar": son 20 KB que no hacen falta al abrir.
const pagarTarjeta = (...args) => import('./formularios-tarjetas.js').then((m) => m.pagarTarjeta(...args));

const { computed } = Vue;

const MAX_PENDIENTES = 6;

export const VistaInicio = {
  components: { BarraSegmentos, ColumnasApiladas, Sparkline, Icono },
  template: `
  <section class="pila amplia">
    <div v-if="sinPersonas" class="aviso-banner">
      <p>Para empezar, importa tu archivo de datos o agrega a las personas del hogar.</p>
      <a class="btn primario" href="#/datos">Ir a Datos y OneDrive</a>
    </div>
    <div v-else-if="asistentePendiente" class="aviso-banner">
      <p>Hay novedades en la app. Revisa {{ pasosAsistente === 1 ? 'un paso' : 'en ' + pasosAsistente + ' pasos' }} cómo quedaron tus datos.</p>
      <a class="btn primario" href="#/configurar">Revisar</a>
    </div>
    <div v-else-if="faltan.length" class="aviso-banner ambar">
      <p>Faltan montos por definir: {{ faltan.map((t) => t.nombre).join(', ') }}.</p>
      <a class="btn" href="#/presupuesto">Definirlos</a>
    </div>

    <article v-if="avisosHoy.length" class="tarjeta aviso-tarjeta hoy">
      <div class="tarjeta-cab centro pegada">
        <h2>Para hoy</h2>
        <a class="btn-link" href="#/avisos">Ver {{ totalAvisos > avisosHoy.length ? 'los ' + totalAvisos + ' avisos' : 'avisos' }}</a>
      </div>
      <ul class="lista" style="margin-top: 6px">
        <li v-for="a in avisosHoy" :key="a.id" class="fila">
          <div class="fila-info"><span class="fila-titulo" style="white-space: normal">{{ a.titulo }}</span><span class="fila-sub" style="white-space: normal">{{ a.texto }}</span></div>
          <button v-if="a.acciones[0]" type="button" class="btn" @click="ejecutarAccionAviso(a.acciones[0])">{{ a.acciones[0].texto }}</button>
        </li>
      </ul>
    </article>

    <div>
      <p class="etiqueta">{{ r.libre < 0 ? 'Faltan este mes' : 'Libre este mes' }}</p>
      <p class="hero-num xl" :class="{ negativo: r.libre < 0 }">{{ fmt(Math.abs(r.libre)) }}</p>
      <p v-if="!r.ingresoEsperado && !r.ingresoDelMes" class="hero-texto">Todavía no hay ingresos definidos. <a href="#/presupuesto">Agrégalos</a> para ver cuánto queda libre.</p>
      <p v-else-if="r.libre >= 0" class="hero-texto">De {{ fmt(r.ingresoDelMes) }} de ingresos quedan {{ fmt(r.libre) }} después del plan y de lo gastado fuera del plan.</p>
      <p v-else class="hero-texto">De {{ fmt(r.ingresoDelMes) }} de ingresos faltan {{ fmt(-r.libre) }} para cubrir el plan y lo gastado fuera del plan.</p>
      <p v-if="textoRitmo" class="hero-texto" style="margin-top: 6px"><strong>{{ textoRitmo }}</strong></p>
      <p v-if="textoIngresos" class="nota chica" style="margin-top: 6px">{{ textoIngresos }}</p>
      <p v-if="sinResponsable" class="nota chica" style="margin-top: 6px">No incluye {{ fmt(sinResponsable) }} del hogar sin responsable.</p>
      <barra-segmentos :segmentos="flujo" style="margin-top: 14px"/>
      <div class="leyenda">
        <span v-for="f in flujo" :key="f.nombre"><i class="punto" :style="{ background: f.color }"></i>{{ f.nombre }} <b>{{ fmtEntero(f.valor) }}</b></span>
      </div>
    </div>

    <a v-if="tramo" class="tarjeta enlace-tarjeta" href="#/mes">
      <div class="fila-info">
        <span class="etiqueta">Disponible hasta el {{ fechaCorta(tramo.fin) }}</span>
        <span class="hero-num" style="font-size: 1.7rem; margin-top: 4px" :class="{ negativo: tramo.disponible < 0 }">{{ fmt(tramo.disponible) }}</span>
        <span class="fila-sub envuelve" style="margin-top: 6px">Entran {{ fmt(tramo.entra) }} · salen {{ fmt(tramo.sale) }} del plan{{ tramo.fueraDelPlan ? ' · ' + fmt(tramo.fueraDelPlan) + ' fuera del plan' : '' }}</span>
      </div>
      <icono n="der" :t="20"/>
    </a>

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
          <button type="button" class="check" :class="{ parcial: it.estado === 'parcial' }" :style="it.estado === 'parcial' ? { '--pct': pctItem(it) } : null"
                  :aria-label="'Registrar ' + it.nombre" @click="marcar(it)"></button>
          <div class="fila-info clic" @click="abrir(it)">
            <span class="fila-titulo">{{ it.nombre }}</span>
            <span class="fila-sub">{{ subPendiente(it) }}</span>
          </div>
          <span class="monto">{{ montoItem(it) }}</span>
        </li>
      </ul>
      <div v-else style="display: flex; flex-direction: column; gap: 2px; margin-top: 10px">
        <div v-for="d in agenda" :key="d.clave" class="agenda-dia">
          <div class="agenda-fecha"><div class="num">{{ d.num }}</div><div class="dia">{{ d.nombreDia }}</div></div>
          <div class="agenda-linea"></div>
          <div class="agenda-items">
            <div v-for="it in d.items" :key="it.clave" class="agenda-item" @click="abrir(it)">
              <span class="punto" :style="{ background: colorGrupo(ix, it.grupoId), borderRadius: '50%' }"></span>
              <div style="flex: 1; min-width: 0">
                <div class="fila-titulo" style="font-size: 0.93rem">{{ it.nombre }}</div>
                <div class="fila-sub">{{ subPendiente(it) }}</div>
              </div>
              <span class="monto">{{ montoItem(it) }}</span>
            </div>
          </div>
        </div>
      </div>
      <p v-if="r.pendientes.length > pendientes.length && prefs.pendientes === 'lista'" class="nota chica" style="margin-top: 8px">
        y {{ r.pendientes.length - pendientes.length }} más en la pestaña Mes.</p>
    </article>

    <article class="tarjeta">
      <h2>A dónde va cada {{ simbolo() }}100</h2>
      <p class="nota chica" style="margin: 3px 0 12px">De {{ fmt(r.gastoReal) }} gastados en {{ nombrePeriodo(store.periodo) }}.</p>
      <div class="segmentos" role="group" aria-label="Agrupar" style="margin-bottom: 14px">
        <button type="button" :class="{ activo: prefs.repartoInicio === 'grupo' }" :aria-pressed="prefs.repartoInicio === 'grupo'" @click="definirVista('repartoInicio', 'grupo')">Por grupo</button>
        <button type="button" :class="{ activo: prefs.repartoInicio === 'medio' }" :aria-pressed="prefs.repartoInicio === 'medio'" @click="definirVista('repartoInicio', 'medio')">Por medio de pago</button>
      </div>
      <p v-if="!r.gastoReal" class="vacio" style="padding: 8px 0">Aún no hay gastos registrados este mes.</p>
      <template v-else>
        <barra-segmentos clase="alta" :segmentos="reparto"/>
        <ul class="lista" style="margin-top: 14px">
          <li v-for="x in reparto" :key="x.id" class="fila compacta">
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
      <p class="nota chica" style="margin: 3px 0 14px">Gasto registrado por grupo{{ meses.length > 1 ? ', últimos ' + meses.length + ' meses' : '' }}.</p>
      <p v-if="!hayHistorial" class="vacio" style="padding: 8px 0">Cuando registres gastos, aquí verás cómo cambian mes a mes.</p>
      <template v-else>
        <columnas-apiladas :meses="meses" :series="series.series" :formatear="fmtCorto" etiqueta="Gasto por grupo"/>
        <div class="leyenda-grafico">
          <span v-for="c in series.series" :key="c.clave"><i class="punto" :style="{ background: c.color }"></i>{{ c.nombre }}</span>
        </div>
      </template>
    </article>

    <article v-if="variables.length" class="tarjeta">
      <div class="tarjeta-cab"><h2>Variables contra lo previsto</h2></div>
      <ul class="lista">
        <li v-for="v in variables" :key="v.clave" class="fila compacta clic" @click="abrir(v.item)">
          <span class="fila-titulo" style="flex: 1; min-width: 0; font-size: 0.92rem">{{ v.nombre }}</span>
          <span class="tenue" style="font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap">prev. {{ fmtEntero(v.esperado) }}</span>
          <span :class="v.clase" style="min-width: 96px; text-align: right; font-size: 0.85rem; font-variant-numeric: tabular-nums; white-space: nowrap">{{ v.texto }}</span>
        </li>
      </ul>
      <p class="nota" style="margin-top: 12px">{{ resumenVariables }}</p>
    </article>

    <article v-if="r.descontado.total || r.descontado.incompletos.length" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Descontado en planilla</h2>
        <span class="monto">{{ fmt(r.descontado.total) }}</span>
      </div>
      <p class="nota chica" style="margin: 3px 0 10px">De los salarios de {{ nombrePeriodo(store.periodo) }}. No es gasto del hogar: el presupuesto usa el neto.</p>
      <ul class="lista">
        <li v-for="c in descontado" :key="c.nombre" class="fila compacta">
          <span style="flex: 1; min-width: 0; font-size: 0.92rem">{{ c.nombre }}</span>
          <span class="monto">{{ fmt(c.valor) }}</span>
        </li>
      </ul>
      <div v-if="r.descontado.incompletos.length" class="caja-ambar" style="display: flex; align-items: center; gap: 10px">
        <span style="flex: 1">Faltan deducciones en {{ r.descontado.incompletos.length }} {{ r.descontado.incompletos.length === 1 ? 'pago' : 'pagos' }}.</span>
        <button type="button" class="btn" @click="completarDeducciones(r.descontado.incompletos[0])">Completar</button>
      </div>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>Deudas</h2>
        <a class="btn-link" href="#/plan-deudas">Ver el plan</a>
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

    <article v-if="listaTarjetas.length" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Tarjetas</h2>
        <a class="btn-link" href="#/tarjetas">Ver tarjetas</a>
      </div>
      <ul class="lista" style="margin-top: 8px">
        <li v-for="x in listaTarjetas" :key="x.id" class="fila">
          <a class="fila-info enlace-fila" :href="'#/tarjeta/' + x.id">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ x.nombre }}</span>
            <span class="fila-sub" :class="{ 'texto-aviso': x.urgente }">{{ x.sub }}</span>
          </a>
          <div class="derecha">
            <div class="monto">{{ fmtMoneda(x.deuda.L, 'L') }}</div>
            <div v-if="x.deuda.USD" class="dif tenue">{{ fmtMoneda(x.deuda.USD, 'USD') }}</div>
          </div>
          <button v-if="x.pagar" type="button" class="btn" @click="pagarTarjeta(x.id, { corte: x.corte })">Pagar</button>
        </li>
      </ul>
    </article>

    <article v-if="metas.length" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>Metas</h2>
        <a class="btn-link" href="#/metas">Ver metas</a>
      </div>
      <ul class="lista" style="margin-top: 8px">
        <li v-for="e in metas" :key="e.meta.id" class="fila">
          <a class="fila-info enlace-fila" href="#/metas">
            <span style="font-size: 0.93rem">{{ e.meta.nombre }}</span>
            <div class="progreso fino acento"><div :style="{ width: e.pct + '%' }"></div></div>
            <span class="fila-sub" :class="{ 'texto-aviso': e.situacion === 'atrasada' }" style="margin-top: 4px">{{ subMeta(e) }}</span>
          </a>
          <span class="monto">{{ fmtEntero(e.ahorrado) }}</span>
        </li>
      </ul>
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
          <span class="monto" :class="{ negativo: c.saldo < 0 }">{{ fmtMoneda(c.saldo, c.moneda) }}</span>
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
          <div class="progreso"><div :style="{ width: c.pct + '%', background: c.color }"></div></div>
        </li>
      </ul>
    </article>
  </section>`,
  setup() {
    const ix = computed(indice);
    const r = computed(() => resumenMes(ix.value, store.periodo, filtro()));
    // Con filtro de persona: lo que no es de nadie y queda fuera de los totales.
    const sinResponsable = computed(() => {
      if (!personaFiltro()) return 0;
      const s = resumenMes(ix.value, store.periodo, { personaId: SIN_RESPONSABLE });
      return redondear(s.comprometido + s.fueraDelPlan);
    });
    // De dónde salen los ingresos: lo que ya llegó (neto) y lo que falta, con el neto de cada salario.
    const textoIngresos = computed(() => {
      const { ingresoRecibido, otrosIngresos, ingresoPorRecibir } = r.value;
      if (!ingresoPorRecibir) return '';
      if (!ingresoRecibido && !otrosIngresos) return 'Los ingresos son el neto de cada salario: lo que llega a la cuenta, ya sin deducciones.';
      return `Ya llegaron ${fmt(redondear(ingresoRecibido + otrosIngresos))} y faltan ${fmt(ingresoPorRecibir)} según el neto de cada salario.`;
    });
    // A qué ritmo se puede gastar lo que queda libre: es el número con el que se decide hoy.
    const textoRitmo = computed(() => {
      const ritmo = ritmoDelMes(indice(), store.periodo, r.value.libre);
      if (!ritmo || (!r.value.ingresoEsperado && !r.value.ingresoDelMes)) return '';
      if (r.value.libre < 0) {
        return `Faltan ${fmt(-r.value.libre)} y quedan ${ritmo.restantes} ${ritmo.restantes === 1 ? 'día' : 'días'} del mes.`;
      }
      const dias = `${ritmo.restantes} ${ritmo.restantes === 1 ? 'día' : 'días'}`;
      return `${fmt(ritmo.librePorDia)} por día en los ${dias} que quedan.`;
    });
    const plan = computed(() => r.value.plan.filter((it) => it.esperado > 0 || it.real > 0));
    const pct = computed(() => (r.value.comprometido ? Math.min(100, (r.value.pagado / r.value.comprometido) * 100) : 0));
    const avanceTexto = computed(() => {
      const hechos = plan.value.filter((i) => i.hecho).length;
      const total = plan.value.length;
      if (!total) return 'No hay partidas para este mes.';
      return r.value.pendiente > 0
        ? `${hechos} de ${total} partidas completas. Faltan ${fmt(r.value.pendiente)}.`
        : `Las ${total} partidas del mes están completas.`;
    });
    const flujo = computed(() => [
      { nombre: 'Plan', valor: r.value.comprometido, color: 'var(--s1)', titulo: `Plan ${fmt(r.value.comprometido)}` },
      { nombre: 'Fuera del plan', valor: r.value.fueraDelPlan, color: 'var(--s5)', titulo: `Fuera del plan ${fmt(r.value.fueraDelPlan)}` },
      r.value.libre >= 0
        ? { nombre: 'Libre', valor: r.value.libre, color: 'var(--s3)', titulo: `Libre ${fmt(r.value.libre)}` }
        : { nombre: 'Faltan', valor: -r.value.libre, color: 'var(--mal)', titulo: `Faltan ${fmt(-r.value.libre)}` },
    ]);

    const pendientes = computed(() => r.value.pendientes.slice(0, MAX_PENDIENTES));
    const pctItem = (it) => (it.esperado ? Math.min(100, Math.round((it.real / it.esperado) * 100)) : 0);
    // Una partida en dólares se ve en dólares, igual que en Mes.
    const enMonedaDe = (it) => (it.moneda === 'USD' ? it.enMoneda : it);
    const montoItem = (it) => {
      const x = enMonedaDe(it);
      return fmtMoneda(x.queda || x.esperado, it.moneda || 'L');
    };
    const subPendiente = (it) => {
      if (it.estado === 'parcial') {
        const x = enMonedaDe(it);
        return `${fmtMoneda(x.real, it.moneda || 'L')} de ${fmtMoneda(x.esperado, it.moneda || 'L')}`;
      }
      return `${nombrePersona(it.responsableId)}${it.dia ? ' · día ' + it.dia : ''}${it.forma === 'abonos' ? ' · en abonos' : ''}`;
    };
    const agenda = computed(() => {
      const [y, m] = store.periodo.split('-').map(Number);
      const dias = new Map();
      for (const it of [...r.value.pendientes].sort((a, b) => (a.dia || 99) - (b.dia || 99))) {
        const clave = it.dia || 'sin';
        if (!dias.has(clave)) {
          dias.set(clave, {
            clave, num: it.dia || '—', nombreDia: it.dia ? DIAS_CORTOS[new Date(y, m - 1, Math.min(it.dia, 28)).getDay()] : 'sin día', items: [],
          });
        }
        dias.get(clave).items.push(it);
      }
      return [...dias.values()];
    });

    const reparto = computed(() => {
      const g = r.value.gasto;
      const total = g.total || 1;
      const porMedio = prefs.repartoInicio === 'medio';
      const colores = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
      return Object.entries(porMedio ? g.porMedio : g.porGrupo)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id, valor], i) => {
          const nombre = porMedio ? (id === 'sin' ? 'Sin medio' : nombreCuenta(id)) : id === SIN_GRUPO ? 'Sin grupo' : ix.value.grupos.get(id)?.nombre || id;
          const color = porMedio ? colores[i] || 'var(--tinta3)' : id === SIN_GRUPO ? 'var(--tinta3)' : colorGrupo(ix.value, id);
          return { id, nombre, color, valor, pct: `${Math.round((valor / total) * 100)}%`, titulo: `${nombre} ${fmt(valor)}` };
        });
    });

    const series = computed(() => seriesDeGrupos(ix.value));
    const meses = computed(() => {
      const desdeInicio = mesesEntre(store.doc.config.inicio || store.periodo, store.periodo) + 1;
      return historial(ix.value, store.periodo, Math.min(6, Math.max(1, desdeInicio)), filtro()).map((h) => {
        const valores = series.value.valores(h.porGrupo);
        return { periodo: h.periodo, etiqueta: nombrePeriodo(h.periodo, true).slice(0, 3), largo: nombrePeriodo(h.periodo), total: h.total, textoTotal: fmtCorto(h.total), valores };
      });
    });
    const hayHistorial = computed(() => meses.value.some((m) => m.total > 0));

    const variables = computed(() => r.value.partidas.filter((it) => it.tipo === 'gasto' && (it.forma === 'variable' || it.forma === 'abonos') && it.esperado > 0).map((it) => {
      const cerrada = it.estado === 'completo' || it.estado === 'excedido';
      const d = cerrada ? redondear(it.real - it.esperado) : null;
      let texto = 'pendiente';
      if (it.estado === 'parcial') texto = `van ${fmtEntero(it.real)}`;
      else if (d !== null) texto = d === 0 ? 'exacto' : `${d > 0 ? '+' : ''}${fmt(d)}`;
      return { clave: it.clave, item: it, nombre: it.nombre, esperado: it.esperado, texto, clase: d === null || d === 0 ? 'tenue' : d > 0 ? 'negativo' : 'positivo', dif: d };
    }));
    const resumenVariables = computed(() => {
      const cerradas = variables.value.filter((v) => v.dif !== null);
      const abiertas = variables.value.filter((v) => v.dif === null).map((v) => v.nombre.toLowerCase());
      const exceso = redondear(cerradas.reduce((a, v) => a + v.dif, 0));
      let texto = !cerradas.length ? 'Todavía no hay partidas variables cerradas este mes'
        : exceso > 0 ? `Van ${fmt(exceso)} por encima de lo previsto`
          : exceso < 0 ? `Van ${fmt(-exceso)} por debajo de lo previsto` : 'Van justo en lo previsto';
      if (cerradas.length && abiertas.length) {
        const lista = abiertas.length > 1 ? `${abiertas.slice(0, -1).join(', ')} y ${abiertas[abiertas.length - 1]}` : abiertas[0];
        texto += `, con ${lista} todavía abiertas`;
      }
      return `${texto}.`;
    });

    const deuda = computed(() => {
      const x = ix.value;
      const inicio = store.doc.config.inicio || store.periodo;
      const hoy = deudaAl(x, store.periodo, filtro());
      const alInicio = deudaAl(x, inicio, filtro());
      const baja = redondear(alInicio - hoy);
      const desde = mesesEntre(inicio, store.periodo) > 5 ? sumarMeses(store.periodo, -5) : inicio;
      const n = Math.max(0, mesesEntre(desde, store.periodo)) + 1;
      const serie = store.periodo >= inicio ? Array.from({ length: n }, (_, i) => deudaAl(x, sumarMeses(desde, i), filtro())) : [];
      const activos = [...x.prestamos.values()].filter((p) => !p.borrado && coincidePersona(p.responsableId, filtro()))
        .map((p) => ({ p, e: estadoDe(x, p) })).filter((y) => !y.e.pagado);
      const cuotas = activos.reduce((a, y) => a + y.p.cuota, 0);
      const costo = activos.reduce((a, y) => a + y.e.interesMes + y.e.seguro, 0);
      const texto = baja > 0 ? `↓ ${fmt(baja)} menos que en ${nombrePeriodo(inicio)}`
        : store.periodo <= inicio ? 'Saldo al empezar el registro' : `Sin cambios desde ${nombrePeriodo(inicio)}`;
      return { hoy, baja, texto, serie, cuotas, costo, pct: cuotas ? Math.round((costo / cuotas) * 100) : 0 };
    });

    const saldos = computed(() => saldosCuentas(ix.value));
    const esenciales = computed(() => presupuestoMensual(ix.value, store.periodo).esenciales);
    const listaCuentas = computed(() => cuentasDinero().filter((c) => coincidePersona(c.titularId || null, filtro())).map((c) => {
      const saldo = saldos.value[c.id] || 0;
      const meta = vivos('metas').find((m) => m.cuentaId === c.id && m.activo !== false);
      let objetivo = meta?.montoObjetivo || null;
      let nota = c.nota || '';
      if (meta) nota = `${Math.round((saldo / meta.montoObjetivo) * 100)}% de la meta de ${fmtMoneda(meta.montoObjetivo, c.moneda)}`;
      else if (c.tipo === 'emergencias' && esenciales.value) {
        objetivo = esenciales.value * 3;
        nota = `${Math.round((saldo / objetivo) * 100)}% de 3 meses de gastos`;
      } else if (c.tipo === 'gastos' && !nota) nota = 'Cuenta del día a día';
      else if (c.tipo === 'reservas' && !nota) {
        const anuales = vivos('partidas').filter((p) => p.tipo === 'anual' && p.activo !== false).map((p) => p.nombre.toLowerCase());
        if (anuales.length) nota = `Para ${anuales.length > 1 ? anuales.slice(0, -1).join(', ') + ' y ' + anuales[anuales.length - 1] : anuales[0]}`;
      }
      const pctMeta = objetivo ? Math.max(0, Math.min(100, Math.round((saldo / objetivo) * 100))) : null;
      return { id: c.id, nombre: c.nombre, moneda: c.moneda || 'L', saldo, nota, pct: pctMeta };
    }));
    const totalCuentas = computed(() => redondear(listaCuentas.value.reduce((a, c) => a + enLempirasAprox(ix.value, c.id, c.saldo), 0)));
    // Tarjetas: lo que se debe y el pago del último corte mientras no esté pagado.
    const listaTarjetas = computed(() => tarjetas().filter((c) => coincidePersona(c.titularId || null, filtro())).map((c) => {
      const r = resumenTarjeta(ix.value, c);
      const u = r.ultimo;
      const porPagar = !u.antesDelSaldo && (u.pendiente.L > 0 || u.pendiente.USD > 0);
      const sub = porPagar
        ? `${u.situacion === 'vencido' ? 'Venció' : 'Vence'} ${cuandoVence(u.limite, store.hoy)}: ${u.situacion === 'parcial' || u.situacion === 'vencido' ? 'faltan' : 'pago de contado'} ${dosMonedas(u.pendiente)}`
        : `Al día · corte el ${fechaCorta(r.corteAbierto)}`;
      return { id: c.id, nombre: c.nombre, deuda: r.deuda, sub, pagar: porPagar, corte: u.corte, urgente: porPagar && (u.situacion === 'vencido' || u.limite <= store.hoy) };
    }));

    const categoriasMes = computed(() => {
      const x = ix.value;
      const filas = Object.entries(r.value.gasto.porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 7);
      const max = filas.length ? filas[0][1] : 1;
      return filas.map(([id, valor]) => ({
        id, nombre: nombreCategoria(id === 'sin' ? null : id), valor, pct: Math.max(2, (valor / max) * 100),
        color: id === 'sin' ? 'var(--tinta3)' : colorGrupo(x, x.grupoDe(id)),
      }));
    });

    // Con filtro: lo de esa persona y lo que no tiene responsable (también le toca revisarlo).
    const faltan = computed(() => [
      ...vivos('partidas').map((p) => ({ nombre: p.nombre, activo: p.activo, monto: p.tipo === 'anual' ? p.montoAnual : p.monto, persona: p.responsableId })),
      ...vivos('ingresos').map((i) => ({ nombre: i.nombre, activo: i.activo, monto: i.netoEsperado, persona: i.personaId })),
    ].filter((t) => t.activo !== false && !Number(t.monto) && (!t.persona || coincidePersona(t.persona, filtro()))));
    const sinPersonas = computed(() => !vivos('personas').length);
    const avisosVisibles = computed(avisos);
    const totalAvisos = computed(() => avisosVisibles.value.length);
    const avisosHoy = computed(() => avisosVisibles.value.filter((a) => a.cuando === 'hoy').slice(0, 3));
    const tramo = computed(() => (store.periodo === periodoDe(store.hoy) ? tramoDeFecha(ix.value, store.hoy, filtro()) : null));
    const descontado = computed(() => Object.entries(r.value.descontado.porConcepto).sort((a, b) => b[1] - a[1]).map(([nombre, valor]) => ({ nombre, valor })));
    const metas = computed(() => estadoMetas(ix.value, filtro()).slice(0, 4));
    const subMeta = (e) => {
      const partes = [`${e.pct}% de ${fmtEntero(e.objetivo)}`];
      if (e.aporteMensual && e.situacion !== 'lograda') partes.push(`${fmt(e.aporteMensual)} al mes`);
      if (e.situacion !== 'sin-fecha' && e.situacion !== 'al-dia') partes.push(SITUACIONES_META[e.situacion].texto.toLowerCase());
      return partes.join(' · ');
    };
    const pasosPendientes = computed(() => {
      const hechos = store.doc.config.asistente?.completados || [];
      return PASOS_ASISTENTE.filter((p) => !hechos.includes(p.id)).length;
    });
    const asistentePendiente = computed(() => !!store.doc.config.migradoDesde && pasosPendientes.value > 0);

    return {
      store, prefs, ix, r, sinResponsable, pct, avanceTexto, flujo, pendientes, pctItem, montoItem, subPendiente, agenda, reparto, series, meses, hayHistorial,
      textoRitmo, variables, resumenVariables, deuda, listaCuentas, totalCuentas, listaTarjetas, pagarTarjeta, metas, subMeta, categoriasMes, faltan, sinPersonas, asistentePendiente, pasosAsistente: pasosPendientes,
      avisosHoy, totalAvisos, tramo, descontado, textoIngresos, ejecutarAccionAviso, completarDeducciones, fechaCorta,
      fmt, fmtEntero, fmtCorto, fmtMoneda, simbolo, nombrePeriodo, colorGrupo, definirVista,
      marcar: (it) => marcarItem(it, store.periodo),
      abrir: (it) => abrirItem(it, store.periodo),
    };
  },
};
