# Gastos del hogar

Aplicación web para llevar las finanzas de un hogar. Registra compromisos del mes (fijos, fijos variables, pagos anuales y aportes a ahorro), préstamos, cuentas y movimientos, con gráficos y un simulador de pago de deudas con los métodos bola de nieve y avalancha.

Los datos se guardan en un archivo JSON en OneDrive y en una copia en el navegador. Varias personas pueden usar el mismo archivo, cada una con su cuenta de Microsoft, y cada registro guarda quién lo anotó y quién lo editó.

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
| `carpeta` | Carpeta del archivo de datos en OneDrive | `GastosHogar` | No |
| `archivo` | Nombre del archivo de datos | `finanzas.json` | No |

Sin `clientId`, la app guarda los datos solo en el navegador.

> [!WARNING]
> GitHub Pages en una cuenta gratuita publica el repositorio completo. Los datos personales van en OneDrive o en la carpeta `privado/`, que está excluida en `.gitignore`.

## Ejecución

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Abre `http://localhost:8080`. Para cargar datos, usa **Más** > **Ajustes** > **Importar archivo**.

Pruebas:

```bash
npm test
```

## Estructura del proyecto

```text
index.html        Página, política de seguridad, fuentes y carga de Vue
css/app.css       Estilos y variables de color (modo claro y oscuro)
js/core/          Cálculos sin interfaz (préstamos, bola de nieve, saldos, fusión de datos)
js/ui/            Vistas, formularios y gráficos SVG
js/tema.js        Preferencias del dispositivo (tema y vista de pendientes)
js/store.js       Estado, guardado en el navegador y sincronización
js/onedrive.js    Inicio de sesión con Microsoft y lectura y escritura del archivo
sw.js             Caché para abrir la app sin conexión
tests/            Pruebas de js/core
```

## Despliegue

La guía de despliegue está en [docs/despliegue.md](docs/despliegue.md).
