// Falla si la carga inicial se pasa del presupuesto. La carga diferida de las vistas
// (js/app.js) está pensada para que abrir la app sea barato; esto lo sostiene en el tiempo.
import { pesoInicial } from './tamano-inicial.js';

// Medido con gzip, que es como lo sirve GitHub Pages. Hoy la carga inicial anda por 185 KB;
// el margen es para crecer sin sustos, no para gastarlo. Una pantalla nueva va a `aDemanda`.
const LIMITE_KB = 210;

const { total, sinComprimir, detalle } = pesoInicial();
const kb = total / 1024;

for (const x of [...detalle].sort((a, b) => b.bytes - a.bytes).slice(0, 10)) {
  console.log(`  ${(x.bytes / 1024).toFixed(1).padStart(7)} KB  ${x.archivo}`);
}
console.log(`\nCarga inicial: ${kb.toFixed(1)} KB con gzip (${(sinComprimir / 1024).toFixed(0)} KB sin comprimir) en ${detalle.length} archivos. Límite ${LIMITE_KB} KB.`);

if (kb > LIMITE_KB) {
  console.error(`\nLa carga inicial se pasó del presupuesto por ${(kb - LIMITE_KB).toFixed(1)} KB.`);
  console.error('Pasa la pantalla nueva a carga diferida en js/app.js (aDemanda), o sube el límite a conciencia.');
  process.exit(1);
}
