// Resumen anual: ingresos, deducciones, gasto, ahorro, deudas y patrimonio del año, comparados
// con el año anterior hasta el mismo día.
import { store, fmt, fmtEntero, fmtCorto, indice, filtro, personaFiltro, nombrePersona, nombreGrupo, anioCargado, resumenGuardado } from '../store.js';
import { resumenAnual, resumenAnualDeGuardado, mismoDiaEn, diferencia, seriesDeGrupos, colorGrupo, costoDeLaDeuda } from '../core/reportes.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { nombrePeriodo, fechaCorta, periodoDe } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { ColumnasApiladas } from './graficos.js';

const { computed } = Vue;

export const VistaResumen = {
  components: { ColumnasApiladas },
  template: `
  <section class="pila amplia">
    <div v-if="esEsteAnio" class="segmentos" role="group" aria-label="Periodo">
      <button type="button" :class="{ activo: prefs.corteAnual === 'va' }" :aria-pressed="prefs.corteAnual === 'va'" @click="definirVista('corteAnual', 'va')">En lo que va del año</button>
      <button type="button" :class="{ activo: prefs.corteAnual === 'completo' }" :aria-pressed="prefs.corteAnual === 'completo'" @click="definirVista('corteAnual', 'completo')">Año completo</button>
    </div>
    <p class="nota chica">{{ textoCorte }}</p>

    <div v-if="r.sinDatos" class="aviso-banner"><p>No hay registros de {{ anio }}{{ personaFiltro() ? ' de ' + nombrePersona(personaFiltro()) : '' }}.</p></div>
    <template v-else>
      <div class="kpis">
        <div v-for="k in kpis" :key="k.clave" class="kpi">
          <div class="kpi-et">{{ k.nombre }}</div>
          <div class="kpi-val" :class="k.clase">{{ fmtEntero(k.valor) }}</div>
          <div class="kpi-nota" :class="k.claseVs">{{ k.vs }}</div>
        </div>
      </div>

      <article class="tarjeta">
        <h2>Mes a mes</h2>
        <div class="segmentos" role="group" aria-label="Ver el gasto" style="margin: 12px 0 14px">
          <button type="button" :class="{ activo: prefs.gastoAnual === 'compra' }" :aria-pressed="prefs.gastoAnual === 'compra'" @click="definirVista('gastoAnual', 'compra')">Por fecha de compra</button>
          <button type="button" :class="{ activo: prefs.gastoAnual === 'salida' }" :aria-pressed="prefs.gastoAnual === 'salida'" @click="definirVista('gastoAnual', 'salida')">Por salida de dinero</button>
        </div>
        <columnas-apiladas :meses="meses" :series="series" :formatear="fmtCorto" :etiqueta="prefs.gastoAnual === 'compra' ? 'Gasto por grupo' : 'Salidas de dinero'"/>
        <div v-if="prefs.gastoAnual === 'compra'" class="leyenda-grafico">
          <span v-for="c in series" :key="c.clave"><i class="punto" :style="{ background: c.color }"></i>{{ c.nombre }}</span>
        </div>
        <p class="nota chica" style="margin-top: 10px">{{ prefs.gastoAnual === 'compra' ? 'Cada compra cuenta en su mes (una compra a cuotas, en el mes de cada cuota).' : 'Lo que salió de las cuentas: gastos, cuotas, abonos y pagos de tarjeta, en la fecha del pago.' }}</p>
      </article>

      <article class="tarjeta">
        <h2>Gasto por grupo</h2>
        <ul class="lista" style="margin-top: 8px">
          <!-- Nombre, gasto y comparación no caben en una línea de teléfono: «+L52,440 (+43.7 %)» se
               comía el ancho y el nombre terminaba pintado encima del monto. La comparación baja a
               la segunda línea, como en el resto de las listas. -->
          <li v-for="g in gruposAnio" :key="g.id" class="fila compacta">
            <i class="punto" :style="{ background: g.color }"></i>
            <div class="fila-info">
              <span class="fila-titulo" style="font-size: 0.92rem">{{ g.nombre }}</span>
              <span v-if="g.vs" class="tenue" :class="g.clase" style="font-size: 0.8rem">{{ g.vs }}</span>
            </div>
            <span class="monto">{{ fmtEntero(g.valor) }}</span>
          </li>
        </ul>
      </article>

      <article v-if="r.deducciones.total || r.ingresos.incompletos" class="tarjeta">
        <div class="tarjeta-cab centro pegada"><h2>Deducciones</h2><span class="monto">{{ fmt(r.deducciones.total) }}</span></div>
        <ul class="lista" style="margin-top: 8px">
          <li v-for="d in deducciones" :key="d.nombre" class="fila compacta"><span style="flex: 1; font-size: 0.92rem">{{ d.nombre }}</span><span class="monto">{{ fmt(d.valor) }}</span></li>
        </ul>
        <p v-if="porPersonaDeducciones.length > 1" class="nota chica" style="margin-top: 8px">{{ porPersonaDeducciones.join(' · ') }}</p>
        <div v-if="r.ingresos.incompletos" class="caja-ambar">{{ r.ingresos.incompletos === 1 ? 'Un pago tiene' : r.ingresos.incompletos + ' pagos tienen' }} deducciones sin monto: el bruto y las deducciones pueden ser más.</div>
      </article>

      <article v-if="ingresosPersona.length" class="tarjeta">
        <h2>Ingresos por persona</h2>
        <div class="envoltura-tabla">
          <table class="tabla">
            <thead><tr><th>Persona</th><th class="num">Bruto</th><th class="num">Neto</th></tr></thead>
            <tbody><tr v-for="x in ingresosPersona" :key="x.id"><td>{{ x.nombre }}</td><td class="num">{{ fmt(x.bruto) }}</td><td class="num">{{ fmt(x.neto) }}</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="tarjeta">
        <h2>Deudas</h2>
        <dl class="datos sin-linea" style="margin-top: 10px">
          <dt>Préstamos al empezar el año</dt><dd>{{ fmt(r.deuda.inicio) }}</dd>
          <dt>{{ r.hasta ? 'Al ' + fechaCorta(r.hasta) : 'Al cierre del año' }}</dt><dd>{{ fmt(r.deuda.fin) }}</dd>
          <dt>Bajó</dt><dd :class="{ positivo: r.deuda.baja > 0 }">{{ fmt(r.deuda.baja) }}</dd>
          <dt>Pagos a préstamos</dt><dd>{{ fmt(r.pagosDeuda.total) }}<span v-if="r.pagosDeuda.abonos" class="tenue"> · {{ fmt(r.pagosDeuda.abonos) }} en abonos</span></dd>
          <dt>Intereses de préstamos</dt><dd>{{ fmt(r.deuda.intereses) }}</dd>
          <dt>Seguros de préstamos</dt><dd>{{ fmt(r.deuda.seguros) }}</dd>
          <template v-if="cargosTarjeta"><dt>Intereses y cargos de tarjeta</dt><dd>{{ fmt(cargosTarjeta) }}</dd></template>
        </dl>
        <div v-if="costo && costo.total > 0" class="resalte" style="margin-top: 14px">
          <p class="etiqueta">Lo que costó deber</p>
          <p class="hero-num" style="font-size: 1.6rem; margin-top: 2px">{{ fmt(costo.total) }}</p>
          <p class="nota" style="margin-top: 6px">{{ textoCosto }}</p>
        </div>
      </article>

      <article class="tarjeta">
        <h2>Patrimonio</h2>
        <div class="envoltura-tabla">
          <table class="tabla">
            <thead><tr><th></th><th class="num">1 de enero</th><th class="num">{{ r.hasta ? fechaCorta(r.hasta) : '31 de diciembre' }}</th></tr></thead>
            <tbody>
              <tr><td>Cuentas</td><td class="num">{{ fmt(r.patrimonio.inicio.cuentas) }}</td><td class="num">{{ fmt(r.patrimonio.fin.cuentas) }}</td></tr>
              <tr><td>Tarjetas</td><td class="num">-{{ fmt(r.patrimonio.inicio.tarjetas) }}</td><td class="num">-{{ fmt(r.patrimonio.fin.tarjetas) }}</td></tr>
              <tr><td>Préstamos</td><td class="num">-{{ fmt(r.patrimonio.inicio.prestamos) }}</td><td class="num">-{{ fmt(r.patrimonio.fin.prestamos) }}</td></tr>
              <tr><td><b>Total</b></td><td class="num" :class="{ negativo: r.patrimonio.inicio.total < 0 }"><b>{{ fmt(r.patrimonio.inicio.total) }}</b></td><td class="num" :class="{ negativo: r.patrimonio.fin.total < 0 }"><b>{{ fmt(r.patrimonio.fin.total) }}</b></td></tr>
            </tbody>
          </table>
        </div>
        <p class="nota chica" style="margin-top: 8px">Lo que hay en las cuentas menos lo que se debe en tarjetas (con las cuotas que faltan) y préstamos. Los dólares, con la tasa de referencia o la última de la tarjeta.</p>
      </article>

      <a class="btn" :href="'#/comparar/' + anio + '/' + (Number(anio) - 1)" style="align-self: flex-start">Comparar con {{ Number(anio) - 1 }}</a>
    </template>
  </section>`,
  setup() {
    const ix = computed(indice);
    const anio = computed(() => store.anio);
    const esEsteAnio = computed(() => anio.value === store.hoy.slice(0, 4));
    // En lo que va del año: hasta hoy, y el año anterior hasta el mismo día.
    const hasta = computed(() => (esEsteAnio.value && prefs.corteAnual === 'va' ? store.hoy : ''));
    // Un año que no está en el dispositivo sale de su resumen guardado (el año completo).
    const deAnio = (y, opciones) => {
      const guardado = !anioCargado(y) && resumenGuardado(y);
      return guardado ? resumenAnualDeGuardado(ix.value, guardado, filtro()) : resumenAnual(ix.value, y, filtro(), opciones);
    };
    const r = computed(() => deAnio(anio.value, { hasta: hasta.value }));
    const anterior = computed(() => deAnio(String(Number(anio.value) - 1), { hasta: hasta.value ? mismoDiaEn(Number(anio.value) - 1, hasta.value) : '' }));
    const textoCorte = computed(() => (hasta.value
      ? `Del 1 de enero al ${fechaCorta(hasta.value)}; el año anterior, hasta el mismo día.`
      : `Todo ${anio.value}${esEsteAnio.value ? ', con lo registrado hasta hoy' : ''}.`));

    // "vs. 2025: +L1,200 (+8 %)". `sentido`: 1 si subir es bueno, -1 si subir es malo.
    const comparar = (a, b, sentido) => {
      if (anterior.value.sinDatos) return { vs: `sin datos de ${Number(anio.value) - 1}`, claseVs: '' };
      const d = diferencia(a, b);
      if (!d.dif) return { vs: `igual que ${Number(anio.value) - 1}`, claseVs: '' };
      const pct = d.pct === null ? '' : ` (${d.pct > 0 ? '+' : ''}${d.pct} %)`;
      return { vs: `${d.dif > 0 ? '+' : ''}${fmtEntero(d.dif)}${pct} vs. ${Number(anio.value) - 1}`, claseVs: d.dif * sentido > 0 ? 'positivo' : 'negativo' };
    };
    const kpis = computed(() => {
      const x = r.value;
      const y = anterior.value;
      return [
        { clave: 'bruto', nombre: 'Ingresos brutos', valor: x.ingresos.bruto, ...comparar(x.ingresos.bruto, y.ingresos.bruto, 1) },
        { clave: 'deducciones', nombre: 'Deducciones', valor: x.deducciones.total, ...comparar(x.deducciones.total, y.deducciones.total, -1) },
        { clave: 'neto', nombre: 'Ingresos netos', valor: x.ingresos.neto, clase: 'positivo', ...comparar(x.ingresos.neto, y.ingresos.neto, 1) },
        { clave: 'gasto', nombre: 'Gastado', valor: x.gasto.total, ...comparar(x.gasto.total, y.gasto.total, -1) },
        { clave: 'ahorro', nombre: 'Ahorrado', valor: x.ahorro, ...comparar(x.ahorro, y.ahorro, 1) },
        { clave: 'deuda', nombre: 'Bajó la deuda', valor: x.deuda.baja, ...comparar(x.deuda.baja, y.deuda.baja, 1) },
      ];
    });

    const grupos = computed(() => seriesDeGrupos(ix.value));
    const series = computed(() => (prefs.gastoAnual === 'compra' ? grupos.value.series : [{ clave: 'salidas', nombre: 'Salidas', color: 'var(--acento)' }]));
    const meses = computed(() => r.value.meses.map((m) => {
      const valores = prefs.gastoAnual === 'compra' ? grupos.value.valores(m.porGrupo) : [m.salidas];
      const total = prefs.gastoAnual === 'compra' ? m.gasto : m.salidas;
      return { periodo: m.periodo, etiqueta: nombrePeriodo(m.periodo, true).slice(0, 1).toUpperCase(), largo: nombrePeriodo(m.periodo), total, textoTotal: '', valores };
    }));
    const gruposAnio = computed(() => Object.entries(r.value.gasto.porGrupo)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, valor]) => {
        const c = comparar(valor, anterior.value.gasto.porGrupo[id] || 0, -1);
        return { id, valor, nombre: id === SIN_GRUPO ? 'Sin grupo' : nombreGrupo(id), color: id === SIN_GRUPO ? 'var(--tinta3)' : colorGrupo(ix.value, id), vs: anterior.value.sinDatos ? '' : c.vs.replace(/ vs\. \d+$/, ''), clase: c.claseVs };
      }));
    const deducciones = computed(() => Object.entries(r.value.deducciones.porConcepto).sort((a, b) => b[1] - a[1]).map(([nombre, valor]) => ({ nombre, valor })));
    const porPersonaDeducciones = computed(() => Object.entries(r.value.deducciones.porPersona).map(([id, v]) => `${id === 'sin' ? 'Hogar' : nombrePersona(id)} ${fmt(v)}`));
    const ingresosPersona = computed(() => Object.entries(r.value.ingresos.porPersona)
      .map(([id, x]) => ({ id, nombre: id === 'sin' ? 'Hogar' : nombrePersona(id), ...x }))
      .sort((a, b) => b.bruto - a.bruto));
    const cargosTarjeta = computed(() => r.value.gasto.porCategoria['cargos-tarjeta'] || 0);
    // Cuánto se pagó solo por deber: intereses y cargos de tarjeta más intereses y seguros de
    // préstamos. Un año que no está en el dispositivo no tiene los movimientos para sumarlo.
    const costo = computed(() => (anioCargado(anio.value)
      ? costoDeLaDeuda(ix.value, `${anio.value}-01`, hasta.value ? periodoDe(hasta.value) : `${anio.value}-12`, filtro())
      : null));
    const textoCosto = computed(() => {
      const c = costo.value;
      if (!c) return '';
      const partes = [];
      if (c.tarjetas) partes.push(`${fmt(c.tarjetas)} de tarjetas`);
      if (c.intereses) partes.push(`${fmt(c.intereses)} de intereses`);
      if (c.seguros) partes.push(`${fmt(c.seguros)} de seguros`);
      const pct = c.pctIngreso ? ` Es el ${c.pctIngreso} % de todo lo que entró.` : '';
      return `${partes.join(' · ')}.${pct}`;
    });

    return {
      store, prefs, definirVista, anio, esEsteAnio, r, textoCorte, kpis, series, meses, gruposAnio, deducciones, porPersonaDeducciones, ingresosPersona, cargosTarjeta, costo, textoCosto,
      fmt, fmtEntero, fmtCorto, fechaCorta, nombrePersona, personaFiltro, periodoDe,
    };
  },
};
