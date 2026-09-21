// Topes: el techo que el hogar se pone para una categoría o un grupo entero.
//
// Una partida planea un pago concreto; un tope no planea nada, solo vigila. Por eso alcanza
// también lo que se gasta fuera del plan, que es justo donde se escapa el dinero: sin una
// partida de restaurantes se pueden gastar L5,000 en restaurantes sin que nada avise.
import { vivo } from './modelo.js';
import { aCentavos, deCentavos, redondear } from './util.js';
import { gastoDelMes } from './reportes.js';

// De cuánto del tope hay que pasar para que la app avise, si el tope no dice otra cosa.
export const AVISO_POR_DEFECTO = 80;

export const montoEnLempiras = (ix, tope, periodo) => (
  tope.moneda === 'USD' ? redondear((Number(tope.monto) || 0) * (ix.tasaEn ? ix.tasaEn(periodo) : 0)) : redondear(Number(tope.monto) || 0)
);

export function topeActivo(t) {
  return vivo(t) && t.activo !== false && Number(t.monto) > 0 && (t.ambito === 'grupo' || t.ambito === 'categoria') && !!t.referenciaId;
}

// Nombre de lo que vigila el tope, para las pantallas y los avisos.
export function nombreDeTope(ix, t) {
  const r = t.ambito === 'grupo' ? ix.grupos.get(t.referenciaId) : ix.categorias.get(t.referenciaId);
  return r?.nombre || (t.ambito === 'grupo' ? 'Grupo borrado' : 'Categoría borrada');
}

/**
 * Cómo va cada tope en `periodo`.
 * @returns [{ tope, id, nombre, ambito, referenciaId, monto, gastado, queda, pct, estado }]
 *   `monto`, `gastado` y `queda` en lempiras; `estado` es 'bien', 'cerca' o 'pasado'.
 *   Un tope cuyo grupo o categoría ya no existe se sigue mostrando, para poder borrarlo.
 */
export function estadoTopes(ix, periodo, filtro) {
  const gasto = gastoDelMes(ix, periodo, filtro);
  const out = [];
  for (const t of ix.doc.topes || []) {
    if (!topeActivo(t)) continue;
    const monto = montoEnLempiras(ix, t, periodo);
    if (!(monto > 0)) continue;
    const fuente = t.ambito === 'grupo' ? gasto.porGrupo : gasto.porCategoria;
    const gastado = Number(fuente[t.referenciaId]) || 0;
    const pct = Math.round((aCentavos(gastado) / aCentavos(monto)) * 100);
    const avisarEn = Math.min(100, Math.max(1, Math.round(Number(t.avisarEn) || AVISO_POR_DEFECTO)));
    out.push({
      tope: t,
      id: t.id,
      nombre: nombreDeTope(ix, t),
      ambito: t.ambito,
      referenciaId: t.referenciaId,
      moneda: t.moneda === 'USD' ? 'USD' : 'L',
      monto,
      gastado,
      queda: redondear(monto - gastado),
      pct,
      avisarEn,
      estado: pct >= 100 ? 'pasado' : pct >= avisarEn ? 'cerca' : 'bien',
      estimado: gasto.estimado,
    });
  }
  return out.sort((a, b) => b.pct - a.pct || a.nombre.localeCompare(b.nombre));
}

// Lo que vigilan todos los topes juntos, para el resumen del mes.
export function resumenTopes(ix, periodo, filtro) {
  const lista = estadoTopes(ix, periodo, filtro);
  const c = { techo: 0, gastado: 0 };
  for (const t of lista) {
    c.techo += aCentavos(t.monto);
    c.gastado += aCentavos(t.gastado);
  }
  return {
    lista,
    techo: deCentavos(c.techo),
    gastado: deCentavos(c.gastado),
    pasados: lista.filter((t) => t.estado === 'pasado').length,
    cerca: lista.filter((t) => t.estado === 'cerca').length,
  };
}

// Un tope ya cubre una categoría si hay uno de esa categoría o uno del grupo al que pertenece:
// sirve para no proponer dos veces lo mismo al crear uno nuevo.
export function categoriaCubierta(ix, categoriaId) {
  const grupoId = ix.grupoDe(categoriaId);
  return (ix.doc.topes || []).some((t) => topeActivo(t)
    && ((t.ambito === 'categoria' && t.referenciaId === categoriaId) || (t.ambito === 'grupo' && t.referenciaId === grupoId)));
}
