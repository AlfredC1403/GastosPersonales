// Financiamientos de tarjeta: intrafinanciamientos (dentro del límite) y extrafinanciamientos
// (crédito aparte). Aquí se ven todos juntos, de todas las tarjetas, con por qué cuota va cada uno
// y cuánto falta. Un financiamiento no aparece en el mes en que se registra —su primera cuota cae
// cuando la tarjeta hace corte—, así que esta es la pantalla donde se encuentra siempre.
import { store, fmt, fmtEntero, indice, tarjetas, nombrePersona, filtro, personaFiltro } from '../store.js';
import { financiamientos, TIPOS_FINANCIAMIENTO } from '../core/tarjetas.js';
import { coincidePersona } from '../core/filtro.js';
import { nombrePeriodo, fechaCorta, cuandoVence } from '../core/util.js';
import { Icono, FranjaPersona } from './componentes.js';
import { nuevoFinanciamiento, editarFinanciamiento } from './formularios-financiamientos.js';

const { computed, ref } = Vue;

const SITUACIONES = {
  'por-empezar': { texto: 'Por empezar', clase: 'aviso' },
  'en-curso': { texto: 'En curso', clase: 'ok' },
  cancelado: { texto: 'Cancelado', clase: '' },
  terminado: { texto: 'Terminado', clase: '' },
};
const VISTAS = { vigentes: 'Vigentes', todos: 'Todos' };

export const VistaFinanciamientos = {
  components: { Icono, FranjaPersona },
  template: `
  <section class="pila">
    <p v-if="!listaTarjetas.length" class="vacio">Todavía no hay tarjetas de crédito. Los financiamientos se registran sobre una tarjeta.
      <a href="#/tarjetas">Agregar una</a>.</p>

    <template v-else>
      <franja-persona/>

      <div class="kpis">
        <div class="kpi"><div class="kpi-et">Falta por pagar</div><div class="kpi-val">{{ fmtEntero(total.total) }}</div>
          <div class="kpi-nota">{{ total.vigentes }} {{ total.vigentes === 1 ? 'financiamiento' : 'financiamientos' }} vigentes</div></div>
        <div class="kpi"><div class="kpi-et">Intra</div><div class="kpi-val">{{ fmtEntero(total.intra) }}</div>
          <div class="kpi-nota">usa el límite de la tarjeta</div></div>
        <div class="kpi"><div class="kpi-et">Extra</div><div class="kpi-val">{{ fmtEntero(total.extra) }}</div>
          <div class="kpi-nota">crédito aparte del límite</div></div>
      </div>

      <div class="segmentos" role="group" aria-label="Qué mostrar">
        <button v-for="(n, k) in vistas" :key="k" type="button" :class="{ activo: vista === k }" :aria-pressed="vista === k" @click="vista = k">{{ n }}</button>
      </div>
      <div v-if="listaTarjetas.length > 1" class="filtros">
        <select v-model="cuenta" aria-label="Tarjeta">
          <option value="">Todas las tarjetas</option>
          <option v-for="c in listaTarjetas" :key="c.id" :value="c.id">{{ c.nombre }}</option>
        </select>
      </div>

      <p v-if="!lista.length" class="vacio">{{ vista === 'vigentes' ? 'No hay financiamientos vigentes.' : 'No hay financiamientos registrados.' }}</p>

      <article v-for="f in lista" :key="f.id" class="tarjeta">
        <div class="tarjeta-cab centro pegada">
          <h2 style="font-size: 1.05rem">{{ f.nombre }}</h2>
          <span class="chip" :class="situaciones[f.situacion].clase">{{ situaciones[f.situacion].texto }}</span>
        </div>
        <p class="nota chica">{{ f.cuenta.nombre }} · {{ tipos[f.tipo] }} · {{ fmt(f.total) }} a {{ f.n }} cuotas · del {{ fechaCorta(f.fecha) }}</p>

        <div class="datos" style="margin-top: 12px">
          <template v-if="f.siguiente">
            <dt>Próxima cuota</dt>
            <dd>{{ fmt(f.cuotaMonto) }} · cuota {{ f.cuotaActual }} de {{ f.n }}, {{ cuandoVence(f.siguiente.fecha, store.hoy) }} ({{ fechaCorta(f.siguiente.fecha) }})</dd>
          </template>
          <dt>Falta</dt>
          <dd>{{ fmt(f.pendiente) }} en {{ f.faltan }} {{ f.faltan === 1 ? 'cuota' : 'cuotas' }}<template v-if="f.faltan"> · termina en {{ nombrePeriodo(f.termina, true) }}</template></dd>
          <template v-if="f.interesPendiente || f.interesPagado">
            <dt>Intereses</dt>
            <dd>{{ fmt(f.interesPendiente) }} por pagar<template v-if="f.interesPagado"> · {{ fmt(f.interesPagado) }} ya pagados</template></dd>
          </template>
          <template v-if="f.comision">
            <dt>Comisión</dt>
            <dd>{{ fmt(f.comision) }}{{ f.comisionMensual ? ' en cada cuota' : '' }} · {{ f.comisionComoGasto ? 'registrada como gasto del mes' : 'viaja en la cuota' }}</dd>
          </template>
          <template v-if="f.desde > 1">
            <dt>Ya venía empezado</dt>
            <dd>Desde la cuota {{ f.desde }}: las anteriores no se registran aquí.</dd>
          </template>
        </div>

        <div class="botones">
          <button type="button" class="btn" @click="editarFinanciamiento(f.movimiento)">Editar</button>
          <a class="btn" :href="'#/tarjeta/' + f.cuenta.id">Ver la tarjeta</a>
          <button type="button" class="btn-link" :aria-expanded="abierto === f.id" @click="abierto = abierto === f.id ? '' : f.id">
            {{ abierto === f.id ? 'Ocultar el plan' : 'Ver el plan de cuotas' }}
          </button>
        </div>

        <div v-if="abierto === f.id" class="envoltura-tabla" style="margin-top: 10px">
          <table class="tabla">
            <thead><tr><th>Cuota</th><th>Se cobra</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Total</th></tr></thead>
            <tbody>
              <tr v-for="q in f.cuotas" :key="q.k" :class="{ tenue: q.fecha <= store.hoy }">
                <td>{{ q.cancelacion ? 'Cancelación' : q.k + ' de ' + q.n }}</td>
                <td>{{ fechaCorta(q.fecha) }}<span v-if="q.fecha <= store.hoy" class="tenue"> · cobrada</span></td>
                <td class="num">{{ fmt(q.capital / 100) }}</td>
                <td class="num">{{ q.interes ? fmt(q.interes / 100) : '—' }}</td>
                <td class="num">{{ fmt(q.c / 100) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <button type="button" class="btn-punteado" @click="nuevoFinanciamiento()">+ Nuevo financiamiento</button>
      <p class="nota chica">La primera cuota cae cuando la tarjeta hace corte, no el día del financiamiento. Si ya venías pagando uno antes de usar la app, al registrarlo indica por qué cuota vas.</p>
    </template>
  </section>`,
  setup() {
    const vista = ref('vigentes');
    const cuenta = ref('');
    const abierto = ref('');
    const listaTarjetas = computed(tarjetas);

    const todos = computed(() => financiamientos(indice(), { hoy: store.hoy })
      .filter((f) => coincidePersona(f.cuenta.titularId || null, filtro())));
    const lista = computed(() => todos.value
      .filter((f) => (!cuenta.value || f.cuenta.id === cuenta.value)
        && (vista.value === 'todos' || (f.situacion !== 'terminado' && f.situacion !== 'cancelado'))));
    const total = computed(() => {
      const t = { intra: 0, extra: 0, total: 0, vigentes: 0 };
      for (const f of todos.value) {
        if (f.situacion === 'terminado' || f.situacion === 'cancelado') continue;
        if (cuenta.value && f.cuenta.id !== cuenta.value) continue;
        t[f.tipo] += f.pendiente;
        t.total += f.pendiente;
        t.vigentes += 1;
      }
      return t;
    });

    return {
      store, vista, cuenta, abierto, lista, total, listaTarjetas, vistas: VISTAS, situaciones: SITUACIONES, tipos: TIPOS_FINANCIAMIENTO,
      fmt, fmtEntero, nombrePeriodo, fechaCorta, cuandoVence, nombrePersona, personaFiltro, nuevoFinanciamiento, editarFinanciamiento,
    };
  },
};
