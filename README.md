# Gastos del hogar

Aplicación web para llevar las finanzas de un hogar. Registra el presupuesto del mes en partidas agrupadas por categoría (que se pueden pagar en abonos), salarios quincenales o mensuales con sus deducciones (IHSS, ISR, préstamos por planilla), préstamos, cuentas y movimientos. Lleva las tarjetas de crédito en lempiras y dólares: estado de cuenta de cada corte, membresía y seguros, compras a cuotas y compras en dólares convertidas con la tasa del día en que se pagan. Muestra cuánto queda disponible con cada pago, avisa lo pendiente y recuerda los comercios frecuentes. Puede poner lo que vence en el calendario de Outlook de cada persona, con alarma y sin montos. También tiene metas de ahorro con el aporte sugerido por mes y por quincena, una sugerencia de cómo repartir los gastos según los ingresos, el resumen del año con el patrimonio, la comparación entre años (los años anteriores quedan en OneDrive con un resumen guardado), gráficos por grupo y un simulador de pago de deudas con los métodos bola de nieve y avalancha.

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
                  tarjetas (cortes, cuotas, cargos) y dólares, metas, reparto de gastos, recordatorios, reportes
                  (resumen anual, patrimonio, comparación de años y resúmenes guardados), cierre de cada año
                  (la apertura del siguiente, en cierres.js) y filtro por persona
js/ui/            Vistas, menú lateral, comercios, asistente de configuración y gráficos SVG.
                  Los formularios están repartidos por tema: formularios.js (los atajos que abre el
                  resto de la app y el detalle del mes), -movimiento, -partidas, -nomina, -catalogos
                  y -tarjetas; formulario-base.js tiene las piezas comunes.
                  Salvo Inicio, Mes y Movimientos, cada vista se carga al entrar en ella
                  (js/app.js) y el resto se precarga cuando el navegador está ocioso
js/tema.js        Preferencias del dispositivo (tema, filtro de persona, menú, orden de cada pantalla, avisos ocultos)
js/store.js       Estado de la app y guardado de cada cambio
js/sincronizacion.js  Sincronización de la carpeta de OneDrive (archivo principal y uno por año; baja el año actual y el anterior)
js/almacen.js     Guardado en el navegador (IndexedDB, o localStorage si no está disponible)
js/bloqueo.js     PIN del dispositivo (hash PBKDF2, intentos y espera)
js/onedrive.js    Inicio de sesión con Microsoft, archivos de la carpeta y respaldos
js/calendario.js  Calendario de Outlook: eventos de los recordatorios (js/recordatorios.js los mantiene al día)
js/version.js     Versión de la entrega: se muestra en el menú y nombra la caché de sw.js
sw.js             Caché para abrir la app sin conexión
tests/            Pruebas de js/core, de la sincronización, del PIN y de OneDrive (datos ficticios de varios
                  años en tests/datos). importaciones.test.js revisa que los import de js/ existan
```

## Despliegue

La guía de despliegue está en [docs/despliegue.md](docs/despliegue.md).
