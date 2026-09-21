// Entrar con huella o cara en vez de escribir el PIN (WebAuthn).
//
// Un PIN de 4 a 6 números escrito varias veces al día en el teléfono es incómodo y se mira por
// encima del hombro. Aquí se registra una credencial del propio dispositivo (la huella, la cara
// o el PIN del sistema) y con ella se abre la app.
//
// El PIN no desaparece: sigue siendo el respaldo y el dueño del cifrado. Para que la huella
// también sirva con el cifrado activado hace falta la extensión `prf` de WebAuthn, que da un
// secreto estable por credencial: con él se guarda el PIN cifrado en este dispositivo y la
// huella lo recupera. Donde no haya `prf` (navegadores más viejos), la huella solo sirve de
// puerta, y con el cifrado puesto se sigue pidiendo el PIN.
//
// Todo vive en este dispositivo: no hay servidor, no se sincroniza y no sale de aquí.
const CLAVE = 'gastos.biometria';
const SAL_PRF = new TextEncoder().encode('gastos-del-hogar/pin/v1');

const leer = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE));
  } catch {
    return null;
  }
};
const escribir = (v) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(v));
  } catch {
    /* sin acceso a localStorage */
  }
};
export const olvidar = () => {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* sin acceso a localStorage */
  }
};

const base64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const desdeBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

// ¿El dispositivo tiene huella, cara o algo equivalente, y el navegador lo expone?
export async function hayBiometria() {
  try {
    if (!globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export const biometriaActiva = () => !!leer()?.id;
// Si se guardó el PIN, la huella también abre los datos cifrados.
export const abreElCifrado = () => !!leer()?.pin;

const azar = (n) => crypto.getRandomValues(new Uint8Array(n));

// El secreto que da `prf` es estable para esta credencial y este dispositivo: sirve de clave
// para guardar el PIN aquí. Si el navegador no trae la extensión, no se guarda nada.
async function claveDePrf(resultados) {
  const bits = resultados?.prf?.results?.first;
  if (!bits) return null;
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Registra la huella de este dispositivo. `pin` es el que ya se verificó: si el navegador lo
 * permite, se guarda cifrado para que la huella también abra los datos cifrados.
 * @returns { guardoPin } — false si la huella va a servir solo de puerta.
 */
export async function registrar(pin, { nombre = 'Gastos del hogar' } = {}) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: azar(32),
      rp: { name: nombre, id: location.hostname },
      user: { id: azar(16), name: nombre, displayName: nombre },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
      extensions: { prf: { eval: { first: SAL_PRF } } },
    },
  });
  if (!cred) throw new Error('No se pudo registrar la huella en este dispositivo.');

  const guardado = { id: base64(cred.rawId), pin: null };
  // Algunos autenticadores dicen que soportan `prf` al registrar pero solo dan el secreto al
  // usarla, así que el PIN se guarda en el primer `entrar` si aquí no vino.
  const clave = await claveDePrf(cred.getClientExtensionResults?.());
  if (clave && pin) {
    const iv = azar(12);
    const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(String(pin)));
    guardado.pin = { iv: base64(iv), datos: base64(datos) };
  }
  escribir(guardado);
  return { guardoPin: !!guardado.pin };
}

/**
 * Pide la huella. Devuelve { ok } y, cuando se pudo guardar, el `pin` para abrir el cifrado.
 * Un "no" del usuario (canceló, no reconoció) vuelve como { ok: false }, no como un error.
 */
export async function entrar() {
  const g = leer();
  if (!g?.id) return { ok: false };
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: azar(32),
        allowCredentials: [{ type: 'public-key', id: desdeBase64(g.id) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: SAL_PRF } } },
      },
    });
  } catch {
    return { ok: false };
  }
  if (!cred) return { ok: false };
  if (!g.pin) return { ok: true, pin: null };

  const clave = await claveDePrf(cred.getClientExtensionResults?.());
  if (!clave) return { ok: true, pin: null };
  try {
    const abierto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeBase64(g.pin.iv) }, clave, desdeBase64(g.pin.datos));
    return { ok: true, pin: new TextDecoder().decode(abierto) };
  } catch {
    // El secreto cambió (se borró la credencial y se hizo otra): la huella ya no abre el cifrado.
    return { ok: true, pin: null };
  }
}
