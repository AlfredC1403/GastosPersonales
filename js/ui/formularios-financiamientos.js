// Formulario de un financiamiento de tarjeta: intrafinanciamiento o extrafinanciamiento. Es el
// mismo registro que una compra a cuotas (un gasto con `cuotas` sobre una tarjeta), pero con los
// campos del financiamiento por delante y sin lo que aquí no viene al caso (partida, comercio, meta).
// Sirve también para registrar uno que ya venía empezado, diciendo por qué cuota va.
import { store, abrirModal, personas, tarjetas, categoriasPorGrupo, buscar, fmt, nombreCuenta } from '../store.js';
import { corteDe, corteSiguiente, cuotasDeCompra, cuotaSiguienteHoy, TIPOS_FINANCIAMIENTO, COBROS_CUOTA, cobroDeCuotas } from '../core/tarjetas.js';
import { hoy, periodoDe, nombrePeriodo, fechaCorta, fechaEnMes, sumarMeses, redondear } from '../core/util.js';
import { copia, PIE, opcionesCategoria, usarFormulario, textoDeCuotas, revisarFinanciamiento } from './formulario-base.js';

const { reactive, ref, computed, watch } = Vue;

export const FinanciamientoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="segmentos" role="group" aria-label="Tipo de financiamiento">
      <button v-for="(n, k) in tipos" :key="k" type="button" :class="{ activo: q.tipo === k }" :aria-pressed="q.tipo === k" @click="q.tipo = k">{{ n }}</button>
    </div>
    <p class="nota chica" style="margin-top: -4px">{{ q.tipo === 'extra'
      ? 'Crédito aparte, fuera del límite: no baja el disponible de la tarjeta.'
      : 'Dentro del límite: el monto completo baja el disponible, que se libera con cada cuota.' }}</p>

    <label class="campo"><span>Tarjeta</span>
      <select v-model="m.cuentaId" required>
        <option v-for="c in listaTarjetas" :key="c.id" :value="c.id">{{ c.nombre }}</option>
      </select></label>

    <div class="fila-campos">
      <label class="campo"><span>Monto financiado</span>
        <input ref="campoMonto" v-model.number="m.monto" type="number" inputmode="decimal" step="0.01" min="0" required></label>
      <label class="campo"><span>Fecha</span><input v-model="m.fecha" type="date" required></label>
    </div>

    <label class="campo"><span>En qué fue</span>
      <input v-model="m.nota" maxlength="80" placeholder="Por ejemplo: refrigeradora, viaje, deuda del carro"></label>
    <label class="campo"><span>Categoría del gasto</span>
      <select v-model="m.categoriaId">${opcionesCategoria('listaCategorias')}</select></label>
    <p class="nota chica" style="margin-top: -4px">El capital de cada cuota se anota en esta categoría. Los intereses y la comisión van a "Intereses y cargos de tarjeta".</p>

    <label class="campo"><span>Cuándo cae la cuota</span>
      <select v-model="q.cobro"><option v-for="(n, k) in cobros" :key="k" :value="k">{{ n }}</option></select></label>
    <p class="nota chica" style="margin-top: -4px">{{ q.cobro === 'dia'
      ? 'Cada cuota cae el mismo día del mes, aunque el corte de la tarjeta sea otro día.'
      : 'Cada cuota cae en el corte de la tarjeta.' }}</p>

    <div class="fila-campos">
      <label class="campo"><span>Cuotas</span><input v-model.number="q.n" type="number" inputmode="numeric" min="2" max="60" required></label>
      <label class="campo"><span>Primera cuota</span>
        <select v-model="q.primerCorte"><option v-for="c in cortesPosibles" :key="c.valor || 'fecha'" :value="c.valor">{{ c.texto }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Tasa anual (%)</span><input v-model.number="q.tasaAnual" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0 = tasa cero"></label>
      <label class="campo"><span>Cuota del banco (opcional)</span><input v-model.number="q.cuotaBanco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Sin la comisión"></label>
    </div>

    <div class="fila-campos">
      <label class="campo"><span>Comisión</span><input v-model.number="q.comision.valor" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0 si no cobran"></label>
      <label class="campo" style="flex: 0 1 96px"><span>En</span>
        <select v-model="q.comision.unidad" aria-label="La comisión es"><option value="porcentaje">%</option><option value="monto">{{ simbolo }}</option></select></label>
      <label class="campo"><span>Se cobra</span>
        <select v-model="q.comision.cobro"><option value="unica">Una vez</option><option value="mensual">En cada cuota</option></select></label>
    </div>
    <template v-if="q.comision.valor > 0">
      <label class="casilla"><input v-model="q.comision.comoGasto" type="checkbox">
        Registrar la comisión como gasto de {{ nombrePeriodo(periodo) }}</label>
      <p class="nota chica" style="margin-top: -4px">{{ q.comision.comoGasto
        ? 'Se anota ya, en la fecha del financiamiento, y suma a la deuda de la tarjeta.'
        : 'Viaja en la cuota: no se anota nada hasta que la tarjeta haga corte.' }}</p>
    </template>

    <label class="campo"><span>¿Ya venía empezado? Por qué cuota va</span>
      <input v-model.number="q.desdeCuota" type="number" inputmode="numeric" min="1" :max="q.n || 60" placeholder="1 = desde el principio"></label>
    <p v-if="q.desdeCuota > 1" class="nota chica" style="margin-top: -4px">Las cuotas 1 a {{ q.desdeCuota - 1 }} se dan por pagadas antes de usar la app: no suman a la deuda ni al gasto de ningún mes.</p>
    <p v-if="avisoCuota" class="nota" style="margin-top: -4px; color: var(--ambar-tinta); background: var(--ambar-suave); padding: 8px 10px; border-radius: var(--radio)">{{ avisoCuota }}</p>

    <label v-if="existe" class="campo"><span>Si se canceló antes, ¿cuándo? (opcional)</span><input v-model="q.canceladaEl" type="date"></label>

    <label class="campo"><span>Quién lo saca</span>
      <select v-model="m.personaId"><option :value="null">El hogar</option>
        <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>

    <p v-if="vista" class="nota">{{ vista }}</p>
    <p v-else class="nota chica">Llena el monto y las cuotas para ver el plan.</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const primeraTarjeta = tarjetas()[0]?.id || null;
    const m = reactive({
      tipo: 'gasto', monto: null, fecha: hoy(), cuentaId: primeraTarjeta, categoriaId: null, nota: '', personaId: null, ...original,
    });
    const campoMonto = ref(null);
    const q = reactive({
      n: 12, tipo: 'intra', tasaAnual: null, cuotaBanco: null, primerCorte: null, canceladaEl: null, desdeCuota: 1,
      // Lo que suele hacer el banco de esa tarjeta; se puede cambiar aquí para este financiamiento.
      cobro: buscar('cuentas', original.cuentaId || primeraTarjeta)?.tarjeta?.cobroCuotas === 'dia' ? 'dia' : 'corte',
      ...(original.cuotas || {}),
    });
    q.desdeCuota = Number(q.desdeCuota) || 1;
    q.comision = { valor: null, unidad: 'porcentaje', cobro: 'unica', comoGasto: false, ...(original.cuotas?.comision || {}) };

    const f = usarFormulario('movimientos', original, emit, { que: 'este financiamiento' });
    const listaTarjetas = computed(tarjetas);
    const listaPersonas = computed(personas);
    const listaCategorias = computed(() => categoriasPorGrupo('gasto'));
    const periodo = computed(() => periodoDe(m.fecha || hoy()));

    // Con cobro en el corte se elige entre el corte de la fecha y el siguiente; con cobro por día,
    // entre el mismo mes del financiamiento y el siguiente (unos bancos cobran ya, otros al mes).
    const cortesPosibles = computed(() => {
      const cuenta = buscar('cuentas', m.cuentaId);
      if (!cuenta?.tarjeta || !m.fecha) return [{ valor: null, texto: 'En el primer cobro' }];
      if (cobroDeCuotas(q) === 'dia') {
        const dia = Number(m.fecha.slice(8, 10));
        const siguiente = fechaEnMes(sumarMeses(periodoDe(m.fecha), 1), dia);
        const lista = [{ valor: null, texto: `El ${fechaCorta(m.fecha)} (este mes)` }, { valor: siguiente, texto: `El ${fechaCorta(siguiente)} (mes siguiente)` }];
        if (q.primerCorte && ![null, siguiente].includes(q.primerCorte)) lista.push({ valor: q.primerCorte, texto: `El ${fechaCorta(q.primerCorte)}` });
        return lista;
      }
      const primero = corteDe(cuenta, m.fecha);
      const siguiente = corteSiguiente(cuenta, primero);
      const lista = [{ valor: null, texto: `Corte del ${fechaCorta(primero)}` }, { valor: siguiente, texto: `Corte del ${fechaCorta(siguiente)}` }];
      if (q.primerCorte && ![null, siguiente].includes(q.primerCorte)) lista.push({ valor: q.primerCorte, texto: `Corte del ${fechaCorta(corteDe(cuenta, q.primerCorte))}` });
      return lista;
    });

    watch(() => [m.cuentaId, q.cobro], ([cuentaId], [antesCuenta]) => {
      q.primerCorte = null; // la fecha elegida era de la otra tarjeta o del otro modo de cobro
      if (cuentaId !== antesCuenta) q.cobro = buscar('cuentas', cuentaId)?.tarjeta?.cobroCuotas === 'dia' ? 'dia' : 'corte';
    });

    const cuotas = computed(() => {
      const cuenta = buscar('cuentas', m.cuentaId);
      const n = Math.round(Number(q.n));
      if (!cuenta?.tarjeta || !(Number(m.monto) > 0) || !(n >= 2) || !m.fecha) return [];
      return cuotasDeCompra(cuenta, { monto: m.monto, fecha: m.fecha, cuotas: { ...q, n } });
    });
    const vista = computed(() => textoDeCuotas(cuotas.value, q));

    // ¿La cuota que se escribió cuadra con las fechas? Si no, se dice, porque casi siempre significa
    // que la fecha del financiamiento no es la del primer cobro.
    const cuotaDeHoy = computed(() => {
      const cuenta = buscar('cuentas', m.cuentaId);
      const n = Math.round(Number(q.n));
      if (!cuenta?.tarjeta || !(Number(m.monto) > 0) || !(n >= 2) || !m.fecha) return null;
      return cuotaSiguienteHoy(cuenta, { monto: m.monto, fecha: m.fecha, cuotas: { ...q, n } }, store.hoy);
    });
    const avisoCuota = computed(() => {
      const esperada = cuotaDeHoy.value;
      const puesta = Math.round(Number(q.desdeCuota) || 1);
      if (!esperada || puesta === esperada) return '';
      return `Por la fecha y el corte de la tarjeta, hoy tocaría la cuota ${esperada} de ${Math.round(Number(q.n))}. `
        + 'Revisa la fecha del financiamiento o el número de cuota.';
    });

    function enviar() {
      f.error.value = '';
      if (!m.cuentaId) return (f.error.value = 'Elige la tarjeta.');
      if (!(Number(m.monto) > 0)) return (f.error.value = 'Escribe un monto mayor que cero.');
      if (!m.fecha) return (f.error.value = 'Elige la fecha.');
      const motivo = revisarFinanciamiento({ monto: m.monto, fecha: m.fecha, q });
      if (motivo) return (f.error.value = motivo);

      const primera = cuotas.value[0];
      return f.terminar({
        ...m,
        tipo: 'gasto',
        monto: redondear(Number(m.monto)),
        moneda: 'L', // los financiamientos se pactan en lempiras
        periodo: periodo.value,
        nota: m.nota.trim(),
        categoriaId: m.categoriaId || null,
        personaId: m.personaId || null,
        // Esto no aplica a un financiamiento: si el registro venía de otro tipo de movimiento, se limpia.
        // La partida, la meta y el comercio se dejan como estaban: una compra a cuotas puede estar
        // ligada a una partida del presupuesto (cada cuota cuenta en su mes) y tener su comercio.
        prestamoId: null, cuentaDestinoId: null, montoDestino: null, tasa: null, cierra: false,
        cuotas: {
          n: Math.round(Number(q.n)),
          tipo: q.tipo === 'extra' ? 'extra' : 'intra',
          tasaAnual: Number(q.tasaAnual) > 0 ? Number(q.tasaAnual) : null,
          cuotaBanco: Number(q.cuotaBanco) > 0 ? redondear(Number(q.cuotaBanco)) : null,
          primerCorte: q.primerCorte || null,
          cobro: cobroDeCuotas(q),
          canceladaEl: q.canceladaEl || null,
          desdeCuota: Number(q.desdeCuota) > 1 ? Math.round(Number(q.desdeCuota)) : 1,
          comision: Number(q.comision.valor) > 0
            ? {
              valor: q.comision.unidad === 'monto' ? redondear(Number(q.comision.valor)) : Number(q.comision.valor),
              unidad: q.comision.unidad, cobro: q.comision.cobro, comoGasto: !!q.comision.comoGasto,
            }
            : null,
        },
      }, {
        // Lo que más confunde es no saber cuándo empieza a cobrarse: el aviso lo dice.
        mensaje: primera
          ? `Guardado. La primera cuota que se registra es ${fmt(primera.c / 100)}, en el corte del ${fechaCorta(primera.fecha)}.`
          : 'Guardado.',
        deshacer: true,
      });
    }

    return {
      m, q, campoMonto, listaTarjetas, listaPersonas, listaCategorias, cortesPosibles, vista, periodo, enviar, avisoCuota,
      store, tipos: TIPOS_FINANCIAMIENTO, cobros: COBROS_CUOTA, simbolo: store.doc.config.moneda || 'L', nombrePeriodo, nombreCuenta,
      error: f.error, existe: f.existe, auditoria: f.auditoria, eliminar: f.eliminar,
    };
  },
};

export const nuevoFinanciamiento = (base = {}) => abrirModal('Nuevo financiamiento', FinanciamientoForm, { inicial: base });
export const editarFinanciamiento = (m) => abrirModal('Editar financiamiento', FinanciamientoForm, { inicial: m });
