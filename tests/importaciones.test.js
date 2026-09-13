// Revisa que cada `import` de js/ apunte a un archivo que existe y que de verdad exporta lo que se
// le pide. Sin paso de compilación, un nombre mal escrito solo se nota al abrir la pantalla que lo
// usa (y a veces solo en el navegador de otra persona); aquí salta en un segundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function archivosJs(carpeta) {
  return readdirSync(join(RAIZ, carpeta), { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? archivosJs(join(carpeta, e.name)) : e.name.endsWith('.js') ? [join(carpeta, e.name)] : []
  ));
}

// Los `import` con nombres entre llaves y/o un `* as`, y de qué archivo vienen.
const IMPORTS = /import\s+([^;'"]*?)\s*from\s*['"](\.[^'"]+)['"]/gs;
// Los `import('./x.js')` de las vistas que se cargan a demanda: ahí el archivo también debe existir.
const DINAMICOS = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function importacionesDe(codigo) {
  return [...codigo.matchAll(IMPORTS)].map(([, clausula, ruta]) => {
    const llaves = clausula.match(/\{([^}]*)\}/s);
    const nombres = llaves
      ? llaves[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [];
    return { ruta, nombres, todo: /^\s*\*\s+as\s+/.test(clausula) };
  });
}

const dinamicasDe = (codigo) => [...codigo.matchAll(DINAMICOS)].map(([, ruta]) => ruta);

// Lo que exporta un archivo. `reexporta`: los `export ... from './otro.js'`, que hay que seguir.
function exportacionesDe(codigo) {
  const nombres = new Set();
  for (const [, n] of codigo.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) nombres.add(n);
  for (const [, lista] of codigo.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/gs)) {
    for (const parte of lista.split(',')) {
      const trozos = parte.trim().split(/\s+as\s+/);
      if (trozos[0]) nombres.add((trozos[1] || trozos[0]).trim());
    }
  }
  const reexporta = [];
  for (const [, lista, ruta] of codigo.matchAll(/export\s*(?:\*|\{([^}]*)\})\s*from\s*['"](\.[^'"]+)['"]/gs)) {
    if (lista) for (const parte of lista.split(',')) nombres.add((parte.trim().split(/\s+as\s+/).pop() || '').trim());
    else reexporta.push(ruta);
  }
  return { nombres, reexporta };
}

const cache = new Map();
const leer = (archivo) => {
  if (!cache.has(archivo)) cache.set(archivo, readFileSync(join(RAIZ, archivo), 'utf8'));
  return cache.get(archivo);
};

// Nombres que un archivo ofrece, siguiendo los `export * from`.
function exportaciones(archivo, vistos = new Set()) {
  if (vistos.has(archivo)) return new Set();
  vistos.add(archivo);
  const { nombres, reexporta } = exportacionesDe(leer(archivo));
  for (const ruta of reexporta) {
    for (const n of exportaciones(relative(RAIZ, resolve(RAIZ, dirname(archivo), ruta)), vistos)) nombres.add(n);
  }
  return nombres;
}

// El código sin comentarios ni textos: dentro de una plantilla de Vue los nombres se resuelven
// contra lo que devuelve setup(), no contra el módulo, y darían falsos avisos.
function soloCodigo(codigo) {
  return codigo
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// Nombres que el archivo tiene a mano: los que importa, los que declara y los de Vue.
function disponiblesEn(codigo) {
  const out = new Set();
  for (const [, lista] of codigo.matchAll(/^(?:import|export)\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/gm)) {
    for (const parte of lista.split(',')) {
      const trozos = parte.trim().split(/\s+as\s+/);
      if (trozos[0]) out.add(trozos[trozos.length - 1].trim());
    }
  }
  for (const [, lista] of codigo.matchAll(/const\s*\{([^}]*)\}\s*=\s*Vue/g)) {
    for (const n of lista.split(',')) if (n.trim()) out.add(n.trim());
  }
  for (const [, n] of codigo.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(n);
  return out;
}

// Solo las constantes en MAYÚSCULAS: los demás nombres se confunden con parámetros y con
// destructuraciones (`const { hoy } = opciones`), y saltarían sin motivo.
const ES_CONSTANTE = /^[A-Z][A-Z0-9_]*$/;

test('ningún archivo usa una constante de otro módulo sin importarla', () => {
  const archivos = archivosJs('js');
  const exportados = new Set();
  for (const a of archivos) for (const n of exportacionesDe(leer(a)).nombres) if (ES_CONSTANTE.test(n)) exportados.add(n);

  const problemas = [];
  for (const archivo of archivos) {
    const codigo = soloCodigo(leer(archivo));
    const disponibles = disponiblesEn(codigo);
    for (const n of exportados) {
      if (disponibles.has(n)) continue;
      if (new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(codigo)) problemas.push(`${archivo}: usa «${n}» y no lo importa`);
    }
  }
  assert.deepEqual(problemas, []);
});

test('cada import de js/ existe y exporta lo que se le pide', () => {
  const problemas = [];
  for (const archivo of archivosJs('js')) {
    const codigo = leer(archivo);
    // Un import() a un archivo que no existe solo falla al entrar en esa pantalla.
    for (const ruta of dinamicasDe(codigo)) {
      try {
        leer(relative(RAIZ, resolve(RAIZ, dirname(archivo), ruta)));
      } catch {
        problemas.push(`${archivo} hace import('${ruta}'), que no existe`);
      }
    }
    for (const { ruta, nombres } of importacionesDe(codigo)) {
      const destino = relative(RAIZ, resolve(RAIZ, dirname(archivo), ruta));
      let ofrece;
      try {
        ofrece = exportaciones(destino);
      } catch {
        problemas.push(`${archivo} importa de '${ruta}', que no existe`);
        continue;
      }
      for (const n of nombres) {
        if (!ofrece.has(n)) problemas.push(`${archivo} importa { ${n} } de '${ruta}', que no lo exporta`);
      }
    }
  }
  assert.deepEqual(problemas, []);
});
