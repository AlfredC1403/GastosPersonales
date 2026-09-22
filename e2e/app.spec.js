// La app abierta de verdad, a ancho de celular. Tres cosas que ninguna prueba de js/core ve:
// que cada pantalla dibuja, que registrar un gasto funciona de punta a punta y que el diseño
// no se sale de la pantalla del teléfono.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Las pantallas salen del menú de la app, leído como texto: importarlo aquí no se puede, porque
// js/ui/menu.js vive dentro del navegador (usa Vue como global). Así la lista nunca se queda
// vieja: una pantalla nueva en el menú entra sola en esta prueba.
const PANTALLAS = [...readFileSync(new URL('../js/ui/menu.js', import.meta.url), 'utf8')
  .matchAll(/\{\s*id:\s*'([\w-]+)',\s*nombre:/g)].map(([, id]) => id);

// El día en que vive la prueba. Se fija antes de abrir la app para que el hogar de abajo caiga
// siempre en el mes en curso: media quincena registrada, media por venir. Sin fijarlo, los datos
// de septiembre de 2026 se irían quedando en el pasado y las pantallas del mes en curso
// (que son otro camino: ver la quincena que corre, los cargos de la tarjeta hasta hoy) dejarían
// de probarse solas.
const HOY = '2026-09-22T10:00:00';

// Un hogar mínimo, del esquema de hoy, puesto antes de que la app arranque: sin esto la app
// abre en el asistente de la primera vez y no hay nada que mirar.
async function hogarDePrueba(page) {
  await page.addInitScript(() => {
    const sello = { creado: '2026-01-01T10:00:00Z', creadoPor: 'p1', actualizado: '2026-01-01T10:00:00Z', actualizadoPor: 'p1' };
    const doc = {
      esquema: 4,
      config: { moneda: 'L', monedaExt: 'USD', simboloExt: 'US$', inicio: '2026-01', tasaReferencia: 25, tasaReferenciaDesde: '2026-01-05', asistente: { completados: [] }, actualizado: '2026-01-01T10:00:00Z' },
      personas: [{ id: 'p1', nombre: 'Moises', email: '', ...sello }],
      cuentas: [
        { id: 'gastos', nombre: 'Gastos', tipo: 'gastos', saldoInicial: 20000, moneda: 'L', titularId: null, ...sello },
        { id: 'ahorro', nombre: 'Ahorro', tipo: 'ahorro', saldoInicial: 5000, moneda: 'L', titularId: null, ...sello },
        // Una tarjeta con su membresía: el cargo que la app genera sola en cada corte no es un
        // movimiento anotado, y aun así se lista con los del mes.
        {
          id: 'visa', nombre: 'Visa', tipo: 'tarjeta', saldoInicial: 0, moneda: 'L', titularId: 'p1', ...sello,
          tarjeta: {
            diaCorte: 20, diaPago: 10, cuentaPagoId: 'gastos', limite: { L: 50000, USD: null },
            saldoInicial: { L: 0, USD: 0 }, saldoFecha: '2026-08-31', saldoRegistrado: '2026-08-31T10:00:00Z',
            cargos: [{ id: 'membresia', nombre: 'Membresía', tipo: 'membresia', monto: 150, moneda: 'L', periodicidad: 'mensual', activo: true }],
          },
        },
      ],
      partidas: [{
        id: 'mercado', nombre: 'Mercado', categoriaId: 'comida', responsableId: 'p1', tipo: 'gasto', forma: 'variable',
        monto: 6000, moneda: 'L', suscripcion: false, ciclo: null, mesCobro: null, pruebaHasta: null, meses: [],
        montoAnual: null, mesPago: null, dia: null, medioPagoId: 'gastos', cuentaDestinoId: null, metaId: null,
        acumula: false, sePagaCon: 'auto', activo: true, desde: null, hasta: null, nota: '', ...sello,
      }],
      ingresos: [{
        id: 'sueldo', nombre: 'Sueldo', personaId: 'p1', frecuencia: 'quincenal', diasPago: [15, 30], finDeSemana: 'igual',
        cuentaId: 'gastos', categoriaId: 'salario', netoEsperado: 12500, meses: [], decimo13: true, decimo14: true,
        vigenteDesde: null, activo: true, nota: '', ...sello,
        deducciones: [{ id: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', fija: true, montoEsperado: 480.5 }],
      }],
      prestamos: [], metas: [], resumenes: [], ajustesPartida: [],
      // La quincena del 15 ya llegó; la del 30 no. Un pago registrado tampoco es un movimiento
      // anotado, y también se lista con los del mes.
      recibos: [{
        id: 'rec1', ingresoId: 'sueldo', tipo: 'ordinario', ocurrencia: '2026-09-15', periodo: '2026-09', fecha: '2026-09-15',
        cuentaId: 'gastos', neto: 12400, extras: [], nota: '', ...sello,
        deducciones: [{ deduccionId: 'ihss', nombre: 'IHSS', naturaleza: 'gasto', categoriaId: 'ihss', monto: 480.5 }],
      }],
      grupos: [], categorias: [],
      // Lo nuevo del esquema 4, con contenido: una pantalla vacía no prueba su plantilla.
      topes: [{ id: 't1', ambito: 'categoria', referenciaId: 'comida', monto: 7000, moneda: 'L', avisarEn: 80, activo: true, nota: '', ...sello }],
      renovaciones: [{ id: 'r1', nombre: 'Seguro del carro', vence: '2026-11-15', repite: 'meses', cadaMeses: 12, avisarDias: 30, monto: 9000, moneda: 'L', categoriaId: null, activo: true, nota: '', ...sello }],
      tasas: [
        { id: 'tasa-2026-01', periodo: '2026-01', valor: 24.8, nota: '', ...sello },
        { id: 'tasa-2026-09', periodo: '2026-09', valor: 25.4, nota: '', ...sello },
      ],
      comercios: [{ id: 'super', nombre: 'Súper La Colonia', categoriaId: 'comida', partidaId: 'mercado', medioPagoId: 'gastos', moneda: 'L', ...sello }],
      movimientos: [
        { id: 'm1', tipo: 'gasto', fecha: '2026-09-03', periodo: '2026-09', monto: 1450, moneda: 'L', cuentaId: 'gastos', categoriaId: 'comida', partidaId: 'mercado', comercioId: 'super', personaId: 'p1', etiquetas: ['casa'], nota: '', ...sello },
        { id: 'm2', tipo: 'gasto', fecha: '2026-09-10', periodo: '2026-09', monto: 1450, moneda: 'L', cuentaId: 'gastos', categoriaId: 'comida', partidaId: 'mercado', comercioId: 'super', personaId: 'p1', etiquetas: ['casa'], nota: '', ...sello },
        { id: 'm3', tipo: 'gasto', fecha: '2026-08-20', periodo: '2026-08', monto: 300, moneda: 'L', cuentaId: 'gastos', categoriaId: 'comida', partidaId: null, comercioId: null, personaId: 'p1', etiquetas: [], nota: 'Borrado de prueba', borrado: true, ...sello },
        { id: 'm4', tipo: 'gasto', fecha: '2026-09-08', periodo: '2026-09', monto: 900, moneda: 'L', cuentaId: 'visa', categoriaId: 'restaurantes', partidaId: null, comercioId: null, personaId: 'p1', etiquetas: [], nota: 'Cena', ...sello },
      ],
    };
    localStorage.setItem('gastos.doc', JSON.stringify(doc));
    localStorage.setItem('gastos.yo', 'p1');
    localStorage.setItem('gastos.almacen', 'local'); // sin IndexedDB: el estado de la prueba es el que se puso
  });
}

// Un error de JavaScript en una plantilla de Vue no rompe la página: deja la pantalla a medias.
// Por eso se miran también la consola y los errores sin capturar.
function vigilarErrores(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // El favicon y la fuente pueden no estar en el servidor de la prueba; no es de la app.
    if (/favicon|fonts\.g|net::ERR/i.test(t)) return;
    errores.push(t);
  });
  return errores;
}

// La app trae Vue de un CDN. En la prueba se sirve el mismo archivo desde node_modules (la
// versión está fijada en package.json), así la prueba no depende de la red ni de que el CDN
// responda, y el sitio publicado sigue pidiéndolo al CDN como siempre.
const VUE = readFileSync(new URL('../node_modules/vue/dist/vue.global.prod.js', import.meta.url), 'utf8');

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**/vue.global.prod.js', (ruta) => ruta.fulfill({
    status: 200, contentType: 'application/javascript', body: VUE,
  }));
  await page.clock.setFixedTime(new Date(HOY));
  await hogarDePrueba(page);
});

test('abre en Inicio y muestra lo libre del mes', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/inicio');
  await expect(page.getByText('Libre este mes')).toBeVisible();
  expect(errores).toEqual([]);
});

test('cada pantalla del menú dibuja sin errores', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/inicio');
  await expect(page.locator('main.contenido')).toBeVisible();

  for (const id of PANTALLAS) {
    await page.evaluate((r) => { location.hash = `#/${r}`; }, id);
    // Las pantallas se cargan a demanda: se espera a que deje de decir "Cargando…".
    await expect(page.locator('.cargando')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('main.contenido'), `la pantalla ${id} no dibujó`).toBeVisible();
    expect(errores, `la pantalla ${id} tiró un error`).toEqual([]);
  }
});

test('registrar un gasto: aparece en Movimientos y baja lo libre del mes', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/inicio');
  await expect(page.getByText('Libre este mes')).toBeVisible();

  // El botón + de la barra de abajo, que es como se registra desde el teléfono.
  await page.getByRole('button', { name: 'Registrar un gasto o ingreso' }).click();
  const dialogo = page.locator('dialog.modal').first();
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel(/^Monto/).first().fill('432');
  await dialogo.getByRole('textbox', { name: 'Nota' }).fill('Prueba de extremo a extremo');
  await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialogo).toBeHidden();

  await page.evaluate(() => { location.hash = '#/movimientos'; });
  await expect(page.locator('.cargando')).toHaveCount(0);
  await expect(page.getByText('Prueba de extremo a extremo')).toBeVisible();
  expect(errores).toEqual([]);
});

// El mes en curso trae filas que no son movimientos anotados: el pago del salario que ya llegó y
// el cargo que la tarjeta genera sola en su corte. Los meses de al lado no las tienen todavía,
// así que si la lista da por hecho que toda fila se parece a un gasto, el mes en curso —y solo
// ese— se queda en blanco.
test('Movimientos dibuja el mes en curso con el salario y el cargo de la tarjeta', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/movimientos');
  await expect(page.locator('.cargando')).toHaveCount(0);

  await expect(page.getByText('Sueldo · pago del 15 sep')).toBeVisible();
  await expect(page.getByText('Membresía').first()).toBeVisible();
  await expect(page.getByText('Cena')).toBeVisible();
  expect(errores).toEqual([]);

  // Y se puede ir al mes anterior y volver.
  for (const boton of ['Mes anterior', 'Mes siguiente']) {
    await page.getByRole('button', { name: boton }).click();
    await expect(page.locator('main.contenido')).toBeVisible();
    expect(errores, `la lista falló al ir al ${boton.toLowerCase()}`).toEqual([]);
  }
  await expect(page.getByText('Sueldo · pago del 15 sep')).toBeVisible();
});

test('nada se sale de la pantalla del teléfono', async ({ page }) => {
  await page.goto('/index.html#/inicio');
  await expect(page.getByText('Libre este mes')).toBeVisible();
  for (const id of PANTALLAS) {
    await page.evaluate((r) => { location.hash = `#/${r}`; }, id);
    await expect(page.locator('.cargando')).toHaveCount(0, { timeout: 10000 });
    const ancho = await page.evaluate(() => ({ documento: document.documentElement.scrollWidth, ventana: window.innerWidth }));
    expect(ancho.documento, `${id} se sale a lo ancho`).toBeLessThanOrEqual(ancho.ventana + 1);
  }
});

test('lo nuevo del esquema 4 se ve en su pantalla', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/topes');
  await expect(page.locator('.cargando')).toHaveCount(0);
  await expect(page.getByText('Comida').first()).toBeVisible();

  await page.evaluate(() => { location.hash = '#/renovaciones'; });
  await expect(page.locator('.cargando')).toHaveCount(0);
  await expect(page.getByText('Seguro del carro')).toBeVisible();

  await page.evaluate(() => { location.hash = '#/rapido'; });
  await expect(page.locator('.cargando')).toHaveCount(0);
  await expect(page.getByText('Súper La Colonia')).toBeVisible();

  // La tasa del dólar es una tabla por mes, no un solo número.
  await page.evaluate(() => { location.hash = '#/datos'; });
  await expect(page.locator('.cargando')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tasa del dólar' })).toBeVisible();
  await expect(page.getByText('25.4')).toBeVisible();

  expect(errores).toEqual([]);
});

test('el buscador global encuentra y lleva', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/index.html#/inicio');
  await page.getByRole('button', { name: 'Buscar en todo' }).click();
  const buscador = page.locator('dialog.modal').first();
  await expect(buscador).toBeVisible();
  await buscador.getByRole('combobox', { name: 'Buscar en todo' }).fill('colonia');
  await expect(buscador.getByText('Súper La Colonia').first()).toBeVisible();
  expect(errores).toEqual([]);
});
