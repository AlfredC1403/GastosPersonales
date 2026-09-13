// Años anteriores: cada año con sus totales (del año cargado o de su resumen guardado), y las
// acciones para abrirlo, compararlo con este año o volver a generar su resumen.
import {
  store, fmtEntero, indice, filtro, personaFiltro, nombrePersona, aviso, anioActual, anioCargado, aniosDeLaCarpeta, resumenGuardado,
  abrirAnio, generarResumen,
} from '../store.js';
import { aniosCargados } from '../core/cierres.js';
import { resumenAnual, resumenAnualDeGuardado } from '../core/reportes.js';
import { Icono } from './componentes.js';

const { computed, ref } = Vue;

const tamano = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Totales de un año para las pantallas: del año cargado, de su resumen guardado o null.
export function resumenDeAnio(ix, anio, f, opciones = {}) {
  if (anioCargado(anio)) return { r: resumenAnual(ix, anio, f, opciones), guardado: false };
  const g = resumenGuardado(anio);
  return g ? { r: resumenAnualDeGuardado(ix, g, f, opciones.hastaMes ? { hastaMes: opciones.hastaMes } : {}), guardado: true } : { r: null, guardado: false };
}

// Abre un año anterior en modo lectura: se baja si hace falta y se ve su resumen anual.
export async function verAnio(anio) {
  try {
    await abrirAnio(anio);
    store.anio = String(anio);
    store.periodo = `${anio}-12`;
    location.hash = '#/resumen';
  } catch (e) {
    aviso(e.message, 'error', 7000);
  }
}

export const VistaAnios = {
  components: { Icono },
  template: `
  <section class="pila">
    <p class="nota">{{ explicacion }}</p>
    <p v-if="personaFiltro()" class="nota chica">Solo lo de {{ nombrePersona(personaFiltro()) }}.</p>

    <article v-for="x in filas" :key="x.anio" class="tarjeta">
      <div class="tarjeta-cab centro">
        <h2>{{ x.anio }}</h2>
        <span v-if="x.anio === actual" class="chip acento">Este año</span>
        <span v-else-if="x.cargado" class="chip ok">En este dispositivo</span>
        <span v-else class="chip">En OneDrive{{ x.tamano ? ' · ' + x.tamano : '' }}</span>
      </div>
      <template v-if="x.r && !x.r.sinDatos">
        <dl class="datos sin-linea">
          <dt>Gasto</dt><dd>{{ fmtEntero(x.r.gasto.total) }}</dd>
          <dt>Ingresos netos</dt><dd>{{ fmtEntero(x.r.ingresos.neto) }}</dd>
          <dt>Ahorro</dt><dd>{{ fmtEntero(x.r.ahorro) }}</dd>
          <dt>{{ x.anio === actual ? 'Deuda de préstamos hoy' : 'Deuda de préstamos al cierre' }}</dt><dd>{{ fmtEntero(x.r.deuda.fin) }}</dd>
        </dl>
        <p v-if="x.guardado" class="nota chica" style="margin-top: 6px">Del resumen guardado{{ x.generado ? ' el ' + x.generado : '' }}.</p>
      </template>
      <p v-else-if="x.r" class="nota">No hay registros de {{ x.anio }}.</p>
      <p v-else class="nota">Todavía no tiene resumen guardado. Ábrelo para ver sus totales.</p>
      <div v-if="x.anio !== actual" class="acciones" style="margin-top: 12px; flex-wrap: wrap">
        <button v-if="!x.siempre" type="button" class="btn" :disabled="!!store.anios.cargando" @click="verAnio(x.anio)">
          {{ store.anios.cargando === x.anio ? 'Bajando…' : 'Abrir' }}</button>
        <a v-else class="btn" href="#/resumen" @click="store.anio = x.anio">Ver resumen</a>
        <a class="btn" :href="'#/comparar/' + actual + '/' + x.anio">Comparar con {{ actual }}</a>
        <button v-if="conOneDrive" type="button" class="btn-link" :disabled="!!store.anios.cargando || generando === x.anio" @click="generar(x.anio)">
          {{ generando === x.anio ? 'Generando…' : 'Generar resumen' }}</button>
      </div>
    </article>
  </section>`,
  setup() {
    const ix = computed(indice);
    const actual = computed(anioActual);
    const conOneDrive = computed(() => !!store.sync.ubicacion);
    const explicacion = computed(() => (conOneDrive.value
      ? `En este dispositivo están ${Number(actual.value) - 1} y ${actual.value}. Los años anteriores quedan en OneDrive con un resumen guardado; al abrir uno se baja su archivo para verlo y, si hace falta, editarlo.`
      : 'Sin OneDrive, todos los años están en este dispositivo.'));
    const fechaResumen = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

    const filas = computed(() => {
      void store.rev;
      const doc = store.doc;
      const guardados = (doc.resumenes || []).filter((r) => !r.borrado).map((r) => r.id);
      const anios = [...new Set([...aniosDeLaCarpeta(), ...aniosCargados(doc), ...guardados, actual.value])]
        .filter((a) => /^\d{4}$/.test(a) && a <= actual.value).sort().reverse();
      return anios.map((anio) => {
        const { r, guardado } = resumenDeAnio(ix.value, anio, filtro());
        const archivo = store.carpeta.find((a) => a.nombre === `finanzas-${anio}.json`);
        const g = guardado ? resumenGuardado(anio) : null;
        return {
          anio, r, guardado, cargado: anioCargado(anio), siempre: Number(anio) >= Number(actual.value) - 1,
          tamano: archivo?.tamano ? tamano(archivo.tamano) : '', generado: g?.actualizado ? fechaResumen.format(new Date(g.actualizado)) : '',
        };
      });
    });

    const generando = ref('');
    async function generar(anio) {
      generando.value = anio;
      try {
        await generarResumen(anio);
        aviso(`Resumen de ${anio} generado.`, 'ok');
      } catch (e) {
        aviso(e.message, 'error', 7000);
      } finally {
        generando.value = '';
      }
    }

    return { store, ix, actual, conOneDrive, explicacion, filas, generando, generar, verAnio, fmtEntero, personaFiltro, nombrePersona };
  },
};
