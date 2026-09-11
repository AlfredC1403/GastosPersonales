import { store, fmt, cuentas, vivos } from '../store.js';
import { saldosCuentas, presupuestoMensual } from '../core/finanzas.js';
import { TIPOS_CUENTA } from '../core/modelo.js';
import { nuevoMovimiento, editarCuenta } from './formularios.js';

const { computed } = Vue;

export const VistaCuentas = {
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Total en cuentas</p>
      <p class="hero-num" :class="{ negativo: total < 0 }">{{ fmt(total) }}</p>
      <p class="hero-texto">{{ lista.length }} cuentas. Los aportes a Ahorro y Emergencias son transferencias: el dinero sale de Gastos pero no se pierde, se mueve.</p>
    </div>

    <article v-for="x in lista" :key="x.c.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ x.c.nombre }}</h2>
        <span class="chip">{{ tipos[x.c.tipo] || x.c.tipo }}</span>
      </div>
      <p class="hero-num" style="font-size: 1.85rem; margin-top: 8px" :class="{ negativo: x.saldo < 0 }">{{ fmt(x.saldo) }}</p>
      <div v-if="x.pct !== null" class="progreso acento" style="margin-top: 14px" role="img" :aria-label="x.pct + '% del objetivo'"><div :style="{ width: x.pct + '%' }"></div></div>
      <p v-if="x.nota" class="nota" style="margin-top: 8px">{{ x.nota }}</p>
      <div class="botones">
        <button type="button" class="btn" @click="transferir(x.c)">Transferir o retirar</button>
        <button type="button" class="btn" @click="ajustar(x.c)">Ajustar saldo</button>
        <button type="button" class="btn" @click="editarCuenta(x.c)">Editar</button>
      </div>
    </article>
    <button type="button" class="btn-punteado" @click="editarCuenta()">+ Nueva cuenta</button>
    <p class="nota chica">Si usan el fondo de emergencia, regístrenlo como transferencia de Emergencias a Gastos, o como gasto pagado desde Emergencias.</p>
  </section>`,
  setup() {
    const saldos = computed(() => saldosCuentas(store.doc));
    const esenciales = computed(() => presupuestoMensual(store.doc, store.periodo).esenciales);
    const lista = computed(() => cuentas().map((c) => {
      const saldo = saldos.value[c.id] || 0;
      let objetivo = c.meta || null;
      let nota = c.nota || '';
      if (c.meta) {
        nota = `${Math.round((saldo / c.meta) * 100)}% de la meta de ${fmt(c.meta)}.${c.nota ? ' ' + c.nota : ''}`;
      } else if (c.tipo === 'emergencias' && esenciales.value) {
        objetivo = esenciales.value * 3;
        nota = `Referencia común: un fondo de 3 a 6 meses de gastos. Con los compromisos actuales (sin aportes), entre ${fmt(Math.round(esenciales.value * 3))} y ${fmt(Math.round(esenciales.value * 6))}.`;
      } else if (c.tipo === 'gastos' && !nota) {
        nota = 'Cuenta del día a día: de aquí salen los compromisos y los gastos adicionales.';
      } else if (c.tipo === 'reservas' && !nota) {
        const anuales = vivos('plantillas').filter((t) => t.clase === 'provision' && t.activo !== false).map((t) => t.nombre.toLowerCase());
        if (anuales.length) nota = `Aquí se acumula lo que se aparta para ${anuales.length > 1 ? anuales.slice(0, -1).join(', ') + ' y ' + anuales[anuales.length - 1] : anuales[0]}.`;
      }
      const pct = objetivo ? Math.max(0, Math.min(100, Math.round((saldo / objetivo) * 100))) : null;
      return { c, saldo, nota, pct };
    }));
    const total = computed(() => lista.value.reduce((a, x) => a + x.saldo, 0));
    return {
      lista, total, fmt, editarCuenta, tipos: TIPOS_CUENTA,
      transferir: (c) => nuevoMovimiento({ tipo: 'transferencia', cuentaId: c.id }),
      ajustar: (c) => nuevoMovimiento({ tipo: 'ajuste', cuentaId: c.id }),
    };
  },
};
