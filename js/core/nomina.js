// Nómina: pagos programados de cada salario, deducciones de cada pago (IHSS, ISR, préstamos
// por planilla…) y recibos. La app no calcula impuestos: registra lo que dice la colilla y
// usa lo anterior como guía.
import { vivo } from './modelo.js';
import { periodoDe, mesDe, sumarMeses, sumarDias, diaDeSemana, fechaEnMes, aCentavos, deCentavos } from './util.js';
import { claveRecibo } from './asientos.js';

const TODOS_LOS_MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const tieneValor = (v) => v !== null && v !== undefined && v !== '';

// Deducciones comunes en Honduras. `naturaleza`: 'gasto' (impuesto o cargo), 'ahorro'
// (aportación que se acumula) o 'prestamo' (cuota descontada por planilla).
export const DEDUCCIONES_SUGERIDAS = [
  { codigo: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss' },
  { codigo: 'isr', nombre: 'ISR', naturaleza: 'gasto', categoriaId: 'isr' },
  { codigo: 'rap', nombre: 'RAP', naturaleza: 'ahorro', categoriaId: 'ahorro' },
  { codigo: 'funebre', nombre: 'Ayuda fúnebre', naturaleza: 'gasto', categoriaId: 'ayuda-funebre' },
  { codigo: 'vecinal', nombre: 'Impuesto vecinal', naturaleza: 'gasto', categoriaId: 'impuesto-vecinal' },
  { codigo: 'cooperativa', nombre: 'Cooperativa', naturaleza: 'ahorro', categoriaId: 'ahorro' },
  { codigo: 'prestamo', nombre: 'Préstamo por planilla', naturaleza: 'prestamo', categoriaId: 'prestamos' },
  { codigo: 'otra', nombre: 'Otra deducción', naturaleza: 'gasto', categoriaId: null },
];

export const NATURALEZAS = { gasto: 'Impuesto o cargo', ahorro: 'Ahorro o aportación', prestamo: 'Pago de un préstamo' };
export const APLICA_EN = { ambas: 'En cada pago', q1: 'Solo en el primer pago del mes', q2: 'Solo en el segundo pago del mes' };

export const pagosPorMes = (ingreso) => (ingreso.frecuencia === 'quincenal' ? 2 : 1);

const diasDePago = (ingreso) => (ingreso.frecuencia === 'quincenal'
  ? [...(ingreso.diasPago?.length >= 2 ? ingreso.diasPago.slice(0, 2) : [15, 31])].map(Number).sort((a, b) => a - b)
  : [Number(ingreso.diasPago?.[0]) || 31]);

// Si el pago cae en fin de semana y así se configuró, se adelanta al viernes.
function ajustarFinDeSemana(fecha, regla) {
  if (regla !== 'anterior') return fecha;
  const dia = diaDeSemana(fecha);
  return dia === 6 ? sumarDias(fecha, -1) : dia === 0 ? sumarDias(fecha, -2) : fecha;
}

// Pagos programados de un ingreso en un mes: [{ tipo, ocurrencia, fecha, quincena }].
// `ocurrencia` es la fecha que toca según los días de pago (31 = último día); `fecha`, la
// que queda después de mover los fines de semana; `quincena`, 'q1' o 'q2' en un pago ordinario.
export function pagosProgramados(ingreso, periodo) {
  if (!vivo(ingreso) || ingreso.activo === false) return [];
  if (ingreso.vigenteDesde && periodo < periodoDe(ingreso.vigenteDesde)) return [];
  const mes = mesDe(periodo);
  const out = [];
  const meses = ingreso.meses?.length ? ingreso.meses : TODOS_LOS_MESES;
  if (meses.includes(mes)) {
    diasDePago(ingreso).forEach((dia, i) => {
      const ocurrencia = fechaEnMes(periodo, dia);
      out.push({ tipo: 'ordinario', ocurrencia, fecha: ajustarFinDeSemana(ocurrencia, ingreso.finDeSemana), quincena: i === 0 ? 'q1' : 'q2' });
    });
  }
  const finDeMes = fechaEnMes(periodo, 31);
  if (ingreso.decimo14 && mes === 6) out.push({ tipo: 'decimo14', ocurrencia: finDeMes, fecha: finDeMes, quincena: null });
  if (ingreso.decimo13 && mes === 12) out.push({ tipo: 'decimo13', ocurrencia: finDeMes, fecha: finDeMes, quincena: null });
  return out;
}

// 'q1' o 'q2' según el día de un pago ordinario (en un salario mensual siempre 'q1').
export function quincenaDe(ingreso, ocurrencia) {
  if (ingreso.frecuencia !== 'quincenal') return 'q1';
  const [primero] = diasDePago(ingreso);
  return Number(String(ocurrencia).slice(8, 10)) <= Math.min(primero, 31) ? 'q1' : 'q2';
}

// Ingreso mensual promedio: los pagos del mes y los décimos repartidos en el año.
export function ingresoMensual(ingreso) {
  const neto = Number(ingreso.netoEsperado) || 0;
  const meses = ingreso.meses?.length ? ingreso.meses.length : 12;
  const decimos = (ingreso.decimo13 ? 1 : 0) + (ingreso.decimo14 ? 1 : 0);
  return (neto * pagosPorMes(ingreso) * (meses + decimos)) / 12;
}

export const netoEsperadoDe = (ingreso, tipo) => deCentavos(aCentavos(ingreso.netoEsperado) * (tipo === 'ordinario' ? 1 : pagosPorMes(ingreso)));

// Deducciones que aplican en un pago. Los décimos solo llevan las marcadas "también en los décimos".
export function deduccionesDelPago(ingreso, pago) {
  const quincena = pago.quincena || quincenaDe(ingreso, pago.ocurrencia);
  return (ingreso.deducciones || []).filter((d) => {
    if (d.activo === false) return false;
    if ((pago.tipo || 'ordinario') !== 'ordinario') return !!d.enDecimos;
    const aplica = ingreso.frecuencia === 'quincenal' ? d.aplicaEn || 'ambas' : 'ambas';
    return aplica === 'ambas' || aplica === quincena;
  });
}

// Monto esperado de una deducción en un pago. Un préstamo sin monto propio descuenta su cuota
// repartida entre las quincenas en que aplica: la primera redondea hacia abajo y la segunda completa.
export function montoEsperado(ix, ingreso, d, pago) {
  if (tieneValor(d.montoEsperado)) return Number(d.montoEsperado);
  if (d.naturaleza !== 'prestamo') return null;
  const p = ix.prestamos.get(d.prestamoId);
  if (!vivo(p)) return null;
  const cuota = aCentavos(p.cuota);
  const reparte = ingreso.frecuencia === 'quincenal' && (d.aplicaEn || 'ambas') === 'ambas' && (pago?.tipo || 'ordinario') === 'ordinario';
  if (!reparte) return deCentavos(cuota);
  const mitad = Math.floor(cuota / 2);
  return deCentavos((pago?.quincena || quincenaDe(ingreso, pago?.ocurrencia || '')) === 'q2' ? cuota - mitad : mitad);
}

// Deducción tal como queda guardada en el recibo: con su nombre y a dónde va, para que el
// recibo se lea igual aunque después cambie la configuración del salario.
export function entradaDeduccion(ix, ingreso, d, pago) {
  const esperado = montoEsperado(ix, ingreso, d, pago);
  return {
    deduccionId: d.id,
    nombre: d.nombre,
    naturaleza: d.naturaleza || 'gasto',
    categoriaId: d.categoriaId || null,
    prestamoId: d.naturaleza === 'prestamo' ? d.prestamoId || null : null,
    cuentaDestinoId: d.naturaleza === 'ahorro' ? d.cuentaDestinoId || null : null,
    monto: d.fija || d.naturaleza === 'prestamo' ? esperado : null,
    noAplica: false,
  };
}

// Recibo listo para registrar un pago: fecha programada (o hoy, si todavía no llega), neto
// esperado y deducciones; las fijas y las de préstamos vienen llenas, las demás vacías.
export function reciboSugerido(ix, ingreso, pago, { hoy }) {
  const conQuincena = { ...pago, quincena: pago.quincena ?? (pago.tipo === 'ordinario' ? quincenaDe(ingreso, pago.ocurrencia) : null) };
  return {
    ingresoId: ingreso.id, tipo: pago.tipo, ocurrencia: pago.ocurrencia, periodo: periodoDe(pago.ocurrencia),
    fecha: pago.fecha <= hoy ? pago.fecha : hoy, cuentaId: ingreso.cuentaId || 'gastos', neto: netoEsperadoDe(ingreso, pago.tipo),
    extras: [], deducciones: deduccionesDelPago(ingreso, conQuincena).map((d) => entradaDeduccion(ix, ingreso, d, conQuincena)),
    personaId: ingreso.personaId || null, nota: '',
  };
}

// Montos anteriores de cada deducción, para usarlos de guía. Se prefiere la misma quincena
// (el pago del 15 con el del 15). `ultimo`: el recibo anterior de esa misma quincena.
export function valoresAnteriores(ix, ingreso, pago) {
  const tipo = pago.tipo || 'ordinario';
  const quincena = tipo === 'ordinario' ? pago.quincena || quincenaDe(ingreso, pago.ocurrencia) : null;
  const previos = (ix.recibosPorIngreso.get(ingreso.id) || [])
    .filter((r) => (r.tipo || 'ordinario') === tipo && r.ocurrencia < pago.ocurrencia)
    .sort((a, b) => (a.ocurrencia < b.ocurrencia ? 1 : a.ocurrencia > b.ocurrencia ? -1 : 0));
  const misma = tipo === 'ordinario' ? previos.filter((r) => quincenaDe(ingreso, r.ocurrencia) === quincena) : previos;
  const guia = {};
  for (const r of [...misma, ...previos]) {
    for (const d of r.deducciones || []) {
      if (!(d.deduccionId in guia) && !d.noAplica && tieneValor(d.monto)) guia[d.deduccionId] = Number(d.monto);
    }
  }
  return { guia, ultimo: misma[0] || null };
}

export function estadoRecibo(r) {
  const deducciones = r.deducciones || [];
  const pendientes = deducciones.filter((d) => !d.noAplica && !tieneValor(d.monto));
  const descontado = deducciones.filter((d) => !d.noAplica && tieneValor(d.monto)).reduce((a, d) => a + aCentavos(d.monto), 0);
  return { pendientes: pendientes.length, completo: !pendientes.length, descontado: deCentavos(descontado), bruto: deCentavos(aCentavos(r.neto) + descontado) };
}

// Pagos que ya pasaron (con días de gracia) y no tienen recibo. Solo de salarios con monto,
// desde `desde` (el inicio del registro) y como mucho de los dos meses anteriores.
export function pagosSinRegistrar(ix, { hoy, diasGracia = 2, desde = '' }) {
  const out = [];
  const actual = periodoDe(hoy);
  const inicio = [sumarMeses(actual, -2), desde].filter(Boolean).sort().pop();
  for (const ingreso of ix.doc.ingresos || []) {
    if (!vivo(ingreso) || ingreso.activo === false || !(Number(ingreso.netoEsperado) > 0)) continue;
    for (let periodo = inicio; periodo <= actual; periodo = sumarMeses(periodo, 1)) {
      for (const pago of pagosProgramados(ingreso, periodo)) {
        if (sumarDias(pago.fecha, diasGracia) >= hoy) continue;
        if (ix.recibos.get(claveRecibo({ ingresoId: ingreso.id, ...pago }))?.length) continue;
        out.push({ ingreso, pago });
      }
    }
  }
  return out.sort((a, b) => (a.pago.fecha < b.pago.fecha ? -1 : 1));
}

// Pagos para elegir al registrar una quincena: los que no tienen recibo, de hace 45 días (o
// desde el inicio del registro) a dentro de 16, del más cercano a hoy al más lejano.
export function pagosParaRegistrar(ix, { hoy, desde: inicio = '' }) {
  const out = [];
  const desde = [sumarDias(hoy, -45), inicio ? `${inicio}-01` : ''].sort().pop();
  const hasta = sumarDias(hoy, 16);
  for (const ingreso of ix.doc.ingresos || []) {
    for (let periodo = periodoDe(desde); periodo <= periodoDe(hasta); periodo = sumarMeses(periodo, 1)) {
      for (const pago of pagosProgramados(ingreso, periodo)) {
        if (pago.fecha < desde || pago.fecha > hasta) continue;
        if (ix.recibos.get(claveRecibo({ ingresoId: ingreso.id, ...pago }))?.length) continue;
        out.push({ ingreso, pago });
      }
    }
  }
  const distancia = (x) => Math.abs(new Date(x.pago.fecha) - new Date(hoy)) + (x.pago.fecha > hoy ? 1 : 0);
  return out.sort((a, b) => distancia(a) - distancia(b));
}

// Deducción de planilla activa que paga un préstamo, si la hay. `veces`: descuentos por mes.
export function planillaDe(ix, prestamoId) {
  for (const ingreso of ix.doc.ingresos || []) {
    if (!vivo(ingreso) || ingreso.activo === false) continue;
    const d = (ingreso.deducciones || []).find((x) => x.activo !== false && x.naturaleza === 'prestamo' && x.prestamoId === prestamoId);
    if (d) return { ingreso, deduccion: d, veces: ingreso.frecuencia === 'quincenal' && (d.aplicaEn || 'ambas') === 'ambas' ? 2 : 1 };
  }
  return null;
}
