// Detección de movimientos repetidos. Pasa de verdad cuando dos personas usan la misma carpeta:
// los dos anotan el mismo pago del súper y el mes queda con L1,200 de más que nadie gastó.
//
// No borra ni impide nada: solo encuentra los candidatos para que el formulario pregunte antes
// de guardar y para poder revisarlos después. La decisión siempre es de la persona.
import { vivo } from './modelo.js';
import { periodoDe, sumarDias, diasDesde, aCentavos, slug } from './util.js';

// Cuántos días de diferencia se toleran y cuánto puede variar el monto para seguir pareciendo
// el mismo pago. Un día de diferencia es normal (uno lo anota hoy y el otro mañana).
export const DIAS = 2;
export const TOLERANCIA = 0.01; // 1 %

const texto = (m, ix) => slug(m.nota || ix?.comercios?.get(m.comercioId)?.nombre || '');

// ¿Se parecen lo suficiente como para preguntar? Dos movimientos del mismo tipo, en la misma
// cuenta, por casi el mismo monto y con pocos días de diferencia.
export function seParecen(a, b, { dias = DIAS, tolerancia = TOLERANCIA } = {}) {
  if (!a || !b || a.id === b.id) return false;
  if (a.tipo !== b.tipo || (a.cuentaId || '') !== (b.cuentaId || '')) return false;
  if ((a.moneda || 'L') !== (b.moneda || 'L')) return false;
  // Un financiamiento no se repite: sus cuotas son una sola compra.
  if (a.cuotas || b.cuotas) return false;
  const ca = aCentavos(a.monto);
  const cb = aCentavos(b.monto);
  if (!ca || !cb) return false;
  if (Math.abs(ca - cb) > Math.max(1, Math.round(Math.max(ca, cb) * tolerancia))) return false;
  return Math.abs(diasDesde(a.fecha, b.fecha)) <= dias;
}

// Qué tan seguro es que sea el mismo pago, de 0 a 100. Sube cuando además del monto coinciden
// el día, el comercio, la categoría o la partida, y sobre todo cuando los anotaron dos personas
// distintas, que es el caso clásico del duplicado. Baja cuando los anotó la misma persona (ahí
// es más probable que de verdad sean dos pagos iguales: dos cafés, dos pasajes) y cuando no hay
// nada que los distinga más que el monto.
export function confianza(a, b, ix = null) {
  let puntos = 40;
  if (aCentavos(a.monto) === aCentavos(b.monto)) puntos += 15;
  if (a.fecha === b.fecha) puntos += 10;
  if (a.comercioId && a.comercioId === b.comercioId) puntos += 15;
  if (a.partidaId && a.partidaId === b.partidaId) puntos += 10;
  else if (a.categoriaId && a.categoriaId === b.categoriaId) puntos += 5;

  const ta = texto(a, ix);
  const tb = texto(b, ix);
  if (ta && ta === tb) puntos += 10;

  const quien = (m) => m.creadoPor || m.personaId || null;
  if (quien(a) && quien(b)) puntos += quien(a) === quien(b) ? -10 : 15;
  // Ni comercio, ni nota, ni nada: solo el monto y la fecha. Se muestra al guardar, pero no
  // entra por su cuenta en la lista de repetidos del mes.
  if (!ta && !tb && !a.comercioId && !b.comercioId) puntos -= 15;

  return Math.max(0, Math.min(100, puntos));
}

/**
 * Movimientos ya guardados que se parecen a `candidato`. Se usa antes de guardar, así que solo
 * mira los días alrededor de su fecha: recorrer todo el año sería caro y no aporta.
 * @returns [{ movimiento, confianza }] de más a menos parecido.
 */
export function parecidosA(ix, candidato, opciones = {}) {
  if (!candidato?.fecha || !candidato.monto) return [];
  const dias = opciones.dias ?? DIAS;
  const desde = sumarDias(candidato.fecha, -dias);
  const hasta = sumarDias(candidato.fecha, dias);
  const out = [];
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m) || m.fecha < desde || m.fecha > hasta) continue;
    if (!seParecen(candidato, m, opciones)) continue;
    out.push({ movimiento: m, confianza: confianza(candidato, m, ix) });
  }
  return out.sort((a, b) => b.confianza - a.confianza);
}

/**
 * Parejas de movimientos repetidos en un mes, para revisarlas todas juntas.
 * Cada pareja aparece una sola vez, y un movimiento no se empareja dos veces con el mismo.
 * @returns [{ a, b, confianza }] de más a menos parecido.
 */
export function duplicadosDelMes(ix, periodo, { minimo = 70, ...opciones } = {}) {
  const lista = (ix.doc.movimientos || []).filter((m) => vivo(m) && (m.periodo || periodoDe(m.fecha)) === periodo)
    .sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0));
  const out = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      if (lista[j].fecha > sumarDias(lista[i].fecha, opciones.dias ?? DIAS)) break;
      if (!seParecen(lista[i], lista[j], opciones)) continue;
      const c = confianza(lista[i], lista[j], ix);
      if (c >= minimo) out.push({ a: lista[i], b: lista[j], confianza: c });
    }
  }
  return out.sort((x, y) => y.confianza - x.confianza);
}
