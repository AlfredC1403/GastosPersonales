// Utilidades puras: dinero, fechas ('YYYY-MM-DD') y periodos ('YYYY-MM').

export const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Los cálculos suman centavos enteros para que 0.1 + 0.2 no deje residuos.
export const aCentavos = (n) => Math.round((Number(n) || 0) * 100);
export const deCentavos = (c) => c / 100;

export function hoy(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Texto sin tildes ni símbolos, para ids: slug('Súper La Colonia') → 'super-la-colonia'.
export const slug = (texto) => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const periodoDe = (fecha) => String(fecha).slice(0, 7);
export const periodoActual = () => periodoDe(hoy());
export const mesDe = (periodo) => Number(periodo.slice(5, 7));
export const anioDe = (fechaOPeriodo) => String(fechaOPeriodo ?? '').slice(0, 4);

export function ultimoDia(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// sumarDias('2026-09-30', 2) → '2026-10-02'. Con fechas UTC para no depender del horario de verano.
export function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export const diaDeSemana = (fecha) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// Día `dia` del mes, sin pasarse del último: fechaEnMes('2026-02', 31) → '2026-02-28'.
export function fechaEnMes(periodo, dia) {
  const d = Math.min(Math.max(Math.round(Number(dia)) || 1, 1), ultimoDia(periodo));
  return `${periodo}-${String(d).padStart(2, '0')}`;
}

export function sumarMeses(periodo, n) {
  const [y, m] = periodo.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function mesesEntre(desde, hasta) {
  const [ya, ma] = desde.split('-').map(Number);
  const [yb, mb] = hasta.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = MESES.map((m) => m.slice(0, 3));

// Índice 0 = domingo, como getDay() y diaDeSemana().
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const nombreMes = (m) => MESES[m - 1];

export function nombrePeriodo(periodo, corto = false) {
  if (!periodo) return '—';
  const [y, m] = periodo.split('-').map(Number);
  return `${(corto ? MESES_CORTOS : MESES)[m - 1]} ${y}`;
}

export function fechaCorta(fecha) {
  if (!fecha) return '';
  const [, m, d] = fecha.split('-').map(Number);
  return `${d} ${MESES_CORTOS[m - 1]}`;
}

const diasEntre = (desde, hasta) => {
  const f = (x) => Date.UTC(...x.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((f(hasta) - f(desde)) / 86400000);
};
// "hoy", "mañana", "en 5 días", "hace 2 días"
export function cuandoVence(limite, hoy) {
  const n = diasEntre(hoy, limite);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n > 1) return `en ${n} días`;
  return n === -1 ? 'ayer' : `hace ${-n} días`;
}

// "7 años y 3 meses", "11 meses"
export function duracion(meses) {
  if (!Number.isFinite(meses)) return 'nunca';
  const a = Math.floor(meses / 12);
  const m = meses % 12;
  const partes = [];
  if (a) partes.push(`${a} ${a === 1 ? 'año' : 'años'}`);
  if (m || !a) partes.push(`${m} ${m === 1 ? 'mes' : 'meses'}`);
  return partes.join(' y ');
}

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

// dinero(-1234.5) → "-L1,234.50"
export function dinero(n, { simbolo = 'L', decimales = true } = {}) {
  const v = redondear(n || 0);
  return `${v < 0 ? '-' : ''}${simbolo}${(decimales ? fmt2 : fmt0).format(Math.abs(v))}`;
}

// 12500 → "L12.5k", 1250000 → "L1.25M"
export function dineroCorto(n, simbolo = 'L') {
  const v = Math.abs(n || 0);
  const s = n < 0 ? '-' : '';
  if (v >= 1e6) return `${s}${simbolo}${+(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${s}${simbolo}${+(v / 1e3).toFixed(1)}k`;
  return `${s}${simbolo}${Math.round(v)}`;
}
