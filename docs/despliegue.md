# Publicar Gastos del hogar en GitHub Pages y conectarlo a OneDrive

La guía parte de un equipo con Windows 11 que tiene el código en `C:\Repos\GastosPersonales`. Termina con la app publicada en `https://<usuario>.github.io/GastosPersonales/`, los datos en un archivo de OneDrive y dos personas usándolo cada una con su cuenta de Microsoft.

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

Los permisos (perfil básico y archivos de OneDrive) se piden al iniciar sesión en la app. No hace falta agregarlos en el portal.

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

Espera uno o dos minutos y recarga la app publicada. En **Ajustes**, la sección **OneDrive** debe mostrar el botón **Conectar con Microsoft**.

## 6. Cargar los datos y crear el archivo en OneDrive

Estos pasos los hace la persona en cuyo OneDrive va a quedar el archivo, desde el equipo donde está `privado/finanzas-inicial.json`.

1. Abre la app publicada y ve a **Ajustes**.
2. Haz clic en **Importar archivo** y elige `C:\Repos\GastosPersonales\privado\finanzas-inicial.json`.
3. En **Quién usa este dispositivo**, elige tu nombre.
4. Haz clic en **Conectar con Microsoft** e inicia sesión. La pantalla de permisos muestra la app como no verificada porque el registro es tuyo. Acepta los permisos.
5. De vuelta en la app, haz clic en **Usar mi OneDrive**.

Comprueba que en tu OneDrive existe `GastosHogar\finanzas.json` y que la parte superior de la app muestra **Sincronizado**.

## 7. Dar acceso a la otra persona

1. En `https://onedrive.live.com`, selecciona la carpeta `GastosHogar` y haz clic en **Compartir**.
2. Escribe el correo de la cuenta de Microsoft de la otra persona, deja el permiso en **Puede editar** y haz clic en **Enviar**. OneDrive le envía un correo con el enlace a la carpeta.
3. En el celular de la otra persona, abre `https://<usuario>.github.io/GastosPersonales/`, elige su nombre en el aviso **¿Quién usa este dispositivo?** y ve a **Ajustes**.
4. Haz clic en **Conectar con Microsoft** e inicia sesión con la cuenta de esa persona.
5. En **Me compartieron el archivo**, pega el enlace del correo de OneDrive y haz clic en **Abrir archivo compartido**.

Para comprobarlo, registra un gasto en un dispositivo y toca el indicador **Sincronizado** en el otro. El gasto debe aparecer en **Movimientos**, y el texto `anotó` debe mostrar el nombre de quien lo registró.

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

OneDrive guarda versiones anteriores de `finanzas.json`. En `https://onedrive.live.com`, haz clic derecho en el archivo y elige **Historial de versiones**. Para tener además una copia propia, usa **Ajustes** > **Descargar respaldo (JSON)** en la app.

### Reconectar la sesión

Microsoft limita la sesión de este tipo de apps a 24 horas. Cuando vence, el indicador de la parte superior muestra **Reconectar**. Tócalo; si la sesión de Microsoft del navegador sigue abierta, vuelve sin pedir la contraseña.

## Problemas comunes

**`la dirección de retorno está registrada como "Web"`**

La URI se agregó en la plataforma **Web**. En **Autenticación**, elimínala de **Web** y agrégala en **Aplicación de página única**.

**`no está registrada como URI de redirección en Azure`**

La dirección de la app no coincide con la registrada. Agrega en **Autenticación** la dirección exacta que muestra el mensaje, con la `/` final.

**`el ID de la aplicación no existe`**

El valor de `clientId` en `js/config.js` no coincide con **Id. de aplicación (cliente)**. Corrígelo y sube el cambio.

**`No tienes permiso para editar ese archivo`**

La carpeta se compartió solo para ver. Repite el paso 7 con el permiso **Puede editar**.
