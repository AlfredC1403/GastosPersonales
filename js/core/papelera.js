// Papelera: lo que se borró y todavía se puede recuperar.
//
// Los borrados nunca desaparecen del archivo: quedan como una marca (`borrado: true`) para que
// no "revivan" al fusionar dos copias. Esa marca es justo lo que hace falta para deshacer un
// borrado días después, que antes solo se podía arreglando el respaldo entero.
import { COLECCIONES } from './modelo.js';
import { sumarDias, periodoDe } from './util.js';

// Cuántos días atrás se muestra por defecto. Más atrás la lista se vuelve un archivo histórico
// y deja de ser una papelera.
export const DIAS = 30;

// Cómo se llama cada cosa en la pantalla, en singular.
export const NOMBRES = {
  movimientos: 'Movimiento',
  recibos: 'Pago recibido',
  ajustesPartida: 'Ajuste de una partida',
  partidas: 'Partida',
  ingresos: 'Salario',
  prestamos: 'Préstamo',
  cuentas: 'Cuenta',
  categorias: 'Categoría',
  grupos: 'Grupo',
  personas: 'Persona',
  metas: 'Meta',
  comercios: 'Comercio',
  topes: 'Tope',
  renovaciones: 'Renovación',
  tasas: 'Tasa del dólar',
  resumenes: 'Resumen guardado',
};

// Colecciones que no tiene sentido mostrar: son resultados que la app vuelve a calcular sola.
const OCULTAS = ['resumenes'];

/**
 * Lo borrado, de lo más reciente a lo más viejo.
 * @returns [{ coleccion, registro, id, cuando, quien, titulo, detalle }]
 */
export function papelera(doc, { hoy, dias = DIAS, coleccion = null } = {}) {
  const desde = hoy ? `${sumarDias(hoy, -Math.max(1, dias))}T00:00:00.000Z` : '';
  const out = [];
  for (const c of COLECCIONES) {
    if (OCULTAS.includes(c) || (coleccion && c !== coleccion)) continue;
    for (const r of doc[c] || []) {
      if (!r.borrado) continue;
      // Un registro que se creó ya borrado (una marca que llegó al fusionar) no se muestra: no
      // hay nada que recuperar, y llenaría la lista de ruido.
      if (!r.actualizado || (desde && r.actualizado < desde)) continue;
      out.push({
        coleccion: c,
        registro: r,
        id: r.id,
        cuando: r.actualizado,
        quien: r.actualizadoPor || null,
        tipo: NOMBRES[c] || c,
      });
    }
  }
  return out.sort((a, b) => (a.cuando < b.cuando ? 1 : a.cuando > b.cuando ? -1 : 0));
}

// Cuántos borrados hay por colección, para las pestañas de la pantalla.
export function conteoPorColeccion(doc, opciones = {}) {
  const cuenta = {};
  for (const x of papelera(doc, opciones)) cuenta[x.coleccion] = (cuenta[x.coleccion] || 0) + 1;
  return cuenta;
}

// El mes al que pertenece un borrado, cuando lo tiene: sirve para avisar que recuperarlo toca
// un año que ya está cerrado.
export const periodoDelBorrado = (x) => {
  const f = x.registro.periodo || x.registro.fecha || x.registro.vence || '';
  return /^\d{4}-\d{2}/.test(f) ? periodoDe(f) : '';
};
