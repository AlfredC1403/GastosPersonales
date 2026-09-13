import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearIndice } from '../js/core/asientos.js';
import { contenidoArchivo } from '../js/core/anios.js';
import {
  cierreDelAnio, cierresPendientes, aniosCargados, aperturaActiva, quitarAnios, fusionarApertura, mismaApertura,
  anioMasViejoNecesario, aniosParaSoltar, bloqueoDeAnio,
} from '../js/core/cierres.js';
import { resumenMes, saldosCuentas, patrimonioAl, resumenAnual, resumenDelAnio, resumenAnualDeGuardado, compararAnios } from '../js/core/reportes.js';
import { estadoDe, deudaAl, costoDePrestamos, prestamosParaSimular } from '../js/core/prestamos.js';
import { resumenTarjeta, estadoCiclo, deudaTarjetasAl, pagosDeTarjetas, corteDe, corteSiguiente } from '../js/core/tarjetas.js';
import { estadoMetas } from '../js/core/metas.js';
import { calcularAvisos } from '../js/core/avisos.js';
import { tramosDePago } from '../js/core/quincena.js';
import { recordatoriosDeseados } from '../js/core/recordatorios.js';
import { sumarMeses, fechaEnMes } from '../js/core/util.js';
import { hogar, HOY } from './datos/hogar-anios.js';

const T = (fecha) => `${fecha}T12:00:00.000Z`;

const PERSONAS = ['moises', 'ruth'];
const FILTROS = [null, { personaId: 'moises' }, { personaId: 'ruth' }];

function periodosDesde(desde, hasta = HOY.slice(0, 7)) {
  const out = [];
  for (let p = desde; p <= hasta; p = sumarMeses(p, 1)) out.push(p);
  return out;
}

// Todo lo que las pantallas calculan desde el primer año cargado da lo mismo con la apertura que
// con todos los años cargados.
function compararIndices(completo, parcial, anio) {
  const cierre = `${anio - 1}-12-31`;
  const primerMes = `${anio}-01`;
  const igual = (a, b, que) => assert.deepStrictEqual(a, b, que);

  const asientos = (ix) => ix.asientos
    .filter((a) => (a.clase === 'saldo' || a.clase === 'tarjeta' ? a.fecha > cierre : a.periodo >= primerMes))
    .map((a) => JSON.stringify(a)).sort();
  igual(asientos(parcial), asientos(completo), 'asientos');

  for (const p of periodosDesde(primerMes)) {
    for (const f of FILTROS) igual(resumenMes(parcial, p, f), resumenMes(completo, p, f), `resumenMes ${p} ${f?.personaId || ''}`);
    igual(deudaAl(parcial, p), deudaAl(completo, p), `deudaAl ${p}`);
    igual(costoDePrestamos(parcial, primerMes, p), costoDePrestamos(completo, primerMes, p), `costoDePrestamos ${p}`);
    const fin = fechaEnMes(p, 31);
    igual(saldosCuentas(parcial, fin), saldosCuentas(completo, fin), `saldos ${fin}`);
    igual(deudaTarjetasAl(parcial, fin), deudaTarjetasAl(completo, fin), `tarjetas ${fin}`);
    for (const f of FILTROS) igual(patrimonioAl(parcial, fin, f), patrimonioAl(completo, fin, f), `patrimonio ${fin}`);
    // Los pagos de tarjeta de enero y febrero son de cortes del año anterior (no cargado).
    if (p >= `${anio}-03`) {
      igual(pagosDeTarjetas(parcial, `${p}-01`, fin), pagosDeTarjetas(completo, `${p}-01`, fin), `pagosDeTarjetas ${p}`);
      igual(tramosDePago(parcial, p), tramosDePago(completo, p), `tramos ${p}`);
    }
  }
  igual(saldosCuentas(parcial, cierre), saldosCuentas(completo, cierre), 'saldos al cierre');
  igual(patrimonioAl(parcial, cierre), patrimonioAl(completo, cierre), 'patrimonio al cierre');
  igual(saldosCuentas(parcial), saldosCuentas(completo), 'saldos de hoy');

  for (const p of completo.doc.prestamos) igual(estadoDe(parcial, p), estadoDe(completo, p), `préstamo ${p.id}`);
  igual(prestamosParaSimular(parcial), prestamosParaSimular(completo), 'simulador');
  for (const f of FILTROS) igual(estadoMetas(parcial, f), estadoMetas(completo, f), 'metas');

  for (const c of completo.doc.cuentas.filter((x) => x.tipo === 'tarjeta')) {
    igual(resumenTarjeta(parcial, c), resumenTarjeta(completo, c), `resumen ${c.id}`);
    const primero = corteDe(c, `${anio}-01-01`);
    for (let corte = [primero, corteDe(c, c.tarjeta.saldoFecha)].sort().pop(); corte <= corteDe(c, HOY); corte = corteSiguiente(c, corte)) {
      const a = estadoCiclo(parcial, c, corte);
      const b = estadoCiclo(completo, c, corte);
      // El ciclo que empieza en diciembre no tiene las compras de diciembre (año no cargado).
      if (corte === primero && b.inicio <= cierre) {
        for (const x of [a, b]) {
          delete x.compras;
          delete x.cargosDelCiclo;
        }
      }
      igual(a, b, `ciclo ${c.id} ${corte}`);
    }
  }
  for (const m of parcial.doc.movimientos) igual(parcial.montoEnLempiras(m), completo.montoEnLempiras(m), `lempiras de ${m.id}`);

  for (let y = anio; y <= 2027; y++) {
    for (const f of FILTROS) {
      igual(resumenAnual(parcial, y, f), resumenAnual(completo, y, f), `resumen anual ${y}`);
      igual(resumenAnual(parcial, y, f, { hasta: `${y}-09-15` }), resumenAnual(completo, y, f, { hasta: `${y}-09-15` }), `resumen anual ${y} hasta`);
    }
  }
  igual(compararAnios(parcial, 2027, anio), compararAnios(completo, 2027, anio), 'comparar años');
  igual(calcularAvisos(parcial, { hoy: HOY }), calcularAvisos(completo, { hoy: HOY }), 'avisos');
  igual(recordatoriosDeseados(parcial, { hoy: HOY, alcance: 'hogar' }), recordatoriosDeseados(completo, { hoy: HOY, alcance: 'hogar' }), 'recordatorios');
}

test('con la apertura de 2026 o de 2027, sin los años anteriores, todo da igual que con todos los años cargados', () => {
  const doc = hogar();
  const completo = crearIndice(doc, { hoy: HOY });
  for (const anio of [2026, 2027]) {
    const apertura = JSON.parse(JSON.stringify(cierreDelAnio(completo, anio - 1)));
    const cargado = quitarAnios(doc, [2025, 2026].filter((y) => y < anio));
    assert.deepEqual(aniosCargados(cargado), ['2026', '2027'].filter((y) => y >= String(anio)));
    compararIndices(completo, crearIndice(cargado, { hoy: HOY, apertura }), anio);
  }
  // Sin pagos en dólares en 2027, lo que falta se estima con la última tasa de 2026.
  const sinDolares = { ...doc, movimientos: doc.movimientos.filter((m) => !(m.pagoUSD && m.fecha >= '2027-01-01')) };
  const todo = crearIndice(sinDolares, { hoy: HOY });
  const apertura = JSON.parse(JSON.stringify(cierreDelAnio(todo, 2026)));
  compararIndices(todo, crearIndice(quitarAnios(sinDolares, [2025, 2026]), { hoy: HOY, apertura }), 2027);
  assert.equal(crearIndice(quitarAnios(sinDolares, [2025, 2026]), { hoy: HOY, apertura }).tarjetas.get('visa').ultimaTasa, 25.4);
});

test('lo que trae la apertura de 2026: saldos, tarjetas, préstamos, metas, sobrantes y registros que siguen contando', () => {
  const ap = cierreDelAnio(crearIndice(hogar(), { hoy: HOY }), 2025);
  assert.deepEqual([ap.version, ap.anio, ap.fecha], [1, 2026, '2025-12-31']);
  // Dólares: la compra de US$10 (de enero) ya se pagó a 24.50; de la de US$100 faltan US$55 (US$45
  // se pagaron a 24.50), y las de US$40 y US$12, completas.
  assert.deepEqual(ap.tarjetas.visa.pendientesUSD.map((c) => [c.pendiente, c.lempiras]), [[0, 1000 * 24.5], [5500, 4500 * 24.5], [4000, 0], [1200, 0]]);
  assert.deepEqual([ap.tarjetas.visa.aFavorUSD, ap.tarjetas.visa.ultimaTasa], [[], 24.5]);
  assert.equal(ap.tarjetas.mc, undefined); // la Mastercard empezó en 2026
  // Préstamos: el de la moto empezó después; el carro tiene la cuota de diciembre (pagada el 2 de enero).
  assert.deepEqual(Object.keys(ap.prestamos), ['carro', 'rap']);
  assert.equal(ap.prestamos.carro.ultimoPeriodo, '2025-12');
  assert.deepEqual(ap.prestamos.carro.parciales, []);
  // Registros de 2025 que cuentan en 2026: las dos compras a cuotas, las dos compras en dólares de
  // enero, el aporte de enero y el pago de salario del 15 de enero hecho el 31 de diciembre.
  assert.equal(ap.registros.movimientos.length, 5);
  assert.deepEqual(ap.registros.recibos.map((r) => [r.ocurrencia, r.fecha]), [['2026-01-15', '2025-12-31']]);
  assert.ok(ap.partidas.super > 0);
  assert.equal(ap.metas.viaje.alInicio.fecha, '2025-02-28');
});

test('la apertura de 2027 calculada con 2026 y 2027 cargados es igual al cierre de 2026 con todo cargado', () => {
  const doc = hogar();
  const completo = crearIndice(doc, { hoy: HOY });
  const ap2026 = JSON.parse(JSON.stringify(cierreDelAnio(completo, 2025)));
  const desde2026 = crearIndice(quitarAnios(doc, [2025]), { hoy: HOY, apertura: ap2026 });
  assert.deepStrictEqual(cierreDelAnio(desde2026, 2026), cierreDelAnio(completo, 2026));
  // Al cierre de 2026 quedan US$20 a favor a 25.40 y la compra a cuotas de noviembre de la Mastercard.
  const ap2027 = cierreDelAnio(completo, 2026);
  assert.deepEqual(ap2027.tarjetas.visa.aFavorUSD, [{ usd: 2000, tasa: 25.4 }]);
  assert.ok(ap2027.tarjetas.mc && ap2027.prestamos.moto);
  assert.ok(ap2027.registros.movimientos.some((m) => m.cuentaId === 'mc' && m.cuotas));
});

test('editar 2025 recalcula las aperturas de 2026 y 2027 y los resúmenes de los años pasados', () => {
  const doc = hogar();
  const ix = crearIndice(doc, { hoy: HOY });
  const conCierres = {
    ...doc,
    aperturas: { 2025: null, 2026: { ...cierreDelAnio(ix, 2025), actualizado: T('2027-01-01') }, 2027: { ...cierreDelAnio(ix, 2026), actualizado: T('2027-01-01') } },
    resumenes: [2025, 2026].map((y) => ({ id: String(y), ...resumenDelAnio(ix, y, PERSONAS), actualizado: T('2027-01-01') })),
  };
  assert.equal(aperturaActiva(conCierres), null); // 2025 es el primer año: se calcula desde el principio
  assert.deepEqual(cierresPendientes(conCierres, crearIndice(conCierres, { hoy: HOY }), { actual: '2027' }), { aperturas: {}, resumenes: {} });

  // Se corrige una compra de marzo de 2025 con la Visa.
  const i = conCierres.movimientos.findIndex((m) => m.cuentaId === 'visa' && m.fecha === '2025-03-12');
  const editado = { ...conCierres, movimientos: conCierres.movimientos.map((m, k) => (k === i ? { ...m, monto: m.monto + 5000, actualizado: T('2027-09-15') } : m)) };
  const ixEditado = crearIndice(editado, { hoy: HOY });
  const cambios = cierresPendientes(editado, ixEditado, { actual: '2027' });
  assert.deepEqual(Object.keys(cambios.aperturas), ['2026', '2027']);
  assert.deepEqual(Object.keys(cambios.resumenes), ['2025', '2026']);
  assert.equal(cambios.aperturas['2026'].tarjetas.visa.deuda.L, conCierres.aperturas['2026'].tarjetas.visa.deuda.L + 500000);
  assert.equal(cambios.aperturas['2027'].tarjetas.visa.deuda.L, conCierres.aperturas['2027'].tarjetas.visa.deuda.L + 500000);

  // Con la apertura nueva de 2027 y solo 2027 cargado, todo cuadra con los datos corregidos.
  const soloEsteAnio = { ...quitarAnios(editado, [2025, 2026]), aperturas: { 2027: cambios.aperturas['2027'] } };
  assert.deepEqual(aniosCargados(soloEsteAnio), ['2027']);
  compararIndices(ixEditado, crearIndice(soloEsteAnio, { hoy: HOY, apertura: aperturaActiva(soloEsteAnio) }), 2027);
});

test('un resumen guardado da lo mismo que calcularlo con el año cargado, por meses completos', () => {
  const ix = crearIndice(hogar(), { hoy: HOY });
  for (const anio of [2025, 2026]) {
    const guardado = JSON.parse(JSON.stringify(resumenDelAnio(ix, anio, PERSONAS)));
    for (const f of FILTROS) {
      for (let mes = 1; mes <= 12; mes++) {
        const hastaMes = `${anio}-${String(mes).padStart(2, '0')}`;
        assert.deepStrictEqual(resumenAnualDeGuardado(ix, guardado, f, { hastaMes }), resumenAnual(ix, anio, f, { hastaMes }), `${hastaMes} ${f?.personaId || ''}`);
      }
      assert.deepStrictEqual(resumenAnualDeGuardado(ix, guardado, f).gasto, resumenAnual(ix, anio, f).gasto);
    }
  }
  // Una persona que se agregó después sale sin datos.
  const guardado = resumenDelAnio(ix, 2025, PERSONAS);
  assert.equal(resumenAnualDeGuardado(ix, guardado, { personaId: 'nueva' }).sinDatos, true);
  assert.ok(JSON.stringify(guardado).length < 30000, `el resumen de un año ocupa ${JSON.stringify(guardado).length} caracteres`);
});

test('comparar con un año que no está cargado usa su resumen y corta los dos años en el último mes completo', () => {
  const doc = hogar();
  const completo = crearIndice(doc, { hoy: HOY });
  const guardados = { 2025: resumenDelAnio(completo, 2025, PERSONAS) };
  const apertura = cierreDelAnio(completo, 2025);
  const parcial = crearIndice(quitarAnios(doc, [2025]), { hoy: HOY, apertura });
  for (const f of FILTROS) {
    const c = compararAnios(parcial, 2027, 2025, { modo: 'va', filtro: f, guardados });
    const detalle = compararAnios(completo, 2027, 2025, { modo: 'va', filtro: f, guardados: {} });
    assert.deepEqual([c.modo, c.corteA, c.corteB, c.resumenA, c.resumenB], ['va', '2027-08-31', '2025-08-31', false, true]);
    assert.deepStrictEqual(c.B, resumenAnual(completo, 2025, f, { hastaMes: '2025-08' }));
    assert.deepStrictEqual(c.A, resumenAnual(completo, 2027, f, { hastaMes: '2027-08' }));
    assert.equal(detalle.corteB, '2025-09-15'); // con los dos años cargados se corta el mismo día
    const completoC = compararAnios(parcial, 2027, 2025, { modo: 'completo', filtro: f, guardados });
    assert.deepStrictEqual(completoC.B, resumenAnual(completo, 2025, f));
    assert.deepStrictEqual(completoC.grupos, compararAnios(completo, 2027, 2025, { modo: 'completo', filtro: f }).grupos);
  }
  // En enero no hay meses completos: se compara el año completo.
  assert.equal(compararAnios(parcial, 2027, 2025, { hoy: '2027-01-10', guardados }).modo, 'completo');
});

test('años cargados, apertura activa, quitar años y unir la apertura de un archivo', () => {
  const doc = hogar();
  assert.deepEqual(aniosCargados(doc), ['2025', '2026', '2027']);
  assert.equal(aperturaActiva(doc), null);
  const ix = crearIndice(doc, { hoy: HOY });
  const ap = { ...cierreDelAnio(ix, 2026), actualizado: T('2027-02-01') };
  const sinViejos = { ...quitarAnios(doc, ['2025', '2026']), aperturas: { 2027: ap } };
  assert.ok(sinViejos.movimientos.every((m) => m.fecha >= '2027-01-01'));
  assert.equal(aperturaActiva(sinViejos), ap);
  // El archivo del año lleva su apertura.
  assert.equal(contenidoArchivo(sinViejos, '2027').apertura, ap);
  assert.equal(contenidoArchivo(sinViejos, '2026').apertura, null);

  // Un archivo sin apertura no borra la calculada; una más reciente la reemplaza; una más vieja, no.
  assert.equal(fusionarApertura(sinViejos, '2027', null), sinViejos);
  const nueva = { ...ap, cuentas: {}, actualizado: T('2027-03-01') };
  assert.equal(fusionarApertura(sinViejos, '2027', nueva).aperturas['2027'], nueva);
  assert.equal(fusionarApertura(sinViejos, '2027', { ...nueva, actualizado: T('2027-01-01') }).aperturas['2027'], ap);
  assert.deepEqual(fusionarApertura({ aperturas: {} }, '2025', null).aperturas, { 2025: null });
  assert.ok(mismaApertura(ap, { ...ap, actualizado: 'otro' }));
  assert.ok(!mismaApertura(ap, nueva));

  // Los registros de años anteriores que sigan en el documento no se cuentan dos veces.
  const conViejos = { ...doc, aperturas: { 2027: ap } };
  assert.deepEqual(saldosCuentas(crearIndice(conViejos, { hoy: HOY, apertura: ap })), saldosCuentas(ix));
});

// ---------------------------------------------------------------- Qué años tiene que haber en el dispositivo

test('se carga el año anterior, y más atrás si hay un año abierto o con cambios sin subir', () => {
  const sola = (actual) => anioMasViejoNecesario({ actual });
  assert.equal(sola('2026'), '2025');
  // Un año abierto en Años anteriores manda, aunque sea mucho más viejo.
  assert.equal(anioMasViejoNecesario({ actual: '2026', abiertos: ['2021'] }), '2021');
  // Los cambios sin subir también: si se descargara ese año, se perderían.
  assert.equal(anioMasViejoNecesario({ actual: '2026', pendientes: ['2019'] }), '2019');
  // El archivo principal no es un año y no cuenta.
  assert.equal(anioMasViejoNecesario({ actual: '2026', pendientes: ['finanzas'] }), '2025');
  // Un año abierto más nuevo que el anterior no reduce lo que se carga.
  assert.equal(anioMasViejoNecesario({ actual: '2026', abiertos: ['2026'] }), '2025');
});

test('solo se sueltan los años viejos que están a salvo en OneDrive', () => {
  const cargados = ['2023', '2024', '2025', '2026'];
  assert.deepEqual(aniosParaSoltar({ cargados, desde: '2025' }), ['2023', '2024']);
  // El año que se está viendo se queda, aunque sea viejo.
  assert.deepEqual(aniosParaSoltar({ cargados, desde: '2025', abiertos: ['2023'] }), ['2024']);
  // Con algo pendiente de subir no se suelta nada: su archivo de OneDrive está viejo.
  assert.deepEqual(aniosParaSoltar({ cargados, desde: '2025', pendientes: ['finanzas'] }), []);
  // Sin un año desde el que cortar (sin OneDrive) tampoco.
  assert.deepEqual(aniosParaSoltar({ cargados, desde: null }), []);
  assert.deepEqual(aniosParaSoltar({ cargados, desde: '2023' }), []);
});

test('el año actual y el anterior se cambian siempre; los de antes piden «Editar este año»', () => {
  const hoy = '2026-09-13';
  const cargados = ['2024', '2025', '2026'];
  assert.equal(bloqueoDeAnio({ anio: '2026', hoy, cargados }), null);
  assert.equal(bloqueoDeAnio({ anio: '2025', hoy, cargados }), null);
  // 2024 está en el dispositivo pero solo para ver.
  assert.equal(bloqueoDeAnio({ anio: '2024', hoy, cargados }), 'solo_ver');
  assert.equal(bloqueoDeAnio({ anio: '2024', hoy, cargados, editar: ['2024'] }), null);
  // 2019 no está ni cargado: el motivo es otro y el mensaje también.
  assert.equal(bloqueoDeAnio({ anio: '2019', hoy, cargados }), 'no_cargado');
  // El modo edición de un año no abre los demás.
  assert.equal(bloqueoDeAnio({ anio: '2023', hoy, cargados, editar: ['2024'] }), 'no_cargado');
  // Con números en vez de textos se comporta igual.
  assert.equal(bloqueoDeAnio({ anio: 2024, hoy, cargados, editar: [2024] }), null);
});
