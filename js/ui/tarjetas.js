// Tarjetas de crédito: la lista con lo que se debe y el estado de cuenta de cada corte.
import { store, fmt, fmtMoneda, indice, tarjetas, buscar, filtro, personaFiltro, nombrePersona, nombreCategoria, nombreCuenta } from '../store.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { coincidePersona } from '../core/filtro.js';
import { resumenTarjeta, estadoCiclo, corteDe, corteSiguiente, corteAnterior, fechaSaldoDe, proximoCobro, TIPOS_CARGO, TIPOS_FINANCIAMIENTO } from '../core/tarjetas.js';
import { fechaCorta, nombrePeriodo, nombreMes, periodoDe, sumarDias, sumarMeses, aCentavos, deCentavos } from '../core/util.js';
import { Icono } from './componentes.js';
import { nuevoMovimiento, editarMovimiento } from './formularios.js';
import { editarTarjeta, pagarTarjeta, dosMonedas, formatoTasa } from './formularios-tarjetas.js';

const { ref, computed, watch } = Vue;

const SITUACION = {
  abierto: { texto: 'Corte abierto', clase: 'acento' },
  pendiente: { texto: 'Por pagar', clase: '' },
  parcial: { texto: 'Pago parcial', clase: 'aviso' },
  vencido: { texto: 'Vencido', clase: 'mal' },
  pagado: { texto: 'Pagado', clase: 'ok' },
};

const dias = (desde, hasta) => {
  const f = (x) => Date.UTC(...x.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((f(hasta) - f(desde)) / 86400000);
};
// "hoy", "mañana", "en 5 días", "hace 2 días"
export function cuandoVence(limite, hoy) {
  const n = dias(hoy, limite);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n > 1) return `en ${n} días`;
  return n === -1 ? 'ayer' : `hace ${-n} días`;
}

// Lo disponible: el mismo límite visto en las dos monedas ("L40,350.00 o US$1,522.64").
const textoLibre = (r) => [r.disponible.L !== null ? fmtMoneda(r.disponible.L, 'L') : '', r.disponible.USD !== null ? fmtMoneda(r.disponible.USD, 'USD') : '']
  .filter(Boolean).join(' o ');

// Lo que hay que mostrar de una tarjeta: su deuda y el pago que toca (o el corte abierto).
function datosTarjeta(ix, c, hoy) {
  const r = resumenTarjeta(ix, c);
  const t = c.tarjeta || {};
  const u = r.ultimo;
  const vigente = !u.antesDelSaldo && (u.situacion !== 'pagado' || hoy <= u.limite) && (u.alCorte.L > 0 || u.alCorte.USD > 0);
  const e = vigente ? u : r.abierto;
  let pago;
  if (!vigente) pago = r.abierto.alCorte.L > 0 || r.abierto.alCorte.USD > 0 ? `Corte del ${fechaCorta(e.corte)}: van ${dosMonedas(e.alCorte)}.` : `Próximo corte: ${fechaCorta(e.corte)}.`;
  else if (e.situacion === 'pagado') pago = `Corte del ${fechaCorta(e.corte)} pagado${e.tarde ? ' (tarde)' : ''}.`;
  else if (e.situacion === 'vencido') pago = `Faltan ${dosMonedas(e.pendiente)} del corte del ${fechaCorta(e.corte)}: venció ${cuandoVence(e.limite, hoy)}.`;
  else pago = `${e.situacion === 'parcial' ? 'Faltan' : 'Pago de contado:'} ${dosMonedas(e.pendiente)}, vence ${cuandoVence(e.limite, hoy)} (${fechaCorta(e.limite)}).`;
  return {
    c, r, e, vigente, pago, usado: r.usoPct, situacion: SITUACION[e.situacion], debe: r.deuda.L > 0 || r.deuda.USD > 0,
    usaDolares: r.deuda.USD !== 0 || Number(t.limite?.USD) > 0 || Number(t.saldoInicial?.USD) > 0,
    detalle: [t.banco, t.ultimos4 ? `•••• ${t.ultimos4}` : '', `corte el ${t.diaCorte >= 31 ? 'último día' : t.diaCorte}`, `pago hasta el ${t.diaPago}`].filter(Boolean).join(' · '),
  };
}

export const VistaTarjetas = {
  components: { Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Deuda en tarjetas</p>
      <p class="hero-num">{{ hayDolares ? '≈ ' : '' }}{{ fmt(totalEnL) }}</p>
      <p class="hero-texto">{{ textoTotal }}</p>
    </div>

    <article v-for="x in lista" :key="x.c.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ x.c.nombre }}</h2>
        <span class="chip">{{ x.c.titularId ? nombrePersona(x.c.titularId) : 'Hogar' }}</span>
      </div>
      <p class="nota chica">{{ x.detalle }}</p>
      <div class="deuda-tarjeta">
        <div><span class="etiqueta">Lempiras</span><span class="hero-num chico" :class="{ positivo: x.r.deuda.L < 0 }">{{ fmtMoneda(x.r.deuda.L, 'L') }}</span></div>
        <div v-if="x.usaDolares"><span class="etiqueta">Dólares</span><span class="hero-num chico" :class="{ positivo: x.r.deuda.USD < 0 }">{{ fmtMoneda(x.r.deuda.USD, 'USD') }}</span></div>
      </div>
      <div v-if="x.usado !== null" class="progreso acento" style="margin-top: 12px" role="img" :aria-label="x.usado + '% del límite usado'"><div :style="{ width: x.usado + '%' }"></div></div>
      <p v-if="textoDisponible(x)" class="nota chica" style="margin-top: 6px">{{ textoDisponible(x) }}</p>
      <div class="caja-corte" style="margin-top: 12px">
        <div style="display: flex; gap: 8px; align-items: baseline">
          <span style="flex: 1">{{ x.pago }}</span>
          <span class="chip" :class="x.situacion.clase">{{ x.situacion.texto }}</span>
        </div>
      </div>
      <div class="botones">
        <button v-if="x.debe" type="button" class="btn primario" @click="pagarTarjeta(x.c.id, x.vigente ? { corte: x.e.corte } : {})">Pagar</button>
        <a class="btn" :href="'#/tarjeta/' + x.c.id">Estado de cuenta</a>
        <button type="button" class="btn" @click="comprar(x.c)">Registrar compra</button>
        <button type="button" class="btn" @click="editarTarjeta(x.c)">Editar</button>
      </div>
    </article>

    <p v-if="!lista.length" class="vacio">{{ personaFiltro() ? nombrePersona(personaFiltro()) + ' no tiene tarjetas a su nombre.' : 'Todavía no hay tarjetas.' }}</p>
    <button type="button" class="btn-punteado" @click="editarTarjeta({ titularId: personaFiltro() })">+ Nueva tarjeta</button>
    <p class="nota chica">Una compra con tarjeta cuenta como gasto en el mes de la compra (o de cada cuota). El pago de la tarjeta no es gasto: es el dinero que sale de la cuenta. Las compras en dólares se pasan a lempiras con la tasa del día en que se pagan, empezando por las más antiguas.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const lista = computed(() => tarjetas().filter((c) => coincidePersona(c.titularId || null, filtro())).map((c) => datosTarjeta(ix.value, c, store.hoy)));
    const totalEnL = computed(() => deCentavos(lista.value.reduce((a, x) => a + aCentavos(x.r.deudaEnL), 0)));
    const total = computed(() => lista.value.reduce((a, x) => ({ L: a.L + aCentavos(x.r.deuda.L), USD: a.USD + aCentavos(x.r.deuda.USD) }), { L: 0, USD: 0 }));
    const hayDolares = computed(() => total.value.USD !== 0);
    const textoTotal = computed(() => {
      if (!lista.value.length) return personaFiltro() ? '' : 'Agrega tus tarjetas para ver lo que se debe, la fecha de pago y lo que cuestan las compras en dólares.';
      const tasa = lista.value.find((x) => x.r.tasa)?.r.tasa;
      const partes = [`${dosMonedas({ L: deCentavos(total.value.L), USD: deCentavos(total.value.USD) }, { cero: 'Nada' })}.`];
      if (hayDolares.value) partes.push(tasa ? `Los dólares, con la última tasa usada (${tasa}).` : 'Los dólares no se suman: todavía no hay una tasa (define la tasa de referencia en Datos y OneDrive).');
      return partes.join(' ');
    });
    const textoDisponible = (x) => {
      const partes = [];
      if (textoLibre(x.r)) partes.push(`Disponible ${textoLibre(x.r)}`);
      if (x.r.porCobrar.L) partes.push(`${fmtMoneda(x.r.porCobrar.L, 'L')} en cuotas por cobrar`);
      if (x.r.extraPorCobrar.L) partes.push(`${fmtMoneda(x.r.extraPorCobrar.L, 'L')} de extrafinanciamiento`);
      return partes.join(' · ');
    };
    return {
      lista, totalEnL, hayDolares, textoTotal, textoDisponible, fmt, fmtMoneda, nombrePersona, personaFiltro, editarTarjeta, pagarTarjeta,
      comprar: (c) => nuevoMovimiento({ tipo: 'gasto', cuentaId: c.id, personaId: c.titularId || store.yo }),
    };
  },
};

// ---------------------------------------------------------------- Estado de cuenta

const PERIODICIDAD_TEXTO = (cargo) => {
  if ((cargo.periodicidad || 'mensual') === 'mensual') return 'cada mes';
  const meses = (cargo.meses || []).map((m) => nombreMes(Number(m)));
  if (cargo.periodicidad === 'anual') return `cada año en ${meses[0] || '—'}`;
  return `en ${meses.length > 1 ? `${meses.slice(0, -1).join(', ')} y ${meses[meses.length - 1]}` : meses[0] || '—'}`;
};

export const VistaTarjeta = {
  components: { Icono },
  props: { params: { type: Array, default: () => [] } },
  template: `
  <section v-if="cuenta" class="pila">
    <div>
      <p class="nota chica">{{ datos.detalle }} · {{ cuenta.titularId ? nombrePersona(cuenta.titularId) : 'Hogar' }}</p>
      <p class="etiqueta" style="margin-top: 10px">Se debe hoy</p>
      <div class="deuda-tarjeta" style="margin-top: 2px">
        <span class="hero-num md">{{ fmtMoneda(datos.r.deuda.L, 'L') }}</span>
        <span v-if="datos.usaDolares" class="hero-num md">{{ fmtMoneda(datos.r.deuda.USD, 'USD') }}</span>
      </div>
      <p class="hero-texto">{{ textoHoy }}</p>
    </div>

    <div class="navegador-corte">
      <button type="button" class="btn-icono" aria-label="Corte anterior" :disabled="!hayAnterior" @click="mover(-1)"><icono n="izq" :t="20"/></button>
      <div class="navegador-titulos">
        <span class="navegador-titulo">Corte del {{ fechaLarga(e.corte) }}</span>
        <span class="navegador-sub">del {{ fechaCorta(e.inicio) }} al {{ fechaCorta(e.corte) }} · pago hasta el {{ fechaCorta(e.limite) }}</span>
      </div>
      <button type="button" class="btn-icono" aria-label="Corte siguiente" :disabled="!haySiguiente" @click="mover(1)"><icono n="der" :t="20"/></button>
    </div>

    <article class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2>{{ e.situacion === 'abierto' ? 'Lo que va del ciclo' : 'Estado de cuenta' }}</h2>
        <span class="chip" :class="situacion.clase">{{ situacion.texto }}{{ e.tarde ? ' tarde' : '' }}</span>
      </div>
      <p v-if="e.antesDelSaldo" class="nota chica" style="margin-top: 6px">Este corte es anterior al saldo con el que empezó la tarjeta en la app ({{ fechaCorta(fechaSaldo) }}).</p>
      <dl class="datos sin-linea" style="margin-top: 10px">
        <dt>{{ e.situacion === 'abierto' ? 'Va para el corte' : 'Saldo al corte' }}</dt><dd>{{ dosMonedas(e.alCorte, { cero: fmtMoneda(0, 'L') }) }}</dd>
        <dt>Compras y cargos del ciclo</dt><dd>{{ dosMonedas(e.cargosDelCiclo, { cero: fmtMoneda(0, 'L') }) }}</dd>
        <template v-if="e.situacion !== 'abierto'">
          <dt>Pagado</dt><dd>{{ dosMonedas(e.pagado, { cero: fmtMoneda(0, 'L') }) }}</dd>
          <template v-if="e.aFavor.L || e.aFavor.USD"><dt>A favor</dt><dd class="positivo">{{ dosMonedas(e.aFavor) }}</dd></template>
          <template v-else><dt>Falta</dt><dd :class="{ negativo: e.situacion === 'vencido' }">{{ dosMonedas(e.pendiente, { cero: fmtMoneda(0, 'L') }) }}</dd></template>
          <template v-if="e.alCorte.USD > 0 && e.situacion === 'pagado'"><dt>Salió de las cuentas</dt><dd>{{ fmt(e.pagadoEnL) }}</dd></template>
          <template v-else-if="e.alCorte.USD > 0"><dt>Pago de contado en lempiras</dt><dd>≈ {{ fmt(e.contadoEnL) }}</dd></template>
        </template>
      </dl>
      <div class="botones">
        <button v-if="puedePagar" type="button" class="btn primario" @click="pagar">Pagar</button>
        <button type="button" class="btn" @click="comprar">Registrar compra</button>
        <button type="button" class="btn" @click="editarTarjeta(cuenta)">Editar tarjeta</button>
      </div>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab pegada"><h2>Compras y cargos</h2><span class="tenue" style="font-size: 0.82rem">{{ e.compras.length }}</span></div>
      <ul v-if="compras.length" class="lista">
        <li v-for="x in compras" :key="x.clave" class="fila clic" @click="x.abrir()">
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub">{{ x.sub }}</span></div>
          <div class="derecha"><div class="monto" :class="{ positivo: x.delta < 0 }">{{ x.monto }}</div><div v-if="x.enL" class="dif tenue">{{ x.enL }}</div></div>
        </li>
      </ul>
      <p v-else class="vacio" style="padding: 8px 0">No hay compras en este ciclo.</p>
    </article>

    <article v-if="pagos.length" class="tarjeta">
      <div class="tarjeta-cab pegada"><h2>Pagos de este corte</h2></div>
      <ul class="lista">
        <li v-for="x in pagos" :key="x.clave" class="fila clic" @click="x.abrir()">
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub">{{ x.sub }}</span></div>
          <div class="derecha"><div class="monto">{{ x.monto }}</div><div v-if="x.enL" class="dif tenue">{{ x.enL }}</div></div>
        </li>
      </ul>
    </article>

    <article v-if="despues.length" class="tarjeta">
      <div class="tarjeta-cab pegada"><h2>Después del corte</h2></div>
      <p class="nota chica">Van en el estado de cuenta siguiente.</p>
      <ul class="lista">
        <li v-for="x in despues" :key="x.clave" class="fila clic" @click="x.abrir()">
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub">{{ x.sub }}</span></div>
          <div class="derecha"><div class="monto" :class="{ positivo: x.delta < 0 }">{{ x.monto }}</div><div v-if="x.enL" class="dif tenue">{{ x.enL }}</div></div>
        </li>
      </ul>
    </article>

    <article v-if="cuotasVigentes.length" class="tarjeta">
      <div class="tarjeta-cab pegada"><h2>Compras a cuotas</h2></div>
      <ul class="lista">
        <li v-for="x in cuotasVigentes" :key="x.id" class="fila clic" @click="editarMovimiento(x.m)">
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub">{{ x.sub }}</span></div>
          <div class="derecha"><div class="monto">{{ fmt(x.queda) }}</div><div class="dif tenue">por cobrar</div></div>
        </li>
      </ul>
    </article>

    <article v-if="cargos.length" class="tarjeta">
      <div class="tarjeta-cab pegada"><h2>Cargos de la tarjeta</h2></div>
      <ul class="lista">
        <li v-for="x in cargos" :key="x.id" class="fila clic" @click="editarTarjeta(cuenta)">
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem" :class="{ tenue: x.activo === false }">{{ x.nombre }}</span><span class="fila-sub">{{ x.sub }}</span></div>
          <div class="derecha"><div class="monto">{{ fmtMoneda(x.monto, x.moneda) }}</div></div>
        </li>
      </ul>
    </article>
  </section>
  <section v-else class="pila">
    <p class="vacio">Esta tarjeta ya no existe.</p>
    <a class="btn" href="#/tarjetas">Ver tarjetas</a>
  </section>`,
  setup(props) {
    const ix = computed(indice);
    const cuenta = computed(() => {
      const c = buscar('cuentas', props.params[0]);
      return c && !c.borrado && c.tipo === 'tarjeta' ? c : null;
    });
    const datos = computed(() => datosTarjeta(ix.value, cuenta.value, store.hoy));
    // Con los años anteriores en OneDrive, la tarjeta empieza en el cierre del año anterior al primero cargado.
    const fechaSaldo = computed(() => (cuenta.value && ix.value.tarjetas.get(cuenta.value.id)?.saldoFecha) || fechaSaldoDe(cuenta.value));
    // Cortes que se pueden ver: del primero después del saldo inicial al que está abierto.
    const primero = computed(() => corteDe(cuenta.value, sumarDias(fechaSaldo.value, 1)));
    const abierto = computed(() => corteDe(cuenta.value, store.hoy));
    const normalizar = (fecha) => {
      if (!cuenta.value) return null;
      const c = corteDe(cuenta.value, fecha);
      if (c > abierto.value) return abierto.value;
      return c < primero.value ? primero.value : c;
    };
    const corte = ref(null);
    const porDefecto = () => (datos.value.vigente ? datos.value.e.corte : abierto.value);
    watch(cuenta, (c) => {
      if (c && !corte.value) corte.value = props.params[1] ? normalizar(props.params[1]) : porDefecto();
    }, { immediate: true });
    // Un enlace a otro corte de la misma tarjeta (por ejemplo, desde Mes).
    watch(() => props.params[1], (fecha) => {
      if (fecha && cuenta.value) corte.value = normalizar(fecha);
    });
    const e = computed(() => estadoCiclo(ix.value, cuenta.value, corte.value || abierto.value));
    const hayAnterior = computed(() => e.value.corte > primero.value);
    const haySiguiente = computed(() => e.value.corte < abierto.value);
    function mover(n) {
      const nuevo = n < 0 ? corteAnterior(cuenta.value, e.value.corte) : corteSiguiente(cuenta.value, e.value.corte);
      corte.value = normalizar(nuevo);
      history.replaceState(null, '', `#/tarjeta/${cuenta.value.id}/${corte.value}`);
    }
    const situacion = computed(() => SITUACION[e.value.situacion]);

    const textoHoy = computed(() => {
      const r = datos.value.r;
      const partes = [];
      if (r.deuda.USD && r.tasa) partes.push(`≈ ${fmt(r.deudaEnL)} en total, con la última tasa (${r.tasa})`);
      if (textoLibre(r)) {
        const l = r.limite;
        const deLimite = l.L !== null && l.USD !== null ? ` de un límite de ${fmtMoneda(l.L, 'L')} o ${fmtMoneda(l.USD, 'USD')} (tasa del límite ${formatoTasa(l.tasa)})` : '';
        partes.push(`disponible ${textoLibre(r)}${deLimite}`);
      }
      if (r.porCobrar.L) partes.push(`${fmtMoneda(r.porCobrar.L, 'L')} en cuotas por cobrar (dentro del límite)`);
      if (r.extraPorCobrar.L) partes.push(`${fmtMoneda(r.extraPorCobrar.L, 'L')} de extrafinanciamiento por cobrar (fuera del límite)`);
      const texto = partes.join(' · ');
      return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) + '.' : '';
    });

    // Filas de las listas a partir de los asientos de la tarjeta.
    const nombreDe = (m) => m.nota || buscar('comercios', m.comercioId)?.nombre || buscar('partidas', m.partidaId)?.nombre || (m.categoriaId ? nombreCategoria(m.categoriaId) : TIPOS_MOVIMIENTO[m.tipo]);
    function filaCargo(ev) {
      const m = ix.value.movimientos.get(ev.origen);
      const base = { clave: `${ev.origen}|${ev.moneda}|${ev.fecha}`, delta: ev.delta, monto: fmtMoneda(ev.delta / 100, ev.moneda), enL: '' };
      if (!m) {
        // Cargo de la tarjeta: la clave es cargo:<tarjeta>:<cargo>:<corte>.
        const cargo = (cuenta.value.tarjeta?.cargos || []).find((x) => x.id === ev.origen.split(':')[2]);
        const sub = [fechaCorta(ev.fecha), (TIPOS_CARGO[cargo?.tipo] || 'Cargo').toLowerCase()];
        const enL = ev.moneda === 'USD' ? (() => {
          const l = ix.value.tarjetas.get(cuenta.value.id)?.tasas.get(ev.origen);
          return l?.c ? `${l.estimado ? '≈ ' : ''}${fmt(l.c / 100)}` : '';
        })() : '';
        return { ...base, titulo: ev.nombre || 'Cargo de la tarjeta', sub: sub.join(' · '), enL, abrir: () => editarTarjeta(cuenta.value) };
      }
      let titulo = nombreDe(m);
      const sub = [fechaCorta(ev.fecha)];
      if (ev.tipo === 'cuota') {
        titulo = `${titulo} · cuota ${ev.cuota} de ${ev.cuotas}`;
        sub.push(`compra del ${fechaCorta(m.fecha)}`);
        if (ev.interes || ev.comision) sub.push(`incluye ${[ev.interes ? `intereses ${fmt(ev.interes / 100)}` : '', ev.comision ? `comisión ${fmt(ev.comision / 100)}` : ''].filter(Boolean).join(' y ')}`);
      } else if (ev.tipo === 'credito') titulo = `${titulo} (crédito)`;
      else if (ev.tipo === 'avance') titulo = `Avance de efectivo · ${nombreCuenta(m.cuentaDestinoId)}`;
      else if (ev.tipo === 'ajuste') titulo = 'Ajuste';
      if (m.personaId) sub.push(`pagó ${nombrePersona(m.personaId)}`);
      if (m.categoriaId && ev.tipo !== 'cuota' && titulo !== nombreCategoria(m.categoriaId)) sub.push(nombreCategoria(m.categoriaId));
      let enL = '';
      if (ev.moneda === 'USD' && ev.tipo === 'compra') {
        const l = ix.value.montoEnLempiras(m);
        if (l.c) enL = l.estimado ? `≈ ${fmt(l.c / 100)} al pagar` : `${fmt(l.c / 100)} con los pagos`;
      }
      return { ...base, titulo, sub: sub.join(' · '), enL, abrir: () => editarMovimiento(m) };
    }
    const compras = computed(() => e.value.compras.map(filaCargo));
    const despues = computed(() => e.value.despues.map(filaCargo));
    // Un pago con lempiras y dólares son dos asientos: se muestran juntos.
    const pagos = computed(() => {
      const porPago = new Map();
      for (const ev of e.value.pagos) {
        const x = porPago.get(ev.origen) || { L: 0, USD: 0, tasa: null, fecha: ev.fecha };
        x[ev.moneda] -= ev.delta;
        if (ev.tasa) x.tasa = ev.tasa;
        porPago.set(ev.origen, x);
      }
      return [...porPago].map(([id, x]) => {
        const m = ix.value.movimientos.get(id);
        const sub = [fechaCorta(x.fecha)];
        if (m?.tipo === 'pago_tarjeta') sub.push(`desde ${nombreCuenta(m.cuentaId)}`);
        if (x.USD && x.tasa) sub.push(`dólares a ${x.tasa}`);
        if (m?.personaId) sub.push(`pagó ${nombrePersona(m.personaId)}`);
        const salida = m?.tipo === 'pago_tarjeta' && x.USD && m.moneda !== 'USD' ? fmt(Number(m.monto) || 0) : '';
        return {
          clave: id, titulo: m?.tipo === 'pago_tarjeta' ? 'Pago' : m ? nombreDe(m) : 'Pago', sub: sub.join(' · '),
          monto: dosMonedas({ L: x.L / 100, USD: x.USD / 100 }), enL: salida ? `salieron ${salida}` : '', abrir: () => m && editarMovimiento(m),
        };
      });
    });

    const cuotasVigentes = computed(() => {
      const info = ix.value.tarjetas.get(cuenta.value.id);
      const out = [];
      for (const [id, lista] of info?.cuotas || []) {
        const m = ix.value.movimientos.get(id);
        const futuras = lista.filter((q) => q.fecha > store.hoy);
        if (!m || !futuras.length) continue;
        const cobradas = lista.length - futuras.length;
        const queda = deCentavos(futuras.reduce((a, q) => a + q.c, 0));
        out.push({
          id, m, queda, titulo: nombreDe(m),
          sub: `${TIPOS_FINANCIAMIENTO[m.cuotas?.tipo === 'extra' ? 'extra' : 'intra']} · ${cobradas} de ${lista[0].n} cobradas · ${fmt((lista[1] || lista[0]).c / 100)} por cuota · termina en ${nombrePeriodo(lista[lista.length - 1].periodo, true)}`,
        });
      }
      return out;
    });
    // Próximo cobro de cada cargo (los de hoy ya se cobraron).
    const proximo = (x) => {
      if (x.activo === false) return null;
      if ((x.periodicidad || 'mensual') === 'mensual') return corteDe(cuenta.value, sumarDias(store.hoy, 1));
      const esteMes = proximoCobro(cuenta.value, x, periodoDe(store.hoy));
      return esteMes && esteMes <= store.hoy ? proximoCobro(cuenta.value, x, sumarMeses(periodoDe(store.hoy), 1)) : esteMes;
    };
    const cargos = computed(() => (cuenta.value.tarjeta?.cargos || []).map((x) => {
      const cuando = proximo(x);
      return { ...x, sub: `${TIPOS_CARGO[x.tipo] || 'Cargo'} · ${PERIODICIDAD_TEXTO(x)}${x.activo === false ? ' · inactivo' : cuando ? ` · próximo ${fechaCorta(cuando)}` : ''}` };
    }));

    const puedePagar = computed(() => datos.value.debe);
    const pagar = () => pagarTarjeta(cuenta.value.id, e.value.situacion !== 'abierto' && !e.value.antesDelSaldo ? { corte: e.value.corte } : {});
    const comprar = () => nuevoMovimiento({ tipo: 'gasto', cuentaId: cuenta.value.id, personaId: cuenta.value.titularId || store.yo });
    const fechaLarga = (f) => `${Number(f.slice(8, 10))} de ${nombreMes(Number(f.slice(5, 7)))}${f.slice(0, 4) !== store.hoy.slice(0, 4) ? ` de ${f.slice(0, 4)}` : ''}`;

    return {
      cuenta, datos, fechaSaldo, e, hayAnterior, haySiguiente, mover, situacion, textoHoy, compras, pagos, despues, cuotasVigentes, cargos, puedePagar, pagar, comprar,
      fmt, fmtMoneda, fechaCorta, fechaLarga, dosMonedas, nombrePersona, editarTarjeta, editarMovimiento,
    };
  },
};
