// Filtro por persona. `filtro = { personaId }`; sin persona = todo el hogar.
// SIN_RESPONSABLE = lo que no es de nadie.
export const SIN_RESPONSABLE = '__sin__';

export function coincidePersona(personaId, filtro) {
  if (!filtro?.personaId) return true;
  if (filtro.personaId === SIN_RESPONSABLE) return !personaId;
  return personaId === filtro.personaId;
}

// Un movimiento es de quien pagó o recibió; si no dice, del titular de la cuenta.
export function personaDeMovimiento(m, cuentasPorId) {
  return m.personaId || cuentasPorId.get(m.cuentaId)?.titularId || null;
}
