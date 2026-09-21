// Cuánto pesa abrir la app: index.html, la hoja de estilos y todos los módulos que se
// alcanzan desde js/main.js siguiendo solo los `import` estáticos. Las vistas que se
// cargan con `import()` (js/app.js) quedan fuera a propósito: no hacen falta para abrir.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, relative } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');

// `import x from './y.js'`, `import './y.js'` y `export … from './y.js'`. El `import()`
// dinámico no lleva `from` ni empieza la línea, así que este patrón no lo toma.
const ESTATICOS = /(?:^|\n)\s*(?:import|export)\b[^\n;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

// js/main.js trae js/app.js con `import()` solo para poder avisar si Vue no cargó, pero se
// pide de inmediato: cuenta como carga inicial. Las vistas de `aDemanda` no.
export const ENTRADAS = ['js/main.js', 'js/app.js'];

export function modulosIniciales(entradas = ENTRADAS) {
  const vistos = new Set();
  const pendientes = entradas.map((e) => resolve(RAIZ, e));
  while (pendientes.length) {
    const archivo = pendientes.pop();
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    const texto = readFileSync(archivo, 'utf8');
    for (const m of texto.matchAll(ESTATICOS)) {
      const ruta = m[1] || m[2];
      if (!ruta?.startsWith('.')) continue; // Vue entra por <script>, no por import
      pendientes.push(resolve(dirname(archivo), ruta));
    }
  }
  return [...vistos].sort();
}

// Se mide comprimido porque es lo que baja el teléfono: GitHub Pages sirve todo con gzip.
export function pesoInicial() {
  const archivos = [
    resolve(RAIZ, 'index.html'),
    resolve(RAIZ, 'css/app.css'),
    resolve(RAIZ, 'manifest.webmanifest'),
    ...modulosIniciales(),
  ];
  const detalle = archivos.map((a) => {
    const crudo = readFileSync(a);
    return { archivo: relative(RAIZ, a), bytes: gzipSync(crudo, { level: 9 }).length, sinComprimir: crudo.length };
  });
  return {
    total: detalle.reduce((s, x) => s + x.bytes, 0),
    sinComprimir: detalle.reduce((s, x) => s + x.sinComprimir, 0),
    detalle,
  };
}
