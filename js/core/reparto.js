// Reparto de gastos entre las personas del hogar: cuánto le tocaría a cada una según el método
// elegido, cuánto paga hoy y sugerencias para acercarse. Es una sugerencia: nada cambia hasta
// que el hogar lo decida.
import { vivo } from './modelo.js';
import { sumarMeses, aCentavos, deCentavos } from './util.js';
import { equivalenteMensual, partidaActivaEn } from './presupuesto.js';
import { ingresoMensual, estadoRecibo } from './nomina.js';
import { prestamoActivoEn } from './prestamos.js';

export const METODOS_REPARTO = { ingresos: 'Según ingresos', mitad: 'Mitad y mitad', propio: 'Porcentajes propios' };
export const BASES_REPARTO = { neto: 'Neto', bruto: 'Bruto' };
export const FUENTES_REPARTO = { presupuesto: 'Presupuesto', mes: 'Este mes', tres_meses: 'Últimos 3 meses' };
// `grupos: null` = todos los grupos de gasto menos Personal.
export const REPARTO_INICIAL = { metodo: 'ingresos', base: 'neto', fuente: 'presupuesto', grupos: null, incluirPrestamos: true, incluirAportes: true, porcentajes: {} };
export const GRUPOS_FUERA_DEL_REPARTO = ['personal', 'ingresos', 'ahorro'];

// Diferencias menores a L1 no merecen una sugerencia.
const TOLERANCIA = 100;
const MAX_SUGERENCIAS = 3;

export function gruposDelReparto(ix, opciones) {
  if (Array.isArray(opciones.grupos)) return new Set(opciones.grupos);
  return new Set(ix.ordenGrupos.filter((id) => !GRUPOS_FUERA_DEL_REPARTO.includes(id)));
}

// Un aporte es del hogar si su cuenta de destino no tiene titular y su meta no tiene responsable.
function aporteDelHogar(ix, cuentaId, metaId) {
  const meta = metaId ? ix.metas.get(metaId) : null;
  if (meta && vivo(meta)) return !meta.responsableId;
  return !ix.cuentas.get(cuentaId)?.titularId;
}

// Ingreso de cada persona al mes, en centavos. Neto: lo configurado en sus salarios (con los
// décimos repartidos en el año). Bruto: el promedio de los recibos de los últimos 3 meses; quien
// no tiene recibos usa el neto (y se marca como estimado).
function ingresosPorPersona(ix, periodo, base, personas) {
  const neto = new Map(personas.map((p) => [p.id, 0]));
  for (const i of ix.doc.ingresos || []) {
    if (vivo(i) && i.activo !== false && neto.has(i.personaId)) neto.set(i.personaId, neto.get(i.personaId) + aCentavos(ingresoMensual(i)));
  }
  if (base !== 'bruto') return { porPersona: neto, estimados: [] };
  const bruto = new Map();
  const meses = new Map();
  for (const p of [sumarMeses(periodo, -2), sumarMeses(periodo, -1), periodo]) {
    for (const r of ix.recibosPorPeriodo.get(p) || []) {
      const persona = r.personaId || ix.ingresos.get(r.ingresoId)?.personaId;
      if (!neto.has(persona)) continue;
      bruto.set(persona, (bruto.get(persona) || 0) + aCentavos(estadoRecibo(r).bruto));
      if (!meses.has(persona)) meses.set(persona, new Set());
      meses.get(persona).add(p);
    }
  }
  const porPersona = new Map();
  const estimados = [];
  for (const [id, c] of neto) {
    if (bruto.has(id)) porPersona.set(id, Math.round(bruto.get(id) / meses.get(id).size));
    else {
      porPersona.set(id, c);
      if (c) estimados.push(id);
    }
  }
  return { porPersona, estimados };
}

// Lo que se reparte, con quién lo paga, en centavos al mes.
// Presupuesto: partidas (equivalente mensual), cuotas de préstamos y aportes, por responsable.
// Este mes / últimos 3 meses: lo registrado, por quién pagó (el promedio en los 3 meses).
function itemsDelPresupuesto(ix, periodo, o, grupos) {
  const items = [];
  for (const p of ix.doc.partidas || []) {
    if (!partidaActivaEn(p, periodo)) continue;
    const incluir = p.tipo === 'aporte' ? o.incluirAportes && aporteDelHogar(ix, p.cuentaDestinoId, p.metaId) : grupos.has(ix.grupoDe(p.categoriaId));
    if (!incluir) continue;
    items.push({ tipo: 'partida', id: p.id, nombre: p.nombre, c: aCentavos(equivalenteMensual(p)), responsableId: p.responsableId || null });
  }
  if (o.incluirPrestamos) {
    for (const p of ix.doc.prestamos || []) {
      if (!vivo(p) || !prestamoActivoEn(ix, p, periodo)) continue;
      items.push({ tipo: 'prestamo', id: p.id, nombre: p.nombre, c: aCentavos(p.cuota), responsableId: p.responsableId || null });
    }
  }
  return items.filter((x) => x.c > 0);
}

function itemsRegistrados(ix, periodos, o, grupos) {
  const porClave = new Map();
  const sumar = (clave, datos, c) => {
    const x = porClave.get(clave) || { ...datos, c: 0 };
    x.c += c;
    porClave.set(clave, x);
  };
  for (const periodo of periodos) {
    for (const a of ix.porPeriodo.get(periodo) || []) {
      const persona = a.personaId || null;
      if (a.clase === 'gasto' && !a.prestamoId && grupos.has(a.grupoId)) {
        const id = a.partidaId || a.categoriaId || 'sin';
        const nombre = ix.partidas.get(a.partidaId)?.nombre || ix.categorias.get(a.categoriaId)?.nombre || 'Sin categoría';
        sumar(`gasto|${id}|${persona}`, { tipo: a.partidaId ? 'partida' : 'categoria', id, nombre, responsableId: persona }, a.c);
      } else if (a.clase === 'prestamo' && a.tipoPago === 'cuota' && o.incluirPrestamos) {
        sumar(`prestamo|${a.prestamoId}|${persona}`, { tipo: 'prestamo', id: a.prestamoId, nombre: ix.prestamos.get(a.prestamoId)?.nombre || 'Préstamo', responsableId: persona }, a.c);
      } else if (a.clase === 'ahorro' && !a.planilla && o.incluirAportes && aporteDelHogar(ix, a.cuentaId, a.metaId)) {
        const id = a.partidaId || a.metaId || a.cuentaId;
        const nombre = ix.partidas.get(a.partidaId)?.nombre || ix.metas.get(a.metaId)?.nombre || ix.cuentas.get(a.cuentaId)?.nombre || 'Aporte';
        sumar(`aporte|${id}|${persona}`, { tipo: 'aporte', id, nombre, responsableId: persona }, a.c);
      }
    }
  }
  return [...porClave.values()].map((x) => ({ ...x, c: Math.round(x.c / periodos.length) })).filter((x) => x.c > 0);
}

// Hasta 3 opciones de pasar 1 o 2 partidas de quien paga de más a quien paga de menos: las que
// dejan la diferencia más cerca de cero. Además, la transferencia mensual que la iguala.
export function sugerirCambios(filas, partidas) {
  if (filas.length < 2) return [];
  const orden = [...filas].sort((a, b) => b.diferencia - a.diferencia);
  const de = orden[0];
  const a = orden[orden.length - 1];
  if (de.diferencia <= TOLERANCIA || a.diferencia >= -TOLERANCIA) return [];
  const distancia = (monto) => Math.abs(de.diferencia - monto) + Math.abs(a.diferencia + monto);
  const actual = distancia(0);
  const propias = partidas.filter((x) => x.responsableId === de.id && x.c > 0);
  const combinaciones = [];
  propias.forEach((x, i) => {
    combinaciones.push([x]);
    for (const y of propias.slice(i + 1)) combinaciones.push([x, y]);
  });
  const opciones = combinaciones
    .map((lista) => {
      const monto = lista.reduce((s, x) => s + x.c, 0);
      return { lista, monto, distancia: distancia(monto) };
    })
    .filter((x) => x.distancia < actual - TOLERANCIA)
    .sort((x, y) => x.distancia - y.distancia || x.lista.length - y.lista.length || x.lista[0].nombre.localeCompare(y.lista[0].nombre))
    .slice(0, MAX_SUGERENCIAS)
    .map((x) => ({
      tipo: 'mover', de: de.id, a: a.id, monto: deCentavos(x.monto), queda: deCentavos(de.diferencia - x.monto),
      partidas: x.lista.map((p) => ({ id: p.id, nombre: p.nombre, monto: deCentavos(p.c) })),
    }));
  opciones.push({ tipo: 'transferencia', de: a.id, a: de.id, monto: deCentavos(Math.min(de.diferencia, -a.diferencia)) });
  return opciones;
}

// Reparto del mes `periodo` con las opciones del hogar (config.reparto). No usa el filtro de
// persona: compara a las personas entre sí.
export function calcularReparto(ix, periodo, opciones = {}) {
  const o = { ...REPARTO_INICIAL, ...opciones, porcentajes: { ...(opciones.porcentajes || {}) } };
  const personas = (ix.doc.personas || []).filter(vivo).sort((a, b) => (a.creado || '').localeCompare(b.creado || '') || a.nombre.localeCompare(b.nombre));
  const grupos = gruposDelReparto(ix, o);
  const ingresos = ingresosPorPersona(ix, periodo, o.base, personas);
  const avisos = [];

  // Porcentajes (fracciones que suman 1).
  let pesos = personas.map((p) => (o.metodo === 'ingresos' ? ingresos.porPersona.get(p.id) || 0 : o.metodo === 'propio' ? Math.max(0, Number(o.porcentajes[p.id]) || 0) : 1));
  const suma = pesos.reduce((s, x) => s + x, 0);
  if (o.metodo === 'ingresos' && !suma) avisos.push('sin-ingresos');
  if (o.metodo === 'propio' && Math.abs(suma - 100) > 0.001) avisos.push('porcentajes');
  if (!suma) pesos = personas.map(() => 1);
  const total = pesos.reduce((s, x) => s + x, 0) || 1;
  const fraccion = new Map(personas.map((p, i) => [p.id, pesos[i] / total]));

  const periodos = o.fuente === 'tres_meses' ? [sumarMeses(periodo, -2), sumarMeses(periodo, -1), periodo] : [periodo];
  const items = o.fuente === 'presupuesto' ? itemsDelPresupuesto(ix, periodo, o, grupos) : itemsRegistrados(ix, periodos, o, grupos);
  const esDeAlguien = (x) => fraccion.has(x.responsableId);
  const asignado = items.filter(esDeAlguien).reduce((s, x) => s + x.c, 0);
  const sinResponsable = items.filter((x) => !esDeAlguien(x)).reduce((s, x) => s + x.c, 0);

  const filas = personas.map((p) => {
    const f = fraccion.get(p.id);
    const leToca = Math.round(asignado * f);
    const pagaHoy = items.filter((x) => x.responsableId === p.id).reduce((s, x) => s + x.c, 0);
    return { id: p.id, nombre: p.nombre, ingreso: ingresos.porPersona.get(p.id) || 0, fraccion: f, leToca, pagaHoy, diferencia: pagaHoy - leToca, parteSinResponsable: Math.round(sinResponsable * f) };
  });
  // Las sugerencias mueven partidas del presupuesto (lo que se puede reasignar).
  const partidas = o.fuente === 'presupuesto' ? items.filter((x) => x.tipo === 'partida') : itemsDelPresupuesto(ix, periodo, o, grupos).filter((x) => x.tipo === 'partida');
  const sugerencias = sugerirCambios(filas, partidas);

  const lempiras = (x) => ({ ...x, ingreso: deCentavos(x.ingreso), pct: Math.round(x.fraccion * 1000) / 10, leToca: deCentavos(x.leToca), pagaHoy: deCentavos(x.pagaHoy), diferencia: deCentavos(x.diferencia), parteSinResponsable: deCentavos(x.parteSinResponsable) });
  return {
    opciones: o, periodo, periodos, avisos, estimados: ingresos.estimados, grupos: [...grupos],
    personas: filas.map(lempiras), asignado: deCentavos(asignado), sinResponsable: deCentavos(sinResponsable), total: deCentavos(asignado + sinResponsable),
    items: items.map((x) => ({ ...x, monto: deCentavos(x.c) })).sort((a, b) => b.c - a.c), sugerencias,
  };
}
