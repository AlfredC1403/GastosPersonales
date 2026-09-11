// Configuraciones de Chart.js con la misma paleta en toda la app. El color sigue a la
// entidad (Préstamos siempre azul, Fijos siempre naranja…), nunca a su posición.
import { dinero, dineroCorto } from '../core/util.js';
import { store } from '../store.js';

const oscuro = () => matchMedia('(prefers-color-scheme: dark)').matches;

const PALETA = {
  claro: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  oscuro: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
};
export const serie = (i) => (oscuro() ? PALETA.oscuro : PALETA.claro)[i];
export const violeta = () => (oscuro() ? '#9085e9' : '#6250d6');
export const gris = () => (oscuro() ? '#6b6a65' : '#b4b2a9');
export const grisClaro = () => (oscuro() ? '#3d3d3a' : '#e1e0d9');

// Tipos de gasto que se grafican, en orden fijo (define su color).
export const CLASES_GRAFICO = [
  ['prestamo', 'Préstamos'],
  ['fijo', 'Fijos'],
  ['fijo_variable', 'Fijos variables'],
  ['provision', 'Pagos anuales'],
  ['adicional', 'Adicionales'],
];

function tinta() {
  const css = getComputedStyle(document.documentElement);
  return {
    texto2: css.getPropertyValue('--texto-2').trim(),
    sup: css.getPropertyValue('--sup').trim(),
    rejilla: oscuro() ? '#2c2c2a' : '#e8e7e0',
    base: oscuro() ? '#3a3a37' : '#c9c8bf',
  };
}

export function prepararChart() {
  if (!window.Chart) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--texto-3').trim();
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 250;
}

const simbolo = () => store.doc.config.moneda || 'L';
const $ = (v) => dinero(v, { simbolo: simbolo() });
const ejeDinero = () => ({
  grid: { color: tinta().rejilla },
  border: { display: false },
  ticks: { callback: (v) => dineroCorto(v, simbolo()) },
});

// Escribe el valor al final de cada barra horizontal.
const etiquetasValor = {
  id: 'etiquetasValor',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const datos = chart.data.datasets[0].data;
    ctx.save();
    ctx.font = `12px ${Chart.defaults.font.family}`;
    ctx.fillStyle = tinta().texto2;
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((barra, i) => {
      if (datos[i]) ctx.fillText(dineroCorto(datos[i], simbolo()), barra.x + 6, barra.y);
    });
    ctx.restore();
  },
};

export function barrasHorizontales(etiquetas, valores, colores) {
  const t = tinta();
  return {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: [{ data: valores, backgroundColor: colores, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 58 } },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${$(c.raw)}` } } },
      scales: {
        x: { ...ejeDinero(), beginAtZero: true },
        y: { grid: { display: false }, border: { color: t.base }, ticks: { color: t.texto2 } },
      },
    },
    plugins: [etiquetasValor],
  };
}

export function columnasApiladas(etiquetas, series) {
  const t = tinta();
  return {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: series.map((s, i) => ({
        label: s.nombre, data: s.valores, backgroundColor: serie(i),
        borderColor: t.sup, borderWidth: { top: 2 }, borderSkipped: 'start', maxBarThickness: 40,
      })),
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          filter: (c) => c.raw > 0,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${$(c.raw)}`,
            footer: (items) => `Total: ${$(items.reduce((a, c) => a + c.raw, 0))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: t.base } },
        y: { stacked: true, ...ejeDinero() },
      },
    },
  };
}

// Saldo total de las deudas mes a mes: sin plan (gris, punteada) vs. con plan (azul).
// `periodos` en formato 'YYYY-MM'; el eje muestra solo años y el detalle sale al pasar el cursor.
export function lineasDeuda(periodos, sinPlan, conPlan, formatear = (p) => p) {
  const t = tinta();
  const anios = periodos.length / 12;
  const paso = anios > 20 ? 5 : anios > 8 ? 2 : 1;
  const etiqueta = (i) => {
    const p = periodos[i];
    return p.endsWith('-01') && Number(p.slice(0, 4)) % paso === 0 ? p.slice(0, 4) : '';
  };
  return {
    type: 'line',
    data: {
      labels: periodos,
      datasets: [
        { label: 'Sin plan', data: sinPlan, borderColor: gris(), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHitRadius: 6 },
        { label: 'Con el plan', data: conPlan, borderColor: serie(0), backgroundColor: `${serie(0)}1f`, fill: 'origin', borderWidth: 2, pointRadius: 0, pointHitRadius: 6 },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => formatear(periodos[items[0].dataIndex]),
            label: (c) => ` ${c.dataset.label}: ${$(c.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: t.base }, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => etiqueta(i) } },
        y: { ...ejeDinero(), beginAtZero: true },
      },
    },
  };
}
