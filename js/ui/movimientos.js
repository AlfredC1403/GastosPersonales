import {
  store, fmt, fmtEntero, fmtMoneda, indice, vivos, buscar, personas, cuentas, categorias, grupos, partidas,
  nombreCuenta, nombreCategoria, nombrePersona, nombreGrupo, filtro,
} from '../store.js';
import { coincidePersona, personaDeMovimiento } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { colorGrupo } from '../core/reportes.js';
import { TIPOS_MOVIMIENTO, TIPOS_RECIBO, MONEDAS } from '../core/modelo.js';
import { nombrePeriodo, hoy, periodoDe, fechaCorta } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { Icono, descargar } from './componentes.js';
import { editarMovimiento, editarRecibo } from './formularios.js';

const { reactive, ref, computed } = Vue;

const TIPOS = { ...TIPOS_MOVIMIENTO, recibo: 'Salario o pago recibido' };
const INICIAL = { gasto: 'G', ingreso: 'I', recibo: 'I', transferencia: 'T', abono: 'A', ajuste: '±' };
const DIA_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
const VERBO = { gasto: 'pagó', abono: 'pagó', ingreso: 'recibió', recibo: 'recibió', transferencia: 'hizo' };
const AGRUPAR = { dia: 'Por día', grupo: 'Por grupo', medio: 'Por medio' };

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
      <select v-model="f.cuenta" aria-label="Medio de pago"><option value="">Todas las cuentas</option><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="f.grupo" aria-label="Grupo"><option value="">Todos los grupos</option><option v-for="g in listaGrupos" :key="g.id" :value="g.id">{{ g.nombre }}</option></select>
      <select v-model="f.categoria" aria-label="Categoría"><option value="">Todas las categorías</option><option v-for="c in listaCategorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="f.partida" aria-label="Partida"><option value="">Cualquier partida</option><option value="__fuera">Fuera del plan</option><option v-for="p in listaPartidas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select>
      <select v-model="f.moneda" aria-label="Moneda"><option value="">Todas las monedas</option><option v-for="(n, k) in monedas" :key="k" :value="k">{{ n }}</option></select>
      <select v-model="f.anoto" aria-label="Anotado por"><option value="">Anotado por cualquiera</option><option v-for="p in listaPersonas" :key="p.id" :value="p.id">Anotado por {{ p.nombre }}</option></select>
      <button type="button" class="btn" :disabled="!lista.length" @click="exportar"><icono n="descargar" :t="16"/> Exportar CSV</button>
    </div>
    <div class="chips-filtro">
      <button type="button" class="chip-filtro" :class="{ activo: !f.tipo }" @click="f.tipo = ''">Todos</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.tipo === 'gasto' }" @click="alternar('tipo', 'gasto')">Gastos</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.tipo === 'ingresos' }" @click="alternar('tipo', 'ingresos')">Ingresos</button>
      <button type="button" class="chip-filtro" :class="{ activo: f.todo }" @click="f.todo = !f.todo">Todos los meses</button>
    </div>

    <div class="kpis dos">
      <div class="kpi"><div class="kpi-et">Gastos</div><div class="kpi-val">{{ fmt(totales.gastos) }}</div><div class="kpi-nota">{{ totales.nGastos }} {{ totales.nGastos === 1 ? 'movimiento' : 'movimientos' }}</div></div>
      <div class="kpi"><div class="kpi-et">Ingresos</div><div class="kpi-val positivo">{{ fmt(totales.ingresos) }}</div><div class="kpi-nota">{{ totales.nIngresos }} {{ totales.nIngresos === 1 ? 'movimiento' : 'movimientos' }}</div></div>
    </div>

    <div class="segmentos" role="group" aria-label="Agrupar">
      <button v-for="(n, k) in agrupar" :key="k" type="button" :class="{ activo: prefs.agruparMovimientos === k }" :aria-pressed="prefs.agruparMovimientos === k" @click="definirVista('agruparMovimientos', k)">{{ n }}</button>
    </div>

    <p v-if="!lista.length" class="vacio">No hay movimientos{{ f.todo ? '' : ' en ' + nombrePeriodo(store.periodo) }} con esos filtros.</p>
    <div v-for="g in bloques" :key="g.clave">
      <div class="dia-cab">
        <i v-if="g.color" class="punto" :style="{ background: g.color }"></i>
        <span class="etiqueta">{{ g.titulo }}</span>
        <span class="linea"></span>
        <span class="total">{{ g.total ? '-' + fmtEntero(g.total) : '' }}</span>
      </div>
      <ul class="lista-mov">
        <li v-for="x in g.filas" :key="x.id" @click="abrir(x)">
          <span class="icono-tipo" :class="x.tipo" :title="tipos[x.tipo]">{{ inicial[x.tipo] }}</span>
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub">{{ x.subtitulo }}</span></div>
          <span class="monto" :class="{ positivo: x.signo > 0 }">{{ x.textoMonto }}</span>
        </li>
      </ul>
    </div>
  </section>`,
  setup() {
    const f = reactive({ q: '', tipo: '', anoto: '', cuenta: '', categoria: '', grupo: '', partida: '', moneda: '', todo: false });
    const verFiltros = ref(false);
    const masFiltros = computed(() => [f.cuenta, f.categoria, f.grupo, f.partida, f.moneda, f.anoto, f.tipo && !['gasto', 'ingresos'].includes(f.tipo)].filter(Boolean).length);
    const alternar = (campo, valor) => { f[campo] = f[campo] === valor ? '' : valor; };

    // Movimientos y pagos recibidos, con lo necesario para mostrarlos, filtrarlos y agruparlos.
    const registros = computed(() => {
      const ix = indice();
      const out = [];
      for (const m of vivos('movimientos')) {
        const nombreVinculo = buscar('partidas', m.partidaId)?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '';
        const categoriaId = m.categoriaId || (m.prestamoId && m.tipo === 'gasto' ? 'prestamos' : null);
        out.push({
          id: m.id, registro: m, tipo: m.tipo, fecha: m.fecha, periodo: m.periodo || periodoDe(m.fecha), monto: Number(m.monto) || 0,
          moneda: ix.monedaDe(m.cuentaId), cuentaId: m.cuentaId, cuentaDestinoId: m.cuentaDestinoId || null, categoriaId,
          grupoId: m.tipo === 'gasto' || m.tipo === 'ingreso' ? ix.grupoDe(categoriaId) : null, partidaId: m.partidaId || null,
          personaId: personaDeMovimiento(m, ix.cuentas), personaAnotada: m.personaId || null, creadoPor: m.creadoPor, nota: m.nota || '', nombreVinculo,
          titulo: m.nota || nombreVinculo || (m.tipo === 'transferencia' ? `A ${nombreCuenta(m.cuentaDestinoId)}` : '') || (categoriaId ? nombreCategoria(categoriaId) : TIPOS_MOVIMIENTO[m.tipo]),
        });
      }
      for (const r of vivos('recibos')) {
        const ingreso = ix.ingresos.get(r.ingresoId);
        const categoriaId = r.tipo === 'decimo13' || r.tipo === 'decimo14' ? 'decimos' : ingreso?.categoriaId || 'salario';
        const nombre = ingreso?.nombre || 'Ingreso';
        out.push({
          id: r.id, registro: r, tipo: 'recibo', fecha: r.fecha, periodo: r.periodo || periodoDe(r.ocurrencia || r.fecha), monto: Number(r.neto) || 0,
          moneda: ix.monedaDe(r.cuentaId), cuentaId: r.cuentaId, cuentaDestinoId: null, categoriaId, grupoId: ix.grupoDe(categoriaId), partidaId: null,
          personaId: r.personaId || ingreso?.personaId || null, personaAnotada: r.personaId || ingreso?.personaId || null, creadoPor: r.creadoPor, nota: r.nota || '', nombreVinculo: nombre,
          titulo: r.nota || (r.tipo === 'ordinario' ? `${nombre} · pago del ${fechaCorta(r.ocurrencia)}` : `${nombre} · ${TIPOS_RECIBO[r.tipo]?.toLowerCase() || 'pago'}`),
        });
      }
      return out;
    });

    function subtitulo(x) {
      const cuenta = x.tipo === 'transferencia' ? `${nombreCuenta(x.cuentaId)} → ${nombreCuenta(x.cuentaDestinoId)}` : nombreCuenta(x.cuentaId);
      const partes = [cuenta];
      if (x.categoriaId && x.titulo !== nombreCategoria(x.categoriaId) && x.tipo !== 'recibo') partes.push(nombreCategoria(x.categoriaId));
      const verbo = VERBO[x.tipo];
      if (x.personaAnotada && verbo && x.personaAnotada === x.creadoPor) partes.push(`${verbo} y anotó ${nombrePersona(x.personaAnotada)}`);
      else {
        if (x.personaAnotada && verbo) partes.push(`${verbo} ${nombrePersona(x.personaAnotada)}`);
        if (x.creadoPor) partes.push(`anotó ${nombrePersona(x.creadoPor)}`);
      }
      return partes.join(' · ');
    }
    const signo = (x) => (x.tipo === 'ingreso' || x.tipo === 'recibo' ? 1 : x.tipo === 'gasto' || x.tipo === 'abono' ? -1 : x.tipo === 'ajuste' ? Math.sign(x.monto) : 0);
    const buscable = (x) => [x.titulo, x.nota, x.nombreVinculo, nombreCategoria(x.categoriaId), nombreCuenta(x.cuentaId), String(x.monto)].join(' ').toLowerCase();

    const lista = computed(() => {
      const q = f.q.trim().toLowerCase();
      return registros.value
        .filter((x) => (f.todo || x.periodo === store.periodo)
          && (!f.tipo || (f.tipo === 'ingresos' ? x.tipo === 'ingreso' || x.tipo === 'recibo' : x.tipo === f.tipo))
          && coincidePersona(x.personaId, filtro())
          && (!f.anoto || x.creadoPor === f.anoto)
          && (!f.cuenta || x.cuentaId === f.cuenta || x.cuentaDestinoId === f.cuenta)
          && (!f.categoria || x.categoriaId === f.categoria)
          && (!f.grupo || x.grupoId === f.grupo)
          && (!f.partida || (f.partida === '__fuera' ? x.tipo === 'gasto' && !x.partidaId && !x.registro.prestamoId : x.partidaId === f.partida))
          && (!f.moneda || x.moneda === f.moneda)
          && (!q || buscable(x).includes(q)))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.registro.creado || '').localeCompare(a.registro.creado || ''))
        .map((x) => {
          const s = signo(x);
          return { ...x, signo: s, subtitulo: subtitulo(x), textoMonto: (s > 0 ? '+' : '') + fmtMoneda(s < 0 ? -Math.abs(x.monto) : Math.abs(x.monto), x.moneda) };
        });
    });

    const bloques = computed(() => {
      const modo = prefs.agruparMovimientos;
      const ix = indice();
      const out = [];
      const porClave = new Map();
      for (const x of lista.value) {
        let clave;
        let titulo;
        let color = null;
        if (modo === 'grupo') {
          clave = x.grupoId || 'otros';
          titulo = !x.grupoId ? 'Transferencias, abonos y ajustes' : x.grupoId === SIN_GRUPO ? 'Sin grupo' : nombreGrupo(x.grupoId);
          color = x.grupoId && x.grupoId !== SIN_GRUPO ? colorGrupo(ix, x.grupoId) : 'var(--tinta3)';
        } else if (modo === 'medio') {
          clave = x.cuentaId || 'sin';
          titulo = nombreCuenta(x.cuentaId);
        } else {
          clave = x.fecha;
          const [y, mes, d] = x.fecha.split('-').map(Number);
          titulo = `${DIA_SEMANA[new Date(y, mes - 1, d).getDay()]} ${d} de ${MESES[mes - 1]}${f.todo ? ' de ' + y : ''}`;
        }
        let g = porClave.get(clave);
        if (!g) {
          g = { clave, titulo, color, total: 0, filas: [] };
          porClave.set(clave, g);
          out.push(g);
        }
        if (x.signo < 0) g.total += Math.abs(ix.enLempiras(x.monto, x.moneda, x.registro.tasa).c) / 100;
        g.filas.push(x);
      }
      if (modo === 'grupo') {
        const orden = [...ix.ordenGrupos, SIN_GRUPO, 'otros'];
        out.sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
      } else if (modo === 'medio') out.sort((a, b) => b.total - a.total);
      return out;
    });

    const totales = computed(() => {
      const ix = indice();
      const enL = (x) => ix.enLempiras(x.monto, x.moneda, x.registro.tasa).c / 100;
      const gastos = lista.value.filter((x) => x.tipo === 'gasto' || x.tipo === 'abono');
      const ingresos = lista.value.filter((x) => x.tipo === 'ingreso' || x.tipo === 'recibo');
      return {
        gastos: gastos.reduce((a, x) => a + enL(x), 0), nGastos: gastos.length,
        ingresos: ingresos.reduce((a, x) => a + enL(x), 0), nIngresos: ingresos.length,
      };
    });

    function exportar() {
      const quien = (id) => (id ? nombrePersona(id) : '');
      const cuando = (iso) => (iso ? fechaHora.format(new Date(iso)) : '');
      const filas = [
        ['Fecha', 'Mes', 'Tipo', 'Monto', 'Moneda', 'Tasa', 'Cuenta', 'Cuenta destino', 'Grupo', 'Categoría', 'Partida o préstamo', 'Comercio', 'Persona', 'Nota', 'Anotó', 'Anotado', 'Editó', 'Editado'],
        ...lista.value.map((x) => [
          x.fecha, x.periodo, TIPOS[x.tipo], x.monto, x.moneda, x.registro.tasa || '', nombreCuenta(x.cuentaId), x.cuentaDestinoId ? nombreCuenta(x.cuentaDestinoId) : '',
          x.grupoId && x.grupoId !== SIN_GRUPO ? nombreGrupo(x.grupoId) : '', x.categoriaId ? nombreCategoria(x.categoriaId) : '', x.nombreVinculo, '',
          quien(x.personaAnotada), x.nota, quien(x.registro.creadoPor), cuando(x.registro.creado), quien(x.registro.actualizadoPor), cuando(x.registro.actualizado),
        ]),
      ];
      // El BOM hace que Excel abra el archivo con acentos y ñ correctos.
      descargar(`movimientos-${f.todo ? 'todos' : store.periodo}-${hoy()}.csv`, '﻿' + csv(filas), 'text/csv;charset=utf-8');
    }

    return {
      store, prefs, f, verFiltros, masFiltros, alternar, lista, bloques, totales, exportar, definirVista,
      fmt, fmtEntero, nombrePeriodo, tipos: TIPOS, inicial: INICIAL, agrupar: AGRUPAR, monedas: MONEDAS,
      abrir: (x) => (x.tipo === 'recibo' ? editarRecibo(x.registro) : editarMovimiento(x.registro)),
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaCategorias: computed(categorias),
      listaGrupos: computed(grupos), listaPartidas: computed(partidas),
    };
  },
};
