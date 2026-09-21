import { store, fmt, fmtEntero, fmtMoneda, indice, vivos, grupos, nombrePersona, nombreCuenta, nombreCategoria, filtro, personaFiltro, colorPersona, personas, cuentas } from '../store.js';
import { presupuestoMensual, equivalenteMensual, equivalenteMensualL, esSuscripcion, monedaDe } from '../core/presupuesto.js';
import { estadoSuscripciones, resumenSuscripciones, cicloDe } from '../core/suscripciones.js';
import { ingresoMensual, pagosPorMes, planillaDe } from '../core/nomina.js';
import { estadoDe } from '../core/prestamos.js';
import { coincidePersona } from '../core/filtro.js';
import { SIN_GRUPO } from '../core/asientos.js';
import { colorGrupo } from '../core/reportes.js';
import { FORMAS, CICLOS } from '../core/modelo.js';
import { nombreMes, nombrePeriodo, redondear } from '../core/util.js';
import { prefs, definirVista } from '../tema.js';
import { BarraSegmentos } from './graficos.js';
import { Icono } from './componentes.js';
import { editarPartida, editarPrestamo, editarIngreso } from './formularios.js';

const { computed } = Vue;

const VISTAS = { grupo: 'Por grupo', persona: 'Por persona', medio: 'Por medio' };

export const VistaPresupuesto = {
  components: { BarraSegmentos, Icono },
  template: `
  <section class="pila">
    <p class="nota">Lo que el hogar paga, aparta o recibe cada mes. Los montos son promedios: un seguro de 10 meses cuenta 10/12 por mes y los décimos se reparten en el año.</p>

    <div class="kpis">
      <div class="kpi"><div class="kpi-et">Ingresos al mes</div><div class="kpi-val positivo">{{ fmtEntero(p.ingresos) }}</div><div class="kpi-nota">netos, con décimos</div></div>
      <div class="kpi"><div class="kpi-et">Egresos al mes</div><div class="kpi-val">{{ fmtEntero(p.egresos) }}</div><div class="kpi-nota">{{ p.planilla ? 'sin ' + fmt(p.planilla) + ' de cuotas por planilla' : 'partidas, préstamos y aportes' }}</div></div>
      <div class="kpi"><div class="kpi-et">Libre planificado</div><div class="kpi-val" :class="{ negativo: libre < 0 }">{{ fmtEntero(libre) }}</div><div class="kpi-nota">antes de gastos fuera del plan</div></div>
    </div>

    <div v-if="sinDefinir.length" class="aviso-banner ambar">
      <p>Sin monto todavía: {{ sinDefinir.join(', ') }}. Toca cada uno para definirlo.</p>
    </div>

    <article v-if="porPersona.length && !personaFiltro()" class="tarjeta">
      <h2 style="margin-bottom: 12px">Quién paga qué</h2>
      <barra-segmentos clase="media" :segmentos="porPersona"/>
      <ul class="lista" style="margin-top: 12px">
        <li v-for="x in porPersona" :key="x.id" class="fila compacta">
          <i class="punto" :style="{ background: x.color }"></i>
          <span style="flex: 1; font-size: 0.92rem">{{ x.nombre }}</span>
          <span class="monto">{{ fmt(x.valor) }}</span>
          <span class="tenue" style="width: 42px; text-align: right; font-size: 0.85rem">{{ x.pct }}</span>
        </li>
      </ul>
    </article>

    <article class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo"><i class="punto" style="background: var(--ok)"></i> Ingresos</h2>
        <span class="monto">{{ fmt(p.ingresos) }}</span><span class="tenue" style="font-size: 0.8rem">/mes</span>
      </div>
      <ul class="lista">
        <li v-for="x in filasIngresos" :key="x.id" class="fila clic" @click="editarIngreso(x.ingreso)">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ x.ingreso.nombre }}</span>
            <span class="fila-sub envuelve"><span v-for="c in x.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span></span>
          </div>
          <div class="derecha">
            <div class="monto">{{ fmt(x.ingreso.netoEsperado) }}</div>
            <div v-if="x.detalle" class="meta">{{ x.detalle }}</div>
          </div>
        </li>
      </ul>
      <p v-if="!filasIngresos.length" class="nota chica" style="padding-top: 8px">Todavía no hay salarios ni otros ingresos.</p>
      <div class="botones">
        <button type="button" class="btn" @click="editarIngreso({ personaId: personaFiltro() || undefined })">+ Agregar ingreso</button>
        <a class="btn" href="#/salarios">Salarios y deducciones</a>
      </div>
    </article>

    <a v-if="susc.cuantas" class="tarjeta enlace-tarjeta" href="#/suscripciones">
      <div class="fila-info">
        <span style="font-weight: 600">Suscripciones: {{ fmt(susc.alMes) }} al mes</span>
        <span class="fila-sub envuelve">{{ textoSuscripciones }}</span>
      </div>
      <icono n="der" :t="20"/>
    </a>

    <div class="segmentos" role="group" aria-label="Ver partidas">
      <button v-for="(n, k) in vistas" :key="k" type="button" :class="{ activo: prefs.vistaPresupuesto === k }" :aria-pressed="prefs.vistaPresupuesto === k" @click="definirVista('vistaPresupuesto', k)">{{ n }}</button>
    </div>

    <article v-for="s in secciones" :key="s.clave" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2 class="titulo-grupo"><i v-if="s.color" class="punto" :style="{ background: s.color }"></i> {{ s.titulo }}</h2>
        <span class="monto">{{ fmt(s.total) }}</span><span class="tenue" style="font-size: 0.8rem">/mes</span>
      </div>
      <ul class="lista">
        <li v-for="x in s.filas" :key="x.id" class="fila clic" @click="x.abrir()">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ x.nombre }}</span>
            <span class="fila-sub envuelve"><span v-for="c in x.chips" :key="c.t" class="chip" :class="c.c">{{ c.t }}</span></span>
          </div>
          <div class="derecha">
            <div class="monto">{{ x.monto }}</div>
            <div v-if="x.detalle" class="meta">{{ x.detalle }}</div>
          </div>
        </li>
      </ul>
      <button type="button" class="btn-punteado" style="margin-top: 14px" @click="s.agregar()">+ Agregar partida</button>
    </article>

    <p v-if="!secciones.length" class="vacio">No hay partidas todavía.</p>
    <button v-if="!secciones.length || prefs.vistaPresupuesto === 'grupo'" type="button" class="btn-punteado" @click="editarPartida({ responsableId: personaFiltro() || undefined })">+ Nueva partida</button>
    <a class="btn-link" href="#/categorias" style="align-self: center">Editar grupos y categorías</a>
  </section>`,
  setup() {
    const ix = computed(indice);
    const p = computed(() => presupuestoMensual(ix.value, store.periodo, filtro()));
    const libre = computed(() => p.value.ingresos - p.value.egresos);
    const porPersona = computed(() => {
      const total = p.value.egresos || 1;
      return Object.entries(p.value.porPersona)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id, valor]) => ({
          id, valor, nombre: id === 'sin' ? 'El hogar' : nombrePersona(id), color: id === 'sin' ? 'var(--tinta3)' : colorPersona(id),
          pct: `${Math.round((valor / total) * 100)}%`, titulo: `${id === 'sin' ? 'El hogar' : nombrePersona(id)} ${fmt(valor)}`,
        }));
    });
    const suscripciones = computed(() => estadoSuscripciones(ix.value, { hoy: store.hoy, filtro: filtro(), periodo: store.periodo }));
    const susc = computed(() => resumenSuscripciones(suscripciones.value));
    const textoSuscripciones = computed(() => {
      const r = susc.value;
      const partes = [`${r.cuantas} ${r.cuantas === 1 ? 'activa' : 'activas'}`, `${fmt(r.alAnio)} al año`];
      if (r.enDolares) partes.push(`${fmtMoneda(r.enDolares, 'USD')}/mes en dólares`);
      if (r.enPrueba) partes.push(`${r.enPrueba} en prueba gratis`);
      return partes.join(' · ');
    });
    const sinDefinir = computed(() => [
      ...vivos('partidas').filter((t) => t.activo !== false && !Number(t.tipo === 'anual' ? t.montoAnual : t.monto)).map((t) => t.nombre),
      ...vivos('ingresos').filter((t) => t.activo !== false && !Number(t.netoEsperado)).map((t) => t.nombre),
    ]);

    const filasIngresos = computed(() => vivos('ingresos').filter((i) => coincidePersona(i.personaId || null, filtro())).map((i) => {
      const chips = [{ t: nombrePersona(i.personaId), c: '' }];
      if (i.activo === false) chips.push({ t: 'inactivo', c: '' });
      if (!Number(i.netoEsperado)) chips.push({ t: 'sin monto', c: 'aviso' });
      const dia = (d) => (d >= 31 ? 'último día' : `día ${d}`);
      const dias = i.diasPago?.length ? i.diasPago : [31];
      chips.push({ t: i.frecuencia === 'quincenal' ? `quincenal · ${dias.map((d) => (d >= 31 ? 'último' : d)).join(' y ')}` : `mensual · ${dia(dias[0])}`, c: '' });
      if (i.decimo13 || i.decimo14) chips.push({ t: 'con décimos', c: 'acento' });
      const activas = (i.deducciones || []).filter((d) => d.activo !== false).length;
      if (activas) chips.push({ t: `${activas} ${activas === 1 ? 'deducción' : 'deducciones'}`, c: '' });
      const promedio = Number(i.netoEsperado) > 0 && (pagosPorMes(i) > 1 || i.decimo13 || i.decimo14);
      return { id: i.id, ingreso: i, chips, detalle: promedio ? `≈ ${fmt(ingresoMensual(i))}/mes` : '' };
    }));

    function filaPartida(t) {
      const chips = [];
      const meses = t.meses?.length || 12;
      const moneda = monedaDe(t);
      const suscripcion = esSuscripcion(t);
      const f = (n) => fmtMoneda(n, moneda);
      if (prefs.vistaPresupuesto !== 'persona') chips.push({ t: nombrePersona(t.responsableId), c: '' });
      if (t.activo === false) chips.push({ t: 'inactiva', c: '' });
      if (!Number(t.tipo === 'anual' ? t.montoAnual : t.monto)) chips.push({ t: 'sin monto', c: 'aviso' });
      if (suscripcion) chips.push({ t: `suscripción · ${CICLOS[cicloDe(t)].toLowerCase()}`, c: 'acento' });
      if (moneda === 'USD') chips.push({ t: 'US$', c: 'acento' });
      if (t.tipo === 'gasto' && !suscripcion && t.forma !== 'fijo') chips.push({ t: FORMAS[t.forma].toLowerCase(), c: t.forma === 'abonos' ? 'acento' : '' });
      if (t.tipo === 'aporte') chips.push({ t: 'aporte', c: 'acento' });
      if (t.tipo !== 'anual' && !suscripcion && meses < 12) chips.push({ t: `${meses} meses`, c: '' });
      if (t.dia) chips.push({ t: suscripcion ? `renueva el ${t.dia}` : `día ${t.dia}`, c: '' });
      if (t.acumula && !suscripcion) chips.push({ t: 'acumula', c: 'ok' });
      if (prefs.vistaPresupuesto !== 'medio' && t.medioPagoId && t.medioPagoId !== 'gastos') chips.push({ t: nombreCuenta(t.medioPagoId), c: '' });
      if (t.tipo === 'anual' && !t.mesPago) chips.push({ t: 'sin mes de pago', c: 'aviso' });
      if (prefs.vistaPresupuesto !== 'grupo' && t.categoriaId) chips.push({ t: nombreCategoria(t.categoriaId), c: '' });
      const alMes = redondear(equivalenteMensualL(ix.value, t));
      let monto = f(t.monto);
      const detalles = [];
      if (t.tipo === 'anual') {
        monto = `${f(t.montoAnual)} al año`;
        detalles.push(`aparta ${f(t.monto)}/mes${t.mesPago ? ' · se paga en ' + nombreMes(t.mesPago) : ''}`);
      } else if (t.tipo === 'aporte' && t.cuentaDestinoId) {
        detalles.push(`a ${nombreCuenta(t.cuentaDestinoId)}`);
      } else if (meses < 12 && moneda === 'L') {
        detalles.push(`≈ ${f(equivalenteMensual(t))}/mes`);
      }
      // En dólares, el equivalente en lempiras: es lo que suma en los totales del presupuesto.
      if (moneda === 'USD') detalles.push(`≈ ${fmt(alMes)}/mes`);
      const inactiva = t.activo === false || (t.hasta && store.periodo > t.hasta);
      return { id: t.id, nombre: t.nombre, persona: t.responsableId || null, grupoId: ix.value.grupoDe(t.categoriaId), medioId: t.medioPagoId || 'sin',
        valor: inactiva ? 0 : alMes, inactiva, chips, monto, detalle: detalles.join(' · '), abrir: () => editarPartida(t) };
    }
    function filaPrestamo(x) {
      const fin = estadoDe(ix.value, x).finEstimado;
      if (!fin || fin < store.periodo) return null;
      const planilla = planillaDe(ix.value, x.id);
      const chips = [{ t: 'préstamo', c: '' }];
      if (prefs.vistaPresupuesto !== 'persona') chips.unshift({ t: nombrePersona(x.responsableId), c: '' });
      if (planilla) chips.push({ t: `por planilla de ${planilla.ingreso.nombre}`, c: 'acento' });
      else if (x.dia) chips.push({ t: `día ${x.dia}`, c: '' });
      return { id: x.id, nombre: x.nombre, persona: x.responsableId || null, grupoId: ix.value.grupoDe(x.categoriaId || 'prestamos'), medioId: planilla ? 'planilla' : x.cuentaId || 'sin',
        // Una cuota por planilla ya viene descontada del neto: no suma en los egresos.
        valor: planilla ? 0 : Number(x.cuota) || 0, inactiva: false, chips, monto: fmt(x.cuota),
        detalle: planilla ? 'se descuenta del salario' : `hasta ${nombrePeriodo(fin, true)}`, abrir: () => editarPrestamo(x) };
    }

    const filas = computed(() => [
      ...vivos('prestamos').filter((x) => coincidePersona(x.responsableId, filtro())).map(filaPrestamo).filter(Boolean),
      ...vivos('partidas').filter((t) => coincidePersona(t.responsableId, filtro())).map(filaPartida),
    ]);

    const secciones = computed(() => {
      const vista = prefs.vistaPresupuesto;
      const orden = (lista) => lista.sort((a, b) => a.inactiva - b.inactiva || b.valor - a.valor || a.nombre.localeCompare(b.nombre));
      const seccion = (clave, titulo, color, lista, agregar) => ({ clave, titulo, color, filas: orden(lista), total: lista.reduce((a, x) => a + x.valor, 0), agregar });
      if (vista === 'persona') {
        const ids = [...personas().map((x) => x.id), null];
        return ids.map((id) => seccion(id || 'sin', id ? nombrePersona(id) : 'El hogar (sin responsable)', id ? colorPersona(id) : 'var(--tinta3)',
          filas.value.filter((x) => x.persona === id), () => editarPartida({ responsableId: id }))).filter((s) => s.filas.length);
      }
      if (vista === 'medio') {
        const ids = [...new Set([...cuentas().map((c) => c.id), ...filas.value.map((x) => x.medioId)])];
        return ids.map((id) => seccion(id, id === 'sin' ? 'Sin medio de pago' : id === 'planilla' ? 'Por planilla' : nombreCuenta(id), null,
          filas.value.filter((x) => x.medioId === id), () => editarPartida({ medioPagoId: id === 'sin' ? 'gastos' : id, responsableId: personaFiltro() || undefined })))
          .filter((s) => s.filas.length).sort((a, b) => b.total - a.total);
      }
      const x = ix.value;
      return [...grupos().map((g) => g.id), SIN_GRUPO].map((id) => {
        const primera = vivos('categorias').find((c) => c.grupoId === id && (c.tipo || 'gasto') === 'gasto');
        return seccion(id, id === SIN_GRUPO ? 'Sin grupo' : x.grupos.get(id)?.nombre || id, id === SIN_GRUPO ? 'var(--tinta3)' : colorGrupo(x, id),
          filas.value.filter((f) => f.grupoId === id), () => editarPartida({ categoriaId: primera?.id || null, responsableId: personaFiltro() || undefined }));
      }).filter((s) => s.filas.length);
    });

    return { store, prefs, p, libre, porPersona, susc, textoSuscripciones, sinDefinir, filasIngresos, secciones, vistas: VISTAS, definirVista, fmt, fmtEntero, fmtMoneda, editarPartida, editarIngreso, personaFiltro };
  },
};
