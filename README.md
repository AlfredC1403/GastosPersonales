# Gastos del hogar

Aplicación web para llevar las finanzas de un hogar. Registra el presupuesto del mes en partidas agrupadas por categoría (que se pueden pagar en abonos y llevarse en lempiras o en dólares), salarios quincenales o mensuales con sus deducciones (IHSS, ISR, préstamos por planilla), préstamos, cuentas y movimientos. Lleva las tarjetas de crédito en lempiras y dólares: estado de cuenta de cada corte, membresía y seguros, financiamientos (intra y extra) con su propia pantalla —por qué cuota va cada uno, lo que falta y el plan completo; se pueden registrar ya empezados y se ajustan a cómo cobre cada banco: en el corte o el mismo día de cada mes— y compras en dólares convertidas con la tasa del día en que se pagan. Muestra cuánto queda disponible con cada pago, avisa lo pendiente y recuerda los comercios frecuentes. Puede poner lo que vence en el calendario de Outlook de cada persona, con alarma y sin montos (el recordatorio enlaza directo al registro), y también avisar en el propio teléfono sin cuenta de Microsoft. Administra las suscripciones —Netflix, iCloud, el hosting— en su propia pantalla: cada una con su ciclo de cobro (cada mes, cada 3 o 6 meses, cada año), su día de renovación, su prueba gratis (avisa antes de que empiece a cobrar) y con qué tarjeta se paga, más lo que cuestan al mes y al año y cuánto de eso es en dólares. Una partida en dólares se mide en dólares —US$9.99 pagados a otra tasa siguen siendo US$9.99— y en el mes y en los reportes cuenta en lempiras con la tasa de su mes, no con la de hoy: cada mes tiene la suya y un reporte viejo no se mueve. Contesta también «¿me va a alcanzar?»: la proyección del saldo de los próximos meses (con simulador de un gasto nuevo o un financiamiento), cómo va a cerrar el mes al ritmo que lleva el gasto, topes por categoría o por grupo que avisan antes de pasarse, y renovaciones —el seguro del carro, la licencia, el pasaporte— que avisan con tiempo. Al registrar se puede pegar el aviso del banco (BAC, Ficohsa, Atlántida, Banpaís y otros) y el formulario se llena solo; hay un registro rápido de dos toques con los comercios de siempre y su monto habitual, etiquetas libres sobre los movimientos, un buscador global (la lupa de la cabecera, o «/») y un aviso cuando algo se parece a un movimiento ya anotado, que es como se cuelan los repetidos cuando dos personas anotan lo mismo. Lo borrado se puede recuperar de la papelera, un respaldo se puede comparar con lo de hoy para traer solo lo que falte, y el mes y el año se pueden imprimir o guardar en PDF. También tiene metas de ahorro con el aporte sugerido por mes y por quincena, una sugerencia de cómo repartir los gastos según los ingresos (con lo que cada persona pagó de verdad y la transferencia que lo cuadra), el resumen del año con el patrimonio, la comparación entre años (los años anteriores quedan en OneDrive con un resumen guardado), gráficos por grupo y un simulador de pago de deudas con los métodos bola de nieve y avalancha, que incluye los financiamientos de tarjeta: al terminar cada uno su cuota queda libre para la siguiente deuda.

Los datos se guardan en la carpeta `GastosHogar` de OneDrive (un archivo principal y uno por año, con respaldos) y en una copia en el navegador (IndexedDB). El formato va por el esquema 4; al abrir la app, un archivo de un esquema anterior se respalda y se migra solo, y uno de un esquema más nuevo deja la app en solo lectura hasta actualizarla, para no pisar datos que todavía no sabe leer. Varias personas pueden usar la misma carpeta, cada una con su cuenta de Microsoft, y cada registro guarda quién lo anotó y quién lo editó. Todas las pantallas se pueden filtrar por persona, y cada dispositivo puede pedir un PIN para abrir la app, entrar con huella en vez de escribirlo y, si se quiere, cifrar con ese PIN la copia guardada aquí.

## Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Interfaz | Vue (cargado desde CDN, sin paso de compilación) | 3.5.42 |
| Gráficos | SVG y CSS propios, con colores del tema | |
| Tipografía | Inter y Outfit (Google Fonts) | |
| Datos | Archivo JSON en OneDrive mediante Microsoft Graph | |
| Publicación | GitHub Pages | |
| Pruebas | Node.js (`node --test`) y Playwright (extremo a extremo) | 22 o superior |
| Estilo | ESLint (configuración plana) | 9 |

## Requisitos

- Python 3 (solo para servir la app en el equipo)
- Node.js 22 o superior (solo para las pruebas y el linter)
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

Pruebas y revisiones:

```bash
npm run verificar   # estilo, pruebas, tamaño de la carga inicial y extremo a extremo
npm test            # solo las pruebas de js/core, sincronización, PIN, cifrado y OneDrive
npm run lint        # ESLint
npm run tamano      # cuánto pesa la carga inicial (con gzip) contra su presupuesto
npm run e2e         # la app en un Chromium a 390x844, como en el teléfono
```

La primera vez, el navegador de las pruebas se baja con `npx playwright install chromium`.
Las dependencias de desarrollo (ESLint, Playwright y una copia de Vue para servirla en las
pruebas sin depender del CDN) no tocan el sitio publicado, que sigue sin paso de compilación.

> [!NOTE]
> La política de seguridad de `index.html` lleva `'unsafe-eval'` a propósito: Vue compila en el
> navegador las plantillas que están escritas como texto en `js/ui/`. Quitarlo exigiría
> precompilarlas, o sea un paso de compilación, que es justo lo que el proyecto decidió evitar.
> `connect-src`, en cambio, nombra uno por uno los sitios de Microsoft con los que la app habla.

## Estructura del proyecto

```text
index.html        Página, política de seguridad, fuentes y carga de Vue
css/app.css       Estilos y variables de color (modo claro y oscuro)
js/core/          Cálculos sin interfaz: modelo y migración de los datos, archivos por año, asientos,
                  partidas (en lempiras o en dólares), suscripciones (ciclo de cobro, próximo cobro y prueba
                  gratis), nómina y deducciones, plan por quincena, avisos, préstamos y bola de nieve,
                  tarjetas (cortes, cuotas, cargos) y dólares, metas, reparto de gastos, recordatorios, reportes
                  (resumen anual, patrimonio, comparación de años, cierre proyectado del mes, costo de la
                  deuda y resúmenes guardados), proyección del saldo, topes, renovaciones, tasa del dólar
                  por mes, etiquetas, buscador, lectura de los avisos del banco, repetidos, comercios
                  frecuentes, papelera, restauración parcial de un respaldo, cierre de cada año
                  (la apertura del siguiente, en cierres.js) y filtro por persona
js/ui/            Vistas, menú lateral, comercios, asistente de configuración y gráficos SVG.
                  Los formularios están repartidos por tema: formularios.js (los atajos que abre el
                  resto de la app y el detalle del mes), -movimiento, -partidas, -nomina, -catalogos,
                  -tarjetas y -financiamientos; formulario-base.js tiene las piezas comunes.
                  Los financiamientos de tarjeta se registran y editan solo desde su módulo:
                  editarMovimiento manda ahí cualquier registro que tenga cuotas.
                  Salvo Inicio, Mes y Movimientos, cada vista se carga al entrar en ella
                  (js/app.js) y el resto se precarga cuando el navegador está ocioso. Una pantalla
                  nueva va siempre a carga diferida: es lo que sostiene el presupuesto de tamaño
js/tema.js        Preferencias del dispositivo (tema, filtro de persona, menú, orden de cada pantalla, avisos ocultos)
js/store.js       Guardar cada cambio, sincronizar y abrir años anteriores. Es la puerta que importan
                  las pantallas; detrás están js/store/estado.js (el objeto reactivo),
                  js/store/consultas.js (preguntas sobre el documento y el formato del dinero) y
                  js/store/dialogos.js (el aviso de abajo, el diálogo y la pregunta de sí o no)
js/sincronizacion.js  Sincronización de la carpeta de OneDrive (archivo principal y uno por año; baja el año actual y el anterior)
js/almacen.js     Guardado en el navegador (IndexedDB, o localStorage si no está disponible)
js/bloqueo.js     PIN del dispositivo (hash PBKDF2, intentos y espera)
js/cifrado.js     Cifrado opcional de la copia local (AES-GCM con clave derivada del PIN)
js/biometria.js   Entrar con huella o cara en vez del PIN (WebAuthn, solo en este dispositivo)
js/onedrive.js    Inicio de sesión con Microsoft, archivos de la carpeta y respaldos
js/calendario.js  Calendario de Outlook: eventos de los recordatorios (js/recordatorios.js los mantiene al día)
js/notificaciones.js  Avisos en el propio teléfono: deja la agenda en IndexedDB para que sw.js la lea
js/version.js     Versión de la entrega: se muestra en el menú y nombra la caché de sw.js
sw.js             Caché para abrir la app sin conexión y los avisos del teléfono
tests/            Pruebas de js/core, de la sincronización, del PIN, del cifrado y de OneDrive (datos
                  ficticios de varios años en tests/datos). importaciones.test.js revisa que los
                  import de js/ existan
e2e/              La app abierta en un navegador a ancho de celular: que cada pantalla del menú
                  dibuje, que registrar un gasto funcione de punta a punta y que nada se salga a
                  lo ancho. La configuración está en playwright.config.js
herramientas/     Revisiones que corren en CI: el peso de la carga inicial contra su presupuesto
                  y que js/version.js suba cuando cambia algo publicado
```

## Despliegue

La guía de despliegue está en [docs/despliegue.md](docs/despliegue.md).
