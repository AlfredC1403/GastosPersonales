// Comparar años: ingresos, deducciones, gasto, ahorro, deuda y patrimonio de dos años lado a lado,
// con el gasto por grupo (y sus categorías y partidas) y mes a mes.
import {
  store, fmtEntero, fmtCorto, indice, filtro, personaFiltro, nombrePersona, nombreGrupo, nombreCategoria, nombrePartida, aviso,
  anioCargado, aniosDeLaCarpeta, resumenGuardado, abrirAnio,
} from '../store.js';
import { compararAnios } from '../core/reportes.js';
import { aniosCargados } from '../core/cierres.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { nombrePeriodo, fechaCorta } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { ColumnasComparadas } from './graficos.js';

const { ref, computed, watch } = Vue;

const esAnio = (x) => /^\d{4}$/.test(String(x || ''));

export const VistaComparar = {
  components: { ColumnasComparadas },
  props: { params: { type: Array, default: () => [] } },
  template: `
  <section class="pila amplia">
    <div class="fila-campos">
      <label class="campo"><span>Año</span><select v-model="a"><option v-for="x in anios" :key="x" :value="x">{{ x }}</option></select></label>
      <label class="campo"><span>Contra</span><select v-model="b"><option v-for="x in anios" :key="x" :value="x" :disabled="x === a">{{ x }}</option></select></label>
    </div>
    <div class="segmentos" role="group" aria-label="Periodo">
      <button type="button" :class="{ activo: prefs.corteAnual === 'va' }" :aria-pressed="prefs.corteAnual === 'va'" @click="definirVista('corteAnual', 'va')">En lo que va del año</button>
      <button type="button" :class="{ activo: prefs.corteAnual === 'completo' }" :aria-pressed="prefs.corteAnual === 'completo'" @click="definirVista('corteAnual', 'completo')">Año completo</button>
    </div>
    <p class="nota chica">{{ textoCorte }}{{ personaFiltro() ? ' Solo lo de ' + nombrePersona(personaFiltro()) + '.' : '' }}</p>

    <div v-for="y in delResumen" :key="'r' + y" class="aviso-banner">
      <p>{{ y }} sale de su resumen guardado: se compara por meses completos y sin el detalle de sus movimientos.</p>
      <button type="button" class="btn" :disabled="!!store.anios.cargando" @click="cargar(y)">{{ store.anios.cargando === y ? 'Bajando…' : 'Cargar detalle' }}</button>
    </div>
    <div v-for="y in sinResumen" :key="'s' + y" class="aviso-banner ambar">
      <p>{{ y }} está en OneDrive y no tiene resumen guardado.</p>
      <button type="button" class="btn" :disabled="!!store.anios.cargando" @click="cargar(y)">{{ store.anios.cargando === y ? 'Bajando…' : 'Cargar ' + y }}</button>
    </div>

    <div v-if="(c.sinDatosA && !sinResumen.includes(a)) || (c.sinDatosB && !sinResumen.includes(b))" class="aviso-banner ambar">
      <p>No hay registros de {{ [c.sinDatosA ? a : '', c.sinDatosB ? b : ''].filter(Boolean).join(' ni de ') }}{{ personaFiltro() ? ' de ' + nombrePersona(personaFiltro()) : '' }}: sus totales no se comparan.</p>
    </div>

    <article class="tarjeta sin-relleno">
      <div class="envoltura-tabla" style="margin: 0; padding: 6px 16px 10px">
        <table class="tabla">
          <thead><tr><th></th><th class="num">{{ a }}</th><th class="num">{{ b }}</th><th class="num">Diferencia</th></tr></thead>
          <tbody>
            <tr v-for="f in c.filas" :key="f.clave">
              <td style="white-space: normal">{{ f.nombre }}</td>
              <td class="num">{{ c.sinDatosA ? '—' : fmtEntero(f.A) }}</td>
              <td class="num tenue">{{ c.sinDatosB ? '—' : fmtEntero(f.B) }}</td>
              <td class="num" :class="clase(f)">{{ textoDif(f) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="tarjeta">
      <h2>Gasto por grupo</h2>
      <div class="leyenda" style="margin: 6px 0 4px">
        <span><i class="punto" style="background: var(--acento)"></i>{{ a }}</span>
        <span><i class="punto" style="background: var(--tinta3)"></i>{{ b }}</span>
      </div>
      <p v-if="!c.grupos.length" class="vacio" style="padding: 8px 0">No hay gastos en ninguno de los dos años.</p>
      <ul class="lista">
        <li v-for="g in c.grupos" :key="g.id" class="fila-comparada">
          <button type="button" class="fila-comparada-cab" :aria-expanded="abierto === g.id" @click="abierto = abierto === g.id ? null : g.id">
            <span class="fila-titulo">{{ g.id === 'sin-grupo' ? 'Sin grupo' : nombreGrupo(g.id) }}</span>
            <span class="monto">{{ fmtEntero(g.A) }}</span>
            <span class="dif" :class="clase({ ...g, sentido: -1 })" style="min-width: 76px; text-align: right">{{ textoDif(g) }}</span>
          </button>
          <div class="barras-par" aria-hidden="true">
            <div class="progreso acento fino-par"><div :style="{ width: ancho(g.A) }"></div></div>
            <div class="progreso gris fino-par"><div :style="{ width: ancho(g.B) }"></div></div>
          </div>
          <div v-if="abierto === g.id" class="detalle-grupo">
            <p class="etiqueta">Categorías</p>
            <div v-for="x in g.categorias" :key="'c' + x.id" class="detalle-fila">
              <span>{{ x.id === 'sin' ? 'Sin categoría' : nombreCategoria(x.id) }}</span><span class="monto">{{ fmtEntero(x.A) }}</span><span class="tenue">{{ fmtEntero(x.B) }}</span><span :class="clase({ ...x, sentido: -1 })">{{ textoDif(x) }}</span>
            </div>
            <template v-if="g.partidas.length">
              <p class="etiqueta" style="margin-top: 6px">Partidas</p>
              <div v-for="x in g.partidas" :key="'p' + x.id" class="detalle-fila">
                <span>{{ nombrePartida(x.id) || 'Partida eliminada' }}</span><span class="monto">{{ fmtEntero(x.A) }}</span><span class="tenue">{{ fmtEntero(x.B) }}</span><span :class="clase({ ...x, sentido: -1 })">{{ textoDif(x) }}</span>
              </div>
            </template>
          </div>
        </li>
      </ul>
    </article>

    <article class="tarjeta">
      <h2>Gasto mes a mes</h2>
      <columnas-comparadas :meses="meses" :nombre-a="a" :nombre-b="b" :formatear="fmtCorto" style="margin-top: 12px"/>
    </article>
  </section>`,
  setup(props) {
    const actual = store.hoy.slice(0, 4);
    const a = ref(esAnio(props.params[0]) ? props.params[0] : actual);
    const b = ref(esAnio(props.params[1]) ? props.params[1] : String(Number(a.value) - 1));
    // Los años cargados, los de OneDrive, los que tienen resumen guardado, este año y el anterior
    // (y los elegidos en el enlace).
    const anios = computed(() => [...new Set([
      ...aniosCargados(store.doc), ...aniosDeLaCarpeta(), ...(store.doc.resumenes || []).filter((r) => !r.borrado).map((r) => r.id),
      actual, String(Number(actual) - 1), a.value, b.value,
    ])].filter(esAnio).sort().reverse());
    watch([a, b], ([x, y]) => {
      if (x === y) b.value = String(Number(x) - 1);
      history.replaceState(null, '', `#/comparar/${a.value}/${b.value}`);
    });
    watch(() => props.params, (p) => {
      if (esAnio(p[0])) a.value = p[0];
      if (esAnio(p[1])) b.value = p[1];
    });

    const ix = computed(indice);
    // Los años que no están en el dispositivo se comparan con su resumen guardado.
    const guardados = computed(() => {
      void ix.value;
      return Object.fromEntries([a.value, b.value].filter((y) => !anioCargado(y) && resumenGuardado(y)).map((y) => [y, resumenGuardado(y)]));
    });
    const delResumen = computed(() => Object.keys(guardados.value).sort());
    const sinResumen = computed(() => {
      void ix.value;
      return [...new Set([a.value, b.value])].filter((y) => !anioCargado(y) && !resumenGuardado(y) && aniosDeLaCarpeta().includes(y)).sort();
    });
    const cargar = (y) => abrirAnio(y).catch((e) => aviso(e.message, 'error', 7000));
    const c = computed(() => compararAnios(ix.value, a.value, b.value, { modo: prefs.corteAnual, hoy: store.hoy, filtro: filtro(), guardados: guardados.value }));
    const textoCorte = computed(() => {
      if (c.value.modo === 'va') return `Del 1 de enero al ${fechaCorta(c.value.corteA)} de cada año.`;
      if (prefs.corteAnual === 'va') return 'En enero todavía no hay meses completos para comparar con un resumen guardado: se comparan los años completos.';
      return 'Los dos años completos (el actual, con lo registrado hasta hoy).';
    });
    const abierto = ref(null);
    const maximo = computed(() => Math.max(1, ...c.value.grupos.flatMap((g) => [g.A, g.B])));
    const ancho = (v) => `${Math.max(0, Math.min(100, (v / maximo.value) * 100))}%`;
    const textoDif = (f) => {
      if (c.value.sinDatosA || c.value.sinDatosB) return '—';
      if (!f.dif) return '=';
      if (f.pct === null) return `+${fmtEntero(f.dif)}`;
      return `${f.pct > 0 ? '+' : ''}${f.pct} %`;
    };
    const clase = (f) => (c.value.sinDatosA || c.value.sinDatosB || !f.dif ? 'tenue' : f.dif * (f.sentido || 1) > 0 ? 'positivo' : 'negativo');
    const meses = computed(() => c.value.meses.map((m) => ({
      etiqueta: nombrePeriodo(`${a.value}-${String(m.mes).padStart(2, '0')}`, true).slice(0, 1).toUpperCase(),
      largo: nombrePeriodo(`${a.value}-${String(m.mes).padStart(2, '0')}`).split(' ')[0],
      A: c.value.sinDatosA ? null : m.A, B: c.value.sinDatosB ? null : m.B,
    })));

    return {
      prefs, definirVista, anios, a, b, c, textoCorte, abierto, ancho, textoDif, clase, meses, store, delResumen, sinResumen, cargar,
      fmtEntero, fmtCorto, nombreGrupo, nombreCategoria, nombrePartida, nombrePersona, personaFiltro, SIN_GRUPO,
    };
  },
};
