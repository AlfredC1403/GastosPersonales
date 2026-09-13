// Validación de documentos y migración del esquema 1 al 2.
// `migrar` es pura y determinista: no cambia "actualizado", no crea ids al azar y no mira
// la fecha de hoy. Así dos celulares que migran el mismo archivo llegan al mismo resultado,
// y aplicarla dos veces no cambia nada.
import { ESQUEMA, COLECCIONES, docVacio, gruposBase, categoriasBase, gana } from './modelo.js';
import { CATEGORIAS_BASE, GRUPO_POR_DEFECTO } from './catalogos.js';
import { periodoDe, fechaEnMes } from './util.js';

const GRUPO_BASE = Object.fromEntries(CATEGORIAS_BASE.map(([id, , grupoId]) => [id, grupoId]));
const TIPO_BASE = Object.fromEntries(CATEGORIAS_BASE.map(([id, , , tipo = 'gasto']) => [id, tipo]));
const TIPO_RECIBO_DE_PARTE = { decimo13: 'decimo13', decimo14: 'decimo14' };

const sellos = (r) => ({
  creado: r.creado || '', creadoPor: r.creadoPor ?? null, actualizado: r.actualizado || '', actualizadoPor: r.actualizadoPor ?? null,
  ...(r.borrado ? { borrado: true } : {}),
});

// Agrega `r` a la lista; si ya hay un registro con ese id, queda el más reciente.
function conRegistro(lista, r) {
  const i = lista.findIndex((x) => x.id === r.id);
  if (i < 0) lista.push(r);
  else if (gana(r, lista[i])) lista[i] = r;
}

function agregarFaltantes(lista, base) {
  const ids = new Set(lista.map((r) => r.id));
  for (const r of base) if (!ids.has(r.id)) lista.push(r);
}

export function partidaDesdePlantilla(t) {
  const tipo = t.clase === 'aporte' ? 'aporte' : t.clase === 'provision' ? 'anual' : 'gasto';
  return {
    id: t.id,
    nombre: t.nombre || '',
    categoriaId: t.categoriaId ?? (tipo === 'aporte' ? 'ahorro' : null),
    responsableId: t.responsableId ?? null,
    tipo,
    forma: t.clase === 'fijo_variable' ? 'variable' : 'fijo',
    monto: Number(t.monto) || 0,
    meses: Array.isArray(t.meses) ? t.meses : [],
    montoAnual: t.montoAnual ?? null,
    mesPago: t.mesPago ?? null,
    dia: t.dia ?? null,
    medioPagoId: t.cuentaId || 'gastos',
    cuentaDestinoId: t.cuentaDestinoId ?? (tipo === 'anual' ? 'reservas' : null),
    metaId: null,
    acumula: false,
    sePagaCon: 'auto',
    activo: t.activo !== false,
    desde: t.desde ?? null,
    hasta: t.hasta ?? null,
    nota: t.nota || '',
    ...sellos(t),
  };
}

export function ingresoDesdePlantilla(t) {
  return {
    id: t.id,
    nombre: t.nombre || '',
    personaId: t.responsableId ?? null,
    frecuencia: 'mensual',
    diasPago: [Number(t.dia) || 31],
    finDeSemana: 'igual',
    cuentaId: t.cuentaId || 'gastos',
    categoriaId: t.categoriaId || 'salario',
    netoEsperado: Number(t.monto) || 0,
    meses: Array.isArray(t.meses) ? t.meses : [],
    decimo13: !!t.decimo13,
    decimo14: !!t.decimo14,
    vigenteDesde: null,
    activo: t.activo !== false,
    deducciones: [],
    nota: t.nota || '',
    ...sellos(t),
  };
}

// Un ingreso registrado en el esquema 1 (movimiento de un salario) pasa a ser un recibo.
function reciboDesdeMovimiento(m, ingreso) {
  const periodo = m.periodo || periodoDe(m.fecha);
  const tipo = TIPO_RECIBO_DE_PARTE[m.parte] || 'ordinario';
  const dia = tipo === 'ordinario' ? Number(ingreso?.diasPago?.[0] ?? ingreso?.dia) || 31 : 31;
  return {
    id: m.id,
    ingresoId: m.plantillaId,
    tipo,
    ocurrencia: fechaEnMes(periodo, dia),
    fecha: m.fecha,
    periodo,
    cuentaId: m.cuentaId || 'gastos',
    neto: Number(m.monto) || 0,
    extras: [],
    deducciones: [],
    personaId: m.personaId ?? null,
    nota: m.nota || '',
    ...sellos(m),
  };
}

export function migrar(entrada) {
  const { plantillas: plantillasV1, ...doc } = entrada;
  const plantillas = Array.isArray(plantillasV1) ? plantillasV1 : [];

  const partidas = [...(doc.partidas || [])];
  const ingresos = [...(doc.ingresos || [])];
  for (const t of plantillas) {
    if (t.clase === 'ingreso') conRegistro(ingresos, ingresoDesdePlantilla(t));
    else conRegistro(partidas, partidaDesdePlantilla(t));
  }
  const ingresosPorId = new Map(ingresos.map((x) => [x.id, x]));

  const movimientos = [];
  const recibos = [...(doc.recibos || [])];
  for (const m of doc.movimientos || []) {
    if (!('plantillaId' in m)) {
      movimientos.push(m.moneda ? m : { ...m, moneda: 'L' });
      continue;
    }
    const { plantillaId, parte, ...resto } = m;
    if (plantillaId && m.tipo === 'ingreso' && ingresosPorId.has(plantillaId)) {
      conRegistro(recibos, reciboDesdeMovimiento(m, ingresosPorId.get(plantillaId)));
    } else {
      // Solo los pagos anuales distinguen partes ('apartar' y 'pagar'); 'principal' ya no se usa.
      const conParte = parte === 'apartar' || parte === 'pagar' ? { parte } : {};
      movimientos.push({ ...resto, ...conParte, partidaId: plantillaId || null, moneda: m.moneda || 'L' });
    }
  }

  const grupos = [...(doc.grupos || [])];
  agregarFaltantes(grupos, gruposBase());
  const categorias = (doc.categorias || []).map((c) => (c.grupoId && c.tipo ? c : {
    ...c, grupoId: c.grupoId || GRUPO_BASE[c.id] || GRUPO_POR_DEFECTO, tipo: c.tipo || TIPO_BASE[c.id] || 'gasto',
  }));
  agregarFaltantes(categorias, categoriasBase());

  // La meta de una cuenta pasa a ser una meta aparte.
  const metas = [...(doc.metas || [])];
  const cuentas = (doc.cuentas || []).map((c) => {
    if (c.moneda && 'titularId' in c && !('meta' in c)) return c;
    const { meta, ...resto } = c;
    const id = `meta-${c.id}`;
    if (Number(meta) > 0 && !metas.some((x) => x.id === id)) {
      metas.push({
        id, nombre: c.nombre || '', montoObjetivo: Number(meta), fechaObjetivo: null, cuentaId: c.id, responsableId: c.titularId ?? null,
        saldoInicial: 0, activo: true, nota: '', ...sellos(c),
      });
    }
    return { ...resto, moneda: c.moneda || 'L', titularId: c.titularId ?? null };
  });

  const out = { ...doc, esquema: Math.max(ESQUEMA, Number(doc.esquema) || 1), grupos, categorias, cuentas, partidas, ingresos, metas, movimientos, recibos };
  // Marca que los datos vienen de una versión anterior: la app ofrece revisar la configuración.
  if ((Number(doc.esquema) || 1) < ESQUEMA && doc.config) out.config = { ...doc.config, migradoDesde: Number(doc.esquema) || 1 };
  for (const c of COLECCIONES) if (!Array.isArray(out[c])) out[c] = [];
  return out;
}

// Valida un documento (de un archivo o del navegador), lo migra si es de un esquema
// anterior y completa lo que falte. Uno de una versión más nueva de la app se rechaza.
export function normalizar(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !('esquema' in doc)) {
    throw new Error('El archivo no tiene el formato de Gastos del hogar.');
  }
  if (Number(doc.esquema) > ESQUEMA) {
    throw Object.assign(new Error('El archivo es de una versión más nueva de la app. Actualiza la app.'), { codigo: 'esquema_nuevo' });
  }
  const vacio = docVacio();
  const d = migrar(Array.isArray(doc.cuentas) ? doc : { ...doc, cuentas: vacio.cuentas });
  return { ...d, esquema: ESQUEMA, config: { ...vacio.config, ...(d.config || {}) } };
}
