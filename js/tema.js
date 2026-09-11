// Preferencias de este dispositivo (no se sincronizan): tema y forma de ver los pendientes.
const { reactive } = Vue;

const CLAVES = { tema: 'gastos.tema', pendientes: 'gastos.pendientes' };
const consulta = matchMedia('(prefers-color-scheme: dark)');

function leer(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function escribir(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* navegador sin almacenamiento: la preferencia dura hasta cerrar */
  }
}

export const prefs = reactive({
  tema: leer(CLAVES.tema), // 'claro' | 'oscuro' | null (sigue al sistema)
  sistemaOscuro: consulta.matches,
  pendientes: leer(CLAVES.pendientes) === 'agenda' ? 'agenda' : 'lista',
});

export const esOscuro = () => (prefs.tema || (prefs.sistemaOscuro ? 'oscuro' : 'claro')) === 'oscuro';

function aplicar() {
  if (prefs.tema) document.documentElement.dataset.tema = prefs.tema;
  else delete document.documentElement.dataset.tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', esOscuro() ? '#0B1120' : '#F8FAFC');
}

let finTransicion = null;
export function alternarTema() {
  const raiz = document.documentElement;
  raiz.classList.add('transicion-tema');
  clearTimeout(finTransicion);
  finTransicion = setTimeout(() => raiz.classList.remove('transicion-tema'), 400);
  prefs.tema = esOscuro() ? 'claro' : 'oscuro';
  escribir(CLAVES.tema, prefs.tema);
  aplicar();
}

export function definirPendientes(modo) {
  prefs.pendientes = modo;
  escribir(CLAVES.pendientes, modo);
}

consulta.addEventListener('change', (e) => {
  prefs.sistemaOscuro = e.matches;
  aplicar();
});
aplicar();
