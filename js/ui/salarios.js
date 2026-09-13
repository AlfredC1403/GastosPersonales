import { store, fmt, indice, vivos, nombrePersona, nombreCuenta, buscar, filtro, personaFiltro } from '../store.js';
import { NATURALEZAS, APLICA_EN, pagosProgramados, montoEsperado, estadoRecibo } from '../core/nomina.js';
import { FRECUENCIAS } from '../core/modelo.js';
import { coincidePersona } from '../core/filtro.js';
import { fechaCorta, periodoDe } from '../core/util.js';
import { editarIngreso, editarDeduccion, editarRecibo } from './formularios.js';

const { computed } = Vue;

const dias = (i) => (i.diasPago?.length ? i.diasPago : [31]).map((d) => (Number(d) >= 31 ? 'último día' : `día ${d}`)).join(' y ');

export const VistaSalarios = {
  template: `
  <section class="pila">
    <p class="nota">Cada salario tiene sus días de pago y sus deducciones. Al registrar una quincena, las deducciones fijas y los préstamos por planilla vienen llenos; las demás se escriben como salen en la colilla. La app no calcula el IHSS ni el ISR.</p>

    <article v-for="x in lista" :key="x.i.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ x.i.nombre }}</h2>
        <span class="chip">{{ nombrePersona(x.i.personaId) }}</span>
        <span v-if="x.i.activo === false" class="chip">inactivo</span>
      </div>
      <p class="nota" style="margin-top: 6px">{{ x.resumen }}</p>
      <div class="botones" style="margin-top: 10px"><button type="button" class="btn" @click="editarIngreso(x.i)">Editar salario</button></div>

      <h3 class="titulo-grupo" style="margin-top: 16px">Deducciones</h3>
      <ul class="lista">
        <li v-for="d in x.deducciones" :key="d.id" class="fila clic" @click="editarDeduccion(x.i.id, d.id)">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem" :class="{ tenue: d.activo === false }">{{ d.nombre }}</span>
            <span class="fila-sub envuelve"><span v-for="c in d.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span></span>
          </div>
          <div class="derecha"><div class="monto">{{ d.monto }}</div></div>
        </li>
      </ul>
      <p v-if="!x.deducciones.length" class="nota chica" style="padding: 6px 0">Sin deducciones.</p>
      <button type="button" class="btn-punteado" style="margin-top: 10px" @click="editarDeduccion(x.i.id)">+ Agregar deducción</button>

      <template v-if="x.ultimos.length">
        <h3 class="titulo-grupo" style="margin-top: 16px">Últimos pagos</h3>
        <ul class="lista">
          <li v-for="r in x.ultimos" :key="r.id" class="fila compacta clic" @click="editarRecibo(r.r)">
            <div class="fila-info"><span style="font-size: 0.9rem">{{ r.titulo }}</span><span class="fila-sub">{{ r.sub }}</span></div>
            <span class="monto">{{ fmt(r.r.neto) }}</span>
          </li>
        </ul>
      </template>
    </article>

    <p v-if="!lista.length" class="vacio">{{ personaFiltro() ? 'No hay salarios de ' + nombrePersona(personaFiltro()) + '.' : 'Todavía no hay salarios.' }}</p>
    <button type="button" class="btn-punteado" @click="editarIngreso({ personaId: personaFiltro() || undefined })">+ Nuevo salario</button>
  </section>`,
  setup() {
    const lista = computed(() => {
      const ix = indice();
      return vivos('ingresos').filter((i) => coincidePersona(i.personaId || null, filtro())).map((i) => {
        const quincenal = i.frecuencia === 'quincenal';
        const [primero] = pagosProgramados(i, periodoDe(store.hoy));
        const resumen = `${FRECUENCIAS[i.frecuencia] || 'Mensual'}, ${dias(i)} · neto ${quincenal ? 'de cada quincena' : 'al mes'} ${fmt(i.netoEsperado || 0)} · entra a ${nombreCuenta(i.cuentaId)}`;
        const deducciones = (i.deducciones || []).map((d) => {
          const chips = [{ t: NATURALEZAS[d.naturaleza] || 'Deducción', c: d.naturaleza === 'prestamo' ? 'acento' : d.naturaleza === 'ahorro' ? 'ok' : '' }];
          if (d.naturaleza === 'prestamo') chips.push({ t: buscar('prestamos', d.prestamoId)?.nombre || 'sin préstamo', c: d.prestamoId ? '' : 'aviso' });
          if (d.naturaleza === 'ahorro' && d.cuentaDestinoId) chips.push({ t: `a ${nombreCuenta(d.cuentaDestinoId)}`, c: '' });
          if (quincenal && (d.aplicaEn || 'ambas') !== 'ambas') chips.push({ t: APLICA_EN[d.aplicaEn].replace('Solo en el ', '').replace(' del mes', ''), c: '' });
          if (d.enDecimos) chips.push({ t: 'también en décimos', c: '' });
          if (d.activo === false) chips.push({ t: 'inactiva', c: '' });
          const esperado = primero ? montoEsperado(ix, i, d, primero) : null;
          let monto = 'cambia';
          if (d.naturaleza === 'prestamo') monto = esperado !== null ? `${fmt(esperado)}${quincenal && (d.aplicaEn || 'ambas') === 'ambas' ? ' c/u' : ''}` : '—';
          else if (esperado !== null) monto = d.fija ? fmt(esperado) : `≈ ${fmt(esperado)}`;
          return { ...d, chips, monto };
        });
        const ultimos = (ix.recibosPorIngreso.get(i.id) || [])
          .slice()
          .sort((a, b) => (a.ocurrencia < b.ocurrencia ? 1 : -1))
          .slice(0, 3)
          .map((r) => {
            const e = estadoRecibo(r);
            return {
              id: r.id, r, titulo: `Pago del ${fechaCorta(r.ocurrencia)}`,
              sub: e.pendientes ? (e.pendientes === 1 ? 'falta 1 deducción' : `faltan ${e.pendientes} deducciones`) : r.deducciones?.length ? `bruto ${fmt(e.bruto)} · descontado ${fmt(e.descontado)}` : `llegó el ${fechaCorta(r.fecha)}`,
            };
          });
        return { i, resumen, deducciones, ultimos };
      });
    });
    return { lista, fmt, nombrePersona, editarIngreso, editarDeduccion, editarRecibo, personaFiltro };
  },
};
