// Comercios frecuentes: al escribir uno en un gasto se llenan su categoría, partida y medio de pago.
import { abrirModal, indice, cuentas, categoriasPorGrupo, vivos, buscar, nombreCategoria, nombreCuenta, nombrePartida, comercios } from '../store.js';
import { fechaCorta } from '../core/util.js';
import { copia, PIE, opcionesCategoria, usarFormulario } from './formulario-base.js';

const { reactive, ref, computed } = Vue;

export const ComercioForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="60" required></label>
    <div class="fila-campos">
      <label class="campo"><span>Categoría</span><select v-model="c.categoriaId">${opcionesCategoria('lista')}</select></label>
      <label class="campo"><span>Partida</span>
        <select v-model="c.partidaId"><option :value="null">Ninguna (fuera del plan)</option>
          <option v-for="p in listaPartidas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Se paga con</span>
        <select v-model="c.medioPagoId"><option :value="null">Sin definir</option>
          <option v-for="x in listaCuentas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
      <label v-if="esTarjeta" class="campo"><span>Moneda</span>
        <select v-model="c.moneda"><option value="L">Lempiras</option><option value="USD">Dólares</option></select></label>
    </div>
    <p class="nota chica">Al escribir este comercio en un gasto nuevo se llenan la categoría, la partida y el medio de pago.{{ usos ? ' Se usó en ' + usos + (usos === 1 ? ' gasto.' : ' gastos.') : '' }}</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', categoriaId: null, partidaId: null, medioPagoId: null, moneda: 'L', ...original });
    const esTarjeta = computed(() => buscar('cuentas', c.medioPagoId)?.tipo === 'tarjeta');
    const usos = original.id ? indice().usoComercios.get(original.id) || 0 : 0;
    const f = usarFormulario('comercios', original, emit, { que: 'este comercio' });
    function enviar() {
      f.error.value = '';
      const nombre = c.nombre.trim();
      if (!nombre) return (f.error.value = 'Escribe el nombre.');
      if (vivos('comercios').some((x) => x.id !== original.id && x.nombre.trim().toLowerCase() === nombre.toLowerCase())) return (f.error.value = 'Ya hay un comercio con ese nombre.');
      f.terminar({ ...c, nombre, moneda: esTarjeta.value ? c.moneda : 'L' });
    }
    return {
      c, esTarjeta, usos, enviar, lista: computed(() => categoriasPorGrupo('gasto')), listaCuentas: computed(cuentas),
      listaPartidas: computed(() => vivos('partidas').filter((p) => p.tipo === 'gasto').sort((a, b) => a.nombre.localeCompare(b.nombre))), ...f,
    };
  },
};

export const editarComercio = (c = {}) => abrirModal(c.id ? 'Editar comercio' : 'Nuevo comercio', ComercioForm, { inicial: c });

export const VistaComercios = {
  template: `
  <section class="pila">
    <p class="nota">Cada comercio que se escribe en un gasto se guarda aquí. La próxima vez, al escribirlo, se llenan solos la categoría, la partida y el medio de pago.</p>
    <div v-if="todos.length > 6" class="buscador">
      <input v-model="q" type="search" placeholder="Buscar comercio…" aria-label="Buscar comercio">
    </div>
    <ul v-if="lista.length" class="lista-mov">
      <li v-for="x in lista" :key="x.c.id" @click="editarComercio(x.c)">
        <span class="icono-tipo">{{ x.inicial }}</span>
        <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.c.nombre }}</span><span class="fila-sub">{{ x.sub }}</span></div>
        <div class="derecha"><div class="monto">{{ x.usos }} {{ x.usos === 1 ? 'compra' : 'compras' }}</div><div v-if="x.ultima" class="dif tenue">última {{ fechaCorta(x.ultima) }}</div></div>
      </li>
    </ul>
    <p v-else class="vacio">{{ q ? 'Ningún comercio con ese nombre.' : 'Todavía no hay comercios. Escribe uno al registrar un gasto.' }}</p>
    <button type="button" class="btn-punteado" @click="editarComercio()">+ Nuevo comercio</button>
  </section>`,
  setup() {
    const q = ref('');
    const todos = computed(comercios);
    const ultimas = computed(() => {
      const out = new Map();
      for (const m of vivos('movimientos')) if (m.comercioId && (out.get(m.comercioId) || '') < m.fecha) out.set(m.comercioId, m.fecha);
      return out;
    });
    const lista = computed(() => {
      const texto = q.value.trim().toLowerCase();
      const uso = indice().usoComercios;
      return todos.value.filter((c) => !texto || c.nombre.toLowerCase().includes(texto)).map((c) => ({
        c, inicial: c.nombre.trim().slice(0, 1).toUpperCase() || '·', usos: uso.get(c.id) || 0, ultima: ultimas.value.get(c.id) || '',
        sub: [c.categoriaId ? nombreCategoria(c.categoriaId) : '', nombrePartida(c.partidaId), c.medioPagoId ? nombreCuenta(c.medioPagoId) : '', c.moneda === 'USD' ? 'US$' : ''].filter(Boolean).join(' · ') || 'Sin datos para llenar',
      }));
    });
    return { q, todos, lista, editarComercio, fechaCorta };
  },
};
