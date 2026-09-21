// Interpreta el aviso que manda el banco (el SMS o la notificación) para llenar el formulario
// solo. Registrar un gasto a mano son varios toques; pegar el aviso es uno.
//
// No hay una plantilla por banco a propósito: cada banco cambia el texto cada cierto tiempo y
// una plantilla exacta se rompe callada. Lo que se busca son las piezas —monto y moneda, los
// últimos cuatro dígitos de la tarjeta, la fecha, el comercio y qué clase de movimiento es—,
// que es lo que todos los avisos traen aunque lo escriban distinto. Lo que no se encuentra
// queda en null y lo llena la persona.
//
// Todo aquí es puro: entra texto y sale un objeto. El formulario decide qué hacer con él.
import { hoy as hoyDe, periodoDe } from './util.js';

// Solo para ponerle nombre a lo que se pegó; no cambia cómo se interpreta.
export const BANCOS = [
  { id: 'bac', nombre: 'BAC Credomatic', señales: /\bbac\b|credomatic/i },
  { id: 'ficohsa', nombre: 'Ficohsa', señales: /ficohsa/i },
  { id: 'atlantida', nombre: 'Banco Atlántida', señales: /atl[aá]ntida/i },
  { id: 'banpais', nombre: 'Banpaís', señales: /banpa[ií]s/i },
  { id: 'occidente', nombre: 'Banco de Occidente', señales: /occidente/i },
  { id: 'davivienda', nombre: 'Davivienda', señales: /davivienda/i },
  { id: 'lafise', nombre: 'Lafise', señales: /lafise/i },
  { id: 'promerica', nombre: 'Promerica', señales: /promerica/i },
];

// Qué clase de movimiento anuncia el aviso. El orden importa: "pago de tarjeta" gana a "compra".
const CLASES = [
  { tipo: 'pago_tarjeta', señales: /pago (?:a|de|recibido a) (?:su )?tarjeta|abono a (?:su )?tarjeta/i },
  { tipo: 'ingreso', señales: /dep[oó]sito|acreditaci[oó]n|transferencia recibida|se le acredit|cr[eé]dito a su cuenta/i },
  { tipo: 'retiro', señales: /retiro|avance de efectivo|cajero|atm\b/i },
  { tipo: 'gasto', señales: /compra|consumo|transacci[oó]n|pos\b|debitad|cargo|pago por/i },
];

const MONEDAS = [
  { moneda: 'USD', señales: /US\$|\bUSD\b|\bd[oó]lares\b/i },
  { moneda: 'L', señales: /\bL\s?PS?\b|\bHNL\b|\blempiras\b|(?:^|[^A-Za-z])L\s?\d/i },
];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const dos = (n) => String(n).padStart(2, '0');

// "1,234.56" y "1.234,56" son el mismo número escrito de dos maneras. Manda el último separador:
// si lo que va detrás son dos dígitos, ese separador es el decimal.
export function numeroDeTexto(texto) {
  const limpio = String(texto ?? '').replace(/\s/g, '');
  if (!/\d/.test(limpio)) return null;
  const ultimo = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','));
  if (ultimo < 0) return Number(limpio);
  const decimales = limpio.length - ultimo - 1;
  if (decimales === 1 || decimales === 2) {
    const entero = limpio.slice(0, ultimo).replace(/[.,]/g, '');
    return Number(`${entero}.${limpio.slice(ultimo + 1)}`);
  }
  return Number(limpio.replace(/[.,]/g, ''));
}

// Fecha del aviso en formato AAAA-MM-DD, o null si no trae ninguna reconocible.
// Un aviso de un mes que todavía no llegó es del año pasado (el banco no avisa del futuro).
export function fechaDeTexto(texto, hoy = hoyDe()) {
  const t = String(texto ?? '');
  const iso = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(t);
  if (iso) return `${iso[1]}-${dos(iso[2])}-${dos(iso[3])}`;

  const dma = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/.exec(t);
  if (dma) {
    const anio = dma[3].length === 2 ? `20${dma[3]}` : dma[3];
    return `${anio}-${dos(dma[2])}-${dos(dma[1])}`;
  }

  const conMes = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MESES.join('|')})[a-zé]*\\.?\\s*(?:de\\s+)?(\\d{4})?`, 'i').exec(t);
  if (conMes) {
    const mes = MESES.indexOf(conMes[2].toLowerCase().slice(0, 3)) + 1;
    if (conMes[3]) return `${conMes[3]}-${dos(mes)}-${dos(conMes[1])}`;
    const anio = Number(hoy.slice(0, 4));
    const fecha = `${anio}-${dos(mes)}-${dos(conMes[1])}`;
    return fecha > hoy ? `${anio - 1}-${dos(mes)}-${dos(conMes[1])}` : fecha;
  }
  return null;
}

// Basura que suelen traer pegada los nombres de comercio.
const limpiarComercio = (nombre) => String(nombre ?? '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
  .replace(/\s+(?:tgu|sps|hn|hnd|honduras)$/i, '')
  .trim();

// El comercio va detrás de "en", "comercio", "establecimiento" o "afiliado", y termina donde
// empieza otra pieza del aviso (la tarjeta, la fecha, el saldo).
// El punto solo corta si cierra una frase: "NETFLIX.COM" es un nombre de comercio, no dos.
const CORTES = /\s*(?:,|\.(?=\s|$)|;|\btarjeta\b|\bcon tarjeta\b|\bterminada\b|\bsaldo\b|\bel d[ií]a\b|\bfecha\b|\bautorizaci[oó]n\b|\bref\b|\bhora\b|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}).*$/i;

export function comercioDeTexto(texto) {
  const t = String(texto ?? '');
  const m = /(?:\ben\b|\bcomercio\b|\bestablecimiento\b|\bafiliado\b|\bat\b)[\s:]+(.+)$/i.exec(t);
  if (!m) return null;
  const nombre = limpiarComercio(m[1].replace(CORTES, ''));
  // Un nombre de una letra o que es solo números no es un comercio.
  return nombre.length > 1 && /[a-záéíóúñ]/i.test(nombre) ? nombre : null;
}

/**
 * Interpreta un aviso de banco pegado.
 * @returns null si no parece un aviso; si no,
 *   { banco, bancoId, tipo, monto, moneda, comercio, ultimos4, fecha, confianza, crudo }
 *   `confianza` va de 0 a 100 y dice cuánto se pudo sacar: el formulario la usa para decidir
 *   si abre el registro directo o si pide confirmar.
 */
export function interpretarAviso(texto, { hoy = hoyDe() } = {}) {
  const crudo = String(texto ?? '').trim();
  if (!crudo || crudo.length > 2000) return null;
  const plano = crudo.replace(/\s+/g, ' ');

  // El monto: el primer número que venga pegado a un símbolo de moneda.
  const conMoneda = /(US\$|USD|HNL|LPS|L\.?|\$)\s?(\d[\d.,]*)/i.exec(plano);
  const monto = conMoneda ? numeroDeTexto(conMoneda[2]) : null;
  if (!(monto > 0)) return null;

  const simbolo = (conMoneda[1] || '').toUpperCase();
  const moneda = /US\$|USD|^\$$/.test(simbolo) ? 'USD' : MONEDAS.find((m) => m.señales.test(plano))?.moneda || 'L';

  const banco = BANCOS.find((b) => b.señales.test(plano)) || null;
  const tipo = CLASES.find((c) => c.señales.test(plano))?.tipo || 'gasto';

  // Los últimos cuatro dígitos: detrás de "terminada en", de asteriscos, o de "tarjeta".
  const tarjeta = /(?:terminada en|termina en|final(?:izada en)?|que termina en|\*{1,6}|x{2,6}|n[°o]\.?|no\.?)\s*(\d{4})\b/i.exec(plano)
    || /\btarjeta\b[^\d]{0,12}(\d{4})\b/i.exec(plano);
  const ultimos4 = tarjeta ? tarjeta[1] : null;

  const fecha = fechaDeTexto(plano, hoy);
  const comercio = tipo === 'gasto' || tipo === 'retiro' ? comercioDeTexto(plano) : null;

  const confianza = 40
    + (banco ? 15 : 0)
    + (ultimos4 ? 20 : 0)
    + (comercio ? 15 : 0)
    + (fecha ? 10 : 0);

  return {
    banco: banco?.nombre || null,
    bancoId: banco?.id || null,
    tipo,
    monto,
    moneda,
    comercio,
    ultimos4,
    fecha: fecha || hoy,
    fechaDelAviso: fecha,
    periodo: periodoDe(fecha || hoy),
    confianza: Math.min(100, confianza),
    crudo,
  };
}

// La cuenta del hogar a la que corresponde el aviso: la tarjeta cuyos últimos cuatro dígitos
// coinciden. Sin esos dígitos no se adivina, porque equivocarse de tarjeta es peor que preguntar.
export function cuentaDelAviso(ix, aviso) {
  if (!aviso?.ultimos4) return null;
  for (const info of ix.tarjetas.values()) {
    if (String(info.cuenta.tarjeta?.ultimos4 || '').slice(-4) === aviso.ultimos4) return info.cuenta;
  }
  return null;
}

// El comercio del catálogo que coincide con el del aviso, comparando sin tildes ni mayúsculas.
export function comercioDelAviso(ix, aviso) {
  if (!aviso?.comercio) return null;
  const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const buscado = normal(aviso.comercio);
  if (!buscado) return null;
  let mejor = null;
  for (const c of ix.comercios.values()) {
    if (c.borrado) continue;
    const nombre = normal(c.nombre);
    if (!nombre) continue;
    if (nombre === buscado) return c;
    // Uno contiene al otro: "la colonia" contra "supermercado la colonia".
    if ((nombre.includes(buscado) || buscado.includes(nombre)) && (!mejor || nombre.length > normal(mejor.nombre).length)) mejor = c;
  }
  return mejor;
}
