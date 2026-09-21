// Formularios de tarjetas de crédito: la tarjeta con sus cargos y el pago de la tarjeta.
import {
  store, abrirModal, indice, personas, cuentasDinero, tarjetas, vivos, buscar, fmt, fmtMoneda, simboloDe, monedaDeCuenta, confirmar,
} from '../store.js';
import { TIPOS_CARGO, PERIODICIDADES, COBROS_CUOTA, corteDelMes, limiteDe, estadoCiclo, resumenTarjeta } from '../core/tarjetas.js';
import { periodoDe, nombreMes, fechaCorta, redondear, aCentavos, deCentavos } from '../core/util.js';
import { copia, hayValor, PIE, usarFormulario } from './formulario-base.js';
import { dosMonedas } from './componentes.js';

const { reactive, ref, computed, watch } = Vue;

const dia = (v) => Math.min(31, Math.max(1, Math.round(Number(v)) || 0));
const diaValido = (v) => Number(v) >= 1 && Number(v) <= 31;
const montoOpcional = (v) => (hayValor(v) && Number(v) > 0 ? redondear(Number(v)) : null);
// Tasa con hasta 4 decimales: 26.8829, 26.5.
export const formatoTasa = (tasa) => (tasa ? String(Number(Number(tasa).toFixed(4))) : '');

// ---------------------------------------------------------------- Tarjeta

export const TarjetaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required placeholder="Por ejemplo Visa BAC"></label>
      <label class="campo"><span>Titular</span>
        <select v-model="c.titularId"><option :value="null">Hogar (de los dos)</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Banco</span><input v-model.trim="t.banco" maxlength="40" placeholder="Opcional"></label>
      <label class="campo"><span>Últimos 4 dígitos</span><input v-model.trim="t.ultimos4" inputmode="numeric" maxlength="4" placeholder="Opcional"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Día de corte (31 = último)</span><input v-model.number="t.diaCorte" type="number" min="1" max="31"></label>
      <label class="campo"><span>Día límite de pago</span><input v-model.number="t.diaPago" type="number" min="1" max="31"></label>
    </div>
    <p v-if="textoCiclo" class="nota chica">{{ textoCiclo }}</p>
    <label class="campo"><span>Cuándo cobra este banco las cuotas de los financiamientos</span>
      <select v-model="t.cobroCuotas"><option v-for="(n, k) in cobros" :key="k" :value="k">{{ n }}</option></select></label>
    <p class="nota chica" style="margin-top: -4px">{{ t.cobroCuotas === 'dia'
      ? 'Cada cuota cae el mismo día del mes en que se sacó el financiamiento, aunque el corte sea otro día.'
      : 'Cada cuota cae en el corte de la tarjeta.' }} Se puede cambiar en cada financiamiento.</p>
    <div class="fila-campos">
      <label class="campo"><span>Límite en lempiras</span><input v-model.number="t.limite.L" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Opcional"></label>
      <label class="campo"><span>Límite en dólares</span><input v-model.number="t.limite.USD" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Opcional"></label>
    </div>
    <p v-if="textoLimite" class="nota chica" style="margin-top: -6px">{{ textoLimite }}</p>
    <label class="campo"><span>Se paga desde</span>
      <select v-model="t.cuentaPagoId"><option v-for="x in listaCuentas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>

    <h3 class="titulo-grupo" style="margin-top: 6px">Lo que se debe</h3>
    <p class="nota chica" style="margin-top: -6px">Como sale en la app del banco ese día. Las compras de antes ya van incluidas; las que registres después se suman.</p>
    <div class="fila-campos">
      <label class="campo"><span>En lempiras</span><input v-model.number="t.saldoInicial.L" type="number" inputmode="decimal" step="0.01"></label>
      <label class="campo"><span>En dólares</span><input v-model.number="t.saldoInicial.USD" type="number" inputmode="decimal" step="0.01"></label>
      <label class="campo"><span>Al día</span><input v-model="t.saldoFecha" type="date"></label>
    </div>

    <h3 class="titulo-grupo" style="margin-top: 6px">Cargos de la tarjeta</h3>
    <p class="nota chica" style="margin-top: -6px">Membresía, seguros y otros cargos fijos. Se suman solos en cada corte, como gasto de intereses y cargos de tarjeta.</p>
    <div v-for="(x, i) in t.cargos" :key="x.id" class="cargo-tarjeta">
      <div class="fila-campos">
        <label class="campo"><span>Cargo</span><input v-model="x.nombre" maxlength="40" placeholder="Membresía, seguro contra fraude…"></label>
        <label class="campo"><span>Tipo</span><select v-model="x.tipo"><option v-for="(n, k) in tiposCargo" :key="k" :value="k">{{ n }}</option></select></label>
      </div>
      <div class="fila-campos">
        <label class="campo"><span>Monto</span><input v-model.number="x.monto" type="number" inputmode="decimal" step="0.01" min="0"></label>
        <label class="campo"><span>Moneda</span><select v-model="x.moneda"><option value="L">Lempiras</option><option value="USD">Dólares</option></select></label>
        <label class="campo"><span>Se cobra</span><select v-model="x.periodicidad"><option v-for="(n, k) in periodicidades" :key="k" :value="k">{{ n }}</option></select></label>
      </div>
      <div v-if="x.periodicidad !== 'mensual'" class="meses" role="group" :aria-label="'Meses en que se cobra ' + (x.nombre || 'el cargo')">
        <button v-for="n in 12" :key="n" type="button" :class="{ activo: x.meses.includes(n) }" :aria-pressed="x.meses.includes(n)" @click="alternarMes(x, n)">{{ nombreMes(n).slice(0, 3) }}</button>
      </div>
      <div class="acciones" style="margin-top: 0">
        <label class="casilla chica"><input v-model="x.activo" type="checkbox"> Activo</label>
        <span class="espacio"></span>
        <button type="button" class="btn-link" @click="t.cargos.splice(i, 1)">Quitar</button>
      </div>
    </div>
    <button type="button" class="btn-punteado" @click="agregarCargo">+ Agregar cargo</button>

    <p class="nota chica">Las compras de esta tarjeta que no digan quién pagó se cuentan como del titular.</p>
    <label class="campo"><span>Nota</span><input v-model.trim="c.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const previa = original.tarjeta || {};
    const c = reactive({ nombre: original.nombre || '', titularId: original.id ? original.titularId || null : original.titularId ?? store.yo ?? null, nota: original.nota || '' });
    const t = reactive({
      banco: '', ultimos4: '', diaCorte: null, diaPago: null, cobroCuotas: 'corte', cuentaPagoId: cuentasDinero()[0]?.id || 'gastos', saldoFecha: store.hoy, saldoRegistrado: null,
      ...copia(previa),
      limite: { L: null, USD: null, ...(previa.limite || {}) },
      saldoInicial: { L: 0, USD: 0, ...(previa.saldoInicial || {}) },
      cargos: (previa.cargos || []).map((x) => ({ activo: true, meses: [], ...copia(x) })),
    });

    const textoCiclo = computed(() => {
      if (!diaValido(t.diaCorte) || !diaValido(t.diaPago)) return '';
      const cuenta = { tarjeta: { diaCorte: t.diaCorte, diaPago: t.diaPago } };
      const corte = corteDelMes(cuenta, periodoDe(store.hoy));
      return `Lo que se compre hasta el ${fechaCorta(corte)} se paga a más tardar el ${fechaCorta(limiteDe(cuenta, corte))}.`;
    });
    // El límite es uno solo: con las dos monedas, la tasa del límite es lempiras ÷ dólares.
    const textoLimite = computed(() => {
      const L = Number(t.limite.L) || 0;
      const USD = Number(t.limite.USD) || 0;
      if (L > 0 && USD > 0) {
        return `Es un solo límite visto en las dos monedas, con la tasa del día en que lo dio el banco: ${formatoTasa(L / USD)} lempiras por dólar. Lo que se debe en una moneda también ocupa el límite en la otra.`;
      }
      if (L > 0 || USD > 0) return 'Si el banco muestra el límite en lempiras y en dólares, escribe los dos: es el mismo límite, y la app saca la tasa con que se dio.';
      return '';
    });
    function alternarMes(x, n) {
      if (x.periodicidad === 'anual') x.meses = [n];
      else x.meses = x.meses.includes(n) ? x.meses.filter((m) => m !== n) : [...x.meses, n].sort((a, b) => a - b);
    }
    const agregarCargo = () => t.cargos.push({
      id: `cargo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nombre: '', tipo: 'seguro', monto: null, moneda: 'L', periodicidad: 'mensual', meses: [], activo: true,
    });

    const usos = original.id ? vivos('movimientos').filter((m) => m.cuentaId === original.id || m.cuentaDestinoId === original.id).length : 0;
    const f = usarFormulario('cuentas', original, emit, {
      que: 'esta tarjeta',
      alBorrar: () => !usos || confirmar(`La tarjeta tiene ${usos} ${usos === 1 ? 'movimiento' : 'movimientos'} que dejarán de sumar en su deuda.`,
        { titulo: '¿Eliminarla igual?', aceptar: 'Eliminar', peligro: true }),
    });

    function enviar() {
      f.error.value = '';
      const nombre = c.nombre.trim();
      if (!nombre) return (f.error.value = 'Ponle un nombre.');
      if (!diaValido(t.diaCorte) || !diaValido(t.diaPago)) return (f.error.value = 'Escribe el día de corte y el día límite de pago (de 1 a 31).');
      if (t.ultimos4 && !/^\d{4}$/.test(t.ultimos4)) return (f.error.value = 'Los últimos dígitos son 4 números.');
      if (!t.saldoFecha) return (f.error.value = 'Elige la fecha del saldo.');
      if ([t.saldoInicial.L, t.saldoInicial.USD].some((v) => hayValor(v) && Number.isNaN(Number(v)))) return (f.error.value = 'Revisa lo que se debe.');
      for (const x of t.cargos) {
        if (!x.nombre.trim()) return (f.error.value = 'Ponle nombre a cada cargo.');
        if (!(Number(x.monto) > 0)) return (f.error.value = `Escribe el monto de ${x.nombre.trim()}.`);
        if (x.periodicidad !== 'mensual' && !x.meses.length) return (f.error.value = `Elige en qué ${x.periodicidad === 'anual' ? 'mes' : 'meses'} se cobra ${x.nombre.trim()}.`);
      }
      const saldoInicial = { L: redondear(Number(t.saldoInicial.L) || 0), USD: redondear(Number(t.saldoInicial.USD) || 0) };
      const cambioSaldo = !original.id || saldoInicial.L !== (Number(previa.saldoInicial?.L) || 0) || saldoInicial.USD !== (Number(previa.saldoInicial?.USD) || 0) || t.saldoFecha !== previa.saldoFecha;
      const tarjeta = {
        ...t, banco: t.banco || '', ultimos4: t.ultimos4 || '', diaCorte: dia(t.diaCorte), diaPago: dia(t.diaPago),
        limite: { L: montoOpcional(t.limite.L), USD: montoOpcional(t.limite.USD) }, saldoInicial,
        saldoRegistrado: cambioSaldo ? new Date().toISOString() : t.saldoRegistrado,
        cargos: t.cargos.map((x) => ({
          ...x, nombre: x.nombre.trim(), monto: redondear(Number(x.monto)), meses: x.periodicidad === 'mensual' ? [] : x.periodicidad === 'anual' ? x.meses.slice(0, 1) : x.meses, activo: x.activo !== false,
        })),
      };
      f.terminar({ ...original, nombre, tipo: 'tarjeta', moneda: 'L', saldoInicial: 0, titularId: c.titularId || null, nota: c.nota, tarjeta });
    }

    return {
      c, t, textoCiclo, textoLimite, alternarMes, agregarCargo, enviar, nombreMes, tiposCargo: TIPOS_CARGO, periodicidades: PERIODICIDADES, cobros: COBROS_CUOTA,
      listaPersonas: computed(personas), listaCuentas: computed(cuentasDinero), ...f,
    };
  },
};

// ---------------------------------------------------------------- Pago de tarjeta

const MODOS = { contado: 'Contado', todo: 'Toda la deuda', otro: 'Otro monto' };

// Pago de una tarjeta desde una cuenta: lo pagado en lempiras y en dólares, con la tasa del día.
// `corte`: el estado de cuenta que se paga (si no, el último corte con saldo pendiente).
export const PagoTarjetaForm = {
  props: { inicial: Object, corte: String },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label v-if="listaTarjetas.length > 1 && !existe" class="campo"><span>Tarjeta</span>
      <select v-model="m.cuentaDestinoId"><option v-for="x in listaTarjetas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>

    <div v-if="estado" class="caja-corte">
      <p><b>Corte del {{ fechaCorta(estado.corte) }}:</b> {{ dosMonedas(estado.alCorte) }}. Fecha límite: {{ fechaCorta(estado.limite) }}.</p>
      <p v-if="!existe && (estado.pagado.L || estado.pagado.USD)" class="nota chica">Ya se pagaron {{ dosMonedas(estado.pagado) }}; {{ estado.situacion === 'pagado' ? 'está pagado' : 'faltan ' + dosMonedas(estado.pendiente) }}.</p>
    </div>
    <p v-else-if="resumen" class="nota">Se deben {{ dosMonedas(resumen.deuda, { cero: 'nada' }) }}.</p>

    <div v-if="!existe" class="segmentos envuelve" role="group" aria-label="Cuánto pagar">
      <button v-for="(n, k) in modos" :key="k" type="button" :class="{ activo: modo === k }" :aria-pressed="modo === k" :disabled="k === 'contado' && !estado" @click="usar(k)">{{ n }}</button>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>Pago en lempiras</span><input v-model.number="m.pagoL" type="number" inputmode="decimal" step="0.01" min="0" @input="modo = 'otro'"></label>
      <label class="campo"><span>Pago en dólares ({{ simboloDe('USD') }})</span><input v-model.number="m.pagoUSD" type="number" inputmode="decimal" step="0.01" min="0" @input="modo = 'otro'"></label>
    </div>
    <label v-if="pideTasa" class="campo"><span>Tasa de ese día (lempiras por dólar){{ tasaObligatoria ? '' : ' (opcional)' }}</span>
      <input v-model.number="m.tasa" type="number" inputmode="decimal" step="0.0001" min="0" :placeholder="tasaSugerida ? 'Última usada: ' + tasaSugerida : 'Por ejemplo 24.65'"></label>

    <div class="fila-campos">
      <label class="campo"><span>Fecha</span><input v-model="m.fecha" type="date" required></label>
      <label class="campo"><span>Sale de</span>
        <select v-model="m.cuentaId"><option v-for="x in listaCuentas" :key="x.id" :value="x.id">{{ x.nombre }}{{ x.moneda === 'USD' ? ' (US$)' : '' }}</option></select></label>
    </div>
    <label class="campo"><span>Quién pagó</span>
      <select v-model="m.personaId"><option :value="null">Hogar</option><option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    <label class="campo"><span>Nota</span><input v-model.trim="m.nota" maxlength="140" placeholder="Opcional"></label>
    <p v-if="textoPie" class="nota" :class="{ 'texto-aviso': quedara }">{{ textoPie }}</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const m = reactive({
      tipo: 'pago_tarjeta', fecha: store.hoy, cuentaId: null, cuentaDestinoId: tarjetas()[0]?.id || null, pagoL: null, pagoUSD: null, tasa: null, personaId: null, nota: '',
      ...original,
    });
    const ix = computed(indice);
    const tarjeta = computed(() => ix.value.cuentas.get(m.cuentaDestinoId));
    if (!original.id) {
      const t = tarjeta.value;
      m.cuentaId ||= t?.tarjeta?.cuentaPagoId || cuentasDinero()[0]?.id || 'gastos';
      if (!('personaId' in original)) m.personaId = t?.titularId || store.yo || null;
    }

    const resumen = computed(() => (tarjeta.value ? resumenTarjeta(ix.value, tarjeta.value) : null));
    // El estado de cuenta que se paga: el pedido, o el último corte si tiene algo pendiente.
    const estado = computed(() => {
      const t = tarjeta.value;
      if (!t) return null;
      if (props.corte && m.cuentaDestinoId === original.cuentaDestinoId) return estadoCiclo(ix.value, t, props.corte);
      const ultimo = resumen.value.ultimo;
      return !ultimo.antesDelSaldo && (ultimo.alCorte.L > 0 || ultimo.alCorte.USD > 0) ? ultimo : null;
    });

    const modo = ref(original.id ? 'otro' : 'contado');
    function usar(k) {
      modo.value = k;
      if (k === 'contado' && estado.value) Object.assign(m, { pagoL: estado.value.pendiente.L || null, pagoUSD: estado.value.pendiente.USD || null });
      else if (k === 'todo' && resumen.value) Object.assign(m, { pagoL: Math.max(0, resumen.value.deuda.L) || null, pagoUSD: Math.max(0, resumen.value.deuda.USD) || null });
      else if (k === 'otro' && !original.id) Object.assign(m, { pagoL: null, pagoUSD: null });
    }
    const elegirModo = () => {
      if (original.id) return;
      const e = estado.value;
      usar(e && (e.pendiente.L > 0 || e.pendiente.USD > 0) ? 'contado' : resumen.value && (resumen.value.deuda.L > 0 || resumen.value.deuda.USD > 0) ? 'todo' : 'otro');
    };
    elegirModo();
    watch(() => m.cuentaDestinoId, (id, antes) => {
      if (id === antes || original.id) return;
      m.cuentaId = tarjeta.value?.tarjeta?.cuentaPagoId || m.cuentaId;
      elegirModo();
    });

    const monedaOrigen = computed(() => monedaDeCuenta(m.cuentaId));
    const pagoL = computed(() => aCentavos(m.pagoL));
    const pagoUSD = computed(() => aCentavos(m.pagoUSD));
    // Con dólares desde una cuenta en lempiras (o lempiras desde una en dólares) hace falta la tasa.
    const tasaObligatoria = computed(() => (monedaOrigen.value === 'USD' ? pagoL.value > 0 : pagoUSD.value > 0));
    const pideTasa = computed(() => pagoUSD.value > 0 || tasaObligatoria.value);
    const tasaSugerida = computed(() => ix.value.tarjetas.get(m.cuentaDestinoId)?.ultimaTasa || ix.value.tasaEn(store.periodo));
    const salida = computed(() => {
      const tasa = Number(m.tasa) || 0;
      return monedaOrigen.value === 'USD'
        ? deCentavos(pagoUSD.value + (tasa ? Math.round(pagoL.value / tasa) : 0))
        : deCentavos(pagoL.value + Math.round(pagoUSD.value * tasa));
    });
    const quedara = computed(() => {
      const e = estado.value;
      if (!e || original.id) return false;
      return pagoL.value < aCentavos(e.pendiente.L) || pagoUSD.value < aCentavos(e.pendiente.USD);
    });
    const textoPie = computed(() => {
      if (!pagoL.value && !pagoUSD.value) return '';
      const sinTasa = tasaObligatoria.value && !(Number(m.tasa) > 0);
      const aparte = monedaOrigen.value === 'USD' ? fmtMoneda(deCentavos(pagoL.value), 'L') : fmtMoneda(deCentavos(pagoUSD.value), 'USD');
      const partes = [`Sale de ${buscar('cuentas', m.cuentaId)?.nombre || 'la cuenta'}: ${fmtMoneda(salida.value, monedaOrigen.value)}${sinTasa ? ` más ${aparte} a la tasa del día` : ''}`];
      if (quedara.value) {
        const e = estado.value;
        const queda = { L: deCentavos(Math.max(0, aCentavos(e.pendiente.L) - pagoL.value)), USD: deCentavos(Math.max(0, aCentavos(e.pendiente.USD) - pagoUSD.value)) };
        partes.push(`quedan ${dosMonedas(queda)} del corte, que siguen en Avisos`);
      }
      return `${partes.join('; ')}.`;
    });

    const f = usarFormulario('movimientos', original, emit, { que: 'este pago de tarjeta' });
    function enviar() {
      f.error.value = '';
      if (!m.cuentaDestinoId || !tarjeta.value) return (f.error.value = 'Elige la tarjeta.');
      if (!m.cuentaId) return (f.error.value = 'Elige de qué cuenta sale el pago.');
      if (!m.fecha) return (f.error.value = 'Elige la fecha.');
      if ([m.pagoL, m.pagoUSD].some((v) => hayValor(v) && !(Number(v) >= 0))) return (f.error.value = 'Revisa los montos.');
      if (!pagoL.value && !pagoUSD.value) return (f.error.value = 'Escribe cuánto se pagó.');
      if (tasaObligatoria.value && !(Number(m.tasa) > 0)) return (f.error.value = 'Escribe la tasa de ese día: con ella se calcula cuánto costaron las compras en dólares.');
      const r = {
        ...m, tipo: 'pago_tarjeta', periodo: periodoDe(m.fecha), pagoL: deCentavos(pagoL.value), pagoUSD: deCentavos(pagoUSD.value),
        tasa: Number(m.tasa) > 0 ? Number(m.tasa) : null, monto: salida.value, moneda: monedaOrigen.value,
        categoriaId: null, partidaId: null, prestamoId: null, montoDestino: null,
      };
      f.terminar(r, { deshacer: true, mensaje: `Pago de ${tarjeta.value.nombre} guardado: ${dosMonedas({ L: r.pagoL, USD: r.pagoUSD })}.` });
    }

    return {
      m, modo, modos: MODOS, usar, resumen, estado, pideTasa, tasaObligatoria, tasaSugerida, textoPie, quedara, enviar,
      dosMonedas, fmt, fechaCorta, simboloDe,
      listaTarjetas: computed(tarjetas), listaCuentas: computed(cuentasDinero), listaPersonas: computed(personas), ...f,
    };
  },
};

// ---------------------------------------------------------------- Atajos

export const editarTarjeta = (c = {}) => abrirModal(c.id ? 'Editar tarjeta' : 'Nueva tarjeta', TarjetaForm, { inicial: c });
export const pagarTarjeta = (tarjetaId, { corte } = {}) => abrirModal('Pago de tarjeta', PagoTarjetaForm, { inicial: { cuentaDestinoId: tarjetaId || tarjetas()[0]?.id || null }, corte });
export const editarPagoTarjeta = (m) => abrirModal('Editar pago de tarjeta', PagoTarjetaForm, { inicial: m });
