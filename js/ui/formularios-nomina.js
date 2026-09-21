// Formularios de la nómina: un ingreso con sus deducciones, un pago recibido (recibo) y cada
// deducción por separado.
import {
  store, guardar, aviso, confirmar, abrirModal, cerrarModal, indice, personas, cuentasDinero, categoriasPorGrupo, vivos, buscar, nombreCuenta, fmt,
} from '../store.js';
import { FRECUENCIAS, TIPOS_RECIBO } from '../core/modelo.js';
import {
  DEDUCCIONES_SUGERIDAS, NATURALEZAS, APLICA_EN, quincenaDe, reciboSugerido, valoresAnteriores, estadoRecibo, pagosParaRegistrar, montoEsperado,
} from '../core/nomina.js';
import { periodoDe, fechaCorta, redondear } from '../core/util.js';
import { copia, hayValor, PIE, opcionesCategoria, usarFormulario } from './formulario-base.js';

const { reactive, ref, computed } = Vue;

// ---------------------------------------------------------------- Ingresos

export const IngresoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="i.nombre" maxlength="60" required placeholder="Salario de…"></label>
      <label class="campo"><span>De quién</span>
        <select v-model="i.personaId"><option :value="null">Hogar</option>
          <option v-for="x in listaPersonas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
    </div>
    <div class="segmentos" role="group" aria-label="Frecuencia">
      <button v-for="(n, k) in frecuencias" :key="k" type="button" :class="{ activo: i.frecuencia === k }" :aria-pressed="i.frecuencia === k" @click="cambiarFrecuencia(k)">{{ n }}</button>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>{{ i.frecuencia === 'quincenal' ? 'Neto de cada quincena' : 'Neto al mes' }}</span>
        <input v-model.number="i.netoEsperado" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>{{ i.frecuencia === 'quincenal' ? 'Primer día de pago' : 'Día de pago' }}</span>
        <input v-model.number="i.diasPago[0]" type="number" min="1" max="31"></label>
      <label v-if="i.frecuencia === 'quincenal'" class="campo"><span>Segundo día (31 = último)</span>
        <input v-model.number="i.diasPago[1]" type="number" min="1" max="31"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Si cae en fin de semana</span>
        <select v-model="i.finDeSemana"><option value="anterior">Se paga el viernes antes</option><option value="igual">Se registra ese día</option></select></label>
      <label class="campo"><span>Entra a</span>
        <select v-model="i.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="casilla"><input v-model="i.decimo14" type="checkbox"> Décimo cuarto mes (junio)</label>
      <label class="casilla"><input v-model="i.decimo13" type="checkbox"> Décimo tercer mes (diciembre)</label>
    </div>
    <p class="nota chica">Las deducciones (IHSS, ISR, préstamos por planilla) se configuran en <a href="#/salarios" @click="$emit('listo')">Salarios y deducciones</a>.</p>
    <label class="casilla"><input v-model="i.activo" type="checkbox"> Activo</label>
    <label class="campo"><span>Nota</span><input v-model.trim="i.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const i = reactive({
      nombre: '', personaId: store.yo, frecuencia: 'quincenal', diasPago: [15, 31], finDeSemana: 'anterior', cuentaId: 'gastos', categoriaId: 'salario',
      netoEsperado: null, meses: [], decimo13: true, decimo14: true, vigenteDesde: null, activo: true, deducciones: [], nota: '', ...original,
    });
    if (!Array.isArray(i.diasPago) || !i.diasPago.length) i.diasPago = [31];
    function cambiarFrecuencia(k) {
      i.frecuencia = k;
      i.diasPago = k === 'quincenal' ? [i.diasPago[0] && i.diasPago[0] < 28 ? i.diasPago[0] : 15, 31] : [i.diasPago[1] || i.diasPago[0] || 31];
    }
    const f = usarFormulario('ingresos', original, emit, { que: 'este ingreso' });
    function enviar() {
      f.error.value = '';
      const r = { ...i, nombre: i.nombre.trim() };
      if (!r.nombre) return (f.error.value = 'Ponle un nombre.');
      if (!hayValor(r.netoEsperado) || !(Number(r.netoEsperado) >= 0)) return (f.error.value = 'Escribe el neto (puede ser 0 si todavía no lo sabes).');
      const dias = r.diasPago.slice(0, r.frecuencia === 'quincenal' ? 2 : 1).map((d) => Math.min(31, Math.max(1, Math.round(Number(d)) || 0)));
      if (dias.some((d) => !d)) return (f.error.value = 'Escribe los días de pago.');
      r.diasPago = [...new Set(dias)].sort((a, b) => a - b);
      if (r.frecuencia === 'quincenal' && r.diasPago.length < 2) return (f.error.value = 'Los dos días de pago tienen que ser distintos.');
      r.netoEsperado = redondear(Number(r.netoEsperado));
      f.terminar(r);
    }
    return { i, cambiarFrecuencia, enviar, frecuencias: FRECUENCIAS, listaPersonas: computed(personas), listaCuentas: computed(cuentasDinero), ...f };
  },
};

// Pago de un salario: neto que llegó y deducciones de la colilla. Una deducción vacía queda
// pendiente (no impide guardar). `elegirPago`: permite cambiar de pago; `soloPendientes`:
// muestra solo las deducciones que faltaban, para completarlas.
export const ReciboForm = {
  props: { inicial: Object, elegirPago: Boolean, soloPendientes: Boolean },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label v-if="elegirPago && opciones.length > 1" class="campo"><span>Pago</span>
      <select :value="claveActual" @change="elegir($event.target.value)">
        <option v-for="o in opciones" :key="o.clave" :value="o.clave">{{ o.texto }}</option>
      </select></label>
    <p v-else class="nota">{{ descripcion }}</p>

    <template v-if="!soloPendientes">
      <div class="fila-campos">
        <label class="campo"><span>Neto que llegó a la cuenta</span><input v-model.number="r.neto" type="number" inputmode="decimal" step="0.01" min="0" required></label>
        <label class="campo"><span>Fecha</span><input v-model="r.fecha" type="date" required></label>
      </div>
      <label class="campo"><span>Entra a</span>
        <select v-model="r.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    </template>

    <div v-if="filas.length" class="deducciones">
      <div class="deducciones-cab">
        <h3 class="titulo-grupo">Deducciones</h3>
        <span class="espacio"></span>
        <button v-if="anteriores.ultimo && !soloPendientes" type="button" class="btn-link" @click="copiarAnterior">Igual que la quincena anterior</button>
        <button v-if="soloPendientes && hayGuia" type="button" class="btn-link" @click="usarAnteriores">Usar valores anteriores</button>
      </div>
      <div v-for="d in filas" :key="d.deduccionId" class="deduccion" :class="{ 'no-aplica': d.noAplica }">
        <div class="deduccion-nombre">
          <span>{{ d.nombre }}</span>
          <span v-if="ayuda(d)" class="fila-sub">{{ ayuda(d) }}</span>
        </div>
        <input v-model.number="d.monto" type="number" inputmode="decimal" step="0.01" min="0" :disabled="d.noAplica" :placeholder="guia(d)" :aria-label="'Monto de ' + d.nombre">
        <label class="casilla chica"><input v-model="d.noAplica" type="checkbox"> No aplicó</label>
      </div>
    </div>
    <p v-else-if="!soloPendientes" class="nota chica">Este salario no tiene deducciones configuradas. <a href="#/salarios" @click="$emit('listo')">Agregarlas</a></p>

    <p class="nota" :class="{ 'texto-aviso': estado.pendientes }">{{ textoPie }}</p>
    <label v-if="!soloPendientes" class="campo"><span>Nota</span><input v-model.trim="r.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const r = reactive({ neto: null, fecha: store.hoy, cuentaId: 'gastos', nota: '', extras: [], deducciones: [], tipo: 'ordinario', ...original });
    const ingreso = computed(() => buscar('ingresos', r.ingresoId));
    const pago = computed(() => ({
      tipo: r.tipo || 'ordinario', ocurrencia: r.ocurrencia, fecha: r.fecha,
      quincena: ingreso.value && (r.tipo || 'ordinario') === 'ordinario' ? quincenaDe(ingreso.value, r.ocurrencia) : null,
    }));
    const anteriores = computed(() => (ingreso.value ? valoresAnteriores(indice(), ingreso.value, pago.value) : { guia: {}, ultimo: null }));
    const hayGuia = computed(() => filas.value.some((d) => d.deduccionId in anteriores.value.guia));
    // Al completar, se muestran las que faltaban al abrir (aunque ya se hayan llenado).
    const faltabanAlAbrir = new Set((original.deducciones || []).filter((d) => !d.noAplica && !hayValor(d.monto)).map((d) => d.deduccionId));
    const filas = computed(() => (props.soloPendientes ? r.deducciones.filter((d) => faltabanAlAbrir.has(d.deduccionId)) : r.deducciones));

    const textoPago = (i, p) => (p.tipo === 'ordinario' ? `${i.nombre} · pago del ${fechaCorta(p.ocurrencia)}` : `${i.nombre} · ${TIPOS_RECIBO[p.tipo].toLowerCase()}`);
    const opciones = computed(() => (props.elegirPago
      ? pagosParaRegistrar(indice(), { hoy: store.hoy, desde: store.doc.config.inicio }).map((x) => ({ clave: `${x.ingreso.id}|${x.pago.tipo}|${x.pago.ocurrencia}`, texto: textoPago(x.ingreso, x.pago), ...x }))
      : []));
    const claveActual = computed(() => `${r.ingresoId}|${r.tipo}|${r.ocurrencia}`);
    function elegir(clave) {
      const o = opciones.value.find((x) => x.clave === clave);
      if (o) Object.assign(r, reciboSugerido(indice(), o.ingreso, o.pago, { hoy: store.hoy }));
    }

    const descripcion = computed(() => {
      const i = ingreso.value;
      const texto = textoPago(i || { nombre: 'Ingreso' }, pago.value);
      if (props.soloPendientes) return `${texto}: neto de ${fmt(r.neto || 0)}.`;
      const esperado = i?.netoEsperado ? i.netoEsperado * (pago.value.tipo === 'ordinario' ? 1 : i.frecuencia === 'quincenal' ? 2 : 1) : 0;
      return esperado ? `${texto} (se esperaban ${fmt(esperado)}).` : `${texto}.`;
    });
    const estado = computed(() => estadoRecibo(r));
    const textoPie = computed(() => {
      const e = estado.value;
      if (!r.deducciones.length) return '';
      if (e.pendientes) return `${e.pendientes === 1 ? 'Falta 1 deducción' : `Faltan ${e.pendientes} deducciones`}: puedes guardar y completarla${e.pendientes === 1 ? '' : 's'} después.`;
      return `Bruto ${fmt(e.bruto)} · descontado ${fmt(e.descontado)}.`;
    });
    const guia = (d) => (d.deduccionId in anteriores.value.guia ? `anterior ${fmt(anteriores.value.guia[d.deduccionId])}` : 'Monto');
    const ayuda = (d) => {
      if (d.naturaleza === 'prestamo') return `pago de ${buscar('prestamos', d.prestamoId)?.nombre || 'un préstamo'}`;
      if (d.naturaleza === 'ahorro') return d.cuentaDestinoId ? `se suma a ${nombreCuenta(d.cuentaDestinoId)}` : 'ahorro';
      return '';
    };
    function copiarAnterior() {
      const ultimo = anteriores.value.ultimo;
      for (const d of r.deducciones) {
        const previo = ultimo?.deducciones?.find((x) => x.deduccionId === d.deduccionId);
        if (previo) Object.assign(d, { monto: previo.monto, noAplica: !!previo.noAplica });
      }
    }
    function usarAnteriores() {
      for (const d of filas.value) if (!hayValor(d.monto) && !d.noAplica && d.deduccionId in anteriores.value.guia) d.monto = anteriores.value.guia[d.deduccionId];
    }

    const f = usarFormulario('recibos', original, emit, { que: 'este pago recibido' });
    function enviar() {
      f.error.value = '';
      if (!(Number(r.neto) >= 0) || !hayValor(r.neto)) return (f.error.value = 'Escribe el neto que llegó a la cuenta.');
      if (!r.fecha) return (f.error.value = 'Elige la fecha.');
      const deducciones = r.deducciones.map((d) => ({ ...d, noAplica: !!d.noAplica, monto: d.noAplica || !hayValor(d.monto) ? null : redondear(Number(d.monto)) }));
      const faltan = estadoRecibo({ neto: r.neto, deducciones }).pendientes;
      const mensaje = faltan ? `Guardado. ${faltan === 1 ? 'Falta 1 deducción' : `Faltan ${faltan} deducciones`}.` : `Guardado: ${fmt(r.neto)}.`;
      f.terminar({ ...r, neto: redondear(Number(r.neto)), deducciones, periodo: periodoDe(r.ocurrencia || r.fecha) }, { deshacer: true, mensaje });
    }
    return {
      r, ingreso, anteriores, hayGuia, filas, opciones, claveActual, elegir, descripcion, estado, textoPie, guia, ayuda, copiarAnterior, usarAnteriores, enviar,
      listaCuentas: computed(cuentasDinero), ...f,
    };
  },
};

// Deducción de un salario (se guarda dentro del ingreso).
export const DeduccionForm = {
  props: { ingresoId: String, deduccionId: String },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label v-if="!existe" class="campo"><span>Qué deducción</span>
      <select v-model="d.codigo" @change="aplicarSugerencia"><option v-for="s in sugerencias" :key="s.codigo" :value="s.codigo">{{ s.nombre }}</option></select></label>
    <label class="campo"><span>Nombre, como sale en la colilla</span><input v-model="d.nombre" maxlength="40" required></label>
    <div class="campo">
      <span>Qué es</span>
      <div class="segmentos envuelve" role="group" aria-label="Qué es">
        <button v-for="(n, k) in naturalezas" :key="k" type="button" :class="{ activo: d.naturaleza === k }" :aria-pressed="d.naturaleza === k" @click="d.naturaleza = k">{{ n }}</button>
      </div>
    </div>
    <label v-if="d.naturaleza === 'prestamo'" class="campo"><span>Préstamo que paga</span>
      <select v-model="d.prestamoId"><option :value="null" disabled>Elige…</option><option v-for="p in listaPrestamos" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    <label v-else-if="d.naturaleza === 'ahorro'" class="campo"><span>Se acumula en (opcional)</span>
      <select v-model="d.cuentaDestinoId"><option :value="null">Ninguna cuenta de la app</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    <label v-else class="campo"><span>Categoría</span><select v-model="d.categoriaId">${opcionesCategoria('lista')}</select></label>

    <label v-if="d.naturaleza !== 'prestamo'" class="casilla"><input v-model="d.fija" type="checkbox"> Es siempre el mismo monto (queda lleno en cada pago)</label>
    <label class="campo"><span>{{ d.naturaleza === 'prestamo' ? 'Monto en cada pago (opcional)' : d.fija ? 'Monto' : 'Monto aproximado (opcional)' }}</span>
      <input v-model.number="d.montoEsperado" type="number" inputmode="decimal" step="0.01" min="0"></label>
    <p v-if="d.naturaleza === 'prestamo'" class="nota chica">{{ textoCuota }}</p>

    <label v-if="quincenal" class="campo"><span>Se descuenta</span>
      <select v-model="d.aplicaEn"><option v-for="(n, k) in aplicaEn" :key="k" :value="k">{{ n }}</option></select></label>
    <label class="casilla"><input v-model="d.enDecimos" type="checkbox"> También en los décimos</label>
    <label class="casilla"><input v-model="d.activo" type="checkbox"> Activa</label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="acciones">
      <button v-if="existe" type="button" class="btn peligro" @click="eliminar">Eliminar</button>
      <span class="espacio"></span>
      <button type="button" class="btn" @click="$emit('listo')">Cancelar</button>
      <button type="submit" class="btn primario">Guardar</button>
    </div>
  </form>`,
  setup(props, { emit }) {
    const ingreso = computed(() => buscar('ingresos', props.ingresoId));
    const actual = ingreso.value?.deducciones?.find((x) => x.id === props.deduccionId);
    const existe = !!actual;
    const d = reactive({
      id: null, codigo: 'ihss', nombre: '', naturaleza: 'gasto', categoriaId: null, prestamoId: null, cuentaDestinoId: null, fija: false,
      montoEsperado: null, aplicaEn: 'ambas', enDecimos: false, activo: true, ...copia(actual),
    });
    const error = ref('');
    function aplicarSugerencia() {
      const s = DEDUCCIONES_SUGERIDAS.find((x) => x.codigo === d.codigo) || DEDUCCIONES_SUGERIDAS[0];
      Object.assign(d, { nombre: s.codigo === 'otra' ? '' : s.nombre, naturaleza: s.naturaleza, categoriaId: s.categoriaId, aplicaEn: s.codigo === 'vecinal' ? 'q1' : 'ambas' });
    }
    if (!existe) aplicarSugerencia();
    const quincenal = computed(() => ingreso.value?.frecuencia === 'quincenal');
    const textoCuota = computed(() => {
      const p = buscar('prestamos', d.prestamoId);
      if (!p) return 'Vacío: se descuenta la cuota del préstamo.';
      const reparte = quincenal.value && d.aplicaEn === 'ambas';
      const monto = montoEsperado(indice(), ingreso.value, { ...d, montoEsperado: null }, { tipo: 'ordinario', ocurrencia: '2000-01-01', quincena: 'q1' });
      return reparte ? `Vacío: la mitad de la cuota en cada quincena (${fmt(monto)} y el resto de ${fmt(p.cuota)}). La cuota ya no aparece como pago aparte.`
        : `Vacío: la cuota completa (${fmt(p.cuota)}). La cuota ya no aparece como pago aparte.`;
    });
    function guardarLista(lista) {
      guardar('ingresos', { ...buscar('ingresos', props.ingresoId), deducciones: lista });
    }
    function enviar() {
      error.value = '';
      const nombre = d.nombre.trim();
      if (!nombre) return (error.value = 'Escribe el nombre.');
      if (d.naturaleza === 'prestamo' && !d.prestamoId) return (error.value = 'Elige el préstamo.');
      if (d.naturaleza !== 'prestamo' && d.fija && !(Number(d.montoEsperado) > 0)) return (error.value = 'Escribe el monto fijo.');
      const lista = [...(ingreso.value?.deducciones || [])].map((x) => copia(x));
      let id = d.id;
      if (!id) {
        id = d.codigo;
        for (let n = 2; lista.some((x) => x.id === id); n++) id = `${d.codigo}-${n}`;
      }
      const limpio = {
        ...d, id, nombre, montoEsperado: hayValor(d.montoEsperado) ? redondear(Number(d.montoEsperado)) : null,
        prestamoId: d.naturaleza === 'prestamo' ? d.prestamoId : null, cuentaDestinoId: d.naturaleza === 'ahorro' ? d.cuentaDestinoId : null,
        categoriaId: d.naturaleza === 'gasto' ? d.categoriaId : d.naturaleza === 'prestamo' ? 'prestamos' : 'ahorro',
        fija: d.naturaleza === 'prestamo' ? false : !!d.fija, aplicaEn: quincenal.value ? d.aplicaEn : 'ambas',
      };
      const i = lista.findIndex((x) => x.id === id);
      if (i >= 0) lista[i] = limpio;
      else lista.push(limpio);
      guardarLista(lista);
      aviso(existe ? 'Deducción guardada.' : `Agregada: ${nombre}.`, 'ok', 2500);
      emit('listo');
    }
    async function eliminar() {
      const ok = await confirmar(`Se quita ${d.nombre} de ${ingreso.value?.nombre}. Los pagos ya registrados la conservan.`,
        { titulo: '¿Eliminar la deducción?', aceptar: 'Eliminar', peligro: true });
      if (!ok) return;
      guardarLista((ingreso.value?.deducciones || []).filter((x) => x.id !== d.id).map((x) => copia(x)));
      aviso('Deducción eliminada.', 'info');
      emit('listo');
    }
    return {
      d, existe, error, aplicarSugerencia, quincenal, textoCuota, enviar, eliminar, sugerencias: DEDUCCIONES_SUGERIDAS, naturalezas: NATURALEZAS, aplicaEn: APLICA_EN,
      lista: computed(() => categoriasPorGrupo('gasto')), listaPrestamos: computed(() => vivos('prestamos')), listaCuentas: computed(cuentasDinero),
    };
  },
};

// Atajo desde el formulario de movimiento: registrar el pago de salario que toca ahora.
export function nuevaQuincena() {
  const ix = indice();
  const pendientes = pagosParaRegistrar(ix, { hoy: store.hoy, desde: store.doc.config.inicio });
  if (!pendientes.length) {
    if (!vivos('ingresos').length) {
      cerrarModal();
      location.hash = '#/salarios';
      return aviso('Primero agrega un salario.', 'info', 4000);
    }
    return aviso('No hay pagos de salario por registrar cerca de hoy.', 'info', 4000);
  }
  const { ingreso, pago } = pendientes[0];
  abrirModal('Registrar quincena', ReciboForm, { inicial: reciboSugerido(ix, ingreso, pago, { hoy: store.hoy }), elegirPago: true });
}
