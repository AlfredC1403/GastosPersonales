// Preguntas cortas sobre el documento y cómo se escribe el dinero. Es lo que usa cada pantalla
// para sacar un nombre, una lista ordenada o una cifra con su símbolo, sin repetir el filtro ni
// el formato en treinta archivos. Solo lee: nada de aquí cambia el documento.
import { vivo } from '../core/modelo.js';
import { dinero, dineroCorto } from '../core/util.js';
import { calcularAvisos, avisosVisibles } from '../core/avisos.js';
import { coincidePersona } from '../core/filtro.js';
import { prefs } from '../tema.js';
import { store, indice } from './estado.js';

const { computed } = Vue;

export const vivos = (coleccion) => store.doc[coleccion].filter(vivo);
export const buscar = (coleccion, id) => (id ? store.doc[coleccion].find((r) => r.id === id) : undefined);
export const nombrePersona = (id) => buscar('personas', id)?.nombre || 'Hogar';
export const nombreCuenta = (id) => buscar('cuentas', id)?.nombre || '—';
export const nombreCategoria = (id) => buscar('categorias', id)?.nombre || 'Sin categoría';
export const nombreGrupo = (id) => buscar('grupos', id)?.nombre || 'Sin grupo';
export const nombrePartida = (id) => buscar('partidas', id)?.nombre || '';
export const simbolo = () => store.doc.config.moneda || 'L';
export const simboloDe = (moneda) => (moneda === 'USD' ? store.doc.config.simboloExt || 'US$' : simbolo());
export const monedaDeCuenta = (id) => buscar('cuentas', id)?.moneda || 'L';
export const fmt = (n) => dinero(n, { simbolo: simbolo() });
export const fmtEntero = (n) => dinero(n, { simbolo: simbolo(), decimales: false });
export const fmtCorto = (n) => dineroCorto(n, simbolo());
export const fmtMoneda = (n, moneda) => dinero(n, { simbolo: simboloDe(moneda) });
export const personas = () => vivos('personas').sort((a, b) => a.nombre.localeCompare(b.nombre));
export const cuentas = () => vivos('cuentas');
// Cuentas con saldo (sin las tarjetas de crédito, que tienen deuda) y tarjetas.
export const cuentasDinero = () => cuentas().filter((c) => c.tipo !== 'tarjeta');
export const tarjetas = () => cuentas().filter((c) => c.tipo === 'tarjeta');
// Comercios, del más usado al menos usado.
export const comercios = () => {
  const uso = indice().usoComercios;
  return vivos('comercios').sort((a, b) => (uso.get(b.id) || 0) - (uso.get(a.id) || 0) || a.nombre.localeCompare(b.nombre));
};
export const categorias = () => vivos('categorias').sort((a, b) => a.nombre.localeCompare(b.nombre));
export const grupos = () => vivos('grupos').sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99) || a.nombre.localeCompare(b.nombre));
export const partidas = () => vivos('partidas').sort((a, b) => a.nombre.localeCompare(b.nombre));

// Categorías agrupadas para los selectores: [{ grupo, categorias }], en el orden de los grupos.
export function categoriasPorGrupo(tipo = 'gasto') {
  const lista = categorias().filter((c) => (c.tipo || 'gasto') === tipo);
  const out = grupos().map((g) => ({ grupo: g, categorias: lista.filter((c) => c.grupoId === g.id) })).filter((x) => x.categorias.length);
  const sueltas = lista.filter((c) => !grupos().some((g) => g.id === c.grupoId));
  if (sueltas.length) out.push({ grupo: { id: 'sin-grupo', nombre: 'Sin grupo' }, categorias: sueltas });
  return out;
}

// Persona elegida en el filtro de este dispositivo (null = todo el hogar).
export const personaFiltro = () => (prefs.persona && vivo(buscar('personas', prefs.persona)) ? prefs.persona : null);
export const filtro = () => (personaFiltro() ? { personaId: personaFiltro() } : null);

// Orden fijo de las personas (por fecha de creación y nombre) para darles siempre el mismo color.
export function colorPersona(id) {
  const orden = vivos('personas').sort((a, b) => (a.creado || '').localeCompare(b.creado || '') || a.nombre.localeCompare(b.nombre));
  const i = orden.findIndex((p) => p.id === id);
  return i < 0 ? 'var(--tinta3)' : ['var(--s2)', 'var(--s5)', 'var(--s4)', 'var(--s1)'][i % 4];
}

// Avisos visibles en este dispositivo (sin los pospuestos ni los descartados), de todo el hogar.
const avisosActuales = computed(() => avisosVisibles(calcularAvisos(indice(), { hoy: store.hoy, sync: store.sync, recordatorios: store.recordatorios }), prefs.avisosOcultos, store.hoy));
// Con filtro de persona: los de esa persona y los que no son de nadie.
export const avisos = () => avisosActuales.value.filter((a) => !a.personaId || coincidePersona(a.personaId, filtro()));
