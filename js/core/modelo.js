// Estructura del documento de datos (un solo JSON) y fusión entre copias.
import { periodoActual } from './util.js';

export const ESQUEMA = 1;
export const COLECCIONES = ['personas', 'cuentas', 'categorias', 'plantillas', 'prestamos', 'movimientos'];

export const CLASES = {
  ingreso: 'Ingresos',
  prestamo: 'Préstamos',
  fijo: 'Fijos',
  fijo_variable: 'Fijos variables',
  aporte: 'Aportes',
  provision: 'Pagos anuales',
};

export const TIPOS_MOVIMIENTO = {
  gasto: 'Gasto',
  ingreso: 'Ingreso',
  transferencia: 'Transferencia',
  abono: 'Abono a capital',
  ajuste: 'Ajuste de saldo',
};

export const TIPOS_CUENTA = {
  gastos: 'Gastos',
  ahorro: 'Ahorro',
  emergencias: 'Emergencias',
  reservas: 'Reservas',
  banco: 'Banco',
  efectivo: 'Efectivo',
  otra: 'Otra',
};

const CATEGORIAS = [
  ['vivienda', 'Vivienda'], ['servicios', 'Servicios'], ['comida', 'Comida'], ['restaurantes', 'Restaurantes'],
  ['transporte', 'Transporte'], ['salud', 'Salud'], ['ninos', 'Niños'], ['comunicaciones', 'Comunicaciones'],
  ['prestamos', 'Préstamos'], ['impuestos', 'Impuestos'], ['ropa', 'Ropa'], ['regalos', 'Regalos'],
  ['educacion', 'Educación'], ['entretenimiento', 'Entretenimiento'], ['salario', 'Salario'], ['otros', 'Otros'],
];

export const vivo = (r) => !!r && !r.borrado;

export function nuevoId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Los registros por defecto tienen id fijo y "actualizado" vacío: así, al fusionar con
// un archivo existente, nunca pisan los datos reales ni se duplican.
const base = (id, datos) => ({ id, ...datos, creado: '', creadoPor: null, actualizado: '', actualizadoPor: null });

export function docVacio() {
  return {
    esquema: ESQUEMA,
    config: { moneda: 'L', inicio: periodoActual(), actualizado: '' },
    personas: [],
    cuentas: [
      base('gastos', { nombre: 'Gastos', tipo: 'gastos', saldoInicial: 0, meta: null }),
      base('ahorro', { nombre: 'Ahorro', tipo: 'ahorro', saldoInicial: 0, meta: null }),
      base('emergencias', { nombre: 'Emergencias', tipo: 'emergencias', saldoInicial: 0, meta: null }),
      base('reservas', { nombre: 'Reservas (pagos anuales)', tipo: 'reservas', saldoInicial: 0, meta: null }),
    ],
    categorias: CATEGORIAS.map(([id, nombre]) => base(id, { nombre })),
    plantillas: [],
    prestamos: [],
    movimientos: [],
  };
}

// Marca quién y cuándo creó/editó un registro.
export function sellar(registro, personaId, ahora = new Date().toISOString()) {
  const r = { ...registro };
  if (!r.id) r.id = nuevoId();
  if (!r.creado) {
    r.creado = ahora;
    r.creadoPor = personaId ?? null;
  }
  r.actualizado = ahora;
  r.actualizadoPor = personaId ?? null;
  return r;
}

export function normalizar(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !('esquema' in doc)) {
    throw new Error('El archivo no tiene el formato de Gastos del hogar.');
  }
  if (doc.esquema > ESQUEMA) {
    throw new Error('El archivo es de una versión más nueva de la app. Recarga la página.');
  }
  const vacio = docVacio();
  const d = { ...vacio, ...doc, config: { ...vacio.config, ...(doc.config || {}) } };
  for (const c of COLECCIONES) if (!Array.isArray(d[c])) d[c] = vacio[c] ?? [];
  return d;
}

// ¿Gana a sobre b? Gana la edición más reciente; en empate, un criterio fijo para que
// todas las copias lleguen al mismo resultado.
function gana(a, b) {
  const ta = a?.actualizado || '';
  const tb = b?.actualizado || '';
  if (ta !== tb) return ta > tb;
  return JSON.stringify(a) > JSON.stringify(b);
}

// Fusiona dos copias del documento registro por registro (los borrados se conservan
// como marcas para que no "revivan").
export function fusionar(local, remoto) {
  const out = { ...remoto, ...local, esquema: Math.max(local.esquema || 1, remoto.esquema || 1) };
  out.config = gana(remoto.config, local.config) ? remoto.config : local.config;
  for (const c of COLECCIONES) {
    const m = new Map();
    for (const r of remoto[c] || []) m.set(r.id, r);
    for (const r of local[c] || []) {
      const x = m.get(r.id);
      if (!x || gana(r, x)) m.set(r.id, r);
    }
    out[c] = [...m.values()];
  }
  return out;
}

// true si el documento no tiene nada hecho por una persona (solo valores por defecto).
export function esPristino(doc) {
  return COLECCIONES.every((c) => (doc[c] || []).every((r) => !r.actualizado)) && !doc.config?.actualizado;
}
