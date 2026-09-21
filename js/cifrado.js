// Cifrado del documento guardado en este dispositivo (AES-GCM con clave derivada del PIN).
//
// El PIN protege la pantalla, no los datos: IndexedDB queda legible para cualquiera que abra
// el perfil del navegador, y ahí están los ingresos, las deudas y los saldos del hogar. Con el
// cifrado activado, lo que se guarda aquí solo se puede leer con el PIN.
//
// Es opcional a propósito: olvidar el PIN pasa a significar perder la copia local. La de
// OneDrive no se toca (allá manda el permiso de la carpeta, no este cifrado).
const CICLOS = 210000;
const V = 1;

const base64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const desdeBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

export const salNueva = () => base64(crypto.getRandomValues(new Uint8Array(16)));

// La clave de cifrado se deriva del PIN con su propia sal, distinta de la del hash que verifica
// el PIN: así, de conocerse una, la otra no se deduce.
export async function claveDesde(pin, sal, ciclos = CICLOS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: desdeBase64(sal), iterations: ciclos, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Un sobre se reconoce a simple vista, para no intentar descifrar un texto que está en claro
// (el de una versión anterior de la app, por ejemplo).
export const esSobre = (texto) => typeof texto === 'string' && texto.startsWith('{"cifrado"');

export async function cifrar(clave, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(texto));
  return JSON.stringify({ cifrado: V, iv: base64(iv), datos: base64(datos) });
}

export async function descifrar(clave, sobre) {
  let s;
  try {
    s = JSON.parse(sobre);
  } catch {
    throw Object.assign(new Error('Los datos cifrados de este dispositivo están dañados.'), { codigo: 'sobre_dañado' });
  }
  if (s.cifrado !== V) throw Object.assign(new Error('Los datos están cifrados con una versión más nueva de la app.'), { codigo: 'sobre_nuevo' });
  try {
    const abierto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeBase64(s.iv) }, clave, desdeBase64(s.datos));
    return new TextDecoder().decode(abierto);
  } catch {
    // AES-GCM no distingue una clave equivocada de un dato alterado: las dos fallan igual.
    throw Object.assign(new Error('No pude abrir los datos de este dispositivo con ese PIN.'), { codigo: 'clave_mala' });
  }
}
