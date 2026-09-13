import {
  store, guardar, borrar, aviso, abrirModal, cerrarModal, indice, personas, cuentas, cuentasDinero, tarjetas, comercios, grupos, categoriasPorGrupo, vivos, buscar,
  nombreCuenta, nombrePersona, fmt, fmtMoneda, simboloDe, monedaDeCuenta,
} from '../store.js';
import { TIPOS_MOVIMIENTO, TIPOS_CUENTA, TIPOS_PARTIDA, FORMAS, FRECUENCIAS, TIPOS_RECIBO, MONEDAS } from '../core/modelo.js';
import { estadoPartidas, partidaActivaEn, partesDelMes, movimientoParaItem } from '../core/presupuesto.js';
import {
  DEDUCCIONES_SUGERIDAS, NATURALEZAS, APLICA_EN, quincenaDe, reciboSugerido, valoresAnteriores, estadoRecibo, pagosParaRegistrar, montoEsperado,
} from '../core/nomina.js';
import { seguroEstimado, cuotasRestantes } from '../core/prestamos.js';
import { saldosCuentas, resumenMes } from '../core/reportes.js';
import { parteDe } from '../core/asientos.js';
import { corteDe, corteSiguiente, cuotasDeCompra, TIPOS_FINANCIAMIENTO } from '../core/tarjetas.js';
import { hoy, periodoDe, periodoActual, nombrePeriodo, nombreMes, fechaCorta, sumarMeses, redondear, slug } from '../core/util.js';
import { copia, hayValor, PIE, opcionesCategoria, usarFormulario } from './formulario-base.js';
import { editarTarjeta, pagarTarjeta, editarPagoTarjeta } from './formularios-tarjetas.js';

const { reactive, ref, computed, watch, nextTick } = Vue;

const TIPOS_CORTOS = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferir', abono: 'Abono', ajuste: 'Ajuste' };

// Estado de una partida en un mes, sin contar el movimiento que se está editando.
function estadoSinEste(partidaId, parte, periodo, movimientoId) {
  if (!partidaId || !periodo) return null;
  const it = estadoPartidas(indice(), periodo).find((x) => x.partida.id === partidaId && x.parte === parte);
  if (!it) return null;
  // Lo que este movimiento aporta en ese mes (en lempiras; en una compra a cuotas, su cuota).
  const propio = (indice().pagosPartida.get(`${partidaId}|${periodo}`) || []).filter((x) => x.m.id === movimientoId).reduce((a, x) => a + x.c, 0);
  const real = redondear(it.real - propio / 100);
  return { ...it, realSinEste: real, quedaSinEste: redondear(Math.max(0, it.esperado - real)) };
}

// Texto del aviso después de registrar un pago de una partida.
export function textoDePartida(partidaId, parte, periodo) {
  const it = estadoPartidas(indice(), periodo).find((x) => x.partida.id === partidaId && x.parte === parte);
  if (!it) return '';
  if (it.estado === 'parcial') return `Quedan ${fmt(it.queda)} en ${it.nombre}.`;
  if (it.estado === 'excedido') return `${it.nombre}: ${fmt(it.real - it.esperado)} más de lo previsto.`;
  if (it.sobrante > 0) return `${it.nombre} cerrada. Sobran ${fmt(it.sobrante)}${it.acumula ? ' para el mes siguiente' : ''}.`;
  return `${it.nombre} completa.`;
}

// ---------------------------------------------------------------- Movimiento

export const MovimientoForm = {
  props: { inicial: Object, sugerirMontos: Boolean },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar(false)">
    <template v-if="!tipoFijo">
      <div class="segmentos" role="group" aria-label="Tipo de movimiento">
        <button type="button" :class="{ activo: m.tipo === 'gasto' }" :aria-pressed="m.tipo === 'gasto'" @click="m.tipo = 'gasto'; verMas = false">Gasto</button>
        <button v-if="!existe" type="button" title="Registrar un pago de salario" @click="nuevaQuincena">Quincena</button>
        <button v-if="!existe && hayTarjetas" type="button" title="Registrar un pago de tarjeta de crédito" @click="pagoDeTarjeta">Pago de tarjeta</button>
        <button type="button" :class="{ activo: m.tipo === 'transferencia' }" :aria-pressed="m.tipo === 'transferencia'" @click="m.tipo = 'transferencia'; verMas = false">Transferir</button>
        <button type="button" :class="{ activo: otroTipo }" :aria-expanded="verMas" @click="verMas = !verMas">{{ otroTipo ? tipos[m.tipo] : 'Más' }}</button>
      </div>
      <div v-if="verMas" class="chips-filtro">
        <button v-for="k in ['ingreso', 'abono', 'ajuste']" :key="k" type="button" class="chip-filtro" :class="{ activo: m.tipo === k }" @click="m.tipo = k; verMas = false">{{ nombresTipo[k] }}</button>
      </div>
    </template>
    <p v-else class="nota">{{ textoVinculo }}</p>

    <template v-if="m.tipo !== 'ajuste'">
      <div class="fila-campos">
        <label class="campo"><span>{{ aCuotas ? 'Monto total de la compra' : 'Monto' }}{{ monedaOrigen === 'USD' ? ' (' + simboloDe('USD') + ')' : '' }}</span>
          <input ref="campoMonto" v-model.number="m.monto" type="number" inputmode="decimal" step="0.01" min="0" required></label>
        <div v-if="origenEsTarjeta" class="campo" style="flex: 0 1 140px">
          <span>Moneda</span>
          <div class="segmentos" role="group" aria-label="Moneda de la compra">
            <button v-for="(n, k) in { L: simboloDe('L'), USD: simboloDe('USD') }" :key="k" type="button" :class="{ activo: monedaOrigen === k }" :aria-pressed="monedaOrigen === k" @click="m.moneda = k">{{ n }}</button>
          </div>
        </div>
      </div>
      <div v-if="montosRapidos.length" class="chips-filtro" style="margin-top: -4px">
        <button v-for="x in montosRapidos" :key="x.texto" type="button" class="chip-filtro" :class="{ activo: Number(m.monto) === x.valor }" @click="m.monto = x.valor">{{ x.texto }}</button>
      </div>
    </template>
    <template v-else>
      <label class="campo"><span>Saldo real hoy</span>
        <input v-model.number="saldoReal" type="number" inputmode="decimal" step="0.01"></label>
      <p class="nota">En la app: {{ fmtMoneda(saldoSinEste, monedaOrigen) }} → ajuste de {{ fmtMoneda(diferencia, monedaOrigen) }}</p>
    </template>

    <label v-if="usaComercio" class="campo"><span>Comercio</span>
      <input v-model="comercioTexto" list="lista-comercios" maxlength="60" autocomplete="off" placeholder="Opcional: dónde se compró" @input="aplicarComercio"></label>
    <datalist id="lista-comercios"><option v-for="x in listaComercios" :key="x.id" :value="x.nombre"></option></datalist>

    <div class="fila-campos">
      <label class="campo"><span>Fecha</span><input v-model="m.fecha" type="date" required></label>
      <label class="campo"><span>{{ etiquetaCuenta }}</span>
        <select v-model="m.cuentaId"><option v-for="c in listaOrigen" :key="c.id" :value="c.id">{{ c.nombre }}{{ c.moneda === 'USD' ? ' (US$)' : '' }}</option></select></label>
      <label v-if="m.tipo === 'transferencia'" class="campo"><span>Hacia</span>
        <select v-model="m.cuentaDestinoId">
          <option :value="null" disabled>Elige…</option>
          <option v-for="c in listaDestino" :key="c.id" :value="c.id" :disabled="c.id === m.cuentaId">{{ c.nombre }}{{ c.moneda === 'USD' ? ' (US$)' : '' }}</option>
        </select></label>
    </div>

    <label v-if="m.tipo === 'transferencia' && monedasDistintas" class="campo"><span>Llega a {{ nombreCuenta(m.cuentaDestinoId) }} ({{ simboloDe(monedaDestino) }})</span>
      <input v-model.number="m.montoDestino" type="number" inputmode="decimal" step="0.01" min="0"></label>
    <p v-else-if="origenEsTarjeta && monedaOrigen === 'USD' && m.tipo !== 'ajuste'" class="nota chica">En lempiras cuenta con la tasa del día en que se pague la tarjeta. Mientras tanto se estima con la última tasa usada.</p>
    <label v-else-if="(m.tipo === 'gasto' || m.tipo === 'ingreso') && monedaOrigen === 'USD'" class="campo"><span>Tasa de cambio de ese día (opcional)</span>
      <input v-model.number="m.tasa" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="Por ejemplo 24.65"></label>

    <template v-if="puedeCuotas">
      <label class="casilla"><input v-model="aCuotas" type="checkbox"> Compra a cuotas</label>
      <div v-if="aCuotas" class="caja-cuotas">
        <div class="segmentos" role="group" aria-label="Tipo de financiamiento">
          <button v-for="(n, k) in tiposFinanciamiento" :key="k" type="button" :class="{ activo: q.tipo === k }" :aria-pressed="q.tipo === k" @click="q.tipo = k">{{ n }}</button>
        </div>
        <p class="nota chica" style="margin-top: -4px">{{ q.tipo === 'extra' ? 'Crédito aparte, fuera del límite: no baja el disponible de la tarjeta.' : 'Dentro del límite: la compra completa baja el disponible, que se libera con cada cuota.' }}</p>
        <div class="fila-campos">
          <label class="campo"><span>Cuotas</span><input v-model.number="q.n" type="number" inputmode="numeric" min="2" max="60"></label>
          <label class="campo"><span>Primera cuota</span>
            <select v-model="q.primerCorte"><option v-for="c in cortesPosibles" :key="c.valor || 'compra'" :value="c.valor">{{ c.texto }}</option></select></label>
        </div>
        <div class="fila-campos">
          <label class="campo"><span>Tasa anual (%)</span><input v-model.number="q.tasaAnual" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0 = tasa cero"></label>
          <label class="campo"><span>Cuota del banco (opcional)</span><input v-model.number="q.cuotaBanco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Sin la comisión"></label>
        </div>
        <div class="fila-campos">
          <label class="campo"><span>Comisión</span><input v-model.number="q.comision.valor" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0 si no cobran"></label>
          <label class="campo" style="flex: 0 1 96px"><span>En</span>
            <select v-model="q.comision.unidad" aria-label="La comisión es"><option value="porcentaje">%</option><option value="monto">{{ simboloDe('L') }}</option></select></label>
          <label class="campo"><span>Se cobra</span>
            <select v-model="q.comision.cobro"><option value="unica">Una vez</option><option value="mensual">En cada cuota</option></select></label>
        </div>
        <label v-if="existe" class="campo"><span>Si se canceló antes, ¿cuándo? (opcional)</span><input v-model="q.canceladaEl" type="date"></label>
        <p v-if="vistaCuotas" class="nota">{{ vistaCuotas }}</p>
      </div>
    </template>

    <label v-if="m.tipo === 'abono'" class="campo"><span>Préstamo</span>
      <select v-model="m.prestamoId"><option :value="null" disabled>Elige…</option>
        <option v-for="p in listaPrestamos" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>

    <label v-if="m.tipo === 'gasto' && !esCuota" class="campo"><span>Partida del presupuesto</span>
      <select v-model="m.partidaId" :disabled="!!m.parte">
        <option :value="null">Fuera del plan</option>
        <option v-for="p in partidasGasto" :key="p.id" :value="p.id">{{ p.texto }}</option>
      </select></label>
    <label v-if="m.tipo === 'transferencia' && partidasAporte.length && !m.parte" class="campo"><span>Aporte del presupuesto</span>
      <select v-model="m.partidaId"><option :value="null">Ninguno</option>
        <option v-for="p in partidasAporte" :key="p.id" :value="p.id">{{ p.texto }}</option></select></label>
    <label v-if="m.tipo === 'transferencia' && listaMetas.length && !m.parte" class="campo"><span>{{ esRetiroDeMeta ? 'Sale de la meta' : 'Para la meta' }}</span>
      <select v-model="m.metaId"><option :value="null">Ninguna</option>
        <option v-for="x in listaMetas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>

    <label v-if="enPartida && !aCuotas && monedaOrigen === 'L' && estado && m.monto > 0 && m.monto < estado.quedaSinEste" class="casilla">
      <input v-model="m.cierra" type="checkbox"> Cierra la partida: sobran {{ fmt(estado.quedaSinEste - m.monto) }}{{ estado.acumula ? ' para el mes siguiente' : '' }}
    </label>

    <div class="fila-campos">
      <label v-if="(m.tipo === 'gasto' || m.tipo === 'ingreso') && !esCuota" class="campo"><span>Categoría</span>
        <select v-model="m.categoriaId">${opcionesCategoria("(m.tipo === 'ingreso' ? categoriasIngreso : categoriasGasto)")}</select></label>
      <label v-if="vinculado" class="campo"><span>Cuenta en el mes de</span>
        <select v-model="m.periodo" @change="periodoTocado = true"><option v-for="p in opcionesPeriodo" :key="p" :value="p">{{ nombrePeriodo(p) }}</option></select></label>
      <label v-if="m.tipo !== 'ajuste'" class="campo"><span>{{ m.tipo === 'ingreso' ? 'Quién lo recibió' : 'Quién pagó' }}</span>
        <select v-model="m.personaId"><option :value="null">Hogar</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>

    <label class="campo"><span>Nota</span><input v-model.trim="m.nota" type="text" maxlength="140" placeholder="Opcional"></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="auditoria" class="meta">{{ auditoria }}</p>
    <div class="acciones">
      <button v-if="existe" type="button" class="btn peligro" @click="eliminar">Eliminar</button>
      <span class="espacio"></span>
      <button v-if="!existe && !tipoFijo" type="button" class="btn" @click="enviar(true)">Guardar y otro</button>
      <button v-else type="button" class="btn" @click="$emit('listo')">Cancelar</button>
      <button type="submit" class="btn primario">Guardar</button>
    </div>
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const m = reactive({
      tipo: 'gasto', fecha: store.hoy, monto: null, moneda: null, cuentaId: cuentasDinero()[0]?.id || 'gastos', cuentaDestinoId: null, montoDestino: null, tasa: null,
      categoriaId: null, personaId: store.yo, nota: '', prestamoId: null, partidaId: null, parte: null, periodo: null, cierra: false, comercioId: null, metaId: null,
      ...original,
    });
    const campoMonto = ref(null);
    const verMas = ref(false);
    const otroTipo = computed(() => ['ingreso', 'abono', 'ajuste'].includes(m.tipo));
    const periodoTocado = ref(!!original.periodo);
    if (!parteDe(m)) m.parte = null;
    const esCuota = computed(() => !!(m.prestamoId && m.tipo === 'gasto'));
    const tipoFijo = computed(() => esCuota.value || !!m.parte);
    const vinculado = computed(() => esCuota.value || (!!m.partidaId && (m.tipo === 'gasto' || m.tipo === 'transferencia')));
    const enPartida = computed(() => m.tipo === 'gasto' && !!m.partidaId && !m.parte);
    const periodoMov = computed(() => (vinculado.value ? m.periodo || periodoDe(m.fecha) : periodoDe(m.fecha)));

    // Si se registró desde "+", el mes sigue a la fecha hasta que se elija otro.
    watch(() => m.fecha, (f) => {
      if (f && !periodoTocado.value) m.periodo = periodoDe(f);
    });
    watch(vinculado, (v) => {
      if (v && !m.periodo) m.periodo = periodoDe(m.fecha);
    }, { immediate: true });

    const partida = computed(() => buscar('partidas', m.partidaId));
    watch(() => m.partidaId, (id, anterior) => {
      const p = buscar('partidas', id);
      if (p && id !== anterior && p.categoriaId) m.categoriaId = p.categoriaId;
      if (p && id !== anterior && p.tipo === 'aporte' && p.metaId) m.metaId = p.metaId;
    });
    // Una meta con cuenta propia: el aporte va a esa cuenta (si no sale de ella).
    const listaMetas = computed(() => vivos('metas').filter((x) => x.activo !== false || x.id === m.metaId).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    const metaElegida = computed(() => buscar('metas', m.metaId));
    const esRetiroDeMeta = computed(() => !!metaElegida.value?.cuentaId && m.cuentaId === metaElegida.value.cuentaId);
    watch(() => m.metaId, (id, anterior) => {
      const x = buscar('metas', id);
      if (x?.cuentaId && id !== anterior && m.cuentaId !== x.cuentaId) m.cuentaDestinoId = x.cuentaId;
    });

    const nombreVinculo = computed(() => partida.value?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '');
    const textoVinculo = computed(() => {
      const mes = nombrePeriodo(periodoMov.value);
      if (esCuota.value) return `Cuota de ${nombreVinculo.value} de ${mes}.`;
      if (m.parte === 'apartar') return `Se aparta para ${nombreVinculo.value} (${mes}).`;
      if (m.parte === 'pagar') return `Pago de ${nombreVinculo.value} (${mes}), desde lo apartado.`;
      return '';
    });

    const estado = computed(() => estadoSinEste(m.partidaId, parteDe(m), periodoMov.value, original.id));
    const textoPartida = (p, periodo) => {
      const it = estadoSinEste(p.id, null, periodo, original.id);
      if (!it) return `${p.nombre} · no toca en ${nombrePeriodo(periodo, true)}`;
      if (it.estado === 'omitida') return `${p.nombre} · omitida este mes`;
      return it.quedaSinEste > 0 ? `${p.nombre} · quedan ${fmt(it.quedaSinEste)}` : `${p.nombre} · completa`;
    };
    const partidasGasto = computed(() => vivos('partidas')
      .filter((p) => p.tipo === 'gasto' && (p.id === m.partidaId || partidaActivaEn(p, periodoMov.value)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ id: p.id, texto: textoPartida(p, periodoMov.value) })));
    const partidasAporte = computed(() => vivos('partidas')
      .filter((p) => p.tipo === 'aporte' && (p.id === m.partidaId || partidaActivaEn(p, periodoMov.value)))
      .map((p) => ({ id: p.id, texto: textoPartida(p, periodoMov.value) })));
    const opcionesPeriodo = computed(() => {
      const base = periodoDe(m.fecha || store.hoy);
      return [...new Set([sumarMeses(base, -1), base, sumarMeses(base, 1), m.periodo].filter(Boolean))].sort();
    });

    const montosRapidos = computed(() => {
      const it = estado.value;
      const abonos = props.sugerirMontos || partida.value?.forma === 'abonos';
      if (!enPartida.value || !it || !abonos || !(it.quedaSinEste > 0) || monedaOrigen.value !== 'L') return [];
      const lista = [1000, 2000].filter((v) => v < it.quedaSinEste).map((v) => ({ texto: fmt(v).replace('.00', ''), valor: v }));
      lista.push({ texto: `Lo que queda (${fmt(it.quedaSinEste)})`, valor: it.quedaSinEste });
      return lista;
    });

    // Cuentas y tarjetas. Un abono o un ajuste es de una cuenta; a una tarjeta se le paga con
    // "Pago de tarjeta", no con una transferencia.
    const conActual = (lista, id) => (id && !lista.some((c) => c.id === id) && buscar('cuentas', id) ? [...lista, buscar('cuentas', id)] : lista);
    const soloCuentas = computed(() => m.tipo === 'abono' || m.tipo === 'ajuste');
    const listaOrigen = computed(() => conActual(soloCuentas.value ? cuentasDinero() : cuentas(), original.cuentaId));
    const listaDestino = computed(() => conActual(cuentasDinero(), original.cuentaDestinoId));
    watch(soloCuentas, (solo) => {
      if (solo && buscar('cuentas', m.cuentaId)?.tipo === 'tarjeta') m.cuentaId = cuentasDinero()[0]?.id || 'gastos';
    }, { immediate: true });
    const origenEsTarjeta = computed(() => buscar('cuentas', m.cuentaId)?.tipo === 'tarjeta');
    const monedaOrigen = computed(() => (origenEsTarjeta.value ? (m.moneda === 'USD' ? 'USD' : 'L') : monedaDeCuenta(m.cuentaId)));
    const monedaDestino = computed(() => monedaDeCuenta(m.cuentaDestinoId));
    const monedasDistintas = computed(() => !!m.cuentaDestinoId && monedaOrigen.value !== monedaDestino.value);
    const hayTarjetas = computed(() => tarjetas().length > 0);
    const pagoDeTarjeta = () => pagarTarjeta(origenEsTarjeta.value ? m.cuentaId : null);

    // Comercio: al elegir uno conocido se llenan su categoría, partida, medio y moneda.
    const usaComercio = computed(() => m.tipo === 'gasto' && !esCuota.value && !m.parte);
    const comercioTexto = ref(buscar('comercios', m.comercioId)?.nombre || '');
    const comercioPorNombre = (nombre) => {
      const clave = nombre.trim().toLowerCase();
      return clave ? vivos('comercios').find((x) => x.nombre.trim().toLowerCase() === clave) : null;
    };
    function aplicarComercio() {
      const x = comercioPorNombre(comercioTexto.value);
      if (!x || original.id) return;
      const cuenta = buscar('cuentas', x.medioPagoId);
      if (cuenta && !cuenta.borrado) m.cuentaId = cuenta.id;
      if (x.moneda && cuenta?.tipo === 'tarjeta') m.moneda = x.moneda;
      if (x.categoriaId) m.categoriaId = x.categoriaId;
      const p = buscar('partidas', x.partidaId);
      if (p && p.tipo === 'gasto' && partidaActivaEn(p, periodoMov.value)) m.partidaId = p.id;
    }

    // Compra a cuotas: solo con tarjeta y en lempiras.
    const puedeCuotas = computed(() => m.tipo === 'gasto' && origenEsTarjeta.value && monedaOrigen.value === 'L' && !esCuota.value && !m.parte);
    const aCuotas = ref(!!original.cuotas);
    const q = reactive({ n: 12, tipo: 'intra', tasaAnual: null, cuotaBanco: null, primerCorte: null, canceladaEl: null, ...(original.cuotas || {}) });
    q.comision = { valor: null, unidad: 'porcentaje', cobro: 'unica', ...(original.cuotas?.comision || {}) };
    const cortesPosibles = computed(() => {
      const cuenta = buscar('cuentas', m.cuentaId);
      if (!cuenta?.tarjeta || !m.fecha) return [{ valor: null, texto: 'En el corte de la compra' }];
      const primero = corteDe(cuenta, m.fecha);
      const siguiente = corteSiguiente(cuenta, primero);
      const lista = [{ valor: null, texto: `Corte del ${fechaCorta(primero)}` }, { valor: siguiente, texto: `Corte del ${fechaCorta(siguiente)}` }];
      if (q.primerCorte && ![null, siguiente].includes(q.primerCorte)) lista.push({ valor: q.primerCorte, texto: `Corte del ${fechaCorta(corteDe(cuenta, q.primerCorte))}` });
      return lista;
    });
    const cuotasPrevias = computed(() => {
      const cuenta = buscar('cuentas', m.cuentaId);
      const n = Math.round(Number(q.n));
      if (!aCuotas.value || !cuenta?.tarjeta || !(Number(m.monto) > 0) || !(n >= 2) || !m.fecha) return [];
      return cuotasDeCompra(cuenta, { monto: m.monto, fecha: m.fecha, cuotas: { ...q, n } });
    });
    // "L1,000.00 × 12, sep 2026–ago 2027. En total: comisión L360.00 (con la primera cuota). Usa L12,000.00 del límite."
    const vistaCuotas = computed(() => {
      const lista = cuotasPrevias.value;
      if (!lista.length) return '';
      const primera = lista[0];
      const ultima = lista[lista.length - 1];
      const tipica = lista[1] || primera;
      const suma = (campo) => lista.reduce((a, x) => a + x[campo], 0);
      const rango = `${nombrePeriodo(primera.periodo, true)}–${nombrePeriodo(ultima.periodo, true)}`;
      const residuo = lista.length > 2 && ultima.c !== tipica.c ? ` (la última, ${fmt(ultima.c / 100)})` : '';
      const costos = [];
      if (suma('interes')) costos.push(`intereses ${fmt(suma('interes') / 100)}`);
      if (suma('comision')) costos.push(`comisión ${fmt(suma('comision') / 100)}${q.comision.cobro === 'mensual' ? '' : ' (con la primera cuota)'}`);
      const limite = q.tipo === 'extra' ? 'No usa el límite de la tarjeta.' : `Usa ${fmt(suma('capital') / 100)} del límite.`;
      return `${fmt(tipica.c / 100)} × ${lista.length}${residuo}, ${rango}. ${costos.length ? `En total: ${costos.join(' y ')}.` : 'Sin intereses ni comisión.'} ${limite}`;
    });

    const saldos = computed(() => saldosCuentas(indice()));
    const saldoSinEste = computed(() => {
      const propio = original.tipo === 'ajuste' && original.cuentaId === m.cuentaId && original.creado ? Number(original.monto) : 0;
      return redondear((saldos.value[m.cuentaId] || 0) - propio);
    });
    const saldoReal = ref(original.tipo === 'ajuste' && original.creado ? redondear(saldos.value[original.cuentaId] || 0) : null);
    const diferencia = computed(() => redondear((Number(saldoReal.value) || 0) - saldoSinEste.value));
    const etiquetaCuenta = computed(() => ({ gasto: 'Pagado con', ingreso: 'Entra a', transferencia: 'Desde', abono: 'Pagado desde', ajuste: 'Cuenta' })[m.tipo]);
    const f = usarFormulario('movimientos', original, emit, { que: 'este movimiento' });

    // Comercio escrito: el existente, o uno nuevo con lo de este gasto.
    function comercioDe(r) {
      const nombre = comercioTexto.value.trim();
      if (!nombre) return null;
      const existente = comercioPorNombre(nombre);
      if (existente) return existente.id;
      const id = slug(nombre) ? `comercio-${slug(nombre)}` : undefined;
      const borrado = id ? buscar('comercios', id) : null;
      return guardar('comercios', {
        ...(borrado || {}), id, nombre, categoriaId: r.categoriaId || null, partidaId: r.partidaId || null, medioPagoId: r.cuentaId, moneda: r.moneda, borrado: false,
      }).id;
    }

    function enviar(otro) {
      f.error.value = '';
      const r = { ...m };
      if (r.tipo === 'ajuste') {
        if (!hayValor(saldoReal.value) || Number.isNaN(Number(saldoReal.value))) return (f.error.value = 'Escribe el saldo real de la cuenta.');
        r.monto = diferencia.value;
        if (!r.monto) return (f.error.value = 'El saldo ya coincide; no hace falta ajustar.');
      } else if (!(Number(r.monto) > 0)) {
        return (f.error.value = 'Escribe un monto mayor que cero.');
      }
      if (!r.fecha) return (f.error.value = 'Elige la fecha.');
      if (r.tipo === 'transferencia' && (!r.cuentaDestinoId || r.cuentaDestinoId === r.cuentaId)) return (f.error.value = 'Elige una cuenta de destino distinta.');
      if (r.tipo === 'transferencia' && monedasDistintas.value && !(Number(r.montoDestino) > 0)) return (f.error.value = `Escribe cuánto llega en ${simboloDe(monedaDestino.value)}.`);
      if (r.tipo === 'abono' && !r.prestamoId) return (f.error.value = 'Elige el préstamo.');
      const conCuotas = puedeCuotas.value && aCuotas.value;
      if (conCuotas) {
        const n = Number(q.n);
        if (!Number.isInteger(n) || n < 2 || n > 60) return (f.error.value = 'Escribe el número de cuotas (de 2 a 60).');
        if (hayValor(q.tasaAnual) && !(Number(q.tasaAnual) >= 0)) return (f.error.value = 'Revisa la tasa anual.');
        if (Number(q.cuotaBanco) > 0 && Number(q.cuotaBanco) * n < Number(r.monto)) return (f.error.value = 'Con esa cuota no se paga la compra: revisa la cuota o el número de cuotas.');
        if (hayValor(q.comision.valor) && !(Number(q.comision.valor) >= 0 && (q.comision.unidad === 'monto' || Number(q.comision.valor) <= 100))) return (f.error.value = 'Revisa la comisión.');
        if (q.canceladaEl && q.canceladaEl < r.fecha) return (f.error.value = 'La cancelación no puede ser antes de la compra.');
      }

      r.monto = redondear(Number(r.monto));
      r.moneda = monedaOrigen.value;
      r.periodo = periodoMov.value;
      if (r.tipo !== 'transferencia') r.cuentaDestinoId = null;
      r.montoDestino = r.tipo === 'transferencia' && monedasDistintas.value ? redondear(Number(r.montoDestino)) : null;
      r.tasa = (r.tipo === 'gasto' || r.tipo === 'ingreso') && monedaOrigen.value === 'USD' && !origenEsTarjeta.value && Number(r.tasa) > 0 ? Number(r.tasa) : null;
      if (r.tipo !== 'gasto' && r.tipo !== 'ingreso') r.categoriaId = null;
      if (r.tipo !== 'abono' && !esCuota.value) r.prestamoId = null;
      if (r.tipo !== 'transferencia') r.metaId = original.tipo === r.tipo ? original.metaId || null : null;
      if (!(r.tipo === 'gasto' || r.tipo === 'transferencia')) r.partidaId = null;
      if (!r.partidaId) r.parte = null;
      r.cierra = enPartida.value && !conCuotas && r.moneda === 'L' && !!r.cierra && !!estado.value && r.monto < estado.value.quedaSinEste;
      if (r.tipo === 'ajuste') r.personaId = null;
      r.cuotas = conCuotas
        ? {
          n: Number(q.n), tipo: q.tipo, tasaAnual: Number(q.tasaAnual) > 0 ? Number(q.tasaAnual) : null,
          cuotaBanco: Number(q.cuotaBanco) > 0 ? redondear(Number(q.cuotaBanco)) : null, primerCorte: q.primerCorte || null, canceladaEl: q.canceladaEl || null,
          comision: Number(q.comision.valor) > 0
            ? { valor: q.comision.unidad === 'monto' ? redondear(Number(q.comision.valor)) : Number(q.comision.valor), unidad: q.comision.unidad, cobro: q.comision.cobro }
            : null,
        }
        : null;
      r.comercioId = usaComercio.value ? comercioDe(r) : null;

      const textoCuotas = conCuotas ? ` ${Number(q.n)} cuotas.` : '';
      const mensaje = r.partidaId
        ? (g) => `${f.existe ? 'Cambios guardados.' : 'Guardado.'}${textoCuotas} ${textoDePartida(g.partidaId, parteDe(g), conCuotas ? periodoDe(cuotasPrevias.value[0]?.fecha || g.fecha) : g.periodo)}`
        : conCuotas ? `${f.existe ? 'Cambios guardados.' : 'Guardado.'}${textoCuotas}` : undefined;
      f.terminar(r, { deshacer: true, cerrar: !otro, mensaje });
      if (otro) {
        Object.assign(m, { monto: null, nota: '', partidaId: null, cierra: false, categoriaId: null, montoDestino: null, tasa: null, comercioId: null });
        comercioTexto.value = '';
        aCuotas.value = false;
        Object.assign(q, { tasaAnual: null, cuotaBanco: null, primerCorte: null, canceladaEl: null, comision: { valor: null, unidad: 'porcentaje', cobro: 'unica' } });
        nextTick(() => campoMonto.value?.focus());
      }
    }

    return {
      m, campoMonto, verMas, otroTipo, nuevaQuincena, periodoTocado, esCuota, tipoFijo, vinculado, enPartida, textoVinculo, estado, partidasGasto, partidasAporte, opcionesPeriodo,
      listaMetas, esRetiroDeMeta,
      montosRapidos, listaOrigen, listaDestino, origenEsTarjeta, monedaOrigen, monedaDestino, monedasDistintas, hayTarjetas, pagoDeTarjeta,
      usaComercio, comercioTexto, aplicarComercio, puedeCuotas, aCuotas, q, cortesPosibles, vistaCuotas, tiposFinanciamiento: TIPOS_FINANCIAMIENTO,
      saldoSinEste, saldoReal, diferencia, etiquetaCuenta, enviar,
      fmt, fmtMoneda, simboloDe, nombreCuenta, nombrePeriodo, tipos: TIPOS_CORTOS, nombresTipo: TIPOS_MOVIMIENTO,
      listaPersonas: computed(personas), listaPrestamos: computed(() => vivos('prestamos')), listaComercios: computed(comercios),
      categoriasGasto: computed(() => categoriasPorGrupo('gasto')), categoriasIngreso: computed(() => categoriasPorGrupo('ingreso')), ...f,
    };
  },
};

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
    function eliminar() {
      if (!confirm(`¿Eliminar ${d.nombre} de ${ingreso.value?.nombre}? Los pagos ya registrados la conservan.`)) return;
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
      if (!(Number(r.tasa) >= 0)) return (f.error.value = 'Escribe la tasa anual (por ejemplo 14.5).');
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

    return { p, seguroTexto, estimado, restantes, enviar, fmt, listaPersonas: computed(personas), listaCuentas: computed(cuentasDinero), ...f };
  },
};

// ---------------------------------------------------------------- Cuenta, persona, grupo y categoría

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
      <label class="campo"><span>Moneda</span><select v-model="c.moneda"><option v-for="(n, k) in monedas" :key="k" :value="k">{{ n }}</option></select></label>
      <label class="campo"><span>Saldo inicial ({{ simboloDe(c.moneda) }})</span><input v-model.number="c.saldoInicial" type="number" inputmode="decimal" step="0.01"></label>
    </div>
    <p v-if="cambioMoneda" class="nota chica">La cuenta ya tiene movimientos: al cambiar la moneda, sus montos se leerán en {{ monedas[c.moneda].toLowerCase() }}.</p>
    <div class="fila-campos">
      <label class="campo"><span>Titular</span>
        <select v-model="c.titularId"><option :value="null">Hogar (de los dos)</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <p class="nota chica">Los gastos de esta cuenta que no digan quién pagó se cuentan como del titular. Las metas de ahorro se configuran en <a href="#/metas" @click="$emit('listo')">Metas</a>.</p>
    <label class="campo"><span>Nota</span><input v-model.trim="c.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', tipo: 'banco', moneda: 'L', saldoInicial: 0, nota: '', titularId: null, ...original });
    const usos = original.id ? vivos('movimientos').filter((m) => m.cuentaId === original.id || m.cuentaDestinoId === original.id).length : 0;
    const cambioMoneda = computed(() => usos > 0 && c.moneda !== (original.moneda || 'L'));
    const f = usarFormulario('cuentas', original, emit, {
      que: 'esta cuenta',
      alBorrar: () => !usos || confirm(`La cuenta tiene ${usos} movimientos que dejarán de sumar en su saldo. ¿Eliminarla igual?`),
    });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Ponle un nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim(), titularId: c.titularId || null, saldoInicial: redondear(Number(c.saldoInicial) || 0) });
    }
    // Las tarjetas se crean y editan con su propio formulario.
    const tipos = Object.fromEntries(Object.entries(TIPOS_CUENTA).filter(([k]) => k !== 'tarjeta'));
    return { c, cambioMoneda, enviar, simboloDe, tipos, monedas: MONEDAS, listaPersonas: computed(personas), ...f };
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

export const GrupoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre del grupo</span><input v-model="g.nombre" maxlength="40" required></label>
    <p v-if="existe && usadas" class="nota chica">Si lo eliminas, sus {{ usadas }} categorías pasan a Personal.</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const g = reactive({ nombre: '', orden: grupos().length + 1, ...original });
    const usadas = vivos('categorias').filter((c) => c.grupoId === original.id).length;
    const f = usarFormulario('grupos', original, emit, {
      que: 'este grupo',
      alBorrar: () => {
        if (original.id === 'personal') {
          aviso('Personal recibe las categorías de los grupos que se eliminan: no se puede eliminar.', 'error', 6000);
          return false;
        }
        for (const c of vivos('categorias').filter((x) => x.grupoId === original.id)) guardar('categorias', { ...c, grupoId: 'personal' });
        return true;
      },
    });
    function enviar() {
      f.error.value = '';
      if (!g.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...g, nombre: g.nombre.trim() });
    }
    return { g, usadas, enviar, ...f };
  },
};

export const CategoriaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required></label>
    <div class="fila-campos">
      <label class="campo"><span>Grupo</span>
        <select v-model="c.grupoId"><option v-for="g in listaGrupos" :key="g.id" :value="g.id">{{ g.nombre }}</option></select></label>
      <label class="campo"><span>Se usa para</span>
        <select v-model="c.tipo"><option value="gasto">Gastos</option><option value="ingreso">Ingresos</option></select></label>
    </div>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', grupoId: 'personal', tipo: 'gasto', ...original });
    const f = usarFormulario('categorias', original, emit, { que: 'esta categoría' });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim() });
    }
    return { c, enviar, listaGrupos: computed(grupos), ...f };
  },
};

// ---------------------------------------------------------------- Detalle de una partida, cuota o ingreso en un mes

const ESTADOS = {
  pendiente: { texto: 'Pendiente', clase: '' },
  parcial: { texto: 'En abonos', clase: 'aviso' },
  completo: { texto: 'Completa', clase: 'ok' },
  excedido: { texto: 'Se pasó', clase: 'aviso' },
  omitida: { texto: 'Omitida este mes', clase: '' },
};

export const DetalleItem = {
  props: { clave: String, periodo: String },
  emits: ['listo'],
  template: `
  <div v-if="it" class="formulario">
    <div>
      <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">
        <span class="hero-num md">{{ fmt(it.real) }}</span>
        <span class="tenue">de {{ fmt(it.esperado) }}</span>
        <span class="espacio"></span>
        <span class="chip" :class="estado.clase">{{ estado.texto }}</span>
      </div>
      <div class="progreso" style="margin-top: 10px"><div :style="{ width: pct + '%', background: it.estado === 'excedido' ? 'var(--ambar)' : null }"></div></div>
      <p class="nota" style="margin-top: 8px">{{ resumen }}</p>
      <p v-if="it.arrastre > 0" class="nota chica">Incluye {{ fmt(it.arrastre) }} que sobraron de meses anteriores.</p>
      <p v-if="it.ajuste && !it.omitida" class="nota chica">Este mes: {{ fmt(it.base) }} en vez del monto de siempre.</p>
      <p v-if="it.planilla" class="nota chica">Se descuenta de {{ it.planilla.ingreso.nombre }}: {{ it.planilla.descontados }} de {{ it.planilla.esperados }} {{ it.planilla.esperados === 1 ? 'descuento' : 'descuentos' }} este mes.</p>
    </div>

    <div>
      <h3 class="titulo-grupo">{{ it.tipoItem === 'ingreso' ? 'Recibido' : 'Pagos del mes' }}</h3>
      <ul v-if="registros.length" class="lista">
        <li v-for="r in registros" :key="r.id" class="fila clic" @click="r.abrir()">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.92rem">{{ fechaCorta(r.fecha) }}{{ r.cierra ? ' · cerró la partida' : '' }}</span>
            <span class="fila-sub">{{ r.texto }}</span>
          </div>
          <span class="monto">{{ fmt(r.monto) }}</span>
        </li>
      </ul>
      <p v-else class="nota chica" style="padding: 6px 0">Todavía no hay nada registrado.</p>
    </div>

    <div class="acciones" style="flex-wrap: wrap">
      <button v-if="it.tipoItem === 'partida'" type="button" class="btn" @click="solo">Cambiar solo este mes</button>
      <button v-if="it.estado === 'parcial' && it.tipoItem === 'partida'" type="button" class="btn" @click="cerrarPartida">Cerrar la partida</button>
      <button v-if="faltanDeducciones" type="button" class="btn" @click="completar">Completar deducciones</button>
      <button type="button" class="btn" @click="editarPlantilla">{{ textoEditar }}</button>
      <span class="espacio"></span>
      <button v-if="puedeRegistrar" type="button" class="btn primario" style="margin-left: auto" @click="registrar">{{ it.tipoItem === 'ingreso' ? 'Registrar lo recibido' : 'Registrar un pago' }}</button>
    </div>
  </div>
  <p v-else class="vacio">Esta partida ya no aplica en {{ nombrePeriodo(periodo) }}.</p>`,
  setup(props, { emit }) {
    const it = computed(() => itemsDelMes(props.periodo).find((x) => x.clave === props.clave));
    const estado = computed(() => (it.value?.tipoItem === 'ingreso'
      ? (it.value.hecho ? { texto: 'Recibido', clase: 'ok' } : { texto: 'Pendiente', clase: '' })
      : ESTADOS[it.value?.estado] || ESTADOS.pendiente));
    const pct = computed(() => (it.value?.esperado ? Math.min(100, (it.value.real / it.value.esperado) * 100) : it.value?.real ? 100 : 0));
    const resumen = computed(() => {
      const x = it.value;
      if (x.tipoItem === 'ingreso') return x.hecho ? `Se esperaban ${fmt(x.esperado)}.` : `Se esperan ${fmt(x.esperado)} el ${fechaCorta(x.fecha)}.`;
      if (x.estado === 'omitida') return 'Este mes no se paga.';
      if (x.estado === 'parcial' || x.estado === 'pendiente') return `Quedan ${fmt(x.queda)}.`;
      if (x.estado === 'excedido') return `${fmt(x.real - x.esperado)} más de lo previsto.`;
      return x.sobrante > 0 ? `Cerrada con ${fmt(x.sobrante)} de sobra${x.acumula ? ', que pasan al mes siguiente' : ''}.` : 'Pagada completa.';
    });
    const subtitulo = (r, verbo) => {
      const partes = [];
      if (r.personaId) partes.push(`${verbo} ${nombrePersona(r.personaId)}`);
      if (r.creadoPor && r.creadoPor !== r.personaId) partes.push(`anotó ${nombrePersona(r.creadoPor)}`);
      partes.push(nombreCuenta(r.cuentaId));
      return partes.join(' · ');
    };
    // Filas de lo registrado: movimientos, pagos recibidos o descuentos de planilla.
    const registros = computed(() => {
      const x = it.value;
      if (!x) return [];
      if (x.tipoItem === 'ingreso') {
        return x.recibos.map((r) => {
          const e = estadoRecibo(r);
          const falta = e.pendientes === 1 ? 'falta 1 deducción' : `faltan ${e.pendientes} deducciones`;
          return { id: r.id, fecha: r.fecha, monto: r.neto, texto: e.pendientes ? `${falta} · ${nombreCuenta(r.cuentaId)}` : subtitulo(r, 'recibió'), abrir: () => editarRecibo(r) };
        });
      }
      return x.pagos.map((p) => {
        if (p.neto === undefined) return { id: p.id, fecha: p.fecha, monto: p.monto, cierra: p.cierra, texto: subtitulo(p, 'pagó'), abrir: () => editarMovimiento(p) };
        const descontado = (p.deducciones || []).filter((d) => !d.noAplica && d.prestamoId === x.prestamo?.id).reduce((a, d) => a + (Number(d.monto) || 0), 0);
        return { id: p.id, fecha: p.fecha, monto: descontado, texto: `descontado de ${buscar('ingresos', p.ingresoId)?.nombre || 'un salario'}`, abrir: () => editarRecibo(p) };
      });
    });
    const faltanDeducciones = computed(() => it.value?.tipoItem === 'ingreso' && it.value.recibos.some((r) => estadoRecibo(r).pendientes));
    const completar = () => completarDeducciones(it.value.recibos.find((r) => estadoRecibo(r).pendientes));
    const puedeRegistrar = computed(() => it.value && !it.value.planilla && (it.value.tipoItem === 'ingreso' ? !it.value.recibos.length : it.value.estado !== 'omitida'));
    const textoEditar = computed(() => ({ partida: 'Editar partida', prestamo: 'Editar préstamo', ingreso: 'Editar ingreso' })[it.value?.tipoItem]);

    function registrar() {
      const x = it.value;
      if (x.tipoItem === 'ingreso') return registrarRecibo(x);
      abrirModal(`Registrar: ${x.nombre}`, MovimientoForm, { inicial: movimientoParaItem(x, props.periodo, { hoy: store.hoy, monto: x.forma === 'abonos' ? null : undefined }), sugerirMontos: x.forma === 'abonos' });
    }
    function cerrarPartida() {
      if (cerrarPartidaDelMes(it.value, props.periodo)) emit('listo');
    }
    const solo = () => abrirModal(`${it.value.partida.nombre}: solo ${nombrePeriodo(props.periodo)}`, AjusteMesForm, { partidaId: it.value.partida.id, periodo: props.periodo });
    function editarPlantilla() {
      const x = it.value;
      if (x.tipoItem === 'partida') editarPartida(x.partida);
      else if (x.tipoItem === 'prestamo') editarPrestamo(x.prestamo);
      else editarIngreso(x.ingreso);
    }
    return {
      it, estado, pct, resumen, registros, faltanDeducciones, completar, puedeRegistrar, textoEditar, registrar, cerrarPartida, solo, editarPlantilla,
      fmt, fechaCorta, nombrePeriodo,
    };
  },
};

// Todo lo que se puede registrar en un mes: partidas, cuotas e ingresos (del hogar).
export function itemsDelMes(periodo) {
  const r = resumenMes(indice(), periodo);
  return [...r.ingresos, ...r.cuotas, ...r.partidas];
}

// ---------------------------------------------------------------- Atajos para abrirlos

export const nuevoMovimiento = (base = {}) =>
  abrirModal(base.tipo === 'ajuste' ? 'Ajustar saldo' : base.tipo === 'abono' ? 'Abono a capital' : 'Nuevo movimiento', MovimientoForm, { inicial: base });
export const editarMovimiento = (m) => (m.tipo === 'pago_tarjeta' ? editarPagoTarjeta(m) : abrirModal('Editar movimiento', MovimientoForm, { inicial: m }));
export const editarRecibo = (r) => abrirModal('Pago recibido', ReciboForm, { inicial: r });
export const registrarRecibo = (it) => abrirModal(`Registrar: ${it.nombre}`, ReciboForm, { inicial: reciboSugerido(indice(), it.ingreso, it.pago, { hoy: store.hoy }) });
export const completarDeducciones = (r) => abrirModal('Completar deducciones', ReciboForm, { inicial: r, soloPendientes: true });
export const editarDeduccion = (ingresoId, deduccionId) => abrirModal(deduccionId ? 'Editar deducción' : 'Nueva deducción', DeduccionForm, { ingresoId, deduccionId });

// "+ Quincena": el pago de salario sin registrar más cercano a hoy, con opción de elegir otro.
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

// Cierra una partida del mes marcando su último pago ("Cierra la partida").
export function cerrarPartidaDelMes(it, periodo, { avisar = true } = {}) {
  const ultimo = it.pagos[it.pagos.length - 1];
  if (!ultimo) return false;
  guardar('movimientos', { ...ultimo, cierra: true });
  if (avisar) {
    aviso(textoDePartida(it.partida.id, it.parte, periodo) || 'Partida cerrada.', 'ok', 5000, {
      texto: 'Deshacer', fn: () => guardar('movimientos', { ...buscar('movimientos', ultimo.id), cierra: false }),
    });
  }
  return true;
}

// Lo que quedó sin pagar pasa al mes siguiente: se cierra la partida y el mes siguiente
// sube en ese monto (si la partida acumula, el sobrante ya pasa solo).
export function pasarAlSiguiente(it, periodo) {
  const p = it.partida;
  const siguiente = sumarMeses(periodo, 1);
  if (!it.acumula) {
    const id = `${p.id}:${siguiente}`;
    const ajuste = buscar('ajustesPartida', id);
    const vigente = ajuste && !ajuste.borrado && !ajuste.omitir && hayValor(ajuste.monto);
    const base = vigente ? Number(ajuste.monto) : (partesDelMes(p, siguiente)[0]?.base || 0) / 100;
    guardar('ajustesPartida', { ...(ajuste || {}), id, partidaId: p.id, periodo: siguiente, omitir: false, monto: redondear(base + it.queda), borrado: false });
  }
  cerrarPartidaDelMes(it, periodo, { avisar: false });
  aviso(`${fmt(it.queda)} de ${p.nombre} pasan a ${nombrePeriodo(siguiente)}.`, 'ok', 5000);
}
export const abrirDetalle = (it, periodo) => abrirModal(`${it.nombre} · ${nombrePeriodo(periodo)}`, DetalleItem, { clave: it.clave, periodo });

// Toque en el círculo: lo fijo se registra al instante con el monto de siempre (con opción
// de deshacer); lo variable abre el formulario con el monto sugerido y "Cierra la partida"
// marcada; lo que se paga en abonos abre el formulario vacío con montos rápidos.
export function marcarItem(it, periodo) {
  if (it.tipoItem === 'tarjeta') return it.hecho ? abrirItem(it, periodo) : pagarTarjeta(it.tarjeta.id, { corte: it.corte });
  if (it.tipoItem === 'ingreso') return it.hecho ? abrirDetalle(it, periodo) : registrarRecibo(it);
  if (it.hecho || it.planilla) return abrirDetalle(it, periodo);
  const variable = it.forma === 'variable' || it.parte === 'pagar';
  if (it.forma === 'abonos' || variable || it.estado === 'parcial') {
    const inicial = movimientoParaItem(it, periodo, { hoy: store.hoy, monto: it.forma === 'abonos' ? null : it.queda, cierra: variable && it.tipoItem === 'partida' });
    return abrirModal(`Registrar: ${it.nombre}`, MovimientoForm, { inicial, sugerirMontos: it.forma === 'abonos' });
  }
  const m = guardar('movimientos', movimientoParaItem(it, periodo, { hoy: store.hoy }));
  aviso(`Registrado: ${it.nombre}, ${fmt(m.monto)}`, 'ok', 6000, { texto: 'Deshacer', fn: () => borrar('movimientos', m.id) });
}

// Toque en el nombre: el detalle del mes (pagos, "solo este mes", editar). Un ingreso sin
// nada recibido abre directo el formulario para registrarlo.
export function abrirItem(it, periodo) {
  if (it.tipoItem === 'tarjeta') {
    location.hash = `#/tarjeta/${it.tarjeta.id}/${it.corte}`;
    return undefined;
  }
  if (it.tipoItem === 'ingreso' && !it.recibos.length) return registrarRecibo(it);
  return abrirDetalle(it, periodo);
}

export const editarPartida = (p = {}) => abrirModal(p.id ? 'Editar partida' : 'Nueva partida', PartidaForm, { inicial: p });
export const editarIngreso = (i = {}) => abrirModal(i.id ? 'Editar ingreso' : 'Nuevo ingreso', IngresoForm, { inicial: i });
export const editarPrestamo = (p = {}) => abrirModal(p.id ? 'Editar préstamo' : 'Nuevo préstamo', PrestamoForm, { inicial: p });
export const editarCuenta = (c = {}) => (c.tipo === 'tarjeta' ? editarTarjeta(c) : abrirModal(c.id ? 'Editar cuenta' : 'Nueva cuenta', CuentaForm, { inicial: c }));
export const editarPersona = (p = {}) => abrirModal(p.id ? 'Editar persona' : 'Nueva persona', PersonaForm, { inicial: p });
export const editarGrupo = (g = {}) => abrirModal(g.id ? 'Editar grupo' : 'Nuevo grupo', GrupoForm, { inicial: g });
export const editarCategoria = (c = {}) => abrirModal(c.id ? 'Editar categoría' : 'Nueva categoría', CategoriaForm, { inicial: c });
export const cambiarSoloEsteMes = (partida, periodo) => abrirModal(`${partida.nombre}: solo ${nombrePeriodo(periodo)}`, AjusteMesForm, { partidaId: partida.id, periodo });
