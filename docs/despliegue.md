# Publicar Gastos del hogar en GitHub Pages y conectarlo a OneDrive

La guía parte de un equipo con Windows 11 que tiene el código en `C:\Repos\GastosPersonales`. Termina con la app publicada en `https://<usuario>.github.io/GastosPersonales/`, los datos en una carpeta de OneDrive y dos personas usándola cada una con su cuenta de Microsoft.

En toda la guía, `<usuario>` es tu nombre de usuario de GitHub.

## Antes de empezar

- Una cuenta de GitHub.
- Una cuenta personal de Microsoft con OneDrive para cada persona que va a usar la app.

## 1. Instalar git

Los comandos van en **PowerShell**.

1. Instala git:

   ```powershell
   winget install --id Git.Git -e --source winget
   ```

2. Cierra PowerShell, ábrelo de nuevo y comprueba la instalación:

   ```powershell
   git --version
   ```

3. Define el nombre y el correo que van a aparecer en los commits. Cambia `<tu-nombre>` y `<tu-correo>` por los tuyos:

   ```powershell
   git config --global user.name "<tu-nombre>"
   git config --global user.email "<tu-correo>"
   ```

## 2. Subir el código a GitHub

1. Abre `https://github.com/new`, escribe `GastosPersonales` en **Repository name**, elige **Public**, deja sin marcar **Add a README file** y haz clic en **Create repository**. GitHub Pages en una cuenta gratuita solo publica repositorios públicos.

2. Crea el repositorio local y agrega los archivos:

   ```powershell
   cd C:\Repos\GastosPersonales
   git init -b main
   git add .
   git status
   ```

   > [!WARNING]
   > En la lista que muestra `git status` no puede aparecer la carpeta `privado/`, porque contiene tus datos. Si aparece, no sigas y revisa que `.gitignore` tenga la línea `privado/`.

3. Haz el primer commit y súbelo:

   ```powershell
   git commit -m "Primera versión"
   git remote add origin https://github.com/<usuario>/GastosPersonales.git
   git push -u origin main
   ```

   La primera vez se abre el navegador para iniciar sesión en GitHub.

Comprueba que `https://github.com/<usuario>/GastosPersonales` muestra los archivos y que no existe la carpeta `privado`.

## 3. Activar GitHub Pages

1. En el repositorio, abre **Settings** > **Pages**.
2. En **Build and deployment**, elige **Deploy from a branch** en **Source**.
3. En **Branch**, elige `main` y la carpeta `/ (root)`. Haz clic en **Save**.

La publicación tarda uno o dos minutos. Abre `https://<usuario>.github.io/GastosPersonales/`. La app debe cargar con el título **Gastos del hogar**.

## 4. Registrar la app en Microsoft Entra

El registro le da a la app un ID con el que Microsoft permite iniciar sesión y acceder a OneDrive. Se hace una sola vez y es gratuito.

1. Abre `https://entra.microsoft.com` e inicia sesión con tu cuenta personal de Microsoft.

   Si el portal indica que tu cuenta no tiene un directorio y no deja registrar aplicaciones, crea una cuenta gratuita de Azure con la misma cuenta en `https://azure.microsoft.com/free` y vuelve a este paso. El alta de Azure pide verificar tu identidad.

2. En el buscador de la parte superior, escribe `Registros de aplicaciones` (`App registrations` si el portal está en inglés) y ábrelo.
3. Haz clic en **Nuevo registro** y completa:

   | Campo | Valor |
   |---|---|
   | Nombre | `Gastos del hogar` |
   | Tipos de cuenta compatibles | **Solo cuentas personales de Microsoft** |
   | URI de redirección, plataforma | **Aplicación de página única (SPA)** |
   | URI de redirección, dirección | `https://<usuario>.github.io/GastosPersonales/` |

   La dirección tiene que terminar en `/`.

4. Haz clic en **Registrar**.
5. En la página **Información general**, copia el valor de **Id. de aplicación (cliente)**. En los pasos siguientes es `<id-de-aplicacion>`.
6. Para probar la app en el equipo, abre **Autenticación**, agrega la URI `http://localhost:8080/` en la plataforma **Aplicación de página única** y haz clic en **Guardar**.

Los permisos (perfil básico y archivos de OneDrive) se piden al iniciar sesión en la app. El del calendario, solo en el dispositivo donde se activan los recordatorios de Outlook. No hace falta agregarlos en el portal.

Comprueba que en **Autenticación**, dentro de **Aplicación de página única**, aparece `https://<usuario>.github.io/GastosPersonales/`.

## 5. Poner el ID en la app

1. Abre `C:\Repos\GastosPersonales\js\config.js` y reemplaza la línea de `clientId`:

   ```js
   clientId: '<id-de-aplicacion>',
   ```

2. Sube el cambio:

   ```powershell
   git add js/config.js
   git commit -m "ID de aplicación de Microsoft"
   git push
   ```

Espera uno o dos minutos y recarga la app publicada. En **Menú** > **Datos y OneDrive**, la sección **OneDrive** debe mostrar el botón **Conectar con Microsoft**.

## 6. Cargar los datos y crear el archivo en OneDrive

Estos pasos los hace la persona en cuyo OneDrive va a quedar el archivo, desde el equipo donde está `privado/finanzas-inicial.json`.

1. Abre la app publicada y ve a **Menú** > **Datos y OneDrive**.
2. Haz clic en **Importar archivo** y elige `C:\Repos\GastosPersonales\privado\finanzas-inicial.json`.
3. En **Menú** > **Personas**, dentro de **Quién usa este dispositivo**, elige tu nombre.
4. Vuelve a **Datos y OneDrive**, haz clic en **Conectar con Microsoft** e inicia sesión. La pantalla de permisos muestra la app como no verificada porque el registro es tuyo. Acepta los permisos.
5. De vuelta en la app, haz clic en **Usar mi OneDrive**.

Comprueba que en tu OneDrive existe la carpeta `GastosHogar` con `finanzas.json` y un `finanzas-AAAA.json` por cada año con movimientos, y que la sección **OneDrive** de **Datos y OneDrive** muestra **Sincronizado**. El ícono de la nube de la parte superior se ve en verde.

## 7. Dar acceso a la otra persona

> [!IMPORTANT]
> Se comparte la carpeta `GastosHogar`, no el archivo `finanzas.json`. La app solo acepta el enlace de la carpeta, porque dentro de ella también guarda un archivo por año y los respaldos.

1. En `https://onedrive.live.com`, selecciona la carpeta `GastosHogar` y haz clic en **Compartir**.
2. Escribe el correo de la cuenta de Microsoft de la otra persona, deja el permiso en **Puede editar** y haz clic en **Enviar**. OneDrive le envía un correo con el enlace a la carpeta.
3. En el celular de la otra persona, abre `https://<usuario>.github.io/GastosPersonales/`, elige su nombre en el aviso **¿Quién usa este dispositivo?** y ve a **Menú** > **Datos y OneDrive**.
4. Haz clic en **Conectar con Microsoft** e inicia sesión con la cuenta de esa persona.
5. En **Me compartieron la carpeta**, pega el enlace del correo de OneDrive y haz clic en **Abrir carpeta compartida**.

Para comprobarlo, registra un gasto en un dispositivo y toca el ícono de la nube de la parte superior en el otro. El gasto debe aparecer en **Movimientos**, y el texto `anotó` debe mostrar el nombre de quien lo registró.

## 8. Instalar en el celular

En Android con Chrome, abre el menú y elige **Agregar a la pantalla principal**. En iPhone con Safari, toca **Compartir** y luego **Agregar a inicio**.

Comprueba que el ícono **Gastos** aparece en la pantalla de inicio y que abre la app sin la barra de direcciones.

## Operación

### Actualizar la app

Después de cambiar el código, sube los cambios. Cambia `<descripcion-del-cambio>` por un texto corto sobre lo que cambiaste:

```powershell
git add .
git commit -m "<descripcion-del-cambio>"
git push
```

GitHub Pages publica la nueva versión en uno o dos minutos. Los datos no cambian porque están en OneDrive.

### Recuperar una versión anterior de los datos

Hay tres copias posibles:

- **Historial de versiones de OneDrive.** En `https://onedrive.live.com`, abre la carpeta `GastosHogar`, haz clic derecho en `finanzas.json` o en el archivo del año y elige **Historial de versiones**.
- **Carpeta `GastosHogar\respaldos`.** La app guarda ahí una copia antes de cambiar el formato de los datos, y otra cada vez que tocas **Menú** > **Datos y OneDrive** > **Guardar respaldo ahora**. Se conservan las 10 más recientes.
- **Copia propia.** **Menú** > **Datos y OneDrive** > **Descargar respaldo (JSON)** descarga todos los datos en un solo archivo, que se puede volver a cargar con **Importar archivo**.

### Actualizar a la versión con grupos y abonos

Esta versión cambia el formato de los datos. La primera vez que un dispositivo con la versión nueva sincroniza:

1. Guarda una copia del archivo anterior en `GastosHogar\respaldos\finanzas-e1-<fecha>.json`.
2. Reparte los datos en `finanzas.json` (configuración, partidas, préstamos) y `finanzas-2026.json` (movimientos y pagos recibidos del año).
3. Muestra en **Inicio** el aviso para revisar la configuración: grupos, cómo se paga cada partida y salarios.

Abran la app con conexión en los dos celulares para que tomen la versión nueva. Un celular que todavía tiene la versión anterior muestra **Los datos se guardaron con una versión más nueva de la app** y no sube nada hasta tocar **Actualizar**.

### Poner un PIN en un dispositivo

En **Menú** > **Seguridad**, escribe un PIN de 4 a 6 números y elige cuándo se bloquea la app. El PIN es de ese dispositivo: cada persona pone el suyo en su celular. Si se olvida, **Olvidé mi PIN** pide iniciar sesión con Microsoft; en un dispositivo sin OneDrive conectado, la única salida es borrar los datos del navegador.

### Activar los recordatorios en Outlook

Cada persona los activa en su celular, con su cuenta de Microsoft:

1. En **Menú** > **Recordatorios**, elige qué recordar, cuándo avisa y en qué calendario.
2. Toca **Activar recordatorios**. Microsoft pide permiso para ver y editar el calendario; acéptalo.
3. Toca **Probar la alarma**. En 10 minutos debe sonar la alarma del evento de prueba. Después tócalo en **Borrar la prueba**.

La app crea el calendario **Gastos del hogar** con lo que vence en los próximos 60 días: partidas con día, cuotas, pagos anuales y pagos de tarjeta. Los eventos no llevan montos, se actualizan cuando cambia algo y se borran cuando se registra el pago. **Apagar y borrar** quita todos sus eventos.

### Actualizar la app en los celulares

Cuando hay una versión nueva publicada, la app muestra **Hay una versión nueva de la app** con el botón **Actualizar**. Tócalo en cada dispositivo.

### Reconectar la sesión

Microsoft limita la sesión de este tipo de apps a 24 horas. Cuando vence, el ícono de la nube de la parte superior se pone amarillo. Tócalo; si la sesión de Microsoft del navegador sigue abierta, vuelve sin pedir la contraseña.

## Problemas comunes

**`la dirección de retorno está registrada como "Web"`**

La URI se agregó en la plataforma **Web**. En **Autenticación**, elimínala de **Web** y agrégala en **Aplicación de página única**.

**`no está registrada como URI de redirección en Azure`**

La dirección de la app no coincide con la registrada. Agrega en **Autenticación** la dirección exacta que muestra el mensaje, con la `/` final.

**`el ID de la aplicación no existe`**

El valor de `clientId` en `js/config.js` no coincide con **Id. de aplicación (cliente)**. Corrígelo y sube el cambio.

**`No tienes permiso para editar ese archivo`**

La carpeta se compartió solo para ver. Repite el paso 7 con el permiso **Puede editar**.

**`Ese enlace es de un archivo`**

Se pegó el enlace de `finanzas.json`. En OneDrive, comparte la carpeta `GastosHogar` (paso 7) y pega ese enlace.

**La alarma de los recordatorios no suena**

En la app de Outlook del celular, abre la lista de calendarios y marca **Gastos del hogar**, y revisa en los ajustes del teléfono que Outlook tenga permiso para mostrar notificaciones. Si aun así no suena, en **Menú** > **Recordatorios** elige **Mi calendario principal** y vuelve a tocar **Probar la alarma**.

**`Microsoft no dio permiso para usar tu calendario`**

Se rechazó el permiso o se quitó desde la cuenta de Microsoft. Vuelve a tocar **Activar recordatorios** y acepta el permiso del calendario. La sincronización con OneDrive no se ve afectada.

**`No tengo acceso a la carpeta GastosHogar`**

El dispositivo se conectó con una versión anterior usando el enlace del archivo, y la versión nueva necesita la carpeta. En **Datos y OneDrive**, toca **Desconectar** y repite los pasos 4 y 5 del paso 7 con el enlace de la carpeta.
