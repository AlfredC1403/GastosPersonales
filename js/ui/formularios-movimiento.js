// Formulario de un movimiento: gasto, ingreso, transferencia, abono a capital y ajuste de saldo.
// Es el que más se usa (el botón +) y el que más sabe: partidas del mes, comercios, compras a
// cuotas y en dólares. Los de tarjeta están en formularios-tarjetas.js.
import {
  store, guardar, indice, personas, cuentas, cuentasDinero, tarjetas, comercios, categoriasPorGrupo, vivos, buscar,
  nombreCuenta, nombrePartida, fmt, fmtMoneda, simboloDe, monedaDeCuenta, confirmar, nombrePersona,
} from '../store.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { partidaActivaEn } from '../core/presupuesto.js';
import { saldosCuentas } from '../core/reportes.js';
import { parteDe } from '../core/asientos.js';
import { periodoDe, nombrePeriodo, sumarMeses, redondear, slug } from '../core/util.js';
import { limpiar as limpiarEtiquetas, sugerir as sugerirEtiquetas } from '../core/etiquetas.js';
import { parecidosA } from '../core/duplicados.js';
import { copia, hayValor, opcionesCategoria, usarFormulario, estadoSinEste, textoDePartida } from './formulario-base.js';
import { CampoEtiquetas, Icono, dictado } from './componentes.js';
import { pagarTarjeta } from './formularios-tarjetas.js';
import { nuevaQuincena } from './formularios-nomina.js';
import { nuevoFinanciamiento } from './formularios-financiamientos.js';

const { reactive, ref, computed, watch, nextTick } = Vue;

const TIPOS_CORTOS = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferir', abono: 'Abono', ajuste: 'Ajuste' };

// ---------------------------------------------------------------- Movimiento

export const MovimientoForm = {
  components: { CampoEtiquetas, Icono },
  props: { inicial: Object, sugerirMontos: Boolean },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar(false)">
    <template v-if="!existe && !tipoFijo">
      <div v-if="!pegando" class="botones" style="margin-bottom: 2px">
        <button type="button" class="btn-enlace" @click="abrirPegado"><icono n="pegar" :t="15"/> Pegar el aviso del banco</button>
      </div>
      <div v-else class="caja-corte">
        <label class="campo"><span>Pega aquí el SMS o la notificación del banco</span>
          <textarea ref="campoAviso" v-model="textoAviso" rows="3" placeholder="BAC Credomatic le informa: Compra por L1,234.56 en…"></textarea></label>
        <p v-if="leido" class="nota chica">{{ textoLeido }}</p>
        <p v-else-if="textoAviso.trim()" class="nota chica">De ahí no se saca un movimiento. Revisa que el texto traiga el monto.</p>
        <div class="botones">
          <button type="button" class="btn" @click="pegando = false">Cancelar</button>
          <button type="button" class="btn primario" :disabled="!leido" @click="aplicarAviso">Usar estos datos</button>
        </div>
      </div>
    </template>
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
        <label class="campo"><span>Monto{{ monedaOrigen === 'USD' ? ' (' + simboloDe('USD') + ')' : '' }}</span>
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

    <p v-if="esTarjetaConCuotas" class="nota chica">¿Es a cuotas? Se registra en
      <a href="#/financiamientos">Financiamientos</a>, donde queda con su plan y se puede seguir.
      <button type="button" class="btn-link" @click="pasarAFinanciamiento">Registrarlo ahí</button></p>

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

    <p v-if="enPartida && monedaOrigen !== monedaPartida" class="nota chica">{{ nombrePartida(m.partidaId) }} se lleva en {{ simboloDe(monedaPartida) }}: este pago se le abona con la tasa de referencia.</p>
    <label v-if="enPartida && monedaOrigen === monedaPartida && estado && m.monto > 0 && m.monto < estado.quedaSinEste" class="casilla">
      <input v-model="m.cierra" type="checkbox"> Cierra la partida: sobran {{ fmtMoneda(estado.quedaSinEste - m.monto, monedaPartida) }}{{ estado.acumula ? ' para el mes siguiente' : '' }}
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

    <label class="campo"><span>Nota</span>
      <span class="con-sufijo">
        <input v-model.trim="m.nota" type="text" maxlength="140" placeholder="Opcional">
        <button v-if="hayDictado" type="button" class="btn-icono" :class="{ activo: dictando }"
                :aria-label="dictando ? 'Dejar de dictar' : 'Dictar la nota'" @click="alternarDictado"><icono n="microfono" :t="18"/></button>
      </span></label>
    <campo-etiquetas v-if="usaEtiquetas" v-model="m.etiquetas" :sugerencias="sugerenciasEtiqueta"/>

    <div v-if="parecidos.length" class="caja-ambar" role="status">
      <p>{{ textoParecidos }}</p>
      <ul class="lista">
        <li v-for="x in parecidos" :key="x.movimiento.id" class="fila compacta">
          <div class="fila-info">
            <span style="font-size: 0.9rem">{{ tituloDe(x.movimiento) }}</span>
            <span class="fila-sub">{{ subtituloDe(x.movimiento) }}</span>
          </div>
          <span class="monto">{{ fmtMoneda(x.movimiento.monto, x.movimiento.moneda) }}</span>
        </li>
      </ul>
    </div>

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
      etiquetas: [],
      ...original,
    });
    if (!Array.isArray(m.etiquetas)) m.etiquetas = [];
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
    // Moneda en la que se mide la partida: una suscripción en dólares se compara en dólares.
    const monedaPartida = computed(() => (partida.value?.moneda === 'USD' ? 'USD' : 'L'));
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
      return it.quedaSinEste > 0 ? `${p.nombre} · quedan ${fmtMoneda(it.quedaSinEste, it.moneda)}` : `${p.nombre} · completa`;
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
      if (!enPartida.value || !it || !abonos || !(it.quedaSinEste > 0) || monedaOrigen.value !== monedaPartida.value) return [];
      const sueltos = monedaOrigen.value === 'USD' ? [5, 10] : [1000, 2000];
      const f = (v) => fmtMoneda(v, monedaOrigen.value);
      const lista = sueltos.filter((v) => v < it.quedaSinEste).map((v) => ({ texto: f(v).replace('.00', ''), valor: v }));
      lista.push({ texto: `Lo que queda (${f(it.quedaSinEste)})`, valor: it.quedaSinEste });
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

    // Los financiamientos (compras a cuotas, intra y extra) tienen su propia pantalla y su
    // formulario: aquí solo se ofrece el paso, con lo que ya se haya escrito.
    const esTarjetaConCuotas = computed(() => m.tipo === 'gasto' && origenEsTarjeta.value && monedaOrigen.value === 'L' && !esCuota.value && !m.parte);
    function pasarAFinanciamiento() {
      const { cuentaId, monto, fecha, categoriaId, nota, personaId } = m;
      nuevoFinanciamiento({ cuentaId, monto: Number(monto) > 0 ? monto : null, fecha, categoriaId, nota, personaId });
    }

    // ---------------------------------------------------------- Etiquetas
    // Solo donde tienen sentido: una cuota de préstamo o la parte de un pago anual ya vienen
    // clasificadas por lo que las generó.
    const usaEtiquetas = computed(() => !tipoFijo.value);
    const sugerenciasEtiqueta = computed(() => sugerirEtiquetas(store.doc, '', { excluir: m.etiquetas }));

    // ---------------------------------------------------------- Movimientos repetidos
    // Dos personas anotando el mismo pago del súper deja el mes con plata que nadie gastó. Aquí
    // no se impide nada: se muestra lo que ya existe y la persona decide.
    const parecidos = computed(() => {
      if (original.id || !(Number(m.monto) > 0) || !m.fecha || m.tipo === 'ajuste') return [];
      return parecidosA(indice(), { ...m, monto: Number(m.monto), moneda: monedaOrigen.value }).slice(0, 3);
    });
    const textoParecidos = computed(() => (parecidos.value.length === 1
      ? 'Ya hay un movimiento muy parecido. Revisa que no sea el mismo pago anotado dos veces.'
      : `Ya hay ${parecidos.value.length} movimientos muy parecidos. Revisa que no sea el mismo pago anotado dos veces.`));
    const tituloDe = (x) => x.nota || buscar('comercios', x.comercioId)?.nombre || nombrePartida(x.partidaId) || nombreCuenta(x.cuentaId);
    const subtituloDe = (x) => [x.fecha, nombreCuenta(x.cuentaId), x.creadoPor ? `anotado por ${nombrePersona(x.creadoPor)}` : ''].filter(Boolean).join(' · ');

    // ---------------------------------------------------------- Pegar el aviso del banco
    const pegando = ref(false);
    const textoAviso = ref('');
    const campoAviso = ref(null);
    // El lector de avisos se trae solo cuando se usa: no hace falta para abrir la app.
    const lector = ref(null);
    const leido = computed(() => (lector.value && textoAviso.value.trim() ? lector.value.interpretarAviso(textoAviso.value, { hoy: store.hoy }) : null));
    const textoLeido = computed(() => {
      const a = leido.value;
      if (!a) return '';
      const cuenta = lector.value.cuentaDelAviso(indice(), a);
      const partes = [`${fmtMoneda(a.monto, a.moneda)}`];
      if (a.comercio) partes.push(a.comercio);
      if (cuenta) partes.push(cuenta.nombre);
      else if (a.ultimos4) partes.push(`tarjeta ${a.ultimos4} (no está en el hogar)`);
      if (a.fechaDelAviso) partes.push(a.fechaDelAviso);
      return `${a.banco || 'Aviso'}: ${partes.join(' · ')}.`;
    });
    async function abrirPegado() {
      pegando.value = true;
      if (!lector.value) {
        try {
          lector.value = await import('../core/avisos-banco.js');
        } catch {
          pegando.value = false;
          return;
        }
      }
      await nextTick();
      campoAviso.value?.focus();
      // En los navegadores que lo permiten, el portapapeles se lee solo: un toque menos.
      try {
        const texto = await navigator.clipboard?.readText?.();
        if (texto && !textoAviso.value && lector.value.interpretarAviso(texto, { hoy: store.hoy })) textoAviso.value = texto;
      } catch { /* sin permiso: se pega a mano */ }
    }
    function aplicarAviso() {
      const a = leido.value;
      if (!a) return;
      const ix = indice();
      m.tipo = a.tipo === 'retiro' ? 'gasto' : a.tipo === 'pago_tarjeta' ? 'gasto' : a.tipo;
      m.monto = a.monto;
      m.fecha = a.fecha;
      const cuenta = lector.value.cuentaDelAviso(ix, a);
      if (cuenta) {
        m.cuentaId = cuenta.id;
        if (cuenta.tipo === 'tarjeta') m.moneda = a.moneda;
      }
      const comercio = lector.value.comercioDelAviso(ix, a);
      if (comercio) {
        comercioTexto.value = comercio.nombre;
        aplicarComercio();
      } else if (a.comercio) {
        comercioTexto.value = a.comercio;
      }
      if (!m.nota && !comercio && !a.comercio) m.nota = a.banco ? `Aviso de ${a.banco}` : '';
      pegando.value = false;
      textoAviso.value = '';
    }

    // ---------------------------------------------------------- Dictado de la nota
    const dictando = ref(false);
    const voz = dictado({
      alTexto: (texto) => { m.nota = (m.nota ? `${m.nota} ${texto}` : texto).slice(0, 140); },
      alTerminar: () => { dictando.value = false; },
    });
    function alternarDictado() {
      if (dictando.value) {
        voz.parar();
        dictando.value = false;
        return;
      }
      dictando.value = true;
      voz.empezar();
    }

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
      r.cierra = enPartida.value && r.moneda === monedaPartida.value && !!r.cierra && !!estado.value && r.monto < estado.value.quedaSinEste;
      if (r.tipo === 'ajuste') r.personaId = null;
      // Un financiamiento no se edita aquí (editarMovimiento lo manda a su formulario), pero si
      // llegara un registro con cuotas, se conservan tal cual en vez de deshacerlo.
      r.cuotas = original.cuotas || null;
      r.comercioId = usaComercio.value ? comercioDe(r) : null;
      r.etiquetas = usaEtiquetas.value ? limpiarEtiquetas(m.etiquetas) : (original.etiquetas || []);

      const mensaje = r.partidaId
        ? (g) => `${f.existe ? 'Cambios guardados.' : 'Guardado.'} ${textoDePartida(g.partidaId, parteDe(g), g.periodo)}`
        : undefined;
      const guardarYa = () => {
        f.terminar(r, { deshacer: true, cerrar: !otro, mensaje });
        if (!otro) return;
        Object.assign(m, { monto: null, nota: '', partidaId: null, cierra: false, categoriaId: null, montoDestino: null, tasa: null, comercioId: null, etiquetas: [] });
        comercioTexto.value = '';
        nextTick(() => campoMonto.value?.focus());
      };

      // Un parecido muy seguro se pregunta antes de guardar; uno flojo ya se está viendo arriba.
      const repetido = parecidos.value.find((x) => x.confianza >= 85);
      if (!repetido) return guardarYa();
      return confirmar(
        `Ya hay uno casi igual: ${tituloDe(repetido.movimiento)}, ${fmtMoneda(repetido.movimiento.monto, repetido.movimiento.moneda)} el ${repetido.movimiento.fecha}.`,
        { titulo: '¿Guardarlo igual?', aceptar: 'Guardar igual' },
      ).then((si) => si && guardarYa());
    }

    return {
      m, campoMonto, verMas, otroTipo, nuevaQuincena, periodoTocado, periodoMov, esCuota, tipoFijo, vinculado, enPartida, textoVinculo, estado, monedaPartida, partidasGasto, partidasAporte, opcionesPeriodo,
      listaMetas, esRetiroDeMeta,
      montosRapidos, listaOrigen, listaDestino, origenEsTarjeta, monedaOrigen, monedaDestino, monedasDistintas, hayTarjetas, pagoDeTarjeta,
      usaComercio, comercioTexto, aplicarComercio, sugerenciasComercio, elegirComercio, esTarjetaConCuotas, pasarAFinanciamiento,
      saldoSinEste, saldoReal, diferencia, etiquetaCuenta, enviar,
      usaEtiquetas, sugerenciasEtiqueta, parecidos, textoParecidos, tituloDe, subtituloDe,
      pegando, textoAviso, campoAviso, leido, textoLeido, abrirPegado, aplicarAviso,
      dictando, hayDictado: voz.hay, alternarDictado,
      fmt, fmtMoneda, simboloDe, nombreCuenta, nombrePartida, nombrePeriodo, tipos: TIPOS_CORTOS, nombresTipo: TIPOS_MOVIMIENTO,
      listaPersonas: computed(personas), listaPrestamos: computed(() => vivos('prestamos')),
      categoriasGasto: computed(() => categoriasPorGrupo('gasto')), categoriasIngreso: computed(() => categoriasPorGrupo('ingreso')), ...f,
    };
  },
};
