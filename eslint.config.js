// Reglas de estilo y de error. Son pocas a propósito: las que atrapan fallos reales
// (una variable que no existe, un `await` olvidado, un `import` que no se usa) sin
// discutir cómo se escribe el código, que ya es consistente en todo el proyecto.
const navegador = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly', crypto: 'readonly',
  fetch: 'readonly', Request: 'readonly', Response: 'readonly', Headers: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  Blob: 'readonly', File: 'readonly', FileReader: 'readonly', FormData: 'readonly', AbortController: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', requestIdleCallback: 'readonly', queueMicrotask: 'readonly',
  console: 'readonly', alert: 'readonly', Intl: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly', matchMedia: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', Image: 'readonly', globalThis: 'readonly', performance: 'readonly',
  PublicKeyCredential: 'readonly', caches: 'readonly', Notification: 'readonly',
  HashChangeEvent: 'readonly', SpeechRecognition: 'readonly', webkitSpeechRecognition: 'readonly',
  MediaRecorder: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
  // Vue entra por <script> en index.html, no por import.
  Vue: 'readonly',
};

const node = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', globalThis: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', crypto: 'readonly', structuredClone: 'readonly',
  fetch: 'readonly', Intl: 'readonly', setImmediate: 'readonly', __dirname: 'readonly',
};

const trabajador = {
  self: 'readonly', caches: 'readonly', clients: 'readonly', indexedDB: 'readonly', location: 'readonly',
  fetch: 'readonly', URL: 'readonly', Response: 'readonly', Request: 'readonly', console: 'readonly',
  registration: 'readonly', setTimeout: 'readonly', Notification: 'readonly',
};

const reglas = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-undef': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-implicit-coercion': 'off',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-return-await': 'error',
  // Varias funciones son `async` por su firma (devuelven una promesa que otra capa espera),
  // no porque usen `await` dentro.
  'require-await': 'off',
  'no-await-in-loop': 'off',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-fallthrough': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-imports': 'error',
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-template-curly-in-string': 'error',
  'no-promise-executor-return': 'off',
};

export default [
  { ignores: ['node_modules/**', 'privado/**', 'pruebas-e2e/informe/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: navegador },
    rules: reglas,
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: trabajador },
    rules: reglas,
  },
  {
    files: ['tests/**/*.js', 'herramientas/**/*.js', 'eslint.config.js', 'pruebas-e2e/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, ...navegador } },
    rules: { ...reglas, 'no-console': 'off' },
  },
];
