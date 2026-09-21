// Restaurar parte de un respaldo.
//
// Un respaldo se restauraba entero: si lo que se perdió fue una partida borrada por error,
// traer el archivo completo revierte también todo lo bueno que se anotó después. Aquí se
// compara el respaldo con lo que hay hoy y se trae solo lo que falta, registro por registro.
//
// Todo es puro: recibe los dos documentos y devuelve la lista de diferencias. Quien la use
// decide qué traer, y lo guarda con las reglas de siempre (la fusión es por "actualizado",
// así que un registro recuperado se vuelve a sellar y gana sobre el borrado).
import { COLECCIONES, vivo, gana } from './modelo.js';
import { NOMBRES } from './papelera.js';

// Las que la app vuelve a calcular sola: traerlas de un respaldo no arregla nada.
const OCULTAS = ['resumenes'];

/**
 * Qué tiene el respaldo que hoy no está.
 *   `falta`:   está vivo en el respaldo y aquí no existe o está borrado.
 *   `cambio`:  está en los dos, vivo, y la versión del respaldo es distinta (y más vieja: si
 *              fuera más nueva, sincronizar ya la habría traído).
 * @returns [{ coleccion, id, estado, registro, actual, tipo }]
 */
export function diferencias(actual, respaldo, { coleccion = null } = {}) {
  const out = [];
  for (const c of COLECCIONES) {
    if (OCULTAS.includes(c) || (coleccion && c !== coleccion)) continue;
    const aqui = new Map((actual?.[c] || []).map((r) => [r.id, r]));
    for (const r of respaldo?.[c] || []) {
      if (!vivo(r)) continue;
      const x = aqui.get(r.id);
      if (!x || !vivo(x)) {
        out.push({ coleccion: c, id: r.id, estado: 'falta', registro: r, actual: x || null, tipo: NOMBRES[c] || c });
      } else if (JSON.stringify(x) !== JSON.stringify(r) && gana(x, r)) {
        out.push({ coleccion: c, id: r.id, estado: 'cambio', registro: r, actual: x, tipo: NOMBRES[c] || c });
      }
    }
  }
  return out;
}

// Cuántas diferencias hay por colección, para las pestañas de la pantalla.
export function conteoPorColeccion(actual, respaldo) {
  const cuenta = {};
  for (const d of diferencias(actual, respaldo)) {
    cuenta[d.coleccion] ??= { falta: 0, cambio: 0 };
    cuenta[d.coleccion][d.estado] += 1;
  }
  return cuenta;
}

// El registro tal como debe guardarse para traerlo de vuelta: el del respaldo, sin la marca de
// borrado que pueda tener la copia de hoy. Quien lo guarde le pone el sello nuevo.
export function paraGuardar(d) {
  const { borrado: _borrado, ...r } = d.registro;
  return r;
}
