// Topes: el techo que el hogar se pone para una categoría o un grupo.
// A diferencia del presupuesto, un tope no planea un pago: vigila, y por eso alcanza también lo
// que se gasta fuera del plan, que es justo donde se escapa el dinero.
import {
  store, fmt, fmtEntero, indice, abrirModal, grupos, categorias, categoriasPorGrupo, filtro, simboloDe, nombreGrupo, nombreCategoria,
} from '../store.js';
import { resumenTopes, categoriaCubierta, AVISO_POR_DEFECTO } from '../core/topes.js';
import { sugerirMonto } from '../core/reportes.js';
import { AMBITOS_TOPE, MONEDAS } from '../core/modelo.js';
import { nombrePeriodo, redondear } from '../core/util.js';
import { copia, PIE, usarFormulario } from './formulario-base.js';
import { Icono } from './componentes.js';

const { reactive, computed } = Vue;

const CLASES = { bien: '', cerca: 'aviso', pasado: 'mal' };
const TEXTOS = { bien: 'Va bien', cerca: 'Va cerca', pasado: 'Se pasó' };

export const TopeForm = {
  components: { Icono },
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Vigilar</span>
        <select v-model="x.ambito"><option v-for="(n, k) in ambitos" :key="k" :value="k">{{ n }}</option></select></label>
      <label class="campo"><span>{{ x.ambito === 'grupo' ? 'Grupo' : 'Categoría' }}</span>
        <select v-model="x.referenciaId">
          <option :value="null">Elegir…</option>
          <template v-if="x.ambito === 'grupo'"><option v-for="g in listaGrupos" :key="g.id" :value="g.id">{{ g.nombre }}</option></template>
          <optgroup v-for="g in porGrupo" v-else :key="g.grupo.id" :label="g.grupo.nombre">
            <option v-for="c in g.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option>
          </optgroup>
        </select></label>
    </div>
    <p v-if="yaCubierta" class="nota chica">Ya hay un tope que cubre esto. Puedes tener los dos: el de la categoría avisa antes que el del grupo.</p>

    <div class="fila-campos">
      <label class="campo"><span>Tope al mes</span><input v-model.number="x.monto" type="number" inputmode="decimal" step="0.01" min="0" required></label>
      <label class="campo"><span>Moneda</span>
        <select v-model="x.moneda"><option v-for="(n, k) in monedas" :key="k" :value="k">{{ n }}</option></select></label>
    </div>
    <p v-if="sugerencia" class="nota chica">
      En los últimos {{ sugerencia.meses }} meses se gastó {{ fmt(sugerencia.promedio) }} al mes de promedio (mediana {{ fmt(sugerencia.mediana) }}, máximo {{ fmt(sugerencia.maximo) }}).
      <button type="button" class="btn-enlace" @click="usarSugerencia">Usar {{ fmt(sugerencia.mediana) }}</button>
    </p>

    <label class="campo"><span>Avisar al llegar al</span>
      <input v-model.number="x.avisarEn" type="number" inputmode="numeric" step="5" min="1" max="100"></label>
    <p class="nota chica">Porcentaje del tope. Con {{ x.avisarEn || 80 }} % y un tope de {{ fmt(x.monto || 0) }}, avisa a los {{ fmt(((x.monto || 0) * (x.avisarEn || 80)) / 100) }}.</p>

    <label class="casilla"><input v-model="x.activo" type="checkbox"> Activo</label>
    <label class="campo"><span>Nota</span><input v-model.trim="x.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const x = reactive({ ambito: 'categoria', referenciaId: null, monto: null, moneda: 'L', avisarEn: AVISO_POR_DEFECTO, activo: true, nota: '', ...original });
    const ix = computed(indice);
    const yaCubierta = computed(() => !original.id && x.ambito === 'categoria' && x.referenciaId && categoriaCubierta(ix.value, x.referenciaId));
    const sugerencia = computed(() => {
      if (!x.referenciaId || x.moneda !== 'L') return null;
      const s = sugerirMonto(ix.value, x.ambito === 'grupo' ? { grupoId: x.referenciaId } : { categoriaId: x.referenciaId });
      return s && s.mesesConGasto ? s : null;
    });
    const usarSugerencia = () => { x.monto = sugerencia.value.mediana; };
    const f = usarFormulario('topes', original, emit, { que: 'este tope' });
    function enviar() {
      f.error.value = '';
      if (!x.referenciaId) return (f.error.value = x.ambito === 'grupo' ? 'Elige el grupo que vigila.' : 'Elige la categoría que vigila.');
      if (!(Number(x.monto) > 0)) return (f.error.value = 'Escribe el tope del mes.');
      const avisarEn = Math.min(100, Math.max(1, Math.round(Number(x.avisarEn) || AVISO_POR_DEFECTO)));
      f.terminar({ ...x, monto: redondear(Number(x.monto)), avisarEn });
    }
    return {
      x, yaCubierta, sugerencia, usarSugerencia, enviar, fmt, ambitos: AMBITOS_TOPE, monedas: MONEDAS,
      listaGrupos: computed(grupos), porGrupo: computed(() => categoriasPorGrupo('gasto')), ...f,
    };
  },
};

export const editarTope = (t = {}) => abrirModal(t.id ? 'Editar tope' : 'Nuevo tope', TopeForm, { inicial: t });

export const VistaTopes = {
  components: { Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Topes de {{ nombrePeriodo(store.periodo) }}</p>
      <p class="hero-num">{{ fmt(r.gastado) }}</p>
      <p class="hero-texto">{{ r.lista.length
        ? 'De ' + fmt(r.techo) + ' entre ' + (r.lista.length === 1 ? 'un tope' : r.lista.length + ' topes') + '.' + resumenEstado
        : 'Un tope es el techo que se ponen para una categoría o un grupo. No planea un pago como una partida: vigila, y cuenta también lo que se gasta fuera del plan.' }}</p>
    </div>

    <article v-for="t in r.lista" :key="t.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ t.nombre }}</h2>
        <span class="chip">{{ t.ambito === 'grupo' ? 'Grupo' : 'Categoría' }}</span>
        <span class="chip" :class="clases[t.estado]">{{ textos[t.estado] }}</span>
      </div>
      <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 8px; flex-wrap: wrap">
        <span class="hero-num chico" :class="{ negativo: t.estado === 'pasado' }">{{ fmt(t.gastado) }}</span>
        <span class="tenue">de {{ fmt(t.monto) }}{{ t.moneda === 'USD' ? ' (US$' + t.tope.monto + ')' : '' }} · {{ t.pct }}%</span>
      </div>
      <div class="progreso" :class="t.estado === 'pasado' ? 'mal' : t.estado === 'cerca' ? 'aviso' : 'acento'" style="margin-top: 10px"
           role="img" :aria-label="t.pct + '% del tope'"><div :style="{ width: Math.min(100, t.pct) + '%' }"></div></div>
      <p class="nota" style="margin-top: 10px">{{ texto(t) }}</p>
      <p v-if="t.tope.nota" class="nota chica">{{ t.tope.nota }}</p>
      <div class="botones">
        <a class="btn" :href="enlaceMovimientos(t)">Ver movimientos</a>
        <button type="button" class="btn" @click="editarTope(t.tope)">Editar</button>
      </div>
    </article>

    <button type="button" class="btn-punteado" @click="editarTope({})">+ Nuevo tope</button>
    <p class="nota chica">El tope se mide contra el gasto del mes en esa categoría o grupo, esté o no dentro del plan. Uno en dólares se pasa a lempiras con la tasa del mes.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const r = computed(() => resumenTopes(ix.value, store.periodo, filtro()));
    const resumenEstado = computed(() => {
      const { pasados, cerca } = r.value;
      const partes = [];
      if (pasados) partes.push(`${pasados} ${pasados === 1 ? 'pasado' : 'pasados'}`);
      if (cerca) partes.push(`${cerca} cerca`);
      return partes.length ? ` ${partes.join(', ')}.` : '';
    });
    function texto(t) {
      if (t.estado === 'pasado') return `Se pasó por ${fmt(-t.queda)}.`;
      const porDia = redondear(t.queda / Math.max(1, diasQueFaltan()));
      return `Quedan ${fmt(t.queda)}${porDia > 0 ? ` · ${fmtEntero(porDia)} por día` : ''}.`;
    }
    function diasQueFaltan() {
      const [a, m] = store.periodo.split('-').map(Number);
      const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
      return store.periodo === store.hoy.slice(0, 7) ? dias - Number(store.hoy.slice(8)) + 1 : dias;
    }
    const enlaceMovimientos = (t) => (t.ambito === 'grupo' ? `#/movimientos?grupo=${t.referenciaId}` : `#/movimientos?categoria=${t.referenciaId}`);
    return {
      store, r, resumenEstado, texto, enlaceMovimientos, editarTope, fmt, fmtEntero, nombrePeriodo,
      clases: CLASES, textos: TEXTOS, simboloDe, nombreGrupo, nombreCategoria, categorias, grupos,
    };
  },
};
