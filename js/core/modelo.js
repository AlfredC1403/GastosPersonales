// Estructura de los datos (esquema 4) y fusión entre copias.
// En memoria todo es un solo documento. En OneDrive se guarda repartido en un archivo
// principal (configuración y catálogos) y un archivo por año (ver anios.js).
import { periodoActual } from './util.js';
import { GRUPOS_BASE, CATEGORIAS_BASE } from './catalogos.js';

export const ESQUEMA = 4;
export const COLECCIONES_PRINCIPAL = ['personas', 'grupos', 'categorias', 'cuentas', 'partidas', 'ingresos', 'prestamos', 'metas', 'comercios', 'resumenes', 'topes', 'renovaciones', 'tasas'];
export const COLECCIONES_ANIO = ['movimientos', 'recibos', 'ajustesPartida'];
export const COLECCIONES = [...COLECCIONES_PRINCIPAL, ...COLECCIONES_ANIO];

export const TIPOS_MOVIMIENTO = {
  gasto: 'Gasto',
  ingreso: 'Ingreso',
  transferencia: 'Transferencia',
  abono: 'Abono a capital',
  ajuste: 'Ajuste de saldo',
  pago_tarjeta: 'Pago de tarjeta',
};

export const TIPOS_CUENTA = {
  gastos: 'Gastos',
  banco: 'Banco',
  efectivo: 'Efectivo',
  ahorro: 'Ahorro',
  emergencias: 'Emergencias',
  reservas: 'Reservas',
  tarjeta: 'Tarjeta de crédito',
  otra: 'Otra',
};

export const MONEDAS = { L: 'Lempiras', USD: 'Dólares' };

export const TIPOS_PARTIDA = {
  gasto: 'Gasto',
  aporte: 'Aporte a una cuenta',
  anual: 'Pago anual',
};

// Lo que se elige al crear una partida. Una suscripción (Netflix, iCloud, el hosting) se guarda
// como un gasto con `suscripcion: true` y su ciclo de cobro: así todo lo que ya sabe tratar un
// gasto la trata igual, y se administra aparte en core/suscripciones.js.
export const CLASES_PARTIDA = {
  gasto: 'Gasto',
  suscripcion: 'Suscripción',
  aporte: 'Aporte a una cuenta',
  anual: 'Pago anual',
};

// Cada cuánto cobra una suscripción.
export const CICLOS = {
  mensual: 'Cada mes',
  trimestral: 'Cada 3 meses',
  semestral: 'Cada 6 meses',
  anual: 'Cada año',
};

// Qué hace el círculo de la partida en la pantalla Mes.
export const FORMAS = {
  fijo: 'Monto fijo',
  variable: 'Monto variable',
  abonos: 'En abonos',
};

export const FRECUENCIAS = { quincenal: 'Quincenal', mensual: 'Mensual' };

// Un tope es el techo que el hogar se pone para una categoría o un grupo entero. A diferencia
// de una partida, no planea un pago: solo avisa cuando el gasto del mes se acerca al techo,
// y por eso alcanza también lo que se gasta fuera del plan.
export const AMBITOS_TOPE = { categoria: 'Una categoría', grupo: 'Un grupo entero' };

// Una renovación vence y hay que hacer algo antes de esa fecha (el seguro del carro, la
// licencia, el pasaporte, la garantía del refrigerador). No es una suscripción: nadie la
// cobra solo, y por eso lo que importa es el aviso con tiempo, no el monto del mes.
export const REPETICIONES = { ninguna: 'No se repite', meses: 'Cada cierto número de meses' };

export const TIPOS_RECIBO = {
  ordinario: 'Pago',
  decimo14: 'Décimo cuarto mes',
  decimo13: 'Décimo tercer mes',
  extra: 'Pago extra',
};

export const vivo = (r) => !!r && !r.borrado;

export function nuevoId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Los registros por defecto tienen id fijo y "actualizado" vacío: así, al fusionar con
// un archivo existente, nunca pisan los datos reales ni se duplican.
export const base = (id, datos) => ({ id, ...datos, creado: '', creadoPor: null, actualizado: '', actualizadoPor: null });

export const gruposBase = () => GRUPOS_BASE.map(([id, nombre], i) => base(id, { nombre, orden: i + 1 }));
export const categoriasBase = () => CATEGORIAS_BASE.map(([id, nombre, grupoId, tipo = 'gasto']) => base(id, { nombre, grupoId, tipo }));

export const configBase = () => ({
  moneda: 'L', monedaExt: 'USD', simboloExt: 'US$', inicio: periodoActual(), tasaReferencia: null,
  // Día en que se anotó la tasa: una tasa vieja distorsiona en silencio todo lo que está en
  // dólares y no se ha pagado todavía, así que la app avisa cuando se pasa de un mes.
  tasaReferenciaDesde: '',
  asistente: { completados: [] }, actualizado: '',
});

export function docVacio() {
  const cuenta = (id, nombre, tipo) => base(id, { nombre, tipo, saldoInicial: 0, moneda: 'L', titularId: null });
  return {
    esquema: ESQUEMA,
    config: configBase(),
    personas: [],
    grupos: gruposBase(),
    categorias: categoriasBase(),
    cuentas: [
      cuenta('gastos', 'Gastos', 'gastos'),
      cuenta('ahorro', 'Ahorro', 'ahorro'),
      cuenta('emergencias', 'Emergencias', 'emergencias'),
      cuenta('reservas', 'Reservas (pagos anuales)', 'reservas'),
    ],
    partidas: [],
    ingresos: [],
    prestamos: [],
    metas: [],
    comercios: [],
    resumenes: [],
    topes: [],
    renovaciones: [],
    tasas: [],
    movimientos: [],
    recibos: [],
    ajustesPartida: [],
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

// ¿Gana a sobre b? Gana la edición más reciente; en empate, un criterio fijo para que
// todas las copias lleguen al mismo resultado.
export function gana(a, b) {
  const ta = a?.actualizado || '';
  const tb = b?.actualizado || '';
  if (ta !== tb) return ta > tb;
  return JSON.stringify(a) > JSON.stringify(b);
}

// Une dos listas registro por registro (los borrados se conservan como marcas para que no "revivan").
export function fusionarColeccion(local = [], remoto = []) {
  const m = new Map();
  for (const r of remoto) m.set(r.id, r);
  for (const r of local) {
    const x = m.get(r.id);
    if (!x || gana(r, x)) m.set(r.id, r);
  }
  return [...m.values()];
}

// Fusiona dos copias completas del documento.
export function fusionar(local, remoto) {
  const out = { ...remoto, ...local, esquema: Math.max(Number(local.esquema) || 1, Number(remoto.esquema) || 1) };
  out.config = gana(remoto.config, local.config) ? remoto.config : local.config;
  for (const c of COLECCIONES) out[c] = fusionarColeccion(local[c], remoto[c]);
  return out;
}

// Fusiona solo algunas colecciones de `parte` (por ejemplo, un archivo de año) en `doc`.
export function fusionarEn(doc, parte, colecciones) {
  const out = { ...doc };
  for (const c of colecciones) out[c] = fusionarColeccion(doc[c], parte[c]);
  return out;
}

// true si el documento no tiene nada hecho por una persona (solo valores por defecto).
export function esPristino(doc) {
  return COLECCIONES.every((c) => (doc[c] || []).every((r) => !r.actualizado)) && !doc.config?.actualizado;
}
