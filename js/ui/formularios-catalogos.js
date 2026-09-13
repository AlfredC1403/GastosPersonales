// Formularios de lo que se crea una vez y se usa muchas: préstamos, cuentas, personas, grupos y
// categorías. Las tarjetas de crédito, aunque son cuentas, van en formularios-tarjetas.js.
import { store, guardar, aviso, confirmar, personas, cuentas, cuentasDinero, tarjetas, grupos, vivos, fmt, simboloDe } from '../store.js';
import { TIPOS_CUENTA, MONEDAS } from '../core/modelo.js';
import { seguroEstimado, cuotasRestantes } from '../core/prestamos.js';
import { hoy, periodoActual, redondear } from '../core/util.js';
import { copia, PIE, usarFormulario } from './formulario-base.js';

const { reactive, ref, computed } = Vue;

// ---------------------------------------------------------------- Préstamo

export const PrestamoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="p.nombre" maxlength="60" required></label>
      <label class="campo"><span>Quién lo paga</span>
        <select v-model="p.responsableId"><option :value="null">Hogar</option>
          <option v-for="x in listaPersonas" :key="x.id" :value="x.id">{{ x.nombre }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Tasa de interés anual (%)</span><input v-model.number="p.tasa" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Cuota mensual (con seguros)</span><input v-model.number="p.cuota" type="number" inputmode="decimal" step="0.01" min="0"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Saldo de capital</span><input v-model.number="p.saldo" type="number" inputmode="decimal" step="0.01" min="0"></label>
      <label class="campo"><span>Después de pagar la cuota de</span><input v-model="p.saldoPeriodo" type="month"></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Fecha de la última cuota</span><input v-model="p.ultimaCuota" type="date"></label>
      <label class="campo"><span>Se paga desde</span>
        <select v-model="p.cuentaId"><option v-for="c in listaCuentas" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></label>
    </div>
    <label class="campo"><span>Seguros y cargos incluidos en la cuota</span>
      <input v-model="seguroTexto" type="number" inputmode="decimal" step="0.01" min="0" :placeholder="'Vacío = estimado: ' + fmt(estimado)"></label>
    <p class="nota">Si tu estado de cuenta muestra cuánto de la cuota es seguro, escríbelo. Si lo dejas vacío, se estima con la tasa, el saldo y el plazo.
      <template v-if="restantes !== null"> Faltan {{ restantes }} cuotas.</template></p>
    <label class="campo"><span>Nota</span><input v-model.trim="p.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const p = reactive({
      nombre: '', responsableId: store.yo, tasa: null, cuota: null, seguro: null, saldo: null, saldoPeriodo: periodoActual(),
      fechaSaldo: hoy(), ultimaCuota: '', dia: null, cuentaId: 'gastos', categoriaId: 'prestamos', nota: '', ...original,
    });
    const seguroTexto = ref(p.seguro === null || p.seguro === undefined ? '' : String(p.seguro));
    const listo = () => p.saldoPeriodo && p.ultimaCuota && Number(p.cuota) > 0;
    const estimado = computed(() => (listo() ? seguroEstimado({ ...p, tasa: Number(p.tasa) || 0, cuota: Number(p.cuota), saldo: Number(p.saldo) || 0 }) : 0));
    const restantes = computed(() => (listo() ? cuotasRestantes(p) : null));
    const f = usarFormulario('prestamos', original, emit, { que: 'este préstamo' });

    function enviar() {
      f.error.value = '';
      const r = { ...p, nombre: p.nombre.trim() };
      if (!r.nombre) return (f.error.value = 'Ponle un nombre.');
      if (!(Number(r.tasa) >= 0)) return (f.error.value = 'Escribe la tasa anual (por ejemplo 14.5).');
      if (!(Number(r.cuota) > 0)) return (f.error.value = 'Escribe la cuota mensual.');
      if (!(Number(r.saldo) >= 0)) return (f.error.value = 'Escribe el saldo de capital.');
      if (!r.saldoPeriodo || !r.ultimaCuota) return (f.error.value = 'Completa el mes del saldo y la fecha de la última cuota.');
      if (r.ultimaCuota.slice(0, 7) < r.saldoPeriodo) return (f.error.value = 'La última cuota no puede ser antes del mes del saldo.');
      r.tasa = Number(r.tasa);
      r.cuota = redondear(Number(r.cuota));
      r.saldo = redondear(Number(r.saldo));
      r.seguro = seguroTexto.value === '' ? null : redondear(Number(seguroTexto.value));
      r.dia = Number(r.ultimaCuota.slice(8, 10)) || null;
      if (r.saldo !== original.saldo || r.saldoPeriodo !== original.saldoPeriodo) {
        r.fechaSaldo = hoy();
        r.saldoRegistrado = new Date().toISOString();
      }
      f.terminar(r);
    }

    return { p, seguroTexto, estimado, restantes, enviar, fmt, listaPersonas: computed(personas), listaCuentas: computed(cuentasDinero), ...f };
  },
};

// ---------------------------------------------------------------- Cuenta, persona, grupo y categoría

export const CuentaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <div class="fila-campos">
      <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required></label>
      <label class="campo"><span>Tipo</span><select v-model="c.tipo"><option v-for="(n, k) in tipos" :key="k" :value="k">{{ n }}</option></select></label>
    </div>
    <div class="fila-campos">
      <label class="campo"><span>Moneda</span><select v-model="c.moneda"><option v-for="(n, k) in monedas" :key="k" :value="k">{{ n }}</option></select></label>
      <label class="campo"><span>Saldo inicial ({{ simboloDe(c.moneda) }})</span><input v-model.number="c.saldoInicial" type="number" inputmode="decimal" step="0.01"></label>
    </div>
    <p v-if="cambioMoneda" class="nota chica">La cuenta ya tiene movimientos: al cambiar la moneda, sus montos se leerán en {{ monedas[c.moneda].toLowerCase() }}.</p>
    <div class="fila-campos">
      <label class="campo"><span>Titular</span>
        <select v-model="c.titularId"><option :value="null">Hogar (de los dos)</option>
          <option v-for="p in listaPersonas" :key="p.id" :value="p.id">{{ p.nombre }}</option></select></label>
    </div>
    <p class="nota chica">Los gastos de esta cuenta que no digan quién pagó se cuentan como del titular. Las metas de ahorro se configuran en <a href="#/metas" @click="$emit('listo')">Metas</a>.</p>
    <label class="campo"><span>Nota</span><input v-model.trim="c.nota" maxlength="140" placeholder="Opcional"></label>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', tipo: 'banco', moneda: 'L', saldoInicial: 0, nota: '', titularId: null, ...original });
    const usos = original.id ? vivos('movimientos').filter((m) => m.cuentaId === original.id || m.cuentaDestinoId === original.id).length : 0;
    const cambioMoneda = computed(() => usos > 0 && c.moneda !== (original.moneda || 'L'));
    const f = usarFormulario('cuentas', original, emit, {
      que: 'esta cuenta',
      alBorrar: () => !usos || confirmar(`La cuenta tiene ${usos} ${usos === 1 ? 'movimiento' : 'movimientos'} que dejarán de sumar en su saldo.`,
        { titulo: '¿Eliminarla igual?', aceptar: 'Eliminar', peligro: true }),
    });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Ponle un nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim(), titularId: c.titularId || null, saldoInicial: redondear(Number(c.saldoInicial) || 0) });
    }
    // Las tarjetas se crean y editan con su propio formulario.
    const tipos = Object.fromEntries(Object.entries(TIPOS_CUENTA).filter(([k]) => k !== 'tarjeta'));
    return { c, cambioMoneda, enviar, simboloDe, tipos, monedas: MONEDAS, listaPersonas: computed(personas), ...f };
  },
};

export const PersonaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="p.nombre" maxlength="40" required></label>
    <label class="campo"><span>Correo de su cuenta Microsoft (opcional)</span><input v-model.trim="p.email" type="email" autocomplete="off"></label>
    <p class="nota">Con el correo, la app reconoce a esta persona cuando conecta OneDrive y firma sus registros con su nombre.</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const p = reactive({ nombre: '', email: '', ...original });
    const f = usarFormulario('personas', original, emit, { que: 'esta persona' });
    function enviar() {
      f.error.value = '';
      if (!p.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...p, nombre: p.nombre.trim() });
    }
    return { p, enviar, ...f };
  },
};

export const GrupoForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre del grupo</span><input v-model="g.nombre" maxlength="40" required></label>
    <p v-if="existe && usadas" class="nota chica">Si lo eliminas, sus {{ usadas }} categorías pasan a Personal.</p>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const g = reactive({ nombre: '', orden: grupos().length + 1, ...original });
    const usadas = vivos('categorias').filter((c) => c.grupoId === original.id).length;
    const f = usarFormulario('grupos', original, emit, {
      que: 'este grupo',
      alBorrar: () => {
        if (original.id === 'personal') {
          aviso('Personal recibe las categorías de los grupos que se eliminan: no se puede eliminar.', 'error', 6000);
          return false;
        }
        for (const c of vivos('categorias').filter((x) => x.grupoId === original.id)) guardar('categorias', { ...c, grupoId: 'personal' });
        return true;
      },
    });
    function enviar() {
      f.error.value = '';
      if (!g.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...g, nombre: g.nombre.trim() });
    }
    return { g, usadas, enviar, ...f };
  },
};

export const CategoriaForm = {
  props: { inicial: Object },
  emits: ['listo'],
  template: `
  <form class="formulario" novalidate @submit.prevent="enviar">
    <label class="campo"><span>Nombre</span><input v-model="c.nombre" maxlength="40" required></label>
    <div class="fila-campos">
      <label class="campo"><span>Grupo</span>
        <select v-model="c.grupoId"><option v-for="g in listaGrupos" :key="g.id" :value="g.id">{{ g.nombre }}</option></select></label>
      <label class="campo"><span>Se usa para</span>
        <select v-model="c.tipo"><option value="gasto">Gastos</option><option value="ingreso">Ingresos</option></select></label>
    </div>
    ${PIE}
  </form>`,
  setup(props, { emit }) {
    const original = copia(props.inicial);
    const c = reactive({ nombre: '', grupoId: 'personal', tipo: 'gasto', ...original });
    const f = usarFormulario('categorias', original, emit, { que: 'esta categoría' });
    function enviar() {
      f.error.value = '';
      if (!c.nombre.trim()) return (f.error.value = 'Escribe el nombre.');
      f.terminar({ ...c, nombre: c.nombre.trim() });
    }
    return { c, enviar, listaGrupos: computed(grupos), ...f };
  },
};
