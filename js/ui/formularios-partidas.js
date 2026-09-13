// Formularios del presupuesto: una partida (con su forma de pago y sus abonos) y el ajuste de una
// partida para un solo mes.
import {
  store, guardar, borrar, aviso, personas, cuentas, cuentasDinero, categoriasPorGrupo, vivos, buscar, nombreCuenta, fmt,
} from '../store.js';
import { TIPOS_PARTIDA, FORMAS } from '../core/modelo.js';
import { partesDelMes } from '../core/presupuesto.js';
import { nombrePeriodo, nombreMes, periodoActual, redondear } from '../core/util.js';
import { copia, hayValor, PIE, opcionesCategoria, usarFormulario } from './formulario-base.js';

const { reactive, ref, computed, watch } = Vue;

// ---------------------------------------------------------------- Partida del presupuesto

const AYUDA_FORMA = {
  fijo: 'Toca el círculo en Mes y queda registrada con este monto.',
  variable: 'Al tocar el círculo se abre para escribir el monto real (por ejemplo, la luz).',
  abonos: 'Se paga en partes (por ejemplo, el súper): cada pago se suma hasta llegar al monto.',
};

export const PartidaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="p.nombre" maxlength="60" required></label>
    <div class="segmentos" role="group" aria-label="Tipo de partida">
      <button v-for="(n, k) in tipos" :key="k" type="button" :class="{ activo: p.tipo === k }" :aria-pressed="p.tipo === k" @click="cambiarTipo(k)">{{ n }}</button>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>Categoría</span><select v-model="p.categoriaId">${opcionesCategoria('lista')}</select></label>
      <label class="campo"><span>Quién la paga</span>
        <select v-model="p.responsableId"><option :value="null">Hogar</option>
          <option v-for="x in listaPersonas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
    </div>

    <template v-if="p.tipo === 'anual'">
      <div class="fila-campos">
        <label class="campo"><span>Monto del pago anual</span><input v-model.number="p.montoAnual" type="number" inputmode="decimal" step="0.01" min="0"></label>
        <label class="campo"><span>Mes en que se paga</span>
          <select v-model="p.mesPago"><option :value="null">Sin definir</option><option v-for="n in 12" :key="n" :value="n">{{ nombreMes(n) }}</option></select></label>
      </div>
      <p class="nota">Cada mes se apartan {{ fmt((p.montoAnual || 0) / 12) }} en {{ nombreCuenta(p.cuentaDestinoId || 'reservas') }} y, cuando llega el cobro, se paga de ahí.</p>
    </template>
    <template v-else>
      <div class="fila-campos">
        <label class="campo"><span>{{ p.tipo === 'aporte' ? 'Aporte al mes' : 'Monto al mes' }}</span><input v-model.number="p.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
        <label class="campo"><span>Día de pago</span><input v-model.number="p.dia" type="number" min="1" max="31" placeholder="Opcional"></label>
      </div>
      <div class="campo">
        <span>Cómo se paga</span>
        <div class="segmentos" role="group" aria-label="Cómo se paga">
          <button v-for="(n, k) in formas" :key="k" type="button" :class="{ activo: p.forma === k }" :aria-pressed="p.forma === k" @click="p.forma = k">{{ n }}</button>
        </div>
        <p class="nota chica" style="margin-top: 6px">{{ ayudaForma[p.forma] }}</p>
      </div>
      <div class="campo">
        <span>Meses en que aplica {{ todos ? '(todos)' : '(' + p.meses.length + ' de 12)' }}</span>
        <div class="meses">
          <button v-for="n in 12" :key="n" type="button" :class="{ activo: todos || p.meses.includes(n) }" :aria-pressed="todos || p.meses.includes(n)" @click="alternarMes(n)">{{ nombreMes(n).slice(0, 3) }}</button>
        </div>
      </div>
    </template>

    <div class="fila-campos">
      <label class="campo"><span>{{ p.tipo === 'gasto' ? 'Se paga con' : 'Sale de' }}</span>
        <select v-model="p.medioPagoId"><option v-for="c in (p.tipo === 'gasto' ? listaCuentas : listaDestinos)" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
      <label v-if="p.tipo === 'aporte' && listaMetas.length" class="campo"><span>Para la meta (opcional)</span>
        <select v-model="p.metaId"><option :value="null">Ninguna</option><option v-for="x in listaMetas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
      <label v-if="p.tipo !== 'gasto'" class="campo"><span>{{ p.tipo === 'aporte' ? 'Va a' : 'Se aparta en' }}</span>
        <select v-model="p.cuentaDestinoId"><option :value="null" disabled>Elige…</option>
          <option v-for="c in listaDestinos" :key="c.id" :value="c.id" :disabled="c.id === p.medioPagoId">{{ c.nombre }}</option></select></label>
    </div>

    <p v-if="conTarjeta" class="nota chica">Con tarjeta, el gasto cuenta en el mes de la compra y el dinero sale de la cuenta cuando se paga la tarjeta.</p>
    <label v-if="hayQuincenas && !conTarjeta" class="campo"><span>Con qué pago se cubre</span>
      <select v-model="p.sePagaCon">
        <option value="auto">{{ p.dia ? 'Con el pago que corre ese día' : 'Mitad con cada pago del mes' }}</option>
        <option value="q1">Con el primer pago del mes</option>
        <option value="q2">Con el segundo pago del mes</option>
        <option value="mitad">Mitad con cada pago del mes</option>
      </select></label>
    <label v-if="p.tipo === 'gasto'" class="casilla"><input v-model="p.acumula" type="checkbox"> Lo que sobre en el mes pasa al mes siguiente</label>
    <label class="casilla"><input v-model="p.activo" type="checkbox"> Activa</label>
    <label class="campo"><span>Nota</span><input v-model.trim="p.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const p = reactive({
      nombre: '', tipo: 'gasto', forma: 'fijo', categoriaId: null, responsableId: store.yo, monto: null, montoAnual: null, mesPago: null, meses: [],
      dia: null, medioPagoId: 'gastos', cuentaDestinoId: null, acumula: false, acumulaDesde: null, activo: true, metaId: null, sePagaCon: 'auto',
      desde: null, hasta: null, nota: '', ...original,
    });
    if (!Array.isArray(p.meses)) p.meses = [];
    const todos = computed(() => !p.meses.length || p.meses.length === 12);
    function alternarMes(n) {
      let ms = todos.value ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [...p.meses];
      ms = ms.includes(n) ? ms.filter((x) => x !== n) : [...ms, n].sort((a, b) => a - b);
      if (ms.length) p.meses = ms.length === 12 ? [] : ms;
    }
    function cambiarTipo(tipo) {
      p.tipo = tipo;
      if (tipo === 'anual') p.cuentaDestinoId ||= 'reservas';
      if (tipo === 'aporte') {
        p.cuentaDestinoId ||= 'ahorro';
        if (!p.categoriaId) p.categoriaId = 'ahorro';
        if (p.forma === 'variable') p.forma = 'fijo';
      }
    }
    const formas = computed(() => (p.tipo === 'aporte' ? { fijo: FORMAS.fijo, abonos: FORMAS.abonos } : FORMAS));
    const f = usarFormulario('partidas', original, emit, { que: 'esta partida' });

    function enviar() {
      f.error.value = '';
      const r = { ...p, nombre: p.nombre.trim() };
      if (!r.nombre) return (f.error.value = 'Ponle un nombre.');
      const monto = r.tipo === 'anual' ? r.montoAnual : r.monto;
      if (!hayValor(monto) || !(Number(monto) >= 0)) return (f.error.value = 'Escribe el monto (puede ser 0 si todavía no lo sabes).');
      if (r.tipo !== 'gasto' && !r.cuentaDestinoId) return (f.error.value = r.tipo === 'aporte' ? 'Elige a qué cuenta va el aporte.' : 'Elige dónde se aparta.');
      if (r.tipo === 'anual') {
        r.montoAnual = redondear(Number(r.montoAnual));
        r.monto = redondear(r.montoAnual / 12);
        r.meses = [];
        r.dia = null;
        r.forma = 'fijo';
        r.mesPago = r.mesPago ? Number(r.mesPago) : null;
      } else {
        r.monto = redondear(Number(r.monto));
        r.montoAnual = null;
        r.mesPago = null;
        r.dia = r.dia ? Math.min(31, Math.max(1, Math.round(Number(r.dia)))) : null;
      }
      if (r.tipo === 'gasto') r.cuentaDestinoId = null;
      if (r.tipo !== 'aporte') r.metaId = null;
      r.acumula = r.tipo === 'gasto' && !!r.acumula;
      // Lo que sobre se empieza a guardar desde el mes en que se activó.
      if (r.acumula && !original.acumula) r.acumulaDesde = store.periodo < periodoActual() ? store.periodo : periodoActual();
      if (!r.acumula) r.acumulaDesde = null;
      f.terminar(r);
    }

    // Solo tiene sentido elegir el pago si algún salario es quincenal.
    const hayQuincenas = computed(() => vivos('ingresos').some((i) => i.activo !== false && i.frecuencia === 'quincenal'));
    const conTarjeta = computed(() => p.tipo === 'gasto' && buscar('cuentas', p.medioPagoId)?.tipo === 'tarjeta');
    const listaMetas = computed(() => vivos('metas').filter((x) => x.activo !== false || x.id === p.metaId).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    watch(() => p.metaId, (id, anterior) => {
      const x = buscar('metas', id);
      if (x?.cuentaId && id !== anterior) p.cuentaDestinoId = x.cuentaId;
    });
    watch(() => p.tipo, (tipo) => {
      if (tipo !== 'gasto' && buscar('cuentas', p.medioPagoId)?.tipo === 'tarjeta') p.medioPagoId = cuentasDinero()[0]?.id || 'gastos';
    });
    return {
      p, todos, alternarMes, cambiarTipo, formas, enviar, fmt, nombreMes, nombreCuenta, tipos: TIPOS_PARTIDA, ayudaForma: AYUDA_FORMA, hayQuincenas, conTarjeta, listaMetas,
      lista: computed(() => categoriasPorGrupo('gasto')), listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaDestinos: computed(cuentasDinero), ...f,
    };
  },
};

// "Cambiar solo este mes": otro monto u omitir la partida en un mes, sin tocar la partida.
export const AjusteMesForm = {
  props: { partidaId: String, periodo: String },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <p class="nota">Solo cambia {{ nombrePeriodo(periodo) }}. El monto de siempre es {{ fmt(montoNormal) }}.</p>
    <label class="casilla"><input v-model="a.omitir" type="checkbox"> Omitir {{ partida?.nombre }} este mes</label>
    <label v-if="!a.omitir" class="campo"><span>Monto para {{ nombrePeriodo(periodo) }}</span>
      <input v-model.number="a.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="acciones">
      <button v-if="existe" type="button" class="btn peligro" @click="quitar">Volver al monto de siempre</button>
      <span class="espacio"></span>
      <button type="button" class="btn" @click="$emit('listo')">Cancelar</button>
      <button type="submit" class="btn primario">Guardar</button>
    </div>
  </form>`,
  setup(props, { emit }) {
    const id = `${props.partidaId}:${props.periodo}`;
    const partida = computed(() => buscar('partidas', props.partidaId));
    const actual = buscar('ajustesPartida', id);
    const existe = !!actual && !actual.borrado;
    const montoNormal = computed(() => {
      const p = partida.value;
      if (!p) return 0;
      const partes = partesDelMes(p, props.periodo);
      const principal = partes.find((x) => x.parte === (p.tipo === 'anual' ? (partes.length > 1 ? 'pagar' : 'apartar') : null));
      return (principal?.base || 0) / 100;
    });
    const a = reactive({ omitir: existe ? !!actual.omitir : false, monto: existe && hayValor(actual.monto) ? actual.monto : montoNormal.value });
    const error = ref('');
    function enviar() {
      error.value = '';
      if (!a.omitir && !(Number(a.monto) >= 0 && hayValor(a.monto))) return (error.value = 'Escribe el monto de este mes.');
      guardar('ajustesPartida', {
        ...(actual || {}), id, partidaId: props.partidaId, periodo: props.periodo, omitir: !!a.omitir,
        monto: a.omitir ? null : redondear(Number(a.monto)), borrado: false,
      });
      aviso(a.omitir ? `${partida.value?.nombre} no se paga en ${nombrePeriodo(props.periodo)}.` : 'Monto de este mes guardado.', 'ok');
      emit('listo');
    }
    function quitar() {
      borrar('ajustesPartida', id);
      aviso('La partida vuelve a su monto de siempre este mes.', 'info');
      emit('listo');
    }
    return { a, partida, existe, montoNormal, error, enviar, quitar, fmt, nombrePeriodo };
  },
};
