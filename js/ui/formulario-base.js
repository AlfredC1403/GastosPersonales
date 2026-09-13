// Piezas comunes de los formularios de edición: pie con Guardar y Eliminar, texto de quién
// registró, opciones de categoría y el guardado con Deshacer.
import { guardar, borrar, aviso, confirmar, buscar, indice, fmt } from '../store.js';
import { estadoPartidas } from '../core/presupuesto.js';
import { redondear } from '../core/util.js';

const { ref } = Vue;

// Motivos por los que el store se niega a guardar y que el formulario explica en su sitio, en vez
// de dejarlos subir como error: un año anterior cerrado y el documento en solo lectura.
const MOTIVOS = ['anio_cerrado', 'solo_lectura'];

export const copia = (x) => JSON.parse(JSON.stringify(x ?? {}));
export const hayValor = (v) => v !== null && v !== undefined && v !== '';

const quien = (id) => buscar('personas', id)?.nombre || 'alguien';
const fechaHora = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function textoAuditoria(r) {
  if (!r?.creado) return '';
  let t = `Registrado por ${quien(r.creadoPor)} el ${fechaHora.format(new Date(r.creado))}`;
  if (r.actualizado && r.actualizado !== r.creado) {
    t += ` · editado por ${quien(r.actualizadoPor)} el ${fechaHora.format(new Date(r.actualizado))}`;
  }
  return t;
}

export const PIE = `
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="auditoria" class="meta">{{ auditoria }}</p>
  <div class="acciones">
    <button v-if="existe" type="button" class="btn peligro" @click="eliminar">Eliminar</button>
    <span class="espacio"></span>
    <button type="button" class="btn" @click="$emit('listo')">Cancelar</button>
    <button type="submit" class="btn primario">Guardar</button>
  </div>`;

// Opciones de un selector de categoría agrupadas; `lista` es una expresión con categoriasPorGrupo(tipo).
export const opcionesCategoria = (lista) => `
  <option :value="null">Sin categoría</option>
  <optgroup v-for="g in ${lista}" :key="g.grupo.id" :label="g.grupo.nombre">
    <option v-for="c in g.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option>
  </optgroup>`;

// Helpers comunes a todos los formularios de edición. `que`: "este movimiento", "esta cuenta"…
export function usarFormulario(coleccion, original, emit, { que, alBorrar } = {}) {
  const error = ref('');
  const existe = !!original.id;
  const auditoria = textoAuditoria(original);
  // `mensaje` puede ser un texto o una función que recibe el registro guardado.
  function terminar(r, { mensaje, deshacer = false, cerrar = true } = {}) {
    let guardado;
    try {
      guardado = guardar(coleccion, r);
    } catch (e) {
      // El formulario queda abierto con el motivo (año cerrado, solo lectura).
      if (!MOTIVOS.includes(e.codigo)) throw e;
      error.value = e.message;
      return null;
    }
    const texto = (typeof mensaje === 'function' ? mensaje(guardado) : mensaje) || (existe ? 'Cambios guardados.' : 'Guardado.');
    const accion = deshacer && !existe ? { texto: 'Deshacer', fn: () => borrar(coleccion, guardado.id) } : null;
    aviso(texto, 'ok', accion ? 6000 : 2500, accion);
    if (cerrar) emit('listo');
    return guardado;
  }
  // `alBorrar` puede preguntar algo más (y por eso se espera): devuelve false para no borrar.
  async function eliminar() {
    if (!await confirmar(`Se va a eliminar ${que}.`, { titulo: '¿Eliminar?', aceptar: 'Eliminar', peligro: true })) return;
    if (alBorrar && await alBorrar() === false) return;
    try {
      borrar(coleccion, original.id);
    } catch (e) {
      if (!MOTIVOS.includes(e.codigo)) throw e;
      error.value = e.message;
      return;
    }
    aviso('Eliminado.', 'info', 6000, {
      texto: 'Deshacer',
      fn: () => guardar(coleccion, { ...buscar(coleccion, original.id), borrado: false }),
    });
    emit('listo');
  }
  return { error, existe, auditoria, terminar, eliminar };
}

// ---------------------------------------------------------------- Partidas del mes

// Estado de una partida en un mes, sin contar el movimiento que se está editando.
export function estadoSinEste(partidaId, parte, periodo, movimientoId) {
  if (!partidaId || !periodo) return null;
  const it = estadoPartidas(indice(), periodo).find((x) => x.partida.id === partidaId && x.parte === parte);
  if (!it) return null;
  // Lo que este movimiento aporta en ese mes (en lempiras; en una compra a cuotas, su cuota).
  const propio = (indice().pagosPartida.get(`${partidaId}|${periodo}`) || []).filter((x) => x.m.id === movimientoId).reduce((a, x) => a + x.c, 0);
  const real = redondear(it.real - propio / 100);
  return { ...it, realSinEste: real, quedaSinEste: redondear(Math.max(0, it.esperado - real)) };
}

// Texto del aviso después de registrar un pago de una partida.
export function textoDePartida(partidaId, parte, periodo) {
  const it = estadoPartidas(indice(), periodo).find((x) => x.partida.id === partidaId && x.parte === parte);
  if (!it) return '';
  if (it.estado === 'parcial') return `Quedan ${fmt(it.queda)} en ${it.nombre}.`;
  if (it.estado === 'excedido') return `${it.nombre}: ${fmt(it.real - it.esperado)} más de lo previsto.`;
  if (it.sobrante > 0) return `${it.nombre} cerrada. Sobran ${fmt(it.sobrante)}${it.acumula ? ' para el mes siguiente' : ''}.`;
  return `${it.nombre} completa.`;
}
