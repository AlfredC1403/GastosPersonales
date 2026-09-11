import { store, fmt, vivos, nombrePersona } from '../store.js';
import { presupuestoMensual, equivalenteMensual, estadoPrestamo, ORDEN_CLASES } from '../core/finanzas.js';
import { CLASES } from '../core/modelo.js';
import { nombreMes, nombrePeriodo } from '../core/util.js';
import { editarPlantilla, editarPrestamo } from './formularios.js';

const { computed } = Vue;

export const VistaPresupuesto = {
  template: `
  <section>
    <p class="nota" style="margin-top: 0">Lo que el hogar paga, aparta o recibe cada mes. De aquí sale la lista de la pestaña Mes.
      Los montos son promedios mensuales: un seguro de 10 meses cuenta 10/12 por mes y los décimos se reparten en el año.</p>

    <div class="kpis">
      <div class="kpi"><span>Ingresos al mes</span><strong>{{ fmt(p.porClase.ingreso) }}</strong><small>promedio, con décimos</small></div>
      <div class="kpi"><span>Egresos al mes</span><strong>{{ fmt(p.egresos) }}</strong><small>compromisos, préstamos y aportes</small></div>
      <div class="kpi"><span>Libre planificado</span><strong :class="{ negativo: libre < 0 }">{{ fmt(libre) }}</strong><small>antes de gastos adicionales</small></div>
      <div v-for="x in porPersona" :key="x.id" class="kpi"><span>Paga {{ x.nombre }}</span><strong>{{ fmt(x.v) }}</strong><small>{{ Math.round(x.v / p.egresos * 100) || 0 }}% de los egresos</small></div>
    </div>

    <div v-if="sinDefinir.length" class="banner aviso">
      <p>Sin monto todavía: {{ sinDefinir.map((t) => t.nombre).join(', ') }}. Toca cada uno para definirlo.</p>
    </div>

    <div class="tarjetas">
      <article v-for="g in grupos" :key="g.clase" class="tarjeta">
        <header><h2>{{ g.titulo }}</h2><span class="monto tenue">{{ fmt(g.total) }}/mes</span></header>
        <ul class="lista">
          <li v-for="x in g.filas" :key="x.id" class="clic" @click="x.abrir()">
            <div class="info">
              <span class="titulo">{{ x.nombre }}</span>
              <span class="sub">
                <span class="chip">{{ nombrePersona(x.responsableId) }}</span>
                <span v-for="c in x.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span>
              </span>
            </div>
            <div class="derecha"><span class="monto">{{ x.monto }}</span><small v-if="x.detalle">{{ x.detalle }}</small></div>
          </li>
        </ul>
        <p v-if="!g.filas.length" class="nota">Nada todavía.</p>
        <div class="botones" v-if="g.clase !== 'prestamo'"><button type="button" class="btn chico" @click="editarPlantilla({ clase: g.clase })">+ Agregar</button></div>
        <div class="botones" v-else><a class="btn chico" href="#/prestamos">Ver préstamos y plan</a></div>
      </article>
    </div>
  </section>`,
  setup() {
    const p = computed(() => presupuestoMensual(store.doc, store.periodo));
    const libre = computed(() => p.value.porClase.ingreso - p.value.egresos);
    const porPersona = computed(() => Object.entries(p.value.porPersona)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => ({ id, v, nombre: id === 'sin' ? 'el hogar' : nombrePersona(id) }))
      .sort((a, b) => b.v - a.v));
    const sinDefinir = computed(() => vivos('plantillas').filter((t) => t.activo !== false && !Number(t.clase === 'provision' ? t.montoAnual : t.monto)));

    function filaPlantilla(t) {
      const chips = [];
      const meses = t.meses?.length || 12;
      if (t.activo === false) chips.push({ t: 'inactivo', c: '' });
      if (!Number(t.clase === 'provision' ? t.montoAnual : t.monto)) chips.push({ t: 'sin monto', c: 'aviso' });
      if (t.clase !== 'provision' && meses < 12) chips.push({ t: `${meses} meses`, c: '' });
      if (t.dia) chips.push({ t: `día ${t.dia}`, c: '' });
      if (t.decimo13 || t.decimo14) chips.push({ t: 'con décimos', c: 'acento' });
      let monto = fmt(t.monto);
      let detalle = '';
      if (t.clase === 'provision') {
        monto = `${fmt(t.montoAnual)} al año`;
        detalle = `aparta ${fmt(t.monto)}/mes · ${t.mesPago ? 'se paga en ' + nombreMes(t.mesPago) : 'mes de pago sin definir'}`;
      } else if (meses < 12 || t.decimo13 || t.decimo14) {
        detalle = `≈ ${fmt(equivalenteMensual(t))}/mes`;
      }
      return { id: t.id, nombre: t.nombre, responsableId: t.responsableId, chips, monto, detalle, abrir: () => editarPlantilla(t) };
    }
    function filaPrestamo(x) {
      return {
        id: x.id, nombre: x.nombre, responsableId: x.responsableId, monto: fmt(x.cuota),
        chips: x.dia ? [{ t: `día ${x.dia}`, c: '' }] : [],
        detalle: `hasta ${nombrePeriodo(x.fin, true)}`, abrir: () => editarPrestamo(x),
      };
    }
    const grupos = computed(() => ORDEN_CLASES.map((clase) => {
      let filas;
      if (clase === 'prestamo') {
        filas = vivos('prestamos')
          .map((x) => ({ ...x, fin: estadoPrestamo(x, store.doc.movimientos).finEstimado }))
          .filter((x) => x.fin && x.fin >= store.periodo)
          .map(filaPrestamo);
      } else {
        filas = vivos('plantillas').filter((t) => t.clase === clase)
          .sort((a, b) => (a.activo === false) - (b.activo === false) || nombrePersona(a.responsableId).localeCompare(nombrePersona(b.responsableId)) || a.nombre.localeCompare(b.nombre))
          .map(filaPlantilla);
      }
      return { clase, titulo: CLASES[clase], filas, total: p.value.porClase[clase] };
    }));

    return { p, libre, porPersona, sinDefinir, grupos, fmt, nombrePersona, editarPlantilla };
  },
};
