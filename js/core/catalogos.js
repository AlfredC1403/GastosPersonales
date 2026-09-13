// Grupos y categorías que trae la app. Tienen id fijo y, en el documento, "actualizado"
// vacío: así nunca pisan lo que el hogar haya cambiado ni se duplican al fusionar.

// Los cinco primeros grupos tienen color propio en los gráficos (--s1 a --s5).
export const GRUPOS_BASE = [
  ['casa', 'Casa'],
  ['comida', 'Comida'],
  ['transporte', 'Transporte'],
  ['hijos', 'Hijos'],
  ['deudas', 'Deudas'],
  ['salud', 'Salud'],
  ['personal', 'Personal'],
  ['impuestos', 'Impuestos y deducciones'],
  ['ahorro', 'Ahorro'],
  ['ingresos', 'Ingresos'],
];

// [id, nombre, grupo, tipo]
export const CATEGORIAS_BASE = [
  ['vivienda', 'Vivienda', 'casa'],
  ['servicios', 'Servicios', 'casa'],
  ['comunicaciones', 'Comunicaciones', 'casa'],
  ['comida', 'Comida', 'comida'],
  ['restaurantes', 'Restaurantes', 'comida'],
  ['transporte', 'Transporte', 'transporte'],
  ['ninos', 'Niños', 'hijos'],
  ['educacion', 'Educación', 'hijos'],
  ['prestamos', 'Préstamos', 'deudas'],
  ['cargos-tarjeta', 'Intereses y cargos de tarjeta', 'deudas'],
  ['salud', 'Salud', 'salud'],
  ['ropa', 'Ropa', 'personal'],
  ['regalos', 'Regalos', 'personal'],
  ['entretenimiento', 'Entretenimiento', 'personal'],
  ['otros', 'Otros', 'personal'],
  ['impuestos', 'Impuestos', 'impuestos'],
  ['ihss', 'IHSS', 'impuestos'],
  ['isr', 'ISR', 'impuestos'],
  ['ayuda-funebre', 'Ayuda fúnebre', 'impuestos'],
  ['impuesto-vecinal', 'Impuesto vecinal', 'impuestos'],
  ['ahorro', 'Ahorro', 'ahorro'],
  ['salario', 'Salario', 'ingresos', 'ingreso'],
  ['decimos', 'Décimos', 'ingresos', 'ingreso'],
  ['otros-ingresos', 'Otros ingresos', 'ingresos', 'ingreso'],
];

// Grupo al que van las categorías creadas por el hogar antes de que existieran los grupos.
export const GRUPO_POR_DEFECTO = 'personal';
