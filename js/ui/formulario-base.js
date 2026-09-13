// Piezas comunes de los formularios de edición: pie con Guardar y Eliminar, texto de quién
// registró, opciones de categoría y el guardado con Deshacer.
import { guardar, borrar, aviso, buscar } from '../store.js';

const { ref } = Vue;

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
    const guardado = guardar(coleccion, r);
    const texto = (typeof mensaje === 'function' ? mensaje(guardado) : mensaje) || (existe ? 'Cambios guardados.' : 'Guardado.');
    const accion = deshacer && !existe ? { texto: 'Deshacer', fn: () => borrar(coleccion, guardado.id) } : null;
    aviso(texto, 'ok', accion ? 6000 : 2500, accion);
    if (cerrar) emit('listo');
    return guardado;
  }
  function eliminar() {
    if (!confirm(`¿Eliminar ${que}?`)) return;
    if (alBorrar && alBorrar() === false) return;
    borrar(coleccion, original.id);
    aviso('Eliminado.', 'info', 6000, {
      texto: 'Deshacer',
      fn: () => guardar(coleccion, { ...buscar(coleccion, original.id), borrado: false }),
    });
    emit('listo');
  }
  return { error, existe, auditoria, terminar, eliminar };
}
