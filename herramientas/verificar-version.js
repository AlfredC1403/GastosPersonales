// js/version.js nombra la caché del service worker: si se entrega un cambio sin subirla, el
// teléfono se queda con la versión vieja hasta que el navegador decida. Es un error callado,
// así que aquí se revisa: si cambió algo de lo que se publica, la versión tuvo que cambiar.
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'origin/main';
const PUBLICADO = /^(js\/|css\/|index\.html$|sw\.js$|manifest\.webmanifest$|icon)/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let cambiados;
try {
  cambiados = git('diff', '--name-only', `${BASE}...HEAD`).split('\n').filter(Boolean);
} catch {
  console.log(`No se pudo comparar contra ${BASE}; no se revisa la versión.`);
  process.exit(0);
}

const publicados = cambiados.filter((f) => PUBLICADO.test(f));
if (!publicados.length) {
  console.log('No cambió nada de lo que se publica: no hace falta subir la versión.');
  process.exit(0);
}

const versionCambio = cambiados.includes('js/version.js');
if (versionCambio) {
  console.log(`Cambiaron ${publicados.length} archivos publicados y js/version.js subió. Bien.`);
  process.exit(0);
}

console.error('Cambiaron archivos que se publican, pero js/version.js quedó igual:');
for (const f of publicados.slice(0, 20)) console.error(`  ${f}`);
console.error('\nSube VERSION en js/version.js (formato aaaa.mm.dd.n). Sin eso, el service worker');
console.error('sigue sirviendo la caché vieja y el cambio no llega al teléfono.');
process.exit(1);
