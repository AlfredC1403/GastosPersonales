// Lo que la app le muestra a la persona por encima de todo: el aviso que aparece abajo, el
// formulario en un diálogo y la pregunta de sí o no. Son tres colas cortas sobre `store`, y
// están juntas porque las tres se abren desde cualquier pantalla y solo una manda a la vez.
import { store } from './estado.js';

const { markRaw } = Vue;

let siguienteAviso = 1;
export function aviso(texto, tipo = 'info', ms = 3500, accion = null) {
  const id = siguienteAviso++;
  store.avisos.push({ id, texto, tipo, accion });
  setTimeout(() => cerrarAviso(id), ms);
}
export function cerrarAviso(id) {
  const i = store.avisos.findIndex((a) => a.id === id);
  if (i >= 0) store.avisos.splice(i, 1);
}

let siguienteModal = 1;
export function abrirModal(titulo, componente, props = {}) {
  store.modal = { id: siguienteModal++, titulo, componente: markRaw(componente), props };
}
export function cerrarModal() {
  store.modal = null;
}

// ---------------------------------------------------------------- Confirmaciones

// Pregunta de sí o no, con el diálogo de la app en vez del confirm() del navegador (que en la app
// instalada sale con la dirección del sitio y sin el estilo de la app). Devuelve una promesa:
//
//   if (!await confirmar('¿Eliminar esta cuenta?', { peligro: true })) return;
//
// Vive en su propio <dialog> (ver ConfirmHost), así que se puede abrir encima de un formulario:
// el navegador apila los diálogos y al cerrar la pregunta el formulario sigue ahí.
let siguienteConfirmacion = 1;

export function confirmar(texto, { titulo = 'Confirmar', aceptar = 'Sí', peligro = false } = {}) {
  // Si ya había una pregunta abierta, se responde "no" para no dejar su promesa colgada.
  responderConfirmacion(false);
  return new Promise((resolver) => {
    store.confirmacion = { id: siguienteConfirmacion++, titulo, texto, aceptar, peligro, resolver };
  });
}

export function responderConfirmacion(valor) {
  const actual = store.confirmacion;
  if (!actual) return;
  store.confirmacion = null;
  actual.resolver(valor);
}
