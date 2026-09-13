// Metas de ahorro: progreso, fecha, aporte sugerido por mes y por pago, y si van al día.
import {
  store, fmt, fmtEntero, indice, vivos, abrirModal, personas, cuentasDinero, nombrePersona, nombreCuenta, filtro, personaFiltro,
} from '../store.js';
import { estadoMetas, SITUACIONES_META } from '../core/metas.js';
import { resumenMes } from '../core/reportes.js';
import { nombrePeriodo, sumarMeses, periodoDe, redondear } from '../core/util.js';
import { copia, hayValor, PIE, usarFormulario } from './formulario-base.js';
import { nuevoMovimiento } from './formularios.js';

const { reactive, computed } = Vue;

export const MetaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="x.nombre" maxlength="60" required placeholder="Fondo de emergencia, viaje, carro…"></label>
    <div class="fila-campos">
      <label class="campo"><span>Monto objetivo</span><input v-model.number="x.montoObjetivo" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Para cuándo (opcional)</span><input v-model="x.fechaObjetivo" type="month"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Se guarda en</span>
        <select v-model="x.cuentaId"><option :value="null">Sin cuenta propia</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
      <label class="campo"><span>De quién es</span>
        <select v-model="x.responsableId"><option :value="null">Hogar</option><option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <p class="nota chica">{{ ayudaCuenta }}</p>
    <label v-if="!conCuenta" class="campo"><span>Ya ahorrado al empezar</span><input v-model.number="x.saldoInicial" type="number" inputmode="decimal" step="0.01" min="0"></label>
    <label class="casilla"><input v-model="x.activo" type="checkbox"> Activa</label>
    <label class="campo"><span>Nota</span><input v-model.trim="x.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const x = reactive({ nombre: '', montoObjetivo: null, fechaObjetivo: '', cuentaId: null, responsableId: null, saldoInicial: 0, activo: true, nota: '', ...original });
    x.fechaObjetivo = x.fechaObjetivo ? String(x.fechaObjetivo).slice(0, 7) : '';
    const compartida = computed(() => !!x.cuentaId && vivos('metas').some((m) => m.id !== original.id && m.activo !== false && m.cuentaId === x.cuentaId));
    const conCuenta = computed(() => !!x.cuentaId && !compartida.value);
    const ayudaCuenta = computed(() => {
      if (conCuenta.value) return `Lo ahorrado es el saldo de ${nombreCuenta(x.cuentaId)}.`;
      if (compartida.value) return `${nombreCuenta(x.cuentaId)} ya tiene otra meta: esta cuenta solo las transferencias marcadas "Para la meta".`;
      return 'Cuentan las transferencias marcadas "Para la meta" y lo que ya estaba ahorrado.';
    });
    const usos = original.id ? vivos('movimientos').filter((m) => m.metaId === original.id).length : 0;
    const f = usarFormulario('metas', original, emit, {
      que: 'esta meta',
      alBorrar: () => !usos || confirm(`${usos} ${usos === 1 ? 'movimiento está marcado' : 'movimientos están marcados'} con esta meta. ¿Eliminarla igual?`),
    });
    function enviar() {
      f.error.value = '';
      const nombre = x.nombre.trim();
      if (!nombre) return (f.error.value = 'Ponle un nombre.');
      if (!(Number(x.montoObjetivo) > 0)) return (f.error.value = 'Escribe el monto objetivo.');
      if (hayValor(x.saldoInicial) && !(Number(x.saldoInicial) >= 0)) return (f.error.value = 'Revisa lo ya ahorrado.');
      f.terminar({
        ...x, nombre, montoObjetivo: redondear(Number(x.montoObjetivo)), fechaObjetivo: x.fechaObjetivo || null, cuentaId: x.cuentaId || null,
        responsableId: x.responsableId || null, saldoInicial: conCuenta.value ? 0 : redondear(Number(x.saldoInicial) || 0),
      });
    }
    return { x, conCuenta, ayudaCuenta, enviar, listaCuentas: computed(cuentasDinero), listaPersonas: computed(personas), ...f };
  },
};

export const editarMeta = (m = {}) => abrirModal(m.id ? 'Editar meta' : 'Nueva meta', MetaForm, { inicial: m });

// Aporte a una meta: una transferencia marcada con ella, hacia su cuenta si tiene.
export function aportarAMeta(meta, monto = null) {
  const origen = cuentasDinero().find((c) => c.id !== meta?.cuentaId)?.id || 'gastos';
  nuevoMovimiento({
    tipo: 'transferencia', cuentaId: origen, cuentaDestinoId: meta?.cuentaId || null, metaId: meta?.id || null, monto,
    personaId: meta?.responsableId || store.yo,
  });
}

export const VistaMetas = {
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Ahorrado en metas</p>
      <p class="hero-num">{{ fmt(total.ahorrado) }}</p>
      <p class="hero-texto">{{ lista.length ? 'De ' + fmt(total.objetivo) + ' entre ' + (lista.length === 1 ? 'una meta' : lista.length + ' metas') + '.' : 'Una meta dice cuánto quieren ahorrar y para cuándo; la app sugiere cuánto aportar cada mes y cada quincena.' }}</p>
    </div>

    <div v-if="sobrante > 0 && abiertas.length" class="aviso-banner">
      <p>En {{ nombrePeriodo(mesAnterior) }} quedaron libres {{ fmt(sobrante) }}. ¿Mandar algo a una meta?</p>
      <button type="button" class="btn primario" @click="mandarSobrante">Mandar a una meta</button>
    </div>

    <article v-for="e in lista" :key="e.meta.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ e.meta.nombre }}</h2>
        <span class="chip">{{ e.meta.responsableId ? nombrePersona(e.meta.responsableId) : 'Hogar' }}</span>
        <span class="chip" :class="situaciones[e.situacion].clase">{{ situaciones[e.situacion].texto }}</span>
      </div>
      <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 8px; flex-wrap: wrap">
        <span class="hero-num chico">{{ fmt(e.ahorrado) }}</span>
        <span class="tenue">de {{ fmt(e.objetivo) }} · {{ e.pct }}%</span>
      </div>
      <div class="progreso acento" style="margin-top: 10px" role="img" :aria-label="e.pct + '% de la meta'"><div :style="{ width: e.pct + '%' }"></div></div>
      <p class="nota" style="margin-top: 10px">{{ texto(e) }}</p>
      <p class="nota chica">{{ detalle(e) }}</p>
      <div class="botones">
        <button v-if="e.situacion !== 'lograda'" type="button" class="btn primario" @click="aportarAMeta(e.meta, e.aporteMensual || null)">Aportar</button>
        <button type="button" class="btn" @click="editarMeta(e.meta)">Editar</button>
      </div>
    </article>

    <p v-if="!lista.length && personaFiltro()" class="vacio">{{ nombrePersona(personaFiltro()) }} no tiene metas a su nombre. Las del hogar se ven en "Todo el hogar".</p>
    <button type="button" class="btn-punteado" @click="editarMeta({ responsableId: personaFiltro() })">+ Nueva meta</button>
    <p class="nota chica">El aporte sugerido reparte lo que falta en partes iguales hasta la fecha (este mes incluido). Una meta va atrasada si lleva menos de lo que tendría a un ritmo parejo desde el mes en que empezó.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const lista = computed(() => estadoMetas(ix.value, filtro()));
    const abiertas = computed(() => lista.value.filter((e) => e.situacion !== 'lograda'));
    const total = computed(() => ({
      ahorrado: redondear(lista.value.reduce((a, e) => a + e.ahorrado, 0)),
      objetivo: redondear(lista.value.reduce((a, e) => a + e.objetivo, 0)),
    }));
    // Lo que quedó libre el mes pasado: lo recibido menos lo del plan y lo gastado fuera del plan.
    const mesAnterior = computed(() => sumarMeses(periodoDe(store.hoy), -1));
    const sobrante = computed(() => {
      if (mesAnterior.value < (store.doc.config.inicio || '')) return 0;
      const r = resumenMes(ix.value, mesAnterior.value, filtro());
      return redondear(Math.max(0, r.ingresoReal - r.comprometido - r.fueraDelPlan));
    });
    const mandarSobrante = () => aportarAMeta(abiertas.value.length === 1 ? abiertas.value[0].meta : null, sobrante.value);

    function texto(e) {
      if (e.situacion === 'lograda') return `Meta lograda${e.ahorrado > e.objetivo ? `, con ${fmt(e.ahorrado - e.objetivo)} de más` : ''}.`;
      if (e.situacion === 'sin-fecha') return `Faltan ${fmt(e.falta)}. Ponle una fecha para calcular cuánto aportar.`;
      if (e.situacion === 'vencida') return `La fecha era ${nombrePeriodo(e.fin)} y faltan ${fmt(e.falta)}. Cambia la fecha para recalcular el aporte.`;
      const porPago = e.aportePorPago ? ` (${fmt(e.aportePorPago)} por quincena)` : '';
      const ritmo = e.situacion === 'atrasada' ? ` A un ritmo parejo llevarían ${fmt(e.ritmo)}.` : '';
      return `Faltan ${fmt(e.falta)} para ${nombrePeriodo(e.fin)}: ${fmt(e.aporteMensual)} al mes${porPago}.${ritmo}`;
    }
    function detalle(e) {
      const donde = e.porCuenta ? `Saldo de ${nombreCuenta(e.meta.cuentaId)}` : 'Con las transferencias marcadas para la meta';
      const mes = e.esteMes ? ` · este mes ${e.esteMes > 0 ? '+' : ''}${fmtEntero(e.esteMes)}` : '';
      return `${donde}${mes}`;
    }
    return {
      lista, abiertas, total, mesAnterior, sobrante, mandarSobrante, texto, detalle, situaciones: SITUACIONES_META,
      fmt, nombrePeriodo, nombrePersona, personaFiltro, editarMeta, aportarAMeta,
    };
  },
};
