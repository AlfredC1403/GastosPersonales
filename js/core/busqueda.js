// Buscador global: una sola caja que cruza movimientos, partidas, comercios, cuentas, personas,
// préstamos, metas, topes, renovaciones, etiquetas y las propias pantallas.
//
// Antes buscar solo existía dentro de Movimientos: para llegar a una partida o a una tarjeta
// había que acordarse de en qué pantalla vive, y en el teléfono eso son varios toques.
import { vivo } from './modelo.js';
import { slug, periodoDe } from './util.js';

const MAXIMO_POR_TIPO = 6;

// Cuánto se parece `texto` a lo buscado, de 0 (nada) a 100 (igual). Devuelve 0 si no coincide.
export function parecido(texto, buscado) {
  const t = slug(texto);
  if (!t || !buscado) return 0;
  if (t === buscado) return 100;
  if (t.startsWith(buscado)) return 80;
  // Una palabra que empieza así: "colonia" encuentra "supermercado la colonia".
  if (t.split('-').some((p) => p.startsWith(buscado))) return 65;
  if (t.includes(buscado)) return 45;
  return 0;
}

// Las pantallas de la app, para poder llegar a cualquiera escribiendo su nombre.
export const PANTALLAS = [
  { id: 'inicio', nombre: 'Inicio' },
  { id: 'mes', nombre: 'Mes' },
  { id: 'movimientos', nombre: 'Movimientos' },
  { id: 'avisos', nombre: 'Avisos' },
  { id: 'cuentas', nombre: 'Cuentas' },
  { id: 'tarjetas', nombre: 'Tarjetas' },
  { id: 'financiamientos', nombre: 'Financiamientos' },
  { id: 'prestamos', nombre: 'Préstamos' },
  { id: 'presupuesto', nombre: 'Presupuesto' },
  { id: 'proyeccion', nombre: 'Proyección' },
  { id: 'topes', nombre: 'Topes' },
  { id: 'renovaciones', nombre: 'Renovaciones' },
  { id: 'suscripciones', nombre: 'Suscripciones' },
  { id: 'plan-deudas', nombre: 'Plan de deudas' },
  { id: 'metas', nombre: 'Metas' },
  { id: 'reparto', nombre: 'Reparto de gastos' },
  { id: 'resumen', nombre: 'Resumen anual' },
  { id: 'comparar', nombre: 'Comparar años' },
  { id: 'anios', nombre: 'Años anteriores' },
  { id: 'salarios', nombre: 'Salarios y deducciones' },
  { id: 'categorias', nombre: 'Categorías y grupos' },
  { id: 'comercios', nombre: 'Comercios' },
  { id: 'personas', nombre: 'Personas' },
  { id: 'recordatorios', nombre: 'Recordatorios' },
  { id: 'configurar', nombre: 'Revisar configuración' },
  { id: 'seguridad', nombre: 'Seguridad' },
  { id: 'datos', nombre: 'Datos y OneDrive' },
  { id: 'papelera', nombre: 'Papelera' },
  { id: 'apariencia', nombre: 'Apariencia' },
];

const GRUPOS = [
  { tipo: 'pantalla', titulo: 'Pantallas' },
  { tipo: 'movimiento', titulo: 'Movimientos' },
  { tipo: 'partida', titulo: 'Partidas' },
  { tipo: 'etiqueta', titulo: 'Etiquetas' },
  { tipo: 'cuenta', titulo: 'Cuentas y tarjetas' },
  { tipo: 'comercio', titulo: 'Comercios' },
  { tipo: 'prestamo', titulo: 'Préstamos' },
  { tipo: 'meta', titulo: 'Metas' },
  { tipo: 'renovacion', titulo: 'Renovaciones' },
  { tipo: 'persona', titulo: 'Personas' },
  { tipo: 'categoria', titulo: 'Categorías' },
];

/**
 * Busca en todo el documento.
 * @returns [{ tipo, titulo, grupo, id, nombre, detalle, ruta, puntos, registro }] por grupos,
 *   cada grupo con sus mejores coincidencias.
 */
export function buscarEnTodo(ix, texto, { maximo = MAXIMO_POR_TIPO } = {}) {
  const buscado = slug(texto);
  if (buscado.length < 2) return [];
  const encontrado = [];
  const agregar = (tipo, r, { nombre, detalle = '', ruta, extra = 0 }) => {
    const puntos = parecido(nombre, buscado) + extra;
    if (puntos > extra) encontrado.push({ tipo, id: r?.id ?? nombre, nombre, detalle, ruta, puntos, registro: r });
  };

  for (const p of PANTALLAS) agregar('pantalla', null, { nombre: p.nombre, ruta: `#/${p.id}` });

  for (const p of ix.doc.partidas || []) {
    if (!vivo(p)) continue;
    agregar('partida', p, { nombre: p.nombre, detalle: p.suscripcion ? 'Suscripción' : p.tipo === 'anual' ? 'Pago anual' : p.tipo === 'aporte' ? 'Aporte' : 'Partida', ruta: '#/presupuesto' });
  }
  for (const c of ix.doc.cuentas || []) {
    if (!vivo(c)) continue;
    agregar('cuenta', c, { nombre: c.nombre, detalle: c.tipo === 'tarjeta' ? 'Tarjeta de crédito' : 'Cuenta', ruta: c.tipo === 'tarjeta' ? `#/tarjeta/${c.id}` : '#/cuentas' });
  }
  for (const c of ix.doc.comercios || []) if (vivo(c)) agregar('comercio', c, { nombre: c.nombre, detalle: 'Comercio', ruta: '#/comercios' });
  for (const p of ix.doc.prestamos || []) if (vivo(p)) agregar('prestamo', p, { nombre: p.nombre, detalle: 'Préstamo', ruta: '#/prestamos' });
  for (const x of ix.doc.metas || []) if (vivo(x)) agregar('meta', x, { nombre: x.nombre, detalle: 'Meta', ruta: '#/metas' });
  for (const r of ix.doc.renovaciones || []) if (vivo(r)) agregar('renovacion', r, { nombre: r.nombre, detalle: r.vence ? `Vence el ${r.vence}` : 'Renovación', ruta: '#/renovaciones' });
  for (const p of ix.doc.personas || []) if (vivo(p)) agregar('persona', p, { nombre: p.nombre, detalle: 'Persona', ruta: '#/personas' });
  for (const c of ix.doc.categorias || []) if (vivo(c)) agregar('categoria', c, { nombre: c.nombre, detalle: 'Categoría', ruta: '#/categorias' });

  // Etiquetas: se buscan por su nombre y llevan a los movimientos que las llevan.
  const etiquetas = new Map();
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m)) continue;
    for (const e of m.etiquetas || []) etiquetas.set(slug(e), e);
  }
  for (const e of etiquetas.values()) agregar('etiqueta', null, { nombre: e, detalle: 'Etiqueta', ruta: `#/movimientos?etiqueta=${encodeURIComponent(e)}` });

  // Movimientos: por nota, comercio y etiquetas. Los más recientes primero, porque lo que se
  // busca casi siempre es de estos días.
  for (const m of ix.doc.movimientos || []) {
    if (!vivo(m)) continue;
    const comercio = ix.comercios.get(m.comercioId)?.nombre || '';
    const nombre = m.nota || comercio || ix.partidas.get(m.partidaId)?.nombre || '';
    if (!nombre) continue;
    const puntos = Math.max(parecido(nombre, buscado), parecido(comercio, buscado), ...(m.etiquetas || []).map((e) => parecido(e, buscado)));
    if (!puntos) continue;
    encontrado.push({
      tipo: 'movimiento', id: m.id, nombre, puntos, registro: m,
      detalle: `${m.fecha} · ${ix.cuentas.get(m.cuentaId)?.nombre || ''}`,
      ruta: `#/movimientos?mes=${m.periodo || periodoDe(m.fecha)}`,
      monto: m.monto, moneda: m.moneda || 'L',
    });
  }

  const porTipo = new Map();
  for (const x of encontrado) {
    const lista = porTipo.get(x.tipo) || [];
    lista.push(x);
    porTipo.set(x.tipo, lista);
  }
  const desempate = (a, b) => b.puntos - a.puntos
    || (b.registro?.fecha || '').localeCompare(a.registro?.fecha || '')
    || a.nombre.localeCompare(b.nombre);

  return GRUPOS
    .map((g) => ({ ...g, resultados: (porTipo.get(g.tipo) || []).sort(desempate).slice(0, maximo) }))
    .filter((g) => g.resultados.length)
    // Primero el grupo cuya mejor coincidencia es más fuerte: si se escribe el nombre exacto de
    // una tarjeta, la tarjeta va arriba y no la pantalla que se le parece.
    .sort((a, b) => b.resultados[0].puntos - a.resultados[0].puntos);
}

// Todos los resultados en una sola lista, en el orden en que se ven: es lo que recorren las
// flechas del teclado.
export const enOrden = (grupos) => grupos.flatMap((g) => g.resultados);
