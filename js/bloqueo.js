// Bloqueo con PIN, propio de cada dispositivo (no se sincroniza).
// Se guarda solo un hash PBKDF2-SHA256 con sal aleatoria. Evita que alguien vea los datos
// en la app, pero no los cifra ni reemplaza el bloqueo del celular.
export const MINUTOS = [0, 1, 5, 15];
export const MAX_FALLOS = 5;
const ESPERA_BASE = 30000;
const CLAVES = { pin: 'gastos.pin', intentos: 'gastos.pin.intentos' };

const entorno = {
  almacen: {
    leer: (k) => {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    escribir: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    borrar: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* sin acceso a localStorage */
      }
    },
  },
  ahora: () => Date.now(),
  ciclos: 200000,
};

// Solo para pruebas: reemplaza el almacenamiento, el reloj o los ciclos.
export function configurarEntorno(cambios) {
  Object.assign(entorno, cambios);
}

const base64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const desdeBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

export const esPinValido = (pin) => /^\d{4,6}$/.test(String(pin ?? ''));

export async function derivar(pin, sal, ciclos) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: ciclos, hash: 'SHA-256' }, clave, 256);
  return base64(bits);
}

const config = () => entorno.almacen.leer(CLAVES.pin);
export const pinActivo = () => !!config()?.hash;
export const largoPin = () => config()?.largo ?? null;
export const minutosBloqueo = () => config()?.minutos ?? 1;

// Espera obligatoria según los fallos seguidos: 30 s al quinto, y se duplica en cada uno más.
export const esperaPara = (fallos) => (fallos < MAX_FALLOS ? 0 : ESPERA_BASE * 2 ** (fallos - MAX_FALLOS));

export function estadoIntentos() {
  const i = entorno.almacen.leer(CLAVES.intentos) || { fallos: 0, esperaHasta: 0 };
  return { fallos: i.fallos || 0, espera: Math.max(0, (i.esperaHasta || 0) - entorno.ahora()) };
}

async function hashDe(pin, c) {
  return derivar(pin, desdeBase64(c.sal), c.ciclos);
}

export async function activarPin(pin, minutos = 1) {
  if (!esPinValido(pin)) throw new Error('El PIN debe tener de 4 a 6 números.');
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const ciclos = entorno.ciclos;
  entorno.almacen.escribir(CLAVES.pin, {
    v: 1, sal: base64(sal), ciclos, hash: await derivar(pin, sal, ciclos), largo: pin.length,
    minutos: MINUTOS.includes(Number(minutos)) ? Number(minutos) : 1,
  });
  entorno.almacen.borrar(CLAVES.intentos);
}

// { ok } si el PIN es correcto; { ok: false, espera, fallos } si no, o si todavía hay que esperar.
export async function verificarPin(pin) {
  const c = config();
  if (!c?.hash) return { ok: true };
  const antes = estadoIntentos();
  if (antes.espera > 0) return { ok: false, espera: antes.espera, fallos: antes.fallos };
  if ((await hashDe(String(pin), c)) === c.hash) {
    entorno.almacen.borrar(CLAVES.intentos);
    return { ok: true };
  }
  const fallos = antes.fallos + 1;
  const espera = esperaPara(fallos);
  entorno.almacen.escribir(CLAVES.intentos, { fallos, esperaHasta: espera ? entorno.ahora() + espera : 0 });
  return { ok: false, espera, fallos };
}

async function exigirActual(actual) {
  const r = await verificarPin(actual);
  if (!r.ok) {
    throw new Error(r.espera ? `Demasiados intentos. Espera ${Math.ceil(r.espera / 1000)} segundos.` : 'El PIN actual no es correcto.');
  }
}

export async function cambiarPin(actual, nuevo) {
  await exigirActual(actual);
  await activarPin(nuevo, minutosBloqueo());
}

export async function desactivarPin(actual) {
  await exigirActual(actual);
  quitarPin();
}

export function definirMinutos(minutos) {
  const c = config();
  if (c && MINUTOS.includes(Number(minutos))) entorno.almacen.escribir(CLAVES.pin, { ...c, minutos: Number(minutos) });
}

// Sin pedir el PIN: solo después de volver a iniciar sesión con Microsoft o al borrar los datos.
export function quitarPin() {
  entorno.almacen.borrar(CLAVES.pin);
  entorno.almacen.borrar(CLAVES.intentos);
}

// ¿Hay que bloquear al volver a la app después de estar oculta desde `ocultoDesde`?
export function debeBloquear(ocultoDesde, ahora, minutos) {
  if (ocultoDesde == null) return false;
  return ahora - ocultoDesde >= minutos * 60000;
}
