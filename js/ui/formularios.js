// Punto de entrada de los formularios: los atajos que abre el resto de la app (`editarPartida`,
// `nuevoMovimiento`, `marcarItem`…) y el detalle de una partida, cuota o ingreso en un mes.
// Cada formulario vive en su propio archivo:
//   formularios-movimiento.js  el movimiento (gasto, ingreso, transferencia, abono, ajuste)
//   formularios-partidas.js    la partida del presupuesto y su ajuste de un mes
//   formularios-nomina.js      el ingreso, el pago recibido y las deducciones
//   formularios-catalogos.js   préstamos, cuentas, personas, grupos y categorías
//   formularios-tarjetas.js    la tarjeta de crédito y el pago de la tarjeta
import {
  store, guardar, borrar, aviso, abrirModal, cerrarModal, indice, vivos, buscar, nombreCuenta, nombrePersona, fmt, fmtMoneda,
} from '../store.js';
import { partesDelMes, movimientoParaItem, quedaParaPagar } from '../core/presupuesto.js';
import { reciboSugerido, pagosParaRegistrar, estadoRecibo } from '../core/nomina.js';
import { itemDeRecordatorio } from '../core/recordatorios.js';
import { resumenMes } from '../core/reportes.js';
import { hoy, nombrePeriodo, fechaCorta, sumarMeses, redondear } from '../core/util.js';
import { hayValor, textoDePartida } from './formulario-base.js';
import { MovimientoForm } from './formularios-movimiento.js';
import { PartidaForm, AjusteMesForm } from './formularios-partidas.js';
import { IngresoForm, ReciboForm, DeduccionForm } from './formularios-nomina.js';
import { PrestamoForm, CuentaForm, PersonaForm, GrupoForm, CategoriaForm } from './formularios-catalogos.js';
import { editarTarjeta, pagarTarjeta, editarPagoTarjeta } from './formularios-tarjetas.js';
import { editarFinanciamiento } from './formularios-financiamientos.js';

const { computed } = Vue;

// Los formularios y el texto de partida se siguen pidiendo por aquí: es la puerta de entrada.
export { textoDePartida } from './formulario-base.js';
export { MovimientoForm } from './formularios-movimiento.js';
export { PartidaForm, AjusteMesForm } from './formularios-partidas.js';
export { IngresoForm, ReciboForm, DeduccionForm, nuevaQuincena } from './formularios-nomina.js';
export { PrestamoForm, CuentaForm, PersonaForm, GrupoForm, CategoriaForm } from './formularios-catalogos.js';
export { FinanciamientoForm, nuevoFinanciamiento, editarFinanciamiento } from './formularios-financiamientos.js';

// ---------------------------------------------------------------- Detalle de una partida, cuota o ingreso en un mes

const ESTADOS = {
  pendiente: { texto: 'Pendiente', clase: '' },
  parcial: { texto: 'En abonos', clase: 'aviso' },
  completo: { texto: 'Completa', clase: 'ok' },
  excedido: { texto: 'Se pasó', clase: 'aviso' },
  omitida: { texto: 'Omitida este mes', clase: '' },
};

export const DetalleItem = {
  props: { clave: String, periodo: String },
  emits: ['listo'],
  template: `
  <div v-if="it" class="formulario">
    <div>
      <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">
        <span class="hero-num md">{{ f(x.real) }}</span>
        <span class="tenue">de {{ f(x.esperado) }}</span>
        <span class="espacio"></span>
        <span class="chip" :class="estado.clase">{{ estado.texto }}</span>
      </div>
      <div class="progreso" style="margin-top: 10px"><div :style="{ width: pct + '%', background: it.estado === 'excedido' ? 'var(--ambar)' : null }"></div></div>
      <p class="nota" style="margin-top: 8px">{{ resumen }}</p>
      <p v-if="enDolares" class="nota chica">En lempiras: {{ fmt(it.real) }} pagados de {{ fmt(it.esperado) }} estimados con la tasa de referencia.</p>
      <p v-if="x.arrastre > 0" class="nota chica">Incluye {{ f(x.arrastre) }} que sobraron de meses anteriores.</p>
      <p v-if="it.ajuste && !it.omitida" class="nota chica">Este mes: {{ f(x.base) }} en vez del monto de siempre.</p>
      <p v-if="it.planilla" class="nota chica">Se descuenta de {{ it.planilla.ingreso.nombre }}: {{ it.planilla.descontados }} de {{ it.planilla.esperados }} {{ it.planilla.esperados === 1 ? 'descuento' : 'descuentos' }} este mes.</p>
    </div>

    <div>
      <h3 class="titulo-grupo">{{ it.tipoItem === 'ingreso' ? 'Recibido' : 'Pagos del mes' }}</h3>
      <ul v-if="registros.length" class="lista">
        <li v-for="r in registros" :key="r.id" class="fila clic" @click="r.abrir()">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.92rem">{{ fechaCorta(r.fecha) }}{{ r.cierra ? ' · cerró la partida' : '' }}</span>
            <span class="fila-sub">{{ r.texto }}</span>
          </div>
          <span class="monto">{{ fmtMoneda(r.monto, r.moneda) }}</span>
        </li>
      </ul>
      <p v-else class="nota chica" style="padding: 6px 0">Todavía no hay nada registrado.</p>
    </div>

    <div class="acciones" style="flex-wrap: wrap">
      <button v-if="it.tipoItem === 'partida'" type="button" class="btn" @click="solo">Cambiar solo este mes</button>
      <button v-if="it.estado === 'parcial' && it.tipoItem === 'partida'" type="button" class="btn" @click="cerrarPartida">Cerrar la partida</button>
      <button v-if="faltanDeducciones" type="button" class="btn" @click="completar">Completar deducciones</button>
      <button type="button" class="btn" @click="editarPlantilla">{{ textoEditar }}</button>
      <span class="espacio"></span>
      <button v-if="puedeRegistrar" type="button" class="btn primario" style="margin-left: auto" @click="registrar">{{ it.tipoItem === 'ingreso' ? 'Registrar lo recibido' : 'Registrar un pago' }}</button>
    </div>
  </div>
  <p v-else class="vacio">Esta partida ya no aplica en {{ nombrePeriodo(periodo) }}.</p>`,
  setup(props, { emit }) {
    const it = computed(() => itemsDelMes(props.periodo).find((x) => x.clave === props.clave));
    const estado = computed(() => (it.value?.tipoItem === 'ingreso'
      ? (it.value.hecho ? { texto: 'Recibido', clase: 'ok' } : { texto: 'Pendiente', clase: '' })
      : ESTADOS[it.value?.estado] || ESTADOS.pendiente));
    // Un item en dólares se mide en dólares; lo de lempiras se ve aparte, como estimado.
    const enDolares = computed(() => it.value?.moneda === 'USD');
    const x = computed(() => (enDolares.value ? it.value.enMoneda : it.value));
    const f = (v) => fmtMoneda(v, it.value?.moneda || 'L');
    const pct = computed(() => (x.value?.esperado ? Math.min(100, (x.value.real / x.value.esperado) * 100) : x.value?.real ? 100 : 0));
    const resumen = computed(() => {
      const v = x.value;
      if (it.value.tipoItem === 'ingreso') return it.value.hecho ? `Se esperaban ${f(v.esperado)}.` : `Se esperan ${f(v.esperado)} el ${fechaCorta(it.value.fecha)}.`;
      if (it.value.estado === 'omitida') return 'Este mes no se paga.';
      if (it.value.enPrueba) return `En prueba gratis hasta el ${fechaCorta(it.value.partida.pruebaHasta)}: este mes no cobra.`;
      if (it.value.estado === 'parcial' || it.value.estado === 'pendiente') return `Quedan ${f(v.queda)}.`;
      if (it.value.estado === 'excedido') return `${f(v.real - v.esperado)} más de lo previsto.`;
      return v.sobrante > 0 ? `Cerrada con ${f(v.sobrante)} de sobra${it.value.acumula ? ', que pasan al mes siguiente' : ''}.` : 'Pagada completa.';
    });
    const subtitulo = (r, verbo) => {
      const partes = [];
      if (r.personaId) partes.push(`${verbo} ${nombrePersona(r.personaId)}`);
      if (r.creadoPor && r.creadoPor !== r.personaId) partes.push(`anotó ${nombrePersona(r.creadoPor)}`);
      partes.push(nombreCuenta(r.cuentaId));
      return partes.join(' · ');
    };
    // Filas de lo registrado: movimientos, pagos recibidos o descuentos de planilla.
    const registros = computed(() => {
      const x = it.value;
      if (!x) return [];
      if (x.tipoItem === 'ingreso') {
        return x.recibos.map((r) => {
          const e = estadoRecibo(r);
          const falta = e.pendientes === 1 ? 'falta 1 deducción' : `faltan ${e.pendientes} deducciones`;
          return { id: r.id, fecha: r.fecha, monto: r.neto, moneda: 'L', texto: e.pendientes ? `${falta} · ${nombreCuenta(r.cuentaId)}` : subtitulo(r, 'recibió'), abrir: () => editarRecibo(r) };
        });
      }
      return x.pagos.map((p) => {
        if (p.neto === undefined) {
          return {
            id: p.id, fecha: p.fecha, monto: p.monto, moneda: indice().monedaDeMovimiento(p), cierra: p.cierra,
            texto: subtitulo(p, 'pagó'), abrir: () => editarMovimiento(p),
          };
        }
        const descontado = (p.deducciones || []).filter((d) => !d.noAplica && d.prestamoId === x.prestamo?.id).reduce((a, d) => a + (Number(d.monto) || 0), 0);
        return { id: p.id, fecha: p.fecha, monto: descontado, moneda: 'L', texto: `descontado de ${buscar('ingresos', p.ingresoId)?.nombre || 'un salario'}`, abrir: () => editarRecibo(p) };
      });
    });
    const faltanDeducciones = computed(() => it.value?.tipoItem === 'ingreso' && it.value.recibos.some((r) => estadoRecibo(r).pendientes));
    const completar = () => completarDeducciones(it.value.recibos.find((r) => estadoRecibo(r).pendientes));
    const puedeRegistrar = computed(() => it.value && !it.value.planilla && (it.value.tipoItem === 'ingreso' ? !it.value.recibos.length : it.value.estado !== 'omitida'));
    const textoEditar = computed(() => (it.value?.suscripcion
      ? 'Editar suscripción'
      : ({ partida: 'Editar partida', prestamo: 'Editar préstamo', ingreso: 'Editar ingreso' })[it.value?.tipoItem]));

    function registrar() {
      const x = it.value;
      if (x.tipoItem === 'ingreso') return registrarRecibo(x);
      abrirModal(`Registrar: ${x.nombre}`, MovimientoForm, { inicial: movimientoParaItem(x, props.periodo, { hoy: store.hoy, monto: x.forma === 'abonos' ? null : undefined }), sugerirMontos: x.forma === 'abonos' });
    }
    function cerrarPartida() {
      if (cerrarPartidaDelMes(it.value, props.periodo)) emit('listo');
    }
    const solo = () => abrirModal(`${it.value.partida.nombre}: solo ${nombrePeriodo(props.periodo)}`, AjusteMesForm, { partidaId: it.value.partida.id, periodo: props.periodo });
    function editarPlantilla() {
      const x = it.value;
      if (x.tipoItem === 'partida') editarPartida(x.partida);
      else if (x.tipoItem === 'prestamo') editarPrestamo(x.prestamo);
      else editarIngreso(x.ingreso);
    }
    return {
      it, x, f, enDolares, estado, pct, resumen, registros, faltanDeducciones, completar, puedeRegistrar, textoEditar, registrar, cerrarPartida, solo, editarPlantilla,
      fmt, fmtMoneda, fechaCorta, nombrePeriodo,
    };
  },
};

// Todo lo que se puede registrar en un mes: partidas, cuotas e ingresos (del hogar).

export function itemsDelMes(periodo) {
  const r = resumenMes(indice(), periodo);
  return [...r.ingresos, ...r.cuotas, ...r.partidas];
}

// ---------------------------------------------------------------- Atajos para abrirlos

export const nuevoMovimiento = (base = {}) =>
  abrirModal(base.tipo === 'ajuste' ? 'Ajustar saldo' : base.tipo === 'abono' ? 'Abono a capital' : 'Nuevo movimiento', MovimientoForm, { inicial: base });
// Un financiamiento y un pago de tarjeta tienen su propio formulario: da igual desde dónde se
// toque el registro, siempre se abre el que sabe editarlo sin perder nada.
export const editarMovimiento = (m) => {
  if (m.tipo === 'pago_tarjeta') return editarPagoTarjeta(m);
  if (m.cuotas) return editarFinanciamiento(m);
  return abrirModal('Editar movimiento', MovimientoForm, { inicial: m });
};
export const editarRecibo = (r) => abrirModal('Pago recibido', ReciboForm, { inicial: r });
export const registrarRecibo = (it) => abrirModal(`Registrar: ${it.nombre}`, ReciboForm, { inicial: reciboSugerido(indice(), it.ingreso, it.pago, { hoy: store.hoy }) });
export const completarDeducciones = (r) => abrirModal('Completar deducciones', ReciboForm, { inicial: r, soloPendientes: true });
export const editarDeduccion = (ingresoId, deduccionId) => abrirModal(deduccionId ? 'Editar deducción' : 'Nueva deducción', DeduccionForm, { ingresoId, deduccionId });

// Cierra una partida del mes marcando su último pago ("Cierra la partida").
export function cerrarPartidaDelMes(it, periodo, { avisar = true } = {}) {
  const ultimo = it.pagos[it.pagos.length - 1];
  if (!ultimo) return false;
  guardar('movimientos', { ...ultimo, cierra: true });
  if (avisar) {
    aviso(textoDePartida(it.partida.id, it.parte, periodo) || 'Partida cerrada.', 'ok', 5000, {
      texto: 'Deshacer', fn: () => guardar('movimientos', { ...buscar('movimientos', ultimo.id), cierra: false }),
    });
  }
  return true;
}

// Lo que quedó sin pagar pasa al mes siguiente: se cierra la partida y el mes siguiente
// sube en ese monto (si la partida acumula, el sobrante ya pasa solo).
export function pasarAlSiguiente(it, periodo) {
  const p = it.partida;
  const siguiente = sumarMeses(periodo, 1);
  const queda = it.moneda === 'USD' ? it.enMoneda.queda : it.queda;
  if (!it.acumula) {
    const id = `${p.id}:${siguiente}`;
    const ajuste = buscar('ajustesPartida', id);
    const vigente = ajuste && !ajuste.borrado && !ajuste.omitir && hayValor(ajuste.monto);
    const base = vigente ? Number(ajuste.monto) : (partesDelMes(p, siguiente)[0]?.base || 0) / 100;
    // El ajuste se guarda en la moneda de la partida, igual que su monto.
    guardar('ajustesPartida', { ...(ajuste || {}), id, partidaId: p.id, periodo: siguiente, omitir: false, monto: redondear(base + queda), borrado: false });
  }
  cerrarPartidaDelMes(it, periodo, { avisar: false });
  aviso(`${fmtMoneda(queda, it.moneda)} de ${p.nombre} pasan a ${nombrePeriodo(siguiente)}.`, 'ok', 5000);
}
export const abrirDetalle = (it, periodo) => abrirModal(`${it.nombre} · ${nombrePeriodo(periodo)}`, DetalleItem, { clave: it.clave, periodo });

// Toque en el círculo: lo fijo se registra al instante con el monto de siempre (con opción
// de deshacer); lo variable abre el formulario con el monto sugerido y "Cierra la partida"
// marcada; lo que se paga en abonos abre el formulario vacío con montos rápidos.
export function marcarItem(it, periodo) {
  if (it.tipoItem === 'tarjeta') return it.hecho ? abrirItem(it, periodo) : pagarTarjeta(it.tarjeta.id, { corte: it.corte });
  if (it.tipoItem === 'ingreso') return it.hecho ? abrirDetalle(it, periodo) : registrarRecibo(it);
  if (it.hecho || it.planilla) return abrirDetalle(it, periodo);
  const variable = it.forma === 'variable' || it.parte === 'pagar';
  if (it.forma === 'abonos' || variable || it.estado === 'parcial') {
    const inicial = movimientoParaItem(it, periodo, { hoy: store.hoy, monto: it.forma === 'abonos' ? null : quedaParaPagar(it), cierra: variable && it.tipoItem === 'partida' });
    return abrirModal(`Registrar: ${it.nombre}`, MovimientoForm, { inicial, sugerirMontos: it.forma === 'abonos' });
  }
  const m = guardar('movimientos', movimientoParaItem(it, periodo, { hoy: store.hoy }));
  aviso(`Registrado: ${it.nombre}, ${fmtMoneda(m.monto, it.monedaPago)}`, 'ok', 6000, { texto: 'Deshacer', fn: () => borrar('movimientos', m.id) });
}

// Toque en el nombre: el detalle del mes (pagos, "solo este mes", editar). Un ingreso sin
// nada recibido abre directo el formulario para registrarlo.
export function abrirItem(it, periodo) {
  if (it.tipoItem === 'tarjeta') {
    location.hash = `#/tarjeta/${it.tarjeta.id}/${it.corte}`;
    return undefined;
  }
  if (it.tipoItem === 'ingreso' && !it.recibos.length) return registrarRecibo(it);
  return abrirDetalle(it, periodo);
}

export const editarPartida = (p = {}) => {
  const que = p.suscripcion ? 'suscripción' : 'partida';
  return abrirModal(p.id ? `Editar ${que}` : `Nueva ${que}`, PartidaForm, { inicial: p });
};
export const editarIngreso = (i = {}) => abrirModal(i.id ? 'Editar ingreso' : 'Nuevo ingreso', IngresoForm, { inicial: i });
export const editarPrestamo = (p = {}) => abrirModal(p.id ? 'Editar préstamo' : 'Nuevo préstamo', PrestamoForm, { inicial: p });
export const editarCuenta = (c = {}) => (c.tipo === 'tarjeta' ? editarTarjeta(c) : abrirModal(c.id ? 'Editar cuenta' : 'Nueva cuenta', CuentaForm, { inicial: c }));
export const editarPersona = (p = {}) => abrirModal(p.id ? 'Editar persona' : 'Nueva persona', PersonaForm, { inicial: p });
export const editarGrupo = (g = {}) => abrirModal(g.id ? 'Editar grupo' : 'Nuevo grupo', GrupoForm, { inicial: g });
export const editarCategoria = (c = {}) => abrirModal(c.id ? 'Editar categoría' : 'Nueva categoría', CategoriaForm, { inicial: c });
export const cambiarSoloEsteMes = (partida, periodo) => abrirModal(`${partida.nombre}: solo ${nombrePeriodo(periodo)}`, AjusteMesForm, { partidaId: partida.id, periodo });

// ---------------------------------------------------------------- Registrar desde un enlace

// Resuelve '#/registrar/tipo/id/fecha' (el enlace de un recordatorio de Outlook o un acceso
// directo del icono) y abre lo que toca. Devuelve la ruta en la que conviene quedarse, o null si
// el enlace no lleva a nada (una versión vieja, o algo que ya se registró y se borró).
export function abrirRegistro([tipo, id, fecha] = []) {
  if (!tipo) {
    nuevoMovimiento();
    return '#/inicio';
  }
  const destino = itemDeRecordatorio({ tipo, id, fecha });
  if (!destino) {
    aviso('Ese enlace ya no lleva a ningún registro. Revisa los avisos.', 'info', 6000);
    return '#/avisos';
  }
  if (destino.que === 'tarjeta') {
    pagarTarjeta(destino.tarjetaId, { corte: destino.corte });
    return '#/tarjetas';
  }
  const it = itemsDelMes(destino.periodo).find((x) => x.clave === destino.clave);
  if (!it) {
    aviso('No encontré eso en el mes. Puede que ya se registrara.', 'info', 6000);
    return `#/mes`;
  }
  // Ya registrado: en vez del formulario, su detalle del mes.
  if (it.hecho) abrirDetalle(it, destino.periodo);
  else marcarItem(it, destino.periodo);
  return '#/mes';
}
