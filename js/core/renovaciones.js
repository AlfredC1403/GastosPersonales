// Renovaciones: lo que vence y hay que renovar a tiempo. El seguro del carro, la licencia,
// el pasaporte, la revisión del extintor, la garantía del refrigerador.
//
// No es una suscripción: nadie la cobra solo. Si se olvida no aparece un cargo en la tarjeta,
// aparece un problema. Por eso lo que importa es el aviso con tiempo y no el monto del mes,
// y por eso vive aparte de las partidas.
import { vivo } from './modelo.js';
import { sumarMeses, periodoDe, fechaEnMes, diasDesde, redondear } from './util.js';

// Con cuántos días de anticipación avisa una renovación que no diga otra cosa.
export const AVISO_POR_DEFECTO = 30;

export const renovacionActiva = (r) => vivo(r) && r.activo !== false && /^\d{4}-\d{2}-\d{2}$/.test(r.vence || '');

export const diasDeAviso = (r) => Math.max(1, Math.round(Number(r.avisarDias) || AVISO_POR_DEFECTO));

export const cadaMesesDe = (r) => Math.max(1, Math.round(Number(r.cadaMeses) || 12));

// La fecha siguiente de una renovación que se repite; null si no se repite.
// Se conserva el día del mes: un seguro que vence el 31 de enero vence el 31 de enero siguiente,
// y en un mes más corto cae en el último día.
export function fechaSiguiente(r, desde = r.vence) {
  if (r.repetir !== 'meses') return null;
  const paso = cadaMesesDe(r);
  const dia = Number(String(r.vence || '').slice(8, 10)) || 1;
  let fecha = r.vence;
  // Avanza de paso en paso hasta pasar `desde`: así, una renovación olvidada hace tres años
  // propone la próxima de verdad y no la del año siguiente al vencimiento.
  for (let i = 0; i < 400 && fecha <= desde; i++) fecha = fechaEnMes(sumarMeses(periodoDe(fecha), paso), dia);
  return fecha;
}

// Cómo queda la renovación después de renovarla: la próxima fecha, o desactivada si no se repite.
export function renovada(r, hoy) {
  const siguiente = fechaSiguiente(r, hoy > r.vence ? hoy : r.vence);
  return siguiente ? { ...r, vence: siguiente } : { ...r, activo: false };
}

const monedaDe = (r) => (r.moneda === 'USD' ? 'USD' : 'L');

/**
 * Estado de cada renovación.
 * @returns [{ renovacion, id, nombre, vence, dias, estado, monto, moneda, montoL, ... }]
 *   `dias` son los que faltan (negativo si ya venció) y `estado` es 'vencida', 'avisa' o 'lejos'.
 */
export function estadoRenovaciones(ix, { hoy, filtro = null, incluirInactivas = false } = {}) {
  const out = [];
  for (const r of ix.doc.renovaciones || []) {
    if (!vivo(r)) continue;
    if (!renovacionActiva(r) && !incluirInactivas) continue;
    if (filtro?.personaId && (r.responsableId || null) !== filtro.personaId) continue;
    const dias = diasDesde(hoy, r.vence);
    const aviso = diasDeAviso(r);
    const monto = Number(r.monto) || 0;
    out.push({
      renovacion: r,
      id: r.id,
      nombre: r.nombre || 'Sin nombre',
      vence: r.vence,
      dias,
      avisarDias: aviso,
      monto,
      moneda: monedaDe(r),
      montoL: monedaDe(r) === 'USD' ? redondear(monto * (ix.tasaEn ? ix.tasaEn(periodoDe(r.vence)) : 0)) : redondear(monto),
      categoriaId: r.categoriaId || null,
      responsableId: r.responsableId || null,
      cuentaId: r.cuentaId || null,
      repite: r.repetir === 'meses',
      cadaMeses: r.repetir === 'meses' ? cadaMesesDe(r) : null,
      activa: r.activo !== false,
      nota: r.nota || '',
      estado: dias < 0 ? 'vencida' : dias <= aviso ? 'avisa' : 'lejos',
    });
  }
  return out.sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : a.nombre.localeCompare(b.nombre)));
}

// Las que piden atención ahora: vencidas o dentro de su ventana de aviso.
export const renovacionesPendientes = (ix, opciones) => estadoRenovaciones(ix, opciones).filter((r) => r.estado !== 'lejos');

// Lo que cuestan al año las renovaciones que se repiten, en lempiras: sirve para el resumen,
// porque un seguro de L18,000 al año pesa más que varias suscripciones juntas.
export function costoAnual(ix, opciones) {
  let total = 0;
  for (const r of estadoRenovaciones(ix, opciones)) {
    if (!r.repite || !r.montoL) continue;
    total += (r.montoL * 12) / r.cadaMeses;
  }
  return redondear(total);
}

// Renovaciones que vencen dentro de un mes, para la proyección del flujo de caja.
export function renovacionesDelMes(ix, periodo, filtro = null) {
  const desde = `${periodo}-01`;
  const hasta = fechaEnMes(periodo, 31);
  return estadoRenovaciones(ix, { hoy: desde, filtro }).filter((r) => r.vence >= desde && r.vence <= hasta);
}
