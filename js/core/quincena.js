// Plan por quincena: el mes se parte en tramos que van de un día de pago al día antes del
// siguiente, aunque crucen de mes. Cada tramo dice lo que entra, lo que sale y lo que queda.
import { periodoDe, sumarMeses, sumarDias, fechaEnMes, aCentavos, deCentavos } from './util.js';
import { coincidePersona } from './filtro.js';
import { usoDelPlan, partidasDelMes } from './presupuesto.js';
import { resumenMes } from './reportes.js';

// Pagos de distintas personas con esta diferencia de días o menos forman un solo tramo.
const JUNTAR_DIAS = 3;

const porFecha = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Tramos que tocan `periodo`: [{ clave, inicio, fin, sinPago, ingresos, items, entra, recibido,
// sale, pagado, pendiente, fueraDelPlan, disponible }]. Cada item lleva `porcion`: 1, o la
// mitad cuando una partida sin día se reparte entre los dos pagos del mes.
export function tramosDePago(ix, periodo, filtro) {
  const periodos = [sumarMeses(periodo, -1), periodo, sumarMeses(periodo, 1)];
  const resumenes = new Map(periodos.map((p) => [p, resumenMes(ix, p, filtro)]));

  // 1. Días de pago ordinarios con monto o ya recibidos, agrupados si caen muy cerca.
  const pagos = [];
  for (const p of periodos) {
    for (const it of resumenes.get(p).ingresos) {
      if (it.tipo !== 'ordinario' || it.fueraDeCalendario || !(it.esperado > 0 || it.recibos.length)) continue;
      pagos.push({ it, ocurrencia: it.ocurrencia, fecha: it.recibos[0]?.fecha || it.fecha });
    }
  }
  if (!pagos.length) return [];
  pagos.sort((a, b) => porFecha(a.ocurrencia, b.ocurrencia));
  const grupos = [];
  for (const x of pagos) {
    const g = grupos[grupos.length - 1];
    if (g && sumarDias(g.ultima, JUNTAR_DIAS) >= x.ocurrencia) {
      g.pagos.push(x);
      g.ultima = x.ocurrencia;
      if (x.fecha < g.inicio) g.inicio = x.fecha;
    } else {
      grupos.push({ clave: x.ocurrencia, ultima: x.ocurrencia, inicio: x.fecha, pagos: [x] });
    }
  }
  const finDeRango = fechaEnMes(periodos[2], 31);
  const tramos = grupos.map((g, i) => ({
    clave: g.clave, inicio: g.inicio, fin: grupos[i + 1] ? sumarDias(grupos[i + 1].inicio, -1) : finDeRango, sinPago: false, ingresos: g.pagos.map((x) => x.it), items: [],
  }));
  // Días antes del primer pago conocido (por ejemplo, el mes en que empieza un salario).
  if (tramos[0].inicio > `${periodos[0]}-01`) {
    tramos.unshift({ clave: `antes:${periodos[0]}`, inicio: `${periodos[0]}-01`, fin: sumarDias(tramos[0].inicio, -1), sinPago: true, ingresos: [], items: [] });
  }
  const tramoDe = (fecha) => tramos.find((t) => t.inicio <= fecha && fecha <= t.fin) || null;

  // 2. Lo que sale: partidas y cuotas de los tres meses, sin los pagos anuales (salen de lo
  // apartado) ni las cuotas por planilla (ya vienen descontadas del salario).
  const asignar = (tramo, it, periodoItem, porcion, parte) => {
    if (!tramo) return;
    const monto = (v) => {
      const c = aCentavos(v);
      if (porcion === 1) return c;
      const mitad = Math.floor(c / 2);
      return parte === 1 ? mitad : c - mitad;
    };
    const fecha = it.dia ? fechaEnMes(periodoItem, it.dia) : null;
    tramo.items.push({ it, periodo: periodoItem, fecha, porcion, esperado: monto(it.esperado), real: monto(it.real), queda: monto(it.queda), uso: monto(usoDelPlan(it)) });
  };
  for (const p of periodos) {
    const r = resumenes.get(p);
    const delMes = tramos.filter((t) => !t.sinPago && periodoDe(t.inicio) === p);
    const items = [...r.cuotas.filter((it) => !it.planilla), ...r.partidas.filter((it) => it.parte !== 'pagar')]
      .filter((it) => it.esperado > 0 || it.real > 0);
    for (const it of items) {
      const regla = it.partida?.sePagaCon || 'auto';
      if (it.dia && regla === 'auto') asignar(tramoDe(fechaEnMes(p, it.dia)), it, p, 1);
      else if (regla === 'q1' && delMes.length) asignar(delMes[0], it, p, 1);
      else if (regla === 'q2' && delMes.length) asignar(delMes[delMes.length - 1], it, p, 1);
      else if (delMes.length >= 2) {
        asignar(delMes[0], it, p, 0.5, 1);
        asignar(delMes[delMes.length - 1], it, p, 0.5, 2);
      } else asignar(delMes[0] || tramoDe(`${p}-01`), it, p, 1);
    }
  }

  // 3. Totales. Lo gastado fuera del plan cuenta por la fecha del gasto.
  const enPlan = new Map(periodos.map((p) => [p, partidasDelMes(ix, p)]));
  const primerDia = `${periodo}-01`;
  const ultimoDia = fechaEnMes(periodo, 31);
  return tramos
    .filter((t) => t.inicio <= ultimoDia && t.fin >= primerDia)
    .map((t) => {
      const suma = (campo) => t.items.reduce((a, x) => a + x[campo], 0);
      const entra = t.ingresos.reduce((a, it) => a + aCentavos(it.hecho ? it.real : it.esperado), 0);
      const recibido = t.ingresos.reduce((a, it) => a + aCentavos(it.real), 0);
      let fuera = 0;
      for (const p of periodos) {
        for (const a of ix.porPeriodo.get(p) || []) {
          if (a.clase !== 'gasto' || a.fecha < t.inicio || a.fecha > t.fin || !coincidePersona(a.personaId, filtro) || a.prestamoId) continue;
          if (a.partidaId && enPlan.get(p)?.has(`${a.partidaId}|${a.parte || ''}`)) continue;
          fuera += a.c;
        }
      }
      const sale = suma('uso');
      return {
        ...t,
        items: t.items.sort((a, b) => porFecha(a.fecha || '9999', b.fecha || '9999') || a.it.nombre.localeCompare(b.it.nombre)),
        entra: deCentavos(entra), recibido: deCentavos(recibido), sale: deCentavos(sale), pagado: deCentavos(suma('real')), pendiente: deCentavos(suma('queda')),
        fueraDelPlan: deCentavos(fuera), disponible: deCentavos(entra - sale - fuera),
      };
    });
}

// Tramo en el que cae `fecha` (normalmente hoy), si hay salarios configurados.
export function tramoDeFecha(ix, fecha, filtro) {
  return tramosDePago(ix, periodoDe(fecha), filtro).find((t) => t.inicio <= fecha && fecha <= t.fin) || null;
}
