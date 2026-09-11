// Configuración pública de la app. Aquí no hay secretos: el ID de una app de página única
// (SPA) es público por diseño; lo que protege tus datos es el inicio de sesión de Microsoft.
export const CONFIG = {
  // ID de aplicación (cliente) del registro en Microsoft Entra. Ver README, paso 2.
  clientId: '',
  // 'consumers' = solo cuentas personales de Microsoft (Microsoft 365 Personal o Familia).
  tenant: 'consumers',
  carpeta: 'GastosHogar',
  archivo: 'finanzas.json',
};
