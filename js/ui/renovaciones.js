// Renovaciones: lo que vence y hay que renovar a tiempo. El seguro del carro, la licencia,
// el pasaporte, la revisión del extintor, la garantía del refrigerador.
// No es una suscripción: si se olvida no aparece un cargo, aparece un problema.
import {
  store, fmt, fmtMoneda, guardar, aviso, indice, abrirModal, personas, cuentas, categoriasPorGrupo, filtro, personaFiltro,
  nombrePersona, nombreCuenta, nombreCategoria, buscar,
} from '../store.js';
import { estadoRenovaciones, renovada, costoAnual, AVISO_POR_DEFECTO } from '../core/renovaciones.js';
import { REPETICIONES, MONEDAS } from '../core/modelo.js';
import { fechaCorta, hoy as hoyDe, redondear } from '../core/util.js';
import { copia, PIE, usarFormulario, opcionesCategoria } from './formulario-base.js';
import { nuevoMovimiento } from './formularios.js';
import { Icono } from './componentes.js';

const { reactive, computed } = Vue;

const CLASES = { vencida: 'mal', avisa: 'aviso', lejos: '' };

export const RenovacionForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Qué se renueva</span>
      <input v-model="x.nombre" maxlength="60" required placeholder="Seguro del carro, licencia, pasaporte…"></label>

    <div class="fila-campos">
      <label class="campo"><span>Vence el</span><input v-model="x.vence" type="date" required></label>
      <label class="campo"><span>Avisar con</span>
        <span class="con-sufijo"><input v-model.number="x.avisarDias" type="number" inputmode="numeric" min="1" max="365"><span>días</span></span></label>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>Se repite</span>
        <select v-model="x.repetir"><option v-for="(n, k) in repeticiones" :key="k" :value="k">{{ n }}</option></select></label>
      <label v-if="x.repetir === 'meses'" class="campo"><span>Cada cuántos meses</span>
        <input v-model.number="x.cadaMeses" type="number" inputmode="numeric" min="1" max="120"></label>
    </div>
    <p v-if="x.repetir === 'meses'" class="nota chica">{{ textoRepeticion }}</p>

    <div class="fila-campos">
      <label class="campo"><span>Cuánto cuesta (opcional)</span><input v-model.number="x.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Moneda</span>
        <select v-model="x.moneda"><option v-for="(n, k) in monedas" :key="k" :value="k">{{ n }}</option></select></label>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>Categoría</span><select v-model="x.categoriaId">${opcionesCategoria('porGrupo')}</select></label>
      <label class="campo"><span>De quién es</span>
        <select v-model="x.responsableId"><option :value="null">Hogar</option><option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <label class="campo"><span>Se paga con (opcional)</span>
      <select v-model="x.cuentaId"><option :value="null">Sin definir</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>

    <label class="casilla"><input v-model="x.activo" type="checkbox"> Activa</label>
    <label class="campo"><span>Nota</span><input v-model.trim="x.nota" maxlength="140" placeholder="Número de póliza, dónde se hace…"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const x = reactive({
      nombre: '', vence: '', avisarDias: AVISO_POR_DEFECTO, repetir: 'meses', cadaMeses: 12, monto: null, moneda: 'L',
      categoriaId: null, responsableId: null, cuentaId: null, activo: true, nota: '', ...original,
    });
    const textoRepeticion = computed(() => {
      const n = Math.max(1, Math.round(Number(x.cadaMeses) || 12));
      if (n === 12) return 'Una vez al año. Al renovarla, la app mueve la fecha al año siguiente.';
      if (n === 1) return 'Cada mes. Si es un cobro automático, quizá quede mejor como suscripción.';
      return `Cada ${n} meses. Al renovarla, la app mueve la fecha ${n} meses adelante.`;
    });
    const f = usarFormulario('renovaciones', original, emit, { que: 'esta renovación' });
    function enviar() {
      f.error.value = '';
      const nombre = x.nombre.trim();
      if (!nombre) return (f.error.value = 'Ponle un nombre.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.vence || '')) return (f.error.value = 'Escribe cuándo vence.');
      if (x.monto !== null && x.monto !== '' && !(Number(x.monto) >= 0)) return (f.error.value = 'Revisa el monto.');
      f.terminar({
        ...x, nombre,
        avisarDias: Math.min(365, Math.max(1, Math.round(Number(x.avisarDias) || AVISO_POR_DEFECTO))),
        cadaMeses: x.repetir === 'meses' ? Math.min(120, Math.max(1, Math.round(Number(x.cadaMeses) || 12))) : null,
        monto: redondear(Number(x.monto) || 0),
        categoriaId: x.categoriaId || null, responsableId: x.responsableId || null, cuentaId: x.cuentaId || null,
      });
    }
    return {
      x, textoRepeticion, enviar, repeticiones: REPETICIONES, monedas: MONEDAS,
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), porGrupo: computed(() => categoriasPorGrupo('gasto')), ...f,
    };
  },
};

export const editarRenovacion = (r = {}) => abrirModal(r.id ? 'Editar renovación' : 'Nueva renovación', RenovacionForm, { inicial: r });

// "Ya la renové": mueve la fecha a la próxima (o la apaga si no se repite).
export function marcarRenovada(id) {
  const r = buscar('renovaciones', id);
  if (!r) return aviso('Esa renovación ya no está.', 'info');
  const antes = { ...r };
  const despues = renovada(r, hoyDe());
  guardar('renovaciones', despues);
  const texto = despues.activo === false
    ? `${r.nombre}: no se repite, queda guardada como vencida.`
    : `${r.nombre}: la próxima es el ${fechaCorta(despues.vence)}.`;
  return aviso(texto, 'ok', 6000, { texto: 'Deshacer', fn: () => guardar('renovaciones', antes) });
}

// Registrar el gasto de renovar, con lo que ya se sabe de ella.
export function pagarRenovacion(r) {
  nuevoMovimiento({
    tipo: 'gasto', monto: r.monto || null, moneda: r.moneda, categoriaId: r.categoriaId || null,
    cuentaId: r.cuentaId || 'gastos', personaId: r.responsableId || store.yo, nota: r.nombre,
  });
}

export const VistaRenovaciones = {
  components: { Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Lo que vence</p>
      <p class="hero-num">{{ pendientes.length }}</p>
      <p class="hero-texto">{{ lista.length
        ? (pendientes.length ? (pendientes.length === 1 ? 'Una renovación pide atención.' : pendientes.length + ' renovaciones piden atención.') : 'Nada pendiente por ahora.') + (anual ? ' Al año cuestan ' + fmt(anual) + '.' : '')
        : 'El seguro del carro, la licencia, el pasaporte, la garantía del refri. No son suscripciones: nadie las cobra solas, y si se olvidan el problema no es un cargo.' }}</p>
    </div>

    <article v-for="r in lista" :key="r.id" class="tarjeta" :class="{ tenue: !r.activa }">
      <div class="tarjeta-cab pegada">
        <h2>{{ r.nombre }}</h2>
        <span v-if="r.responsableId" class="chip">{{ nombrePersona(r.responsableId) }}</span>
        <span class="chip" :class="clases[r.estado]">{{ etiqueta(r) }}</span>
      </div>
      <p class="nota" style="margin-top: 8px">{{ detalle(r) }}</p>
      <p v-if="r.renovacion.nota" class="nota chica">{{ r.renovacion.nota }}</p>
      <div class="botones">
        <button v-if="r.estado !== 'lejos' && r.activa" type="button" class="btn primario" @click="marcarRenovada(r.id)">Ya la renové</button>
        <button v-if="r.monto && r.activa" type="button" class="btn" @click="pagarRenovacion(r)">Registrar el pago</button>
        <button type="button" class="btn" @click="editarRenovacion(r.renovacion)">Editar</button>
      </div>
    </article>

    <p v-if="!lista.length && personaFiltro()" class="vacio">{{ nombrePersona(personaFiltro()) }} no tiene renovaciones a su nombre. Las del hogar se ven en "Todo el hogar".</p>
    <button type="button" class="btn-punteado" @click="editarRenovacion({ responsableId: personaFiltro() })">+ Nueva renovación</button>
    <p class="nota chica">Cada una avisa con los días que le pongas, y al marcarla renovada la app mueve la fecha a la próxima. Lo que cuestan al año cuenta solo las que se repiten.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const lista = computed(() => estadoRenovaciones(ix.value, { hoy: store.hoy, filtro: filtro(), incluirInactivas: true }));
    const pendientes = computed(() => lista.value.filter((r) => r.activa && r.estado !== 'lejos'));
    const anual = computed(() => costoAnual(ix.value, { hoy: store.hoy, filtro: filtro() }));

    const etiqueta = (r) => (!r.activa ? 'Guardada' : r.estado === 'vencida' ? 'Venció' : r.estado === 'avisa' ? 'Pronto' : 'Al día');
    function detalle(r) {
      const cuanto = r.monto ? ` · ${fmtMoneda(r.monto, r.moneda)}` : '';
      const repite = r.repite ? ` · se repite cada ${r.cadaMeses === 12 ? 'año' : r.cadaMeses + ' meses'}` : ' · no se repite';
      const donde = r.cuentaId ? ` · se paga con ${nombreCuenta(r.cuentaId)}` : '';
      const cuando = r.estado === 'vencida'
        ? `Venció el ${fechaCorta(r.vence)}, hace ${-r.dias} ${-r.dias === 1 ? 'día' : 'días'}`
        : `Vence el ${fechaCorta(r.vence)}, en ${r.dias} ${r.dias === 1 ? 'día' : 'días'}`;
      return `${cuando}${cuanto}${repite}${donde}.`;
    }
    return {
      lista, pendientes, anual, etiqueta, detalle, clases: CLASES,
      editarRenovacion, marcarRenovada, pagarRenovacion, fmt, fmtMoneda, nombrePersona, nombreCategoria, personaFiltro,
    };
  },
};
