// Formulario de un movimiento: gasto, ingreso, transferencia, abono a capital y ajuste de saldo.
// Es el que más se usa (el botón +) y el que más sabe: partidas del mes, comercios, compras a
// cuotas y en dólares. Los de tarjeta están en formularios-tarjetas.js.
import {
  store, guardar, indice, personas, cuentas, cuentasDinero, tarjetas, comercios, categoriasPorGrupo, vivos, buscar,
  nombreCuenta, fmt, fmtMoneda, simboloDe, monedaDeCuenta,
} from '../store.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { partidaActivaEn } from '../core/presupuesto.js';
import { saldosCuentas } from '../core/reportes.js';
import { parteDe } from '../core/asientos.js';
import { corteDe, corteSiguiente, cuotasDeCompra, TIPOS_FINANCIAMIENTO } from '../core/tarjetas.js';
import { hoy, periodoDe, nombrePeriodo, fechaCorta, sumarMeses, redondear, slug } from '../core/util.js';
import { copia, hayValor, opcionesCategoria, usarFormulario, estadoSinEste, textoDePartida } from './formulario-base.js';
import { pagarTarjeta } from './formularios-tarjetas.js';
import { nuevaQuincena } from './formularios-nomina.js';

const { reactive, ref, computed, watch, nextTick } = Vue;

const TIPOS_CORTOS = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferir', abono: 'Abono', ajuste: 'Ajuste' };

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
      <input v-model="comercioTexto" maxlength="60" autocomplete="off" placeholder="Opcional: dónde se compró" @input="aplicarComercio"></label>
    <div v-if="usaComercio && sugerenciasComercio.length" class="chips-filtro" style="margin-top: -4px" role="group" aria-label="Comercios guardados">
      <button v-for="x in sugerenciasComercio" :key="x.id" type="button" class="chip-filtro" @click="elegirComercio(x)">{{ x.nombre }}</button>
    </div>

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
    // Comercios guardados como botones (la lista del navegador no se ve en todos los celulares): con el
    // campo vacío, los más usados; al escribir, los que empiezan así y después los que lo contienen.
    const sugerenciasComercio = computed(() => {
      const texto = slug(comercioTexto.value);
      const lista = comercios();
      if (!texto) return lista.slice(0, 8);
      if (comercioPorNombre(comercioTexto.value)) return [];
      const empiezan = lista.filter((x) => slug(x.nombre).startsWith(texto));
      const contienen = lista.filter((x) => !slug(x.nombre).startsWith(texto) && slug(x.nombre).includes(texto));
      return [...empiezan, ...contienen].slice(0, 8);
    });
    function elegirComercio(x) {
      comercioTexto.value = x.nombre;
      aplicarComercio();
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
      usaComercio, comercioTexto, aplicarComercio, sugerenciasComercio, elegirComercio, puedeCuotas, aCuotas, q, cortesPosibles, vistaCuotas, tiposFinanciamiento: TIPOS_FINANCIAMIENTO,
      saldoSinEste, saldoReal, diferencia, etiquetaCuenta, enviar,
      fmt, fmtMoneda, simboloDe, nombreCuenta, nombrePeriodo, tipos: TIPOS_CORTOS, nombresTipo: TIPOS_MOVIMIENTO,
      listaPersonas: computed(personas), listaPrestamos: computed(() => vivos('prestamos')),
      categoriasGasto: computed(() => categoriasPorGrupo('gasto')), categoriasIngreso: computed(() => categoriasPorGrupo('ingreso')), ...f,
    };
  },
};
