import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codificarEnlace } from '../js/onedrive.js';

test('codifica un enlace compartido como pide Graph (u! + base64url sin relleno)', () => {
  // Ejemplo de la documentación de Microsoft Graph (shares-get).
  assert.equal(
    codificarEnlace('https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1'),
    'u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx',
  );
  const codigo = codificarEnlace('https://1drv.ms/f/c/abc/Eñe?e=x+y/z');
  assert.match(codigo, /^u![A-Za-z0-9_-]+$/);
});
