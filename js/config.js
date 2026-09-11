// Configuración pública de la app. Aquí no hay secretos: el ID de una app de página única
// (SPA) es público por diseño; lo que protege tus datos es el inicio de sesión de Microsoft.
export const CONFIG = {
  // ID de aplicación (cliente) del registro en Microsoft Entra. Ver README, paso 2.
  clientId: '423e5baa-10ae-45d1-a916-29f57f1f3a3c',
  // 'consumers' = solo cuentas personales de Microsoft (Microsoft 365 Personal o Familia).
  tenant: 'consumers',
  carpeta: 'GastosHogar',
  archivo: 'finanzas.json',
};
