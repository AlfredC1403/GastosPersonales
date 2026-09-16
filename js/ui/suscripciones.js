// Suscripciones: todas juntas, con lo que cuestan al mes y al año, cuándo vuelve a cobrar cada
// una y con qué se paga. Desde aquí se agregan, se editan y se cancelan.
import {
  store, guardar, aviso, confirmar, indice, fmt, fmtEntero, fmtMoneda, nombreCuenta, nombrePersona, nombreCategoria,
  filtro, personaFiltro, colorPersona,
} from '../store.js';
import { estadoSuscripciones, resumenSuscripciones } from '../core/suscripciones.js';
import { CICLOS } from '../core/modelo.js';
import { fechaCorta, nombrePeriodo, cuandoVence, periodoActual } from '../core/util.js';
import { Icono } from './componentes.js';
import { editarPartida } from './formularios.js';

const { computed } = Vue;

export const VistaSuscripciones = {
  components: { Icono },
  template: `
  <section class="pila">
    <p class="nota">Lo que se cobra solo cada mes o cada año hasta que alguien lo cancele. Cada una es una partida del presupuesto, así que también aparece en Mes y cuenta en los reportes.</p>

    <div class="kpis">
      <div class="kpi"><div class="kpi-et">Al mes</div><div class="kpi-val">{{ fmtEntero(r.alMes) }}</div><div class="kpi-nota">{{ r.cuantas }} {{ r.cuantas === 1 ? 'activa' : 'activas' }}</div></div>
      <div class="kpi"><div class="kpi-et">Al año</div><div class="kpi-val">{{ fmtEntero(r.alAnio) }}</div><div class="kpi-nota">a este ritmo</div></div>
      <div class="kpi"><div class="kpi-et">En dólares</div><div class="kpi-val">{{ fmtMoneda(r.enDolares, 'USD') }}</div><div class="kpi-nota">{{ r.enDolares ? 'al mes, a la tasa ' + (tasa || 'sin anotar') : 'ninguna en dólares' }}</div></div>
    </div>

    <div v-if="faltaTasa" class="aviso-banner ambar">
      <p>Hay suscripciones en dólares y no está anotada la tasa de referencia: sin ella no se pueden sumar en lempiras.</p>
      <a class="btn primario" href="#/datos">Anotar la tasa</a>
    </div>

    <article v-if="activas.length" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo">Activas</h2>
        <span class="monto">{{ fmt(r.alMes) }}</span><span class="tenue" style="font-size: 0.8rem">/mes</span>
      </div>
      <ul class="lista">
        <li v-for="s in activas" :key="s.id" class="fila">
          <i class="punto" :style="{ background: s.color }"></i>
          <div class="fila-info clic" @click="editarPartida(s.partida)">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ s.nombre }}</span>
            <span class="fila-sub envuelve"><span v-for="c in s.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span></span>
          </div>
          <div class="derecha">
            <div class="monto">{{ fmtMoneda(s.monto, s.moneda) }}</div>
            <div v-if="s.detalle" class="meta">{{ s.detalle }}</div>
          </div>
          <button type="button" class="btn-icono" :aria-label="'Cancelar ' + s.nombre" title="Cancelar suscripción" @click="cancelar(s)"><icono n="x" :t="17"/></button>
        </li>
      </ul>
    </article>
    <p v-else class="vacio">Todavía no hay suscripciones. Agrega Netflix, iCloud, Spotify o lo que se cobre solo cada mes.</p>

    <article v-if="porMedio.length > 1" class="tarjeta">
      <h2 style="margin-bottom: 12px">Con qué se pagan</h2>
      <ul class="lista">
        <li v-for="m in porMedio" :key="m.id" class="fila compacta">
          <span style="flex: 1; font-size: 0.92rem">{{ m.nombre }}</span>
          <span class="tenue" style="font-size: 0.85rem">{{ m.cuantas }}</span>
          <span class="monto">{{ fmt(m.alMes) }}</span>
        </li>
      </ul>
      <p class="nota chica" style="margin-top: 10px">Si se cambia una tarjeta, estas son las que hay que actualizar en cada servicio.</p>
    </article>

    <article v-if="terminadas.length" class="tarjeta">
      <div class="tarjeta-cab pegada"><h2 class="titulo-grupo tenue">Canceladas</h2></div>
      <ul class="lista">
        <li v-for="s in terminadas" :key="s.id" class="fila">
          <div class="fila-info clic" @click="editarPartida(s.partida)">
            <span class="fila-titulo tenue" style="font-size: 0.93rem">{{ s.nombre }}</span>
            <span class="fila-sub envuelve"><span v-for="c in s.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span></span>
          </div>
          <div class="derecha"><div class="monto tenue">{{ fmtMoneda(s.monto, s.moneda) }}</div></div>
          <button type="button" class="btn" @click="reactivar(s)">Reactivar</button>
        </li>
      </ul>
      <p class="nota chica" style="margin-top: 10px">Lo que ya se pagó en los meses anteriores se conserva: solo dejan de contar de aquí en adelante.</p>
    </article>

    <button type="button" class="btn-punteado" @click="nueva">+ Nueva suscripción</button>
    <p class="nota chica">Las que se cobran en dólares cuentan en lempiras con la tasa de referencia, y cada pago registrado queda con la tasa real de ese día.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const tasa = computed(() => Number(store.doc.config.tasaReferencia) || 0);
    const lista = computed(() => estadoSuscripciones(ix.value, { hoy: store.hoy, filtro: filtro(), periodo: store.periodo }));
    const r = computed(() => resumenSuscripciones(lista.value));
    const faltaTasa = computed(() => !tasa.value && lista.value.some((s) => s.activa && s.moneda === 'USD'));

    // Lo largo (cuándo cobra, con qué se paga) va en los chips de la izquierda, que envuelven;
    // a la derecha solo el monto y su equivalente al mes, que es lo que se compara de un vistazo.
    function fila(s) {
      const chips = [];
      if (s.proximo) chips.push({ t: `cobra el ${fechaCorta(s.proximo)} · ${cuandoVence(s.proximo, store.hoy)}`, c: s.proximo <= store.hoy ? 'aviso' : 'acento' });
      else if (s.hasta) chips.push({ t: `hasta ${nombrePeriodo(s.hasta, true)}`, c: '' });
      if (s.enPrueba) chips.push({ t: `prueba gratis hasta el ${fechaCorta(s.pruebaHasta)}`, c: 'ok' });
      if (s.sinMonto) chips.push({ t: 'sin monto', c: 'aviso' });
      chips.push({ t: CICLOS[s.ciclo].toLowerCase(), c: '' });
      if (s.medioId) chips.push({ t: nombreCuenta(s.medioId), c: '' });
      if (!personaFiltro() && s.responsableId) chips.push({ t: nombrePersona(s.responsableId), c: '' });
      if (s.categoriaId && s.categoriaId !== 'suscripciones') chips.push({ t: nombreCategoria(s.categoriaId), c: '' });
      // A la derecha, lo que cuesta al mes en lempiras: es la cifra con la que se comparan entre sí.
      const detalle = (s.ciclo !== 'mensual' || s.moneda === 'USD') && s.alMesL ? `≈ ${fmt(s.alMesL)}/mes` : '';
      return { ...s, chips, detalle, color: s.responsableId ? colorPersona(s.responsableId) : 'var(--tinta3)' };
    }
    const activas = computed(() => lista.value.filter((s) => s.activa).map(fila));
    const terminadas = computed(() => lista.value.filter((s) => !s.activa).map(fila));

    // Lo que cuesta al mes cada tarjeta o cuenta: al cambiar una tarjeta, esto es lo que hay que
    // actualizar en cada servicio.
    const porMedio = computed(() => {
      const mapa = new Map();
      for (const s of lista.value.filter((x) => x.activa)) {
        const id = s.medioId || 'sin';
        const x = mapa.get(id) || { id, nombre: id === 'sin' ? 'Sin medio de pago' : nombreCuenta(id), alMes: 0, cuantas: 0 };
        x.alMes += s.alMesL;
        x.cuantas += 1;
        mapa.set(id, x);
      }
      return [...mapa.values()].sort((a, b) => b.alMes - a.alMes);
    });

    const nueva = () => editarPartida({ suscripcion: true, tipo: 'gasto', moneda: 'USD', ciclo: 'mensual', responsableId: personaFiltro() || undefined });

    // Cancelar no borra nada: la suscripción deja de cobrar desde el mes siguiente y lo pagado
    // en los meses anteriores se queda donde está.
    async function cancelar(s) {
      const desde = store.periodo < periodoActual() ? periodoActual() : store.periodo;
      const ok = await confirmar(
        `${s.nombre} cuenta hasta ${nombrePeriodo(desde)} y ya no cobra después. Lo de los meses anteriores no se toca.`,
        { titulo: '¿Cancelar la suscripción?', aceptar: 'Cancelar suscripción', peligro: true },
      );
      if (!ok) return;
      guardar('partidas', { ...s.partida, hasta: desde });
      aviso(`${s.nombre} queda hasta ${nombrePeriodo(desde)}.`, 'ok', 6000, {
        texto: 'Deshacer', fn: () => guardar('partidas', { ...s.partida, hasta: s.partida.hasta || null }),
      });
    }
    function reactivar(s) {
      guardar('partidas', { ...s.partida, hasta: null, activo: true });
      aviso(`${s.nombre} vuelve a contar.`, 'ok');
    }

    return {
      store, r, tasa, faltaTasa, activas, terminadas, porMedio, nueva, cancelar, reactivar, editarPartida,
      fmt, fmtEntero, fmtMoneda,
    };
  },
};
