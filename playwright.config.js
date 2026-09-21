// Pruebas de extremo a extremo: abren la app de verdad en un navegador, a ancho de celular,
// que es como se usa. Atrapan lo que ninguna prueba de `js/core` ve (una plantilla con un
// nombre mal escrito, un import que no resuelve, una pantalla que no dibuja).
//
// Es la única dependencia de desarrollo además del linter: el sitio publicado sigue sin
// ningún paso de compilación.
import { defineConfig, devices } from '@playwright/test';

const PUERTO = 8123;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}`,
    // Un celular: es donde se usa la app, y donde primero se rompe el diseño.
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    // Normalmente Playwright usa el Chromium que bajó él (`npx playwright install chromium`).
    // En un entorno que ya trae uno, se le dice cuál con PLAYWRIGHT_CHROMIUM.
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } } : {}),
  },
  projects: [{ name: 'celular' }],
  webServer: {
    command: `python3 -m http.server ${PUERTO} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PUERTO}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
