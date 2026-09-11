import {
  store, guardar, borrar, aviso, abrirModal, personas, cuentas, categorias, vivos, buscar, nombreCuenta, fmt,
} from '../store.js';
import { TIPOS_MOVIMIENTO, CLASES, TIPOS_CUENTA } from '../core/modelo.js';
import { saldosCuentas, seguroEstimado, cuotasRestantes, movimientoParaCompromiso } from '../core/finanzas.js';
import { hoy, periodoDe, periodoActual, nombrePeriodo, nombreMes, redondear } from '../core/util.js';

const { reactive, ref, computed } = Vue;

const copia = (x) => JSON.parse(JSON.stringify(x ?? {}));
const TIPOS_CORTOS = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferir', abono: 'Abono', ajuste: 'Ajuste' };
const quien = (id) => buscar('personas', id)?.nombre || 'alguien';
const fechaHora = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function textoAuditoria(r) {
  if (!r?.creado) return '';
  let t = `Registrado por ${quien(r.creadoPor)} el ${fechaHora.format(new Date(r.creado))}`;
  if (r.actualizado && r.actualizado !== r.creado) {
    t += ` · editado por ${quien(r.actualizadoPor)} el ${fechaHora.format(new Date(r.actualizado))}`;
  }
  return t;
}

const PIE = `
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="auditoria" class="meta">{{ auditoria }}</p>
  <div class="acciones">
    <button v-if="existe" type="button" class="btn peligro" @click="eliminar">Eliminar</button>
    <span class="espacio"></span>
    <button type="button" class="btn" @click="$emit('listo')">Cancelar</button>
    <button type="submit" class="btn primario">Guardar</button>
  </div>`;

// Helpers comunes a todos los formularios de edición. `que`: "este movimiento", "esta cuenta"…
function usarFormulario(coleccion, original, emit, { que, alBorrar } = {}) {
  const error = ref('');
  const existe = !!original.id;
  const auditoria = textoAuditoria(original);
  function terminar(r) {
    guardar(coleccion, r);
    aviso(existe ? 'Cambios guardados.' : 'Guardado.', 'ok', 2500);
    emit('listo');
  }
  function eliminar() {
    if (!confirm(`¿Eliminar ${que}?`)) return;
    if (alBorrar && alBorrar() === false) return;
    borrar(coleccion, original.id);
    aviso('Eliminado.', 'info', 6000, {
      texto: 'Deshacer',
      fn: () => guardar(coleccion, { ...buscar(coleccion, original.id), borrado: false }),
    });
    emit('listo');
  }
  return { error, existe, auditoria, terminar, eliminar };
}

// ---------------------------------------------------------------- Movimiento

export const MovimientoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div v-if="!vinculado" class="segmentos" role="group" aria-label="Tipo de movimiento">
      <button v-for="(n, k) in tipos" :key="k" type="button" :class="{ activo: m.tipo === k }" :aria-pressed="m.tipo === k" :title="nombresTipo[k]" @click="m.tipo = k">{{ n }}</button>
    </div>
    <p v-else class="nota">Corresponde a <strong>{{ nombreVinculo }}</strong> de {{ nombrePeriodo(m.periodo) }}.</p>

    <label v-if="m.tipo !== 'ajuste'" class="campo"><span>Monto</span>
      <input v-model.number="m.monto" type="number" inputmode="decimal" step="0.01" min="0" required></label>
    <template v-else>
      <label class="campo"><span>Saldo real hoy</span>
        <input v-model.number="saldoReal" type="number" inputmode="decimal" step="0.01"></label>
      <p class="nota">En la app: {{ fmt(saldoSinEste) }} → ajuste de {{ fmt(diferencia) }}</p>
    </template>

    <div class="fila-campos">
      <label class="campo"><span>Fecha</span><input v-model="m.fecha" type="date" required></label>
      <label class="campo"><span>{{ etiquetaCuenta }}</span>
        <select v-model="m.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
      <label v-if="m.tipo === 'transferencia'" class="campo"><span>Hacia</span>
        <select v-model="m.cuentaDestinoId">
          <option :value="null" disabled>Elige…</option>
          <option v-for="c in listaCuentas" :key="c.id" :value="c.id" :disabled="c.id === m.cuentaId">{{ c.nombre }}</option>
        </select></label>
    </div>

    <label v-if="m.tipo === 'abono'" class="campo"><span>Préstamo</span>
      <select v-model="m.prestamoId"><option :value="null" disabled>Elige…</option>
        <option v-for="p in listaPrestamos" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>

    <div class="fila-campos">
      <label v-if="m.tipo === 'gasto' || m.tipo === 'ingreso'" class="campo"><span>Categoría</span>
        <select v-model="m.categoriaId"><option :value="null">Sin categoría</option>
          <option v-for="c in listaCategorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
      <label v-if="m.tipo !== 'ajuste'" class="campo"><span>{{ m.tipo === 'ingreso' ? 'Quién lo recibió' : 'Quién pagó' }}</span>
        <select v-model="m.personaId"><option :value="null">Hogar</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>

    <label class="campo"><span>Nota</span><input v-model.trim="m.nota" type="text" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const m = reactive({
      tipo: 'gasto', fecha: hoy(), monto: null, cuentaId: cuentas()[0]?.id || 'gastos', cuentaDestinoId: null,
      categoriaId: null, personaId: store.yo, nota: '', prestamoId: null, plantillaId: null, parte: null, periodo: null,
      ...original,
    });
    const vinculado = !!(m.plantillaId || (m.prestamoId && m.tipo === 'gasto'));
    const nombreVinculo = computed(() => buscar('plantillas', m.plantillaId)?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '');
    const saldos = computed(() => saldosCuentas(store.doc));
    const saldoSinEste = computed(() => {
      const propio = original.tipo === 'ajuste' && original.cuentaId === m.cuentaId && original.creado ? Number(original.monto) : 0;
      return redondear((saldos.value[m.cuentaId] || 0) - propio);
    });
    const saldoReal = ref(original.tipo === 'ajuste' && original.creado ? redondear(saldos.value[original.cuentaId] || 0) : null);
    const diferencia = computed(() => redondear((Number(saldoReal.value) || 0) - saldoSinEste.value));
    const etiquetaCuenta = computed(() => ({ gasto: 'Pagado desde', ingreso: 'Entra a', transferencia: 'Desde', abono: 'Pagado desde', ajuste: 'Cuenta' })[m.tipo]);
    const f = usarFormulario('movimientos', original, emit, { que: 'este movimiento' });

    function enviar() {
      f.error.value = '';
      const r = { ...m };
      if (r.tipo === 'ajuste') {
        if (saldoReal.value === null || saldoReal.value === '' || Number.isNaN(Number(saldoReal.value))) return (f.error.value = 'Escribe el saldo real de la cuenta.');
        r.monto = diferencia.value;
        if (!r.monto) return (f.error.value = 'El saldo ya coincide; no hace falta ajustar.');
      } else if (!(Number(r.monto) > 0)) {
        return (f.error.value = 'Escribe un monto mayor que cero.');
      }
      if (!r.fecha) return (f.error.value = 'Elige la fecha.');
      if (r.tipo === 'transferencia' && (!r.cuentaDestinoId || r.cuentaDestinoId === r.cuentaId)) return (f.error.value = 'Elige una cuenta de destino distinta.');
      if (r.tipo === 'abono' && !r.prestamoId) return (f.error.value = 'Elige el préstamo.');
      r.monto = redondear(Number(r.monto));
      if (!vinculado) r.periodo = periodoDe(r.fecha);
      if (r.tipo !== 'transferencia') r.cuentaDestinoId = null;
      if (r.tipo !== 'gasto' && r.tipo !== 'ingreso') r.categoriaId = null;
      if (r.tipo !== 'abono' && !vinculado) r.prestamoId = null;
      if (r.tipo === 'ajuste') r.personaId = null;
      f.terminar(r);
    }

    return {
      m, vinculado, nombreVinculo, saldoSinEste, saldoReal, diferencia, etiquetaCuenta, enviar, fmt, nombrePeriodo,
      tipos: TIPOS_CORTOS, nombresTipo: TIPOS_MOVIMIENTO, listaCuentas: computed(cuentas), listaPersonas: computed(personas), listaCategorias: computed(categorias),
      listaPrestamos: computed(() => vivos('prestamos')), ...f,
    };
  },
};

// ---------------------------------------------------------------- Compromiso (plantilla)

const CLASES_PLANTILLA = Object.fromEntries(Object.entries(CLASES).filter(([k]) => k !== 'prestamo'));

export const PlantillaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="t.nombre" maxlength="60" required></label>
    <div class="fila-campos">
      <label class="campo"><span>Tipo</span>
        <select v-model="t.clase"><option v-for="(n, k) in clases" :key="k" :value="k">{{ n }}</option></select></label>
      <label class="campo"><span>{{ t.clase === 'ingreso' ? 'De quién' : 'Quién lo paga' }}</span>
        <select v-model="t.responsableId"><option :value="null">Hogar</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>

    <div v-if="t.clase === 'provision'" class="fila-campos">
      <label class="campo"><span>Monto del pago anual</span>
        <input v-model.number="t.montoAnual" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Mes en que se paga</span>
        <select v-model="t.mesPago"><option :value="null">Sin definir</option>
          <option v-for="n in 12" :key="n" :value="n">{{ nombreMes(n) }}</option></select></label>
    </div>
    <div v-else class="fila-campos">
      <label class="campo"><span>{{ etiquetaMonto }}</span>
        <input v-model.number="t.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Día de pago</span>
        <input v-model.number="t.dia" type="number" min="1" max="31" placeholder="Opcional"></label>
    </div>
    <p v-if="t.clase === 'provision'" class="nota">Cada mes se apartan {{ fmt((t.montoAnual || 0) / 12) }} en {{ nombreCuenta(t.cuentaDestinoId || 'reservas') }} y, cuando llega el cobro, se paga de ahí.</p>

    <div v-if="t.clase !== 'provision'" class="campo">
      <span>Meses en que aplica {{ todos ? '(todos)' : '(' + t.meses.length + ' de 12)' }}</span>
      <div class="meses">
        <button v-for="n in 12" :key="n" type="button" :class="{ activo: todos || t.meses.includes(n) }" :aria-pressed="todos || t.meses.includes(n)" @click="alternarMes(n)">{{ nombreMes(n).slice(0, 3) }}</button>
      </div>
    </div>
    <div v-if="t.clase === 'ingreso'" class="fila-campos">
      <label class="casilla"><input v-model="t.decimo14" type="checkbox"> Décimo cuarto mes (junio)</label>
      <label class="casilla"><input v-model="t.decimo13" type="checkbox"> Décimo tercer mes (diciembre)</label>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>{{ t.clase === 'ingreso' ? 'Entra a' : 'Sale de' }}</span>
        <select v-model="t.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
      <label v-if="t.clase === 'aporte' || t.clase === 'provision'" class="campo"><span>{{ t.clase === 'aporte' ? 'Va a' : 'Se aparta en' }}</span>
        <select v-model="t.cuentaDestinoId"><option :value="null" disabled>Elige…</option>
          <option v-for="c in listaCuentas" :key="c.id" :value="c.id" :disabled="c.id === t.cuentaId">{{ c.nombre }}</option></select></label>
      <label v-if="['fijo', 'fijo_variable', 'provision'].includes(t.clase)" class="campo"><span>Categoría</span>
        <select v-model="t.categoriaId"><option :value="null">Sin categoría</option>
          <option v-for="c in listaCategorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    </div>

    <label class="casilla"><input v-model="t.activo" type="checkbox"> Activo</label>
    <label class="campo"><span>Nota</span><input v-model.trim="t.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const t = reactive({
      nombre: '', clase: 'fijo', monto: null, montoAnual: null, mesPago: null, meses: [], decimo13: false, decimo14: false,
      responsableId: store.yo, cuentaId: 'gastos', cuentaDestinoId: null, categoriaId: null, dia: null, activo: true, nota: '',
      ...original,
    });
    if (!Array.isArray(t.meses)) t.meses = [];
    if (t.clase === 'provision' && !t.cuentaDestinoId) t.cuentaDestinoId = 'reservas';
    const todos = computed(() => !t.meses.length || t.meses.length === 12);
    function alternarMes(n) {
      let ms = todos.value ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [...t.meses];
      ms = ms.includes(n) ? ms.filter((x) => x !== n) : [...ms, n].sort((a, b) => a - b);
      if (ms.length) t.meses = ms.length === 12 ? [] : ms;
    }
    const etiquetaMonto = computed(() => ({
      ingreso: 'Monto mensual (neto)', fijo: 'Monto mensual', fijo_variable: 'Monto estimado al mes', aporte: 'Aporte mensual',
    })[t.clase]);
    const f = usarFormulario('plantillas', original, emit, { que: 'este compromiso' });

    function enviar() {
      f.error.value = '';
      const r = { ...t, nombre: t.nombre.trim() };
      if (!r.nombre) return (f.error.value = 'Ponle un nombre.');
      const monto = r.clase === 'provision' ? r.montoAnual : r.monto;
      if (monto === null || monto === '' || !(Number(monto) >= 0)) return (f.error.value = 'Escribe el monto (puede ser 0 si todavía no lo sabes).');
      if (r.clase === 'aporte' && !r.cuentaDestinoId) return (f.error.value = 'Elige a qué cuenta va el aporte.');
      if (r.clase === 'provision') {
        r.montoAnual = redondear(Number(r.montoAnual));
        r.monto = redondear(r.montoAnual / 12);
        r.meses = [];
        r.dia = null;
        r.cuentaDestinoId ||= 'reservas';
        r.mesPago = r.mesPago ? Number(r.mesPago) : null;
      } else {
        r.monto = redondear(Number(r.monto));
        r.montoAnual = null;
        r.mesPago = null;
        r.dia = r.dia ? Math.min(31, Math.max(1, Math.round(Number(r.dia)))) : null;
      }
      if (r.clase !== 'ingreso') r.decimo13 = r.decimo14 = false;
      if (r.clase !== 'aporte' && r.clase !== 'provision') r.cuentaDestinoId = null;
      if (!['fijo', 'fijo_variable', 'provision'].includes(r.clase)) r.categoriaId = r.clase === 'ingreso' ? 'salario' : null;
      f.terminar(r);
    }

    return {
      t, todos, alternarMes, etiquetaMonto, enviar, fmt, nombreMes, nombreCuenta, clases: CLASES_PLANTILLA,
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaCategorias: computed(categorias), ...f,
    };
  },
};

// ---------------------------------------------------------------- Préstamo

export const PrestamoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="p.nombre" maxlength="60" required></label>
      <label class="campo"><span>Quién lo paga</span>
        <select v-model="p.responsableId"><option :value="null">Hogar</option>
          <option v-for="x in listaPersonas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Tasa de interés anual (%)</span><input v-model.number="p.tasa" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Cuota mensual (con seguros)</span><input v-model.number="p.cuota" type="number" inputmode="decimal" step="0.01" min="0"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Saldo de capital</span><input v-model.number="p.saldo" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Después de pagar la cuota de</span><input v-model="p.saldoPeriodo" type="month"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Fecha de la última cuota</span><input v-model="p.ultimaCuota" type="date"></label>
      <label class="campo"><span>Se paga desde</span>
        <select v-model="p.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    </div>
    <label class="campo"><span>Seguros y cargos incluidos en la cuota</span>
      <input v-model="seguroTexto" type="number" inputmode="decimal" step="0.01" min="0" :placeholder="'Vacío = estimado: ' + fmt(estimado)"></label>
    <p class="nota">Si tu estado de cuenta muestra cuánto de la cuota es seguro, escríbelo. Si lo dejas vacío, se estima con la tasa, el saldo y el plazo.
      <template v-if="restantes !== null"> Faltan {{ restantes }} cuotas.</template></p>
    <label class="campo"><span>Nota</span><input v-model.trim="p.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const p = reactive({
      nombre: '', responsableId: store.yo, tasa: null, cuota: null, seguro: null, saldo: null, saldoPeriodo: periodoActual(),
      fechaSaldo: hoy(), ultimaCuota: '', dia: null, cuentaId: 'gastos', categoriaId: 'prestamos', nota: '', ...original,
    });
    const seguroTexto = ref(p.seguro === null || p.seguro === undefined ? '' : String(p.seguro));
    const listo = () => p.saldoPeriodo && p.ultimaCuota && Number(p.cuota) > 0;
    const estimado = computed(() => (listo() ? seguroEstimado({ ...p, tasa: Number(p.tasa) || 0, cuota: Number(p.cuota), saldo: Number(p.saldo) || 0 }) : 0));
    const restantes = computed(() => (listo() ? cuotasRestantes(p) : null));
    const f = usarFormulario('prestamos', original, emit, { que: 'este préstamo' });

    function enviar() {
      f.error.value = '';
      const r = { ...p, nombre: p.nombre.trim() };
      if (!r.nombre) return (f.error.value = 'Ponle un nombre.');
      if (!(Number(r.tasa) >= 0)) return (f.error.value = 'Escribe la tasa anual (por ejemplo 16.5).');
      if (!(Number(r.cuota) > 0)) return (f.error.value = 'Escribe la cuota mensual.');
      if (!(Number(r.saldo) >= 0)) return (f.error.value = 'Escribe el saldo de capital.');
      if (!r.saldoPeriodo || !r.ultimaCuota) return (f.error.value = 'Completa el mes del saldo y la fecha de la última cuota.');
      if (r.ultimaCuota.slice(0, 7) < r.saldoPeriodo) return (f.error.value = 'La última cuota no puede ser antes del mes del saldo.');
      r.tasa = Number(r.tasa);
      r.cuota = redondear(Number(r.cuota));
      r.saldo = redondear(Number(r.saldo));
      r.seguro = seguroTexto.value === '' ? null : redondear(Number(seguroTexto.value));
      r.dia = Number(r.ultimaCuota.slice(8, 10)) || null;
      if (r.saldo !== original.saldo || r.saldoPeriodo !== original.saldoPeriodo) {
        r.fechaSaldo = hoy();
        r.saldoRegistrado = new Date().toISOString();
      }
      f.terminar(r);
    }

    return { p, seguroTexto, estimado, restantes, enviar, fmt, listaPersonas: computed(personas), listaCuentas: computed(cuentas), ...f };
  },
};

// ---------------------------------------------------------------- Cuenta, persona y categoría

export const CuentaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required></label>
      <label class="campo"><span>Tipo</span><select v-model="c.tipo"><option v-for="(n, k) in tipos" :key="k" :value="k">{{ n }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Saldo inicial</span><input v-model.number="c.saldoInicial" type="number" inputmode="decimal" step="0.01"></label>
      <label class="campo"><span>Meta (opcional)</span><input v-model.number="c.meta" type="number" inputmode="decimal" step="100" min="0"></label>
    </div>
    <label class="campo"><span>Nota</span><input v-model.trim="c.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', tipo: 'banco', saldoInicial: 0, meta: null, nota: '', ...original });
    const f = usarFormulario('cuentas', original, emit, {
      que: 'esta cuenta',
      alBorrar: () => {
        const usos = vivos('movimientos').filter((m) => m.cuentaId === original.id || m.cuentaDestinoId === original.id).length;
        return !usos || confirm(`La cuenta tiene ${usos} movimientos que dejarán de sumar en su saldo. ¿Eliminarla igual?`);
      },
    });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Ponle un nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim(), saldoInicial: redondear(Number(c.saldoInicial) || 0), meta: Number(c.meta) > 0 ? redondear(Number(c.meta)) : null });
    }
    return { c, enviar, tipos: TIPOS_CUENTA, ...f };
  },
};

export const PersonaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="p.nombre" maxlength="40" required></label>
    <label class="campo"><span>Correo de su cuenta Microsoft (opcional)</span><input v-model.trim="p.email" type="email" autocomplete="off"></label>
    <p class="nota">Con el correo, la app reconoce a esta persona cuando conecta OneDrive y firma sus registros con su nombre.</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const p = reactive({ nombre: '', email: '', ...original });
    const f = usarFormulario('personas', original, emit, { que: 'esta persona' });
    function enviar() {
      f.error.value = '';
      if (!p.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...p, nombre: p.nombre.trim() });
    }
    return { p, enviar, ...f };
  },
};

export const CategoriaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', ...original });
    const f = usarFormulario('categorias', original, emit, { que: 'esta categoría' });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim() });
    }
    return { c, enviar, ...f };
  },
};

// ---------------------------------------------------------------- Atajos para abrirlos

export const nuevoMovimiento = (base = {}) =>
  abrirModal(base.tipo === 'ajuste' ? 'Ajustar saldo' : base.tipo === 'abono' ? 'Abono a capital' : 'Nuevo movimiento', MovimientoForm, { inicial: base });
export const editarMovimiento = (m) => abrirModal('Editar movimiento', MovimientoForm, { inicial: m });
export const registrarCompromiso = (item, periodo) =>
  abrirModal(`Registrar: ${item.nombre}`, MovimientoForm, { inicial: movimientoParaCompromiso(item, periodo) });

// Abre el pago ya registrado para editarlo, o el formulario para registrarlo.
export const abrirCompromiso = (item, periodo) =>
  (item.hecho ? editarMovimiento(item.movimientos[0]) : registrarCompromiso(item, periodo));

// Toque en el círculo de un compromiso: lo fijo se registra al instante con el monto de
// siempre (con opción de deshacer); lo variable abre el formulario para escribir el monto real.
export function marcarCompromiso(item, periodo) {
  if (item.hecho) return editarMovimiento(item.movimientos[0]);
  if (item.clase === 'fijo_variable' || (item.clase === 'provision' && item.parte === 'pagar')) {
    return registrarCompromiso(item, periodo);
  }
  const m = guardar('movimientos', movimientoParaCompromiso(item, periodo));
  aviso(`Registrado: ${item.nombre}, ${fmt(item.esperado)}`, 'ok', 6000, { texto: 'Deshacer', fn: () => borrar('movimientos', m.id) });
}
export const editarPlantilla = (t = {}) => abrirModal(t.id ? 'Editar compromiso' : 'Nuevo compromiso', PlantillaForm, { inicial: t });
export const editarPrestamo = (p = {}) => abrirModal(p.id ? 'Editar préstamo' : 'Nuevo préstamo', PrestamoForm, { inicial: p });
export const editarCuenta = (c = {}) => abrirModal(c.id ? 'Editar cuenta' : 'Nueva cuenta', CuentaForm, { inicial: c });
export const editarPersona = (p = {}) => abrirModal(p.id ? 'Editar persona' : 'Nueva persona', PersonaForm, { inicial: p });
export const editarCategoria = (c = {}) => abrirModal(c.id ? 'Editar categoría' : 'Nueva categoría', CategoriaForm, { inicial: c });
