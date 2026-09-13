// Preferencias de este dispositivo (no se sincronizan): tema, vista de pendientes,
// filtro de persona, menú contraído y cómo se ordena o agrupa cada pantalla.
const { reactive } = Vue;

const CLAVES = {
  tema: 'gastos.tema', pendientes: 'gastos.pendientes', persona: 'gastos.persona', menu: 'gastos.menuContraido',
  ordenMes: 'gastos.ordenMes', repartoInicio: 'gastos.repartoInicio', vistaPresupuesto: 'gastos.vistaPresupuesto', agruparMovimientos: 'gastos.agruparMovimientos',
};
// Valores posibles de cada vista; el primero es el que se usa si no hay nada guardado.
const VISTAS = {
  ordenMes: ['grupo', 'fecha', 'medio'],
  repartoInicio: ['grupo', 'medio'],
  vistaPresupuesto: ['grupo', 'persona', 'medio'],
  agruparMovimientos: ['dia', 'grupo', 'medio'],
};
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
    if (valor === null || valor === undefined) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch {
    /* navegador sin almacenamiento: la preferencia dura hasta cerrar */
  }
}

export const prefs = reactive({
  tema: leer(CLAVES.tema), // 'claro' | 'oscuro' | null (sigue al sistema)
  sistemaOscuro: consulta.matches,
  pendientes: leer(CLAVES.pendientes) === 'agenda' ? 'agenda' : 'lista',
  persona: leer(CLAVES.persona), // id de persona o null (todo el hogar)
  menuContraido: leer(CLAVES.menu) === '1',
  ...Object.fromEntries(Object.entries(VISTAS).map(([clave, valores]) => [clave, valores.includes(leer(CLAVES[clave])) ? leer(CLAVES[clave]) : valores[0]])),
});

export const esOscuro = () => (prefs.tema || (prefs.sistemaOscuro ? 'oscuro' : 'claro')) === 'oscuro';

function aplicar() {
  if (prefs.tema) document.documentElement.dataset.tema = prefs.tema;
  else delete document.documentElement.dataset.tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', esOscuro() ? '#0B1120' : '#F8FAFC');
}

let finTransicion = null;
// `valor`: 'claro', 'oscuro' o null para seguir al sistema.
export function definirTema(valor) {
  const raiz = document.documentElement;
  raiz.classList.add('transicion-tema');
  clearTimeout(finTransicion);
  finTransicion = setTimeout(() => raiz.classList.remove('transicion-tema'), 400);
  prefs.tema = valor === 'claro' || valor === 'oscuro' ? valor : null;
  escribir(CLAVES.tema, prefs.tema);
  aplicar();
}

export const alternarTema = () => definirTema(esOscuro() ? 'claro' : 'oscuro');

export function definirPendientes(modo) {
  prefs.pendientes = modo;
  escribir(CLAVES.pendientes, modo);
}

export function definirPersona(personaId) {
  prefs.persona = personaId || null;
  escribir(CLAVES.persona, prefs.persona);
}

export function definirVista(clave, valor) {
  if (!VISTAS[clave]?.includes(valor)) return;
  prefs[clave] = valor;
  escribir(CLAVES[clave], valor);
}
export const definirOrdenMes = (valor) => definirVista('ordenMes', valor);

export function alternarMenuContraido() {
  prefs.menuContraido = !prefs.menuContraido;
  escribir(CLAVES.menu, prefs.menuContraido ? '1' : null);
}

consulta.addEventListener('change', (e) => {
  prefs.sistemaOscuro = e.matches;
  aplicar();
});
aplicar();
