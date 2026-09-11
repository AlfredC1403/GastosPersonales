import { store, fmt, vivos, buscar, personas, cuentas, categorias, nombreCuenta, nombreCategoria, nombrePersona } from '../store.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { nombrePeriodo, hoy } from '../core/util.js';
import { Icono, descargar } from './componentes.js';
import { editarMovimiento } from './formularios.js';

const { reactive, ref, computed } = Vue;

const INICIAL = { gasto: 'G', ingreso: 'I', transferencia: 'T', abono: 'A', ajuste: '±' };
const fechaLarga = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

function csv(filas) {
  return filas.map((f) => f.map((v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

export const VistaMovimientos = {
  components: { Icono },
  template: `
  <section>
    <div class="filtros">
      <input v-model="f.q" type="search" placeholder="Buscar…" aria-label="Buscar">
      <button type="button" class="btn" :aria-expanded="verFiltros" @click="verFiltros = !verFiltros">Filtros{{ activos ? ' (' + activos + ')' : '' }}</button>
      <button type="button" class="btn" :disabled="!lista.length" @click="exportar"><icono n="descargar" :t="16"/> CSV</button>
    </div>
    <div v-if="verFiltros" class="filtros">
      <select v-model="f.tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option v-for="(n, k) in tipos" :key="k" :value="k">{{ n }}</option></select>
      <select v-model="f.persona" aria-label="Persona"><option value="">Todas las personas</option><option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select>
      <select v-model="f.cuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="f.categoria" aria-label="Categoría"><option value="">Todas las categorías</option><option v-for="c in listaCategorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <label class="casilla"><input v-model="f.todo" type="checkbox"> Todos los meses</label>
    </div>

    <div class="kpis">
      <div class="kpi"><span>Gastos</span><strong>{{ fmt(totales.gastos) }}</strong><small>{{ f.todo ? 'en todo el historial' : 'en ' + nombrePeriodo(store.periodo) }}</small></div>
      <div class="kpi"><span>Ingresos</span><strong>{{ fmt(totales.ingresos) }}</strong><small>{{ lista.length }} movimientos</small></div>
    </div>

    <p v-if="!lista.length" class="vacio">No hay movimientos{{ f.todo ? '' : ' en ' + nombrePeriodo(store.periodo) }} con esos filtros.</p>
    <div v-for="d in porDia" :key="d.fecha">
      <h3 class="dia-cab">{{ d.titulo }}</h3>
      <ul class="lista tarjeta" style="padding: 4px 14px">
        <li v-for="m in d.movs" :key="m.id" class="clic" @click="editar(m)">
          <span class="icono-tipo" :class="m.tipo" :title="tipos[m.tipo]">{{ inicial[m.tipo] }}</span>
          <div class="info"><span class="titulo">{{ titulo(m) }}</span><span class="sub">{{ subtitulo(m) }}</span></div>
          <span class="monto" :class="clase(m)">{{ montoConSigno(m) }}</span>
        </li>
      </ul>
    </div>
  </section>`,
  setup() {
    const f = reactive({ q: '', tipo: '', persona: '', cuenta: '', categoria: '', todo: false });
    const verFiltros = ref(false);
    const activos = computed(() => [f.tipo, f.persona, f.cuenta, f.categoria, f.todo].filter(Boolean).length);
    const nombreDe = (m) => buscar('plantillas', m.plantillaId)?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '';
    const titulo = (m) => m.nota || nombreDe(m)
      || (m.tipo === 'transferencia' ? `A ${nombreCuenta(m.cuentaDestinoId)}` : '')
      || (m.categoriaId ? nombreCategoria(m.categoriaId) : TIPOS_MOVIMIENTO[m.tipo]);
    const VERBO = { gasto: 'pagó', abono: 'pagó', ingreso: 'recibió', transferencia: 'hizo' };
    function subtitulo(m) {
      const cuenta = m.tipo === 'transferencia' ? `${nombreCuenta(m.cuentaId)} → ${nombreCuenta(m.cuentaDestinoId)}` : nombreCuenta(m.cuentaId);
      const partes = [TIPOS_MOVIMIENTO[m.tipo], cuenta];
      if (m.categoriaId && titulo(m) !== nombreCategoria(m.categoriaId)) partes.push(nombreCategoria(m.categoriaId));
      const verbo = VERBO[m.tipo];
      if (m.personaId && verbo && m.personaId === m.creadoPor) partes.push(`${verbo} y anotó ${nombrePersona(m.personaId)}`);
      else {
        if (m.personaId && verbo) partes.push(`${verbo} ${nombrePersona(m.personaId)}`);
        if (m.creadoPor) partes.push(`anotó ${nombrePersona(m.creadoPor)}`);
      }
      return partes.join(' · ');
    }
    const buscable = (m) => [titulo(m), m.nota, nombreDe(m), nombreCategoria(m.categoriaId), nombreCuenta(m.cuentaId), String(m.monto)].join(' ').toLowerCase();

    const lista = computed(() => {
      const q = f.q.trim().toLowerCase();
      return vivos('movimientos')
        .filter((m) => (f.todo || m.periodo === store.periodo)
          && (!f.tipo || m.tipo === f.tipo)
          && (!f.persona || m.personaId === f.persona || m.creadoPor === f.persona)
          && (!f.cuenta || m.cuentaId === f.cuenta || m.cuentaDestinoId === f.cuenta)
          && (!f.categoria || m.categoriaId === f.categoria)
          && (!q || buscable(m).includes(q)))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || ''));
    });
    const porDia = computed(() => {
      const grupos = [];
      for (const m of lista.value) {
        let g = grupos[grupos.length - 1];
        if (!g || g.fecha !== m.fecha) {
          const [y, mes, d] = m.fecha.split('-').map(Number);
          g = { fecha: m.fecha, titulo: fechaLarga.format(new Date(y, mes - 1, d)) + (f.todo ? ` de ${y}` : ''), movs: [] };
          grupos.push(g);
        }
        g.movs.push(m);
      }
      return grupos;
    });
    const totales = computed(() => ({
      gastos: lista.value.filter((m) => m.tipo === 'gasto' || m.tipo === 'abono').reduce((a, m) => a + m.monto, 0),
      ingresos: lista.value.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + m.monto, 0),
    }));
    const signo = (m) => (m.tipo === 'ingreso' ? 1 : m.tipo === 'gasto' || m.tipo === 'abono' ? -1 : m.tipo === 'ajuste' ? Math.sign(m.monto) : 0);
    const montoConSigno = (m) => (signo(m) > 0 ? '+' : '') + fmt(signo(m) < 0 ? -Math.abs(m.monto) : Math.abs(m.monto));
    const clase = (m) => (signo(m) > 0 ? 'positivo' : '');

    function exportar() {
      const quien = (id) => (id ? nombrePersona(id) : '');
      const cuando = (iso) => (iso ? fechaHora.format(new Date(iso)) : '');
      const filas = [
        ['Fecha', 'Mes', 'Tipo', 'Monto', 'Cuenta', 'Cuenta destino', 'Categoría', 'Compromiso o préstamo', 'Persona', 'Nota', 'Anotó', 'Anotado', 'Editó', 'Editado'],
        ...lista.value.map((m) => [
          m.fecha, m.periodo, TIPOS_MOVIMIENTO[m.tipo], m.monto, nombreCuenta(m.cuentaId), m.cuentaDestinoId ? nombreCuenta(m.cuentaDestinoId) : '',
          m.categoriaId ? nombreCategoria(m.categoriaId) : '', nombreDe(m), quien(m.personaId), m.nota,
          quien(m.creadoPor), cuando(m.creado), quien(m.actualizadoPor), cuando(m.actualizado),
        ]),
      ];
      // El BOM hace que Excel abra el archivo con acentos y ñ correctos.
      descargar(`movimientos-${f.todo ? 'todos' : store.periodo}-${hoy()}.csv`, '\uFEFF' + csv(filas), 'text/csv;charset=utf-8');
    }

    return {
      store, f, verFiltros, activos, lista, porDia, totales, titulo, subtitulo, montoConSigno, clase, exportar, fmt, nombrePeriodo,
      editar: editarMovimiento, tipos: TIPOS_MOVIMIENTO, inicial: INICIAL,
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaCategorias: computed(categorias),
    };
  },
};
