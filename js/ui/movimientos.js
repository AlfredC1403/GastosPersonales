import {
  store, fmt, fmtEntero, fmtMoneda, indice, vivos, buscar, personas, cuentas, categorias, grupos, partidas,
  nombreCuenta, nombreCategoria, nombrePersona, nombreGrupo, filtro, anioCargado, aniosDeLaCarpeta,
} from '../store.js';
import { coincidePersona, personaDeMovimiento } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { colorGrupo } from '../core/reportes.js';
import { TIPOS_MOVIMIENTO, TIPOS_RECIBO, MONEDAS } from '../core/modelo.js';
import { TIPOS_FINANCIAMIENTO, comisionInmediata } from '../core/tarjetas.js';
import { estadoRecibo } from '../core/nomina.js';
import { nombrePeriodo, hoy, periodoDe, fechaCorta, nombreMes, DIAS_CORTOS } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { Icono, descargar } from './componentes.js';
import { editarMovimiento, editarRecibo } from './formularios.js';
import { editarFinanciamiento } from './formularios-financiamientos.js';

const { reactive, ref, computed } = Vue;

const TIPOS = { ...TIPOS_MOVIMIENTO, recibo: 'Salario o pago recibido', cuota: 'Cuota de un financiamiento', cargo: 'Cargo de tarjeta', financiamiento: 'Financiamiento de tarjeta' };
const INICIAL = { gasto: 'G', ingreso: 'I', recibo: 'I', transferencia: 'T', abono: 'A', ajuste: '±', pago_tarjeta: 'P', cuota: 'C', cargo: 'C', financiamiento: 'F' };
// Lo que cuenta como gasto en los totales (con el chip "Gastos").
const ES_GASTO = ['gasto', 'cuota', 'cargo'];
const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
const VERBO = { gasto: 'pagó', cuota: 'pagó', abono: 'pagó', pago_tarjeta: 'pagó', ingreso: 'recibió', recibo: 'recibió', transferencia: 'hizo' };
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
      <button v-if="hayPendientes" type="button" class="chip-filtro" :class="{ activo: f.pendientes }" @click="f.pendientes = !f.pendientes">Deducciones pendientes</button>
    </div>
    <p v-if="f.todo && aniosFuera.length" class="nota chica">Sin {{ aniosFuera.join(', ') }}: {{ aniosFuera.length === 1 ? 'está' : 'están' }} en OneDrive. Se abren en <a href="#/anios">Años anteriores</a>.</p>

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
          <div class="fila-info"><span class="fila-titulo" style="font-size: 0.93rem">{{ x.titulo }}</span><span class="fila-sub"><span v-if="x.quien" class="chip-quien" :class="{ otro: x.quien.otro }" :title="x.quien.detalle">{{ x.quien.nombre }}</span>{{ x.subtitulo }}</span></div>
          <div class="derecha">
            <div class="monto" :class="{ positivo: x.signo > 0 }">{{ x.textoMonto }}</div>
            <div v-if="x.textoLempiras" class="dif tenue">{{ x.textoLempiras }}</div>
          </div>
        </li>
      </ul>
    </div>
  </section>`,
  setup() {
    const f = reactive({ q: '', tipo: '', anoto: '', cuenta: '', categoria: '', grupo: '', partida: '', moneda: '', todo: false, pendientes: false });
    const verFiltros = ref(false);
    const masFiltros = computed(() => [f.cuenta, f.categoria, f.grupo, f.partida, f.moneda, f.anoto, f.tipo && !['gasto', 'ingresos'].includes(f.tipo)].filter(Boolean).length);
    const alternar = (campo, valor) => { f[campo] = f[campo] === valor ? '' : valor; };

    // Movimientos, pagos recibidos, cuotas de las compras a cuotas y cargos de las tarjetas, con lo
    // necesario para mostrarlos, filtrarlos y agruparlos. `enL`: el monto en lempiras.
    const registros = computed(() => {
      const ix = indice();
      const out = [];
      const nombreComercio = (m) => (m.comercioId ? ix.comercios.get(m.comercioId)?.nombre || '' : '');
      // También los de un año anterior que no está en el dispositivo y cuentan en los años cargados
      // (una compra a cuotas que se sigue cobrando, un pago de enero hecho en diciembre).
      const previos = (coleccion) => (ix.previos ? ix.doc[coleccion].filter((r) => ix.previos.has(r.id) && !r.borrado) : []);
      for (const m of [...vivos('movimientos'), ...previos('movimientos')]) {
        const nombreVinculo = buscar('partidas', m.partidaId)?.nombre || buscar('prestamos', m.prestamoId)?.nombre || '';
        const categoriaId = m.categoriaId || (m.prestamoId && m.tipo === 'gasto' ? 'prestamos' : null);
        const comercio = nombreComercio(m);
        const base = {
          id: m.id, registro: m, tipo: m.tipo, fecha: m.fecha, periodo: m.periodo || periodoDe(m.fecha), monto: Number(m.monto) || 0,
          moneda: ix.monedaDeMovimiento(m), cuentaId: m.cuentaId, cuentaDestinoId: m.cuentaDestinoId || null, categoriaId,
          grupoId: m.tipo === 'gasto' || m.tipo === 'ingreso' ? ix.grupoDe(categoriaId) : null, partidaId: m.partidaId || null,
          personaId: personaDeMovimiento(m, ix.cuentas), personaAnotada: m.personaId || null, creadoPor: m.creadoPor, nota: m.nota || '', nombreVinculo, comercio,
          titulo: m.nota || comercio || nombreVinculo || (m.tipo === 'transferencia' ? `A ${nombreCuenta(m.cuentaDestinoId)}` : '')
            || (m.tipo === 'pago_tarjeta' ? `Pago de ${nombreCuenta(m.cuentaDestinoId)}` : '') || (categoriaId ? nombreCategoria(categoriaId) : TIPOS_MOVIMIENTO[m.tipo]),
          abrir: () => editarMovimiento(m),
        };
        const t = ix.tarjetas.get(m.cuentaId);
        if (m.tipo === 'gasto' && m.cuotas && t) {
          // El financiamiento no mueve dinero el día que se firma: lo que se cobra son sus cuotas.
          // Aun así se muestra en su mes, porque si no, quien lo acaba de registrar no lo ve en
          // ninguna parte (su primera cuota puede caer el mes siguiente). No cuenta en los totales.
          const lista = t.cuotas.get(m.id) || [];
          const primera = lista[0];
          // Comisión registrada como gasto del mes: es un cargo de la tarjeta ese día, y cuenta en
          // los totales del mes. Sin esta fila estaría en los totales pero no en la lista.
          const comision = comisionInmediata(t.cuenta, m);
          if (comision) {
            out.push({
              ...base, id: `${m.id}:comision`, tipo: 'cargo', fecha: comision.fecha, periodo: comision.periodo,
              monto: comision.c / 100, enL: comision.c / 100, moneda: 'L',
              categoriaId: 'cargos-tarjeta', grupoId: ix.grupoDe('cargos-tarjeta'), partidaId: null,
              titulo: `Comisión · ${base.titulo}`, abrir: () => editarFinanciamiento(m),
            });
          }
          if (primera) {
            out.push({
              ...base, id: `${m.id}:financiamiento`, tipo: 'financiamiento', monto: 0, enL: 0, moneda: 'L',
              titulo: `${base.titulo} · ${TIPOS_FINANCIAMIENTO[m.cuotas?.tipo === 'extra' ? 'extra' : 'intra'].toLowerCase()}`,
              financiado: Number(m.monto) || 0, cuotasN: primera.n, primeraCuota: primera,
              abrir: () => editarFinanciamiento(m),
            });
          }
          // Una fila por cuota, en el mes en que se cobra.
          for (const q of lista) {
            if (ix.previos?.has(m.id) && q.periodo < ix.apertura.mes) continue;
            out.push({
              ...base, id: `${m.id}:${q.k}`, tipo: 'cuota', fecha: q.fecha, periodo: q.periodo, monto: q.c / 100, moneda: 'L', enL: q.c / 100,
              titulo: `${base.titulo} · ${q.cancelacion ? 'cancelación' : `cuota ${q.k} de ${q.n}`}`, compra: m.fecha, interes: q.interes / 100, comision: q.comision / 100,
            });
          }
          continue;
        }
        const l = m.tipo === 'pago_tarjeta' ? null : ix.montoEnLempiras(m);
        out.push({ ...base, enL: l ? l.c / 100 : 0, estimado: !!l?.estimado && base.moneda === 'USD' });
      }
      for (const r of [...vivos('recibos'), ...previos('recibos')]) {
        const ingreso = ix.ingresos.get(r.ingresoId);
        const categoriaId = r.tipo === 'decimo13' || r.tipo === 'decimo14' ? 'decimos' : ingreso?.categoriaId || 'salario';
        const nombre = ingreso?.nombre || 'Ingreso';
        const moneda = ix.monedaDe(r.cuentaId);
        out.push({
          id: r.id, registro: r, tipo: 'recibo', fecha: r.fecha, periodo: r.periodo || periodoDe(r.ocurrencia || r.fecha), monto: Number(r.neto) || 0,
          moneda, enL: ix.enLempiras(r.neto, moneda).c / 100, cuentaId: r.cuentaId, cuentaDestinoId: null, categoriaId, grupoId: ix.grupoDe(categoriaId), partidaId: null,
          personaId: r.personaId || ingreso?.personaId || null, personaAnotada: r.personaId || ingreso?.personaId || null, creadoPor: r.creadoPor, nota: r.nota || '', nombreVinculo: nombre, comercio: '',
          faltan: estadoRecibo(r).pendientes,
          titulo: r.nota || (r.tipo === 'ordinario' ? `${nombre} · pago del ${fechaCorta(r.ocurrencia)}` : `${nombre} · ${TIPOS_RECIBO[r.tipo]?.toLowerCase() || 'pago'}`),
          abrir: () => editarRecibo(r),
        });
      }
      for (const t of ix.tarjetas.values()) {
        for (const cargo of t.cargos) {
          const l = cargo.moneda === 'USD' ? t.tasas.get(cargo.clave) || { c: Math.round(cargo.c * t.ultimaTasa), estimado: true } : { c: cargo.c, estimado: false };
          out.push({
            id: cargo.clave, registro: { creado: '' }, tipo: 'cargo', fecha: cargo.fecha, periodo: cargo.periodo, monto: cargo.c / 100, moneda: cargo.moneda, enL: l.c / 100,
            estimado: cargo.moneda === 'USD' && l.estimado, cuentaId: t.cuenta.id, cuentaDestinoId: null, categoriaId: 'cargos-tarjeta', grupoId: ix.grupoDe('cargos-tarjeta'), partidaId: null,
            personaId: t.cuenta.titularId || null, personaAnotada: null, creadoPor: null, nota: '', nombreVinculo: '', comercio: '',
            titulo: cargo.cargo.nombre, abrir: () => { location.hash = `#/tarjeta/${t.cuenta.id}/${cargo.fecha}`; },
          });
        }
      }
      return out;
    });

    // Quién pagó (o recibió) va en un chip al principio de la fila: azul si también lo anotó y
    // amarillo si lo anotó otra persona. Quién anotó queda en el título del chip y en el movimiento.
    function quienDe(x) {
      const verbo = VERBO[x.tipo];
      const personaId = x.personaAnotada || x.personaId;
      if (!verbo || !personaId) return null;
      const nombre = nombrePersona(personaId);
      const otro = !!x.creadoPor && x.creadoPor !== personaId;
      return { nombre, otro, detalle: otro ? `${nombre} ${verbo} · anotó ${nombrePersona(x.creadoPor)}` : `${nombre} ${verbo}${x.creadoPor ? ' y anotó' : ''}` };
    }

    function subtitulo(x) {
      const cuenta = x.tipo === 'transferencia' || x.tipo === 'pago_tarjeta' ? `${nombreCuenta(x.cuentaId)} → ${nombreCuenta(x.cuentaDestinoId)}` : nombreCuenta(x.cuentaId);
      const partes = [cuenta];
      if (x.tipo === 'cuota') {
        partes.push(`compra del ${fechaCorta(x.compra)}`);
        if (x.interes || x.comision) partes.push(`incluye ${[x.interes ? `intereses ${fmt(x.interes)}` : '', x.comision ? `comisión ${fmt(x.comision)}` : ''].filter(Boolean).join(' y ')}`);
      }
      if (x.tipo === 'financiamiento') {
        partes.push(`${fmt(x.financiado)} a ${x.cuotasN} cuotas`);
        partes.push(`primera cuota el ${fechaCorta(x.primeraCuota.fecha)}`);
      }
      if (x.tipo === 'pago_tarjeta') {
        const m = x.registro;
        const pagado = [Number(m.pagoL) ? fmtMoneda(m.pagoL, 'L') : '', Number(m.pagoUSD) ? `${fmtMoneda(m.pagoUSD, 'USD')}${m.tasa ? ' a ' + m.tasa : ''}` : ''].filter(Boolean).join(' + ');
        if (pagado) partes.push(pagado);
      }
      if (x.faltan) partes.push(x.faltan === 1 ? 'falta 1 deducción' : `faltan ${x.faltan} deducciones`);
      if (x.categoriaId && x.titulo !== nombreCategoria(x.categoriaId) && x.tipo !== 'recibo') partes.push(nombreCategoria(x.categoriaId));
      return partes.join(' · ');
    }
    const signo = (x) => (x.tipo === 'ingreso' || x.tipo === 'recibo' ? 1 : ES_GASTO.includes(x.tipo) || x.tipo === 'abono' ? -1 : x.tipo === 'ajuste' ? Math.sign(x.monto) : 0);
    const buscable = (x) => [x.titulo, x.nota, x.nombreVinculo, x.comercio, nombreCategoria(x.categoriaId), nombreCuenta(x.cuentaId), String(x.monto)].join(' ').toLowerCase();

    const lista = computed(() => {
      const ix = indice();
      const q = f.q.trim().toLowerCase();
      return registros.value
        // En "Todos los meses" no salen las cuotas que todavía no se cobran.
        .filter((x) => (f.todo ? !(x.tipo === 'cuota' && x.fecha > store.hoy) : x.periodo === store.periodo)
          && (!f.tipo || (f.tipo === 'ingresos' ? x.tipo === 'ingreso' || x.tipo === 'recibo' : f.tipo === 'gasto' ? ES_GASTO.includes(x.tipo) : x.tipo === f.tipo))
          && coincidePersona(x.personaId, filtro())
          && (!f.anoto || x.creadoPor === f.anoto)
          && (!f.cuenta || x.cuentaId === f.cuenta || x.cuentaDestinoId === f.cuenta)
          && (!f.categoria || x.categoriaId === f.categoria)
          && (!f.grupo || x.grupoId === f.grupo)
          && (!f.partida || (f.partida === '__fuera' ? x.tipo === 'gasto' && !x.partidaId && !x.registro.prestamoId : x.partidaId === f.partida))
          && (!f.moneda || x.moneda === f.moneda)
          && (!f.pendientes || x.faltan > 0)
          && (!q || buscable(x).includes(q)))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.registro.creado || '').localeCompare(a.registro.creado || ''))
        .map((x) => {
          const s = signo(x);
          const textoLempiras = x.moneda === 'USD' && x.enL ? `${x.estimado ? '≈ ' : ''}${fmt(x.enL)}${x.estimado && ix.esTarjeta(x.cuentaId) ? ' al pagar' : ''}` : '';
          const textoMonto = x.tipo === 'financiamiento'
            ? fmt(x.financiado) // lo financiado, no un movimiento del mes
            : (s > 0 ? '+' : '') + fmtMoneda(s < 0 ? -Math.abs(x.monto) : Math.abs(x.monto), x.moneda);
          return { ...x, signo: s, quien: quienDe(x), subtitulo: subtitulo(x), textoMonto, textoLempiras: x.tipo === 'financiamiento' ? 'no se cobra hoy' : textoLempiras };
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
          titulo = !x.grupoId ? 'Transferencias, pagos, abonos y ajustes' : x.grupoId === SIN_GRUPO ? 'Sin grupo' : nombreGrupo(x.grupoId);
          color = x.grupoId && x.grupoId !== SIN_GRUPO ? colorGrupo(ix, x.grupoId) : 'var(--tinta3)';
        } else if (modo === 'medio') {
          clave = x.cuentaId || 'sin';
          titulo = nombreCuenta(x.cuentaId);
        } else {
          clave = x.fecha;
          const [y, mes, d] = x.fecha.split('-').map(Number);
          titulo = `${DIAS_CORTOS[new Date(y, mes - 1, d).getDay()]} ${d} de ${nombreMes(mes)}${f.todo ? ' de ' + y : ''}`;
        }
        let g = porClave.get(clave);
        if (!g) {
          g = { clave, titulo, color, total: 0, filas: [] };
          porClave.set(clave, g);
          out.push(g);
        }
        if (x.signo < 0) g.total += Math.abs(x.enL);
        g.filas.push(x);
      }
      if (modo === 'grupo') {
        const orden = [...ix.ordenGrupos, SIN_GRUPO, 'otros'];
        out.sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
      } else if (modo === 'medio') out.sort((a, b) => b.total - a.total);
      return out;
    });

    const totales = computed(() => {
      const gastos = lista.value.filter((x) => ES_GASTO.includes(x.tipo) || x.tipo === 'abono');
      const ingresos = lista.value.filter((x) => x.tipo === 'ingreso' || x.tipo === 'recibo');
      const suma = (filas) => filas.reduce((a, x) => a + Math.round(x.enL * 100), 0) / 100;
      return { gastos: suma(gastos), nGastos: gastos.length, ingresos: suma(ingresos), nIngresos: ingresos.length };
    });

    function exportar() {
      const quien = (id) => (id ? nombrePersona(id) : '');
      const cuando = (iso) => (iso ? fechaHora.format(new Date(iso)) : '');
      const filas = [
        ['Fecha', 'Mes', 'Tipo', 'Monto', 'Moneda', 'En lempiras', 'Tasa', 'Cuenta', 'Cuenta destino', 'Grupo', 'Categoría', 'Partida o préstamo', 'Comercio', 'Persona', 'Nota', 'Anotó', 'Anotado', 'Editó', 'Editado'],
        ...lista.value.map((x) => [
          x.fecha, x.periodo, TIPOS[x.tipo], x.monto, x.moneda, x.tipo === 'pago_tarjeta' ? '' : x.enL, x.registro.tasa || '', nombreCuenta(x.cuentaId), x.cuentaDestinoId ? nombreCuenta(x.cuentaDestinoId) : '',
          x.grupoId && x.grupoId !== SIN_GRUPO ? nombreGrupo(x.grupoId) : '', x.categoriaId ? nombreCategoria(x.categoriaId) : '', x.nombreVinculo, x.comercio,
          quien(x.personaAnotada), x.nota, quien(x.registro.creadoPor), cuando(x.registro.creado), quien(x.registro.actualizadoPor), cuando(x.registro.actualizado),
        ]),
      ];
      // El BOM hace que Excel abra el archivo con acentos y ñ correctos.
      descargar(`movimientos-${f.todo ? 'todos' : store.periodo}-${hoy()}.csv`, '﻿' + csv(filas), 'text/csv;charset=utf-8');
    }

    const hayPendientes = computed(() => registros.value.some((x) => x.faltan > 0));
    // Años de OneDrive que no están en este dispositivo (no salen en Todos los meses).
    const aniosFuera = computed(() => {
      void store.rev;
      return aniosDeLaCarpeta().filter((a) => !anioCargado(a));
    });
    return {
      store, prefs, f, verFiltros, masFiltros, alternar, lista, bloques, totales, exportar, definirVista, hayPendientes, aniosFuera,
      fmt, fmtEntero, nombrePeriodo, tipos: TIPOS, inicial: INICIAL, agrupar: AGRUPAR, monedas: MONEDAS,
      abrir: (x) => x.abrir(),
      listaPersonas: computed(personas), listaCuentas: computed(cuentas), listaCategorias: computed(categorias),
      listaGrupos: computed(grupos), listaPartidas: computed(partidas),
    };
  },
};
