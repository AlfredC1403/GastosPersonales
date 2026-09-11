import { store, fmt, fmtEntero, vivos, buscar, personas, cuentas, categorias, nombreCuenta, nombreCategoria, nombrePersona } from '../store.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { nombrePeriodo, hoy } from '../core/util.js';
import { Icono, descargar } from './componentes.js';
import { editarMovimiento } from './formularios.js';

const { reactive, ref, computed } = Vue;

const INICIAL = { gasto: 'G', ingreso: 'I', transferencia: 'T', abono: 'A', ajuste: '±' };
const DIA_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
const VERBO = { gasto: 'pagó', abono: 'pagó', ingreso: 'recibió', transferencia: 'hizo' };

function csv(filas) {
  return filas.map((f) => f.map((v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

export const VistaMovimientos = {
  components: { Icono },
  template: `
  <section class="pila">
    <div class="buscador">
      <input v-model="f.q" type="search" placeholder="Buscar movimientos…" aria-label="Buscar movimientos">
      <button type="button" class="btn" :aria-expanded="verFiltros" @click="verFiltros = !verFiltros">Filtros{{ masFiltros ? ' (' + masFiltros + ')' : '' }}</button>
    </div>
    <div v-if="verFiltros" class="filtros">
      <select v-model="f.tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option v-for="(n, k) in tipos" :key="k" :value="k">{{ n }}</option></select>
      <select v-model="f.cuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="f.categoria" aria-label="Categoría"><option value="">Todas las categorías</option><option v-for="c in listaCategorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <button type="button" class="btn" :disabled="!lista.length" @click="exportar"><icono n="descargar" :t="16"/> Exportar CSV</button>
    </div>
    <div class="chips-filtro">
      <button type="button" class="chip-filtro" :class="{ activo: !f.tipo && !f.persona }" @click="f.tipo = ''; f.persona = ''">Todos</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.tipo === 'gasto' }" @click="alternar('tipo', 'gasto')">Gastos</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.tipo === 'ingreso' }" @click="alternar('tipo', 'ingreso')">Ingresos</button>
      <button v-for="p in listaPersonas" :key="p.id" type="button" class="chip-filtro" :class="{ activo: f.persona === p.id }" @click="alternar('persona', p.id)">{{ p.nombre }}</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.todo }" @click="f.todo = !f.todo">Todos los meses</button>
    </div>

    <div class="kpis dos">
      <div class="kpi"><div class="kpi-et">Gastos</div><div class="kpi-val">{{ fmt(totales.gastos) }}</div><div class="kpi-nota">{{ totales.nGastos }} {{ totales.nGastos === 1 ? 'movimiento' : 'movimientos' }}</div></div>
      <div class="kpi"><div class="kpi-et">Ingresos</div><div class="kpi-val positivo">{{ fmt(totales.ingresos) }}</div><div class="kpi-nota">{{ totales.nIngresos }} {{ totales.nIngresos === 1 ? 'movimiento' : 'movimientos' }}</div></div>
    </div>

    <p v-if="!lista.length" class="vacio">No hay movimientos{{ f.todo ? '' : ' en ' + nombrePeriodo(store.periodo) }} con esos filtros.</p>
    <div v-for="d in porDia" :key="d.fecha">
      <div class="dia-cab">
        <span class="etiqueta">{{ d.titulo }}</span>
        <span class="linea"></span>
        <span class="total">{{ d.total ? '-' + fmtEntero(d.total) : '' }}</span>
      </div>
      <ul class="lista-mov">
        <li v-for="m in d.movs" :key="m.id" @click="editar(m)">
          <span class="icono-tipo" :class="m.tipo" :title="tipos[m.tipo]">{{ inicial[m.tipo] }}</span>
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ titulo(m) }}</span><span class="fila-sub">{{ subtitulo(m) }}</span></div>
          <span class="monto" :class="{ positivo: signo(m) > 0 }">{{ montoConSigno(m) }}</span>
        </li>
      </ul>
    </div>
  </section>`,
  setup() {
    const f = reactive({ q: '', tipo: '', persona: '', cuenta: '', categoria: '', todo: false });
    const verFiltros = ref(false);
    const masFiltros = computed(() => [f.cuenta, f.categoria, f.tipo && !['gasto', 'ingreso'].includes(f.tipo)].filter(Boolean).length);
    const alternar = (campo, valor) => { f[campo] = f[campo] === valor ? '' : valor; };
    const nombreDe = (m) => buscar('plantillas', m.plantillaId)?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '';
    const titulo = (m) => m.nota || nombreDe(m)
      || (m.tipo === 'transferencia' ? `A ${nombreCuenta(m.cuentaDestinoId)}` : '')
      || (m.categoriaId ? nombreCategoria(m.categoriaId) : TIPOS_MOVIMIENTO[m.tipo]);
    function subtitulo(m) {
      const cuenta = m.tipo === 'transferencia' ? `${nombreCuenta(m.cuentaId)} → ${nombreCuenta(m.cuentaDestinoId)}` : nombreCuenta(m.cuentaId);
      const partes = [cuenta];
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
    const signo = (m) => (m.tipo === 'ingreso' ? 1 : m.tipo === 'gasto' || m.tipo === 'abono' ? -1 : m.tipo === 'ajuste' ? Math.sign(m.monto) : 0);
    const porDia = computed(() => {
      const grupos = [];
      for (const m of lista.value) {
        let g = grupos[grupos.length - 1];
        if (!g || g.fecha !== m.fecha) {
          const [y, mes, d] = m.fecha.split('-').map(Number);
          const dia = DIA_SEMANA[new Date(y, mes - 1, d).getDay()];
          g = { fecha: m.fecha, titulo: `${dia} ${d} de ${MESES[mes - 1]}${f.todo ? ' de ' + y : ''}`, total: 0, movs: [] };
          grupos.push(g);
        }
        if (signo(m) < 0) g.total += Math.abs(m.monto);
        g.movs.push(m);
      }
      return grupos;
    });
    const totales = computed(() => {
      const gastos = lista.value.filter((m) => m.tipo === 'gasto' || m.tipo === 'abono');
      const ingresos = lista.value.filter((m) => m.tipo === 'ingreso');
      return {
        gastos: gastos.reduce((a, m) => a + m.monto, 0), nGastos: gastos.length,
        ingresos: ingresos.reduce((a, m) => a + m.monto, 0), nIngresos: ingresos.length,
      };
    });
    const montoConSigno = (m) => (signo(m) > 0 ? '+' : '') + fmt(signo(m) < 0 ? -Math.abs(m.monto) : Math.abs(m.monto));

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
      descargar(`movimientos-${f.todo ? 'todos' : store.periodo}-${hoy()}.csv`, '﻿' + csv(filas), 'text/csv;charset=utf-8');
    }

    return {
      store, f, verFiltros, masFiltros, alternar, lista, porDia, totales, titulo, subtitulo, signo, montoConSigno, exportar,
      fmt, fmtEntero, nombrePeriodo, editar: editarMovimiento, tipos: TIPOS_MOVIMIENTO, inicial: INICIAL,
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaCategorias: computed(categorias),
    };
  },
};
