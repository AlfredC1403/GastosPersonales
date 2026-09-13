# Gastos del hogar

Aplicación web para llevar las finanzas de un hogar. Registra el presupuesto del mes en partidas agrupadas por categoría (que se pueden pagar en abonos), salarios quincenales o mensuales con sus deducciones (IHSS, ISR, préstamos por planilla), préstamos, cuentas y movimientos. Muestra cuánto queda disponible con cada pago, avisa lo pendiente y tiene gráficos por grupo y un simulador de pago de deudas con los métodos bola de nieve y avalancha.

Los datos se guardan en la carpeta `GastosHogar` de OneDrive (un archivo principal y uno por año, con respaldos) y en una copia en el navegador (IndexedDB). Varias personas pueden usar la misma carpeta, cada una con su cuenta de Microsoft, y cada registro guarda quién lo anotó y quién lo editó. Todas las pantallas se pueden filtrar por persona, y cada dispositivo puede pedir un PIN para abrir la app.

## Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Interfaz | Vue (cargado desde CDN, sin paso de compilación) | 3.5.42 |
| Gráficos | SVG y CSS propios, con colores del tema | |
| Tipografía | Inter y Outfit (Google Fonts) | |
| Datos | Archivo JSON en OneDrive mediante Microsoft Graph | |
| Publicación | GitHub Pages | |
| Pruebas | Node.js (`node --test`) | 22 o superior |

## Requisitos

- Python 3 (solo para servir la app en el equipo)
- Node.js 22 o superior (solo para las pruebas)
- Un registro de aplicación en Microsoft Entra para sincronizar con OneDrive

## Configuración

Los valores están en `js/config.js`:

| Campo | Qué es | Ejemplo | Obligatorio |
|---|---|---|---|
| `clientId` | ID de aplicación (cliente) del registro en Microsoft Entra | `00000000-0000-0000-0000-000000000000` | Sí, para OneDrive |
| `tenant` | Cuentas que pueden iniciar sesión | `consumers` | No |
| `carpeta` | Carpeta de los datos en OneDrive | `GastosHogar` | No |

Sin `clientId`, la app guarda los datos solo en el navegador.

> [!WARNING]
> GitHub Pages en una cuenta gratuita publica el repositorio completo. Los datos personales van en OneDrive o en la carpeta `privado/`, que está excluida en `.gitignore`.

## Ejecución

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Abre `http://localhost:8080`. Para cargar datos, usa **Menú** > **Datos y OneDrive** > **Importar archivo**.

Pruebas:

```bash
npm test
```

## Estructura del proyecto

```text
index.html        Página, política de seguridad, fuentes y carga de Vue
css/app.css       Estilos y variables de color (modo claro y oscuro)
js/core/          Cálculos sin interfaz: modelo y migración de los datos, archivos por año, asientos,
                  partidas, nómina y deducciones, plan por quincena, avisos, préstamos y bola de nieve,
                  reportes y filtro por persona
js/ui/            Vistas, menú lateral, formularios, asistente de configuración y gráficos SVG
js/tema.js        Preferencias del dispositivo (tema, filtro de persona, menú, orden de cada pantalla, avisos ocultos)
js/store.js       Estado de la app y guardado de cada cambio
js/sincronizacion.js  Sincronización de la carpeta de OneDrive (archivo principal y uno por año)
js/almacen.js     Guardado en el navegador (IndexedDB, o localStorage si no está disponible)
js/bloqueo.js     PIN del dispositivo (hash PBKDF2, intentos y espera)
js/onedrive.js    Inicio de sesión con Microsoft, archivos de la carpeta y respaldos
sw.js             Caché para abrir la app sin conexión
tests/            Pruebas de js/core, de la sincronización, del PIN y de OneDrive
```

## Despliegue

La guía de despliegue está en [docs/despliegue.md](docs/despliegue.md).
