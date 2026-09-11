import { store, fmt, vivos, nombrePersona } from '../store.js';
import { presupuestoMensual, equivalenteMensual, estadoPrestamo, ORDEN_CLASES } from '../core/finanzas.js';
import { CLASES } from '../core/modelo.js';
import { nombreMes, nombrePeriodo } from '../core/util.js';
import { BarraSegmentos } from './graficos.js';
import { editarPlantilla, editarPrestamo } from './formularios.js';

const { computed } = Vue;

const ACCION = { ingreso: '+ Agregar ingreso', fijo: '+ Agregar fijo', fijo_variable: '+ Agregar fijo variable', aporte: '+ Agregar aporte', provision: '+ Agregar pago anual' };
const COLORES_PERSONA = ['var(--s1)', 'var(--s5)', 'var(--s2)', 'var(--s4)'];

export const VistaPresupuesto = {
  components: { BarraSegmentos },
  template: `
  <section class="pila">
    <p class="nota">Lo que el hogar paga, aparta o recibe cada mes. Los montos son promedios: un seguro de 10 meses cuenta 10/12 por mes y los décimos se reparten en el año.</p>

    <div class="kpis">
      <div class="kpi"><div class="kpi-et">Ingresos al mes</div><div class="kpi-val positivo">{{ fmt(p.porClase.ingreso) }}</div><div class="kpi-nota">promedio, con décimos</div></div>
      <div class="kpi"><div class="kpi-et">Egresos al mes</div><div class="kpi-val">{{ fmt(p.egresos) }}</div><div class="kpi-nota">compromisos, préstamos y aportes</div></div>
      <div class="kpi"><div class="kpi-et">Libre planificado</div><div class="kpi-val" :class="{ negativo: libre < 0 }">{{ fmt(libre) }}</div><div class="kpi-nota">antes de gastos adicionales</div></div>
    </div>

    <div v-if="sinDefinir.length" class="aviso-banner ambar">
      <p>Sin monto todavía: {{ sinDefinir.map((t) => t.nombre).join(', ') }}. Toca cada uno para definirlo.</p>
    </div>

    <article v-if="porPersona.length" class="tarjeta">
      <h2 style="margin-bottom: 12px">Quién paga qué</h2>
      <barra-segmentos clase="media" :segmentos="porPersona"/>
      <ul class="lista" style="margin-top: 12px">
        <li v-for="x in porPersona" :key="x.id" class="fila compacta">
          <i class="punto" :style="{ background: x.color }"></i>
          <span style="flex: 1; font-size: 0.92rem">{{ x.nombre }}</span>
          <span class="monto">{{ fmt(x.valor) }}</span>
          <span class="tenue" style="width: 42px; text-align: right; font-size: 0.85rem">{{ x.pct }}</span>
        </li>
      </ul>
    </article>

    <article v-for="g in grupos" :key="g.clase" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo">{{ g.titulo }}</h2>
        <span class="monto">{{ fmt(g.total) }}</span><span class="tenue" style="font-size: 0.8rem">/mes</span>
      </div>
      <ul class="lista">
        <li v-for="x in g.filas" :key="x.id" class="fila clic" @click="x.abrir()">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ x.nombre }}</span>
            <span class="fila-sub envuelve">
              <span class="chip">{{ nombrePersona(x.responsableId) }}</span>
              <span v-for="c in x.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span>
            </span>
          </div>
          <div class="derecha">
            <div class="monto">{{ x.monto }}</div>
            <div v-if="x.detalle" class="meta">{{ x.detalle }}</div>
          </div>
        </li>
      </ul>
      <p v-if="!g.filas.length" class="nota chica" style="padding-top: 8px">Nada todavía.</p>
      <a v-if="g.clase === 'prestamo'" class="btn-punteado" href="#/prestamos" style="display: block; text-align: center; margin-top: 14px">Ver préstamos y plan</a>
      <button v-else type="button" class="btn-punteado" style="margin-top: 14px" @click="editarPlantilla({ clase: g.clase })">{{ accion[g.clase] }}</button>
    </article>
  </section>`,
  setup() {
    const p = computed(() => presupuestoMensual(store.doc, store.periodo));
    const libre = computed(() => p.value.porClase.ingreso - p.value.egresos);
    const porPersona = computed(() => {
      const total = p.value.egresos || 1;
      return Object.entries(p.value.porPersona)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id, valor], i) => ({
          id, valor, nombre: id === 'sin' ? 'El hogar' : nombrePersona(id), color: COLORES_PERSONA[i % COLORES_PERSONA.length],
          pct: `${Math.round((valor / total) * 100)}%`, titulo: `${id === 'sin' ? 'El hogar' : nombrePersona(id)} ${fmt(valor)}`,
        }));
    });
    const sinDefinir = computed(() => vivos('plantillas').filter((t) => t.activo !== false && !Number(t.clase === 'provision' ? t.montoAnual : t.monto)));

    function filaPlantilla(t) {
      const chips = [];
      const meses = t.meses?.length || 12;
      if (t.activo === false) chips.push({ t: 'inactivo', c: '' });
      if (!Number(t.clase === 'provision' ? t.montoAnual : t.monto)) chips.push({ t: 'sin monto', c: 'aviso' });
      if (t.clase !== 'provision' && meses < 12) chips.push({ t: `${meses} meses`, c: '' });
      if (t.dia) chips.push({ t: `día ${t.dia}`, c: '' });
      if (t.decimo13 || t.decimo14) chips.push({ t: 'con décimos', c: 'acento' });
      if (t.clase === 'provision' && !t.mesPago) chips.push({ t: 'sin mes de pago', c: 'aviso' });
      let monto = fmt(t.monto);
      let detalle = '';
      if (t.clase === 'provision') {
        monto = `${fmt(t.montoAnual)} al año`;
        detalle = `aparta ${fmt(t.monto)}/mes${t.mesPago ? ' · se paga en ' + nombreMes(t.mesPago) : ''}`;
      } else if (t.clase === 'aporte' && t.cuentaDestinoId) {
        detalle = `a la cuenta ${store.doc.cuentas.find((c) => c.id === t.cuentaDestinoId)?.nombre || ''}`;
      } else if (meses < 12 || t.decimo13 || t.decimo14) {
        detalle = `≈ ${fmt(equivalenteMensual(t))}/mes`;
      }
      return { id: t.id, nombre: t.nombre, responsableId: t.responsableId, chips, monto, detalle, abrir: () => editarPlantilla(t) };
    }
    const filaPrestamo = (x) => ({
      id: x.id, nombre: x.nombre, responsableId: x.responsableId, monto: fmt(x.cuota),
      chips: x.dia ? [{ t: `día ${x.dia}`, c: '' }] : [], detalle: `hasta ${nombrePeriodo(x.fin, true)}`, abrir: () => editarPrestamo(x),
    });
    const grupos = computed(() => ORDEN_CLASES.map((clase) => {
      const filas = clase === 'prestamo'
        ? vivos('prestamos')
          .map((x) => ({ ...x, fin: estadoPrestamo(x, store.doc.movimientos).finEstimado }))
          .filter((x) => x.fin && x.fin >= store.periodo)
          .map(filaPrestamo)
        : vivos('plantillas').filter((t) => t.clase === clase)
          .sort((a, b) => (a.activo === false) - (b.activo === false) || (Number(b.monto) || 0) - (Number(a.monto) || 0))
          .map(filaPlantilla);
      return { clase, titulo: CLASES[clase], filas, total: p.value.porClase[clase] };
    }));

    return { p, libre, porPersona, sinDefinir, grupos, fmt, nombrePersona, editarPlantilla, accion: ACCION };
  },
};
