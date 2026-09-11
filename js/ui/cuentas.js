import { store, fmt, cuentas } from '../store.js';
import { saldosCuentas, presupuestoMensual } from '../core/finanzas.js';
import { TIPOS_CUENTA } from '../core/modelo.js';
import { nuevoMovimiento, editarCuenta } from './formularios.js';

const { computed } = Vue;

export const VistaCuentas = {
  template: `
  <section>
    <div class="kpis">
      <div class="kpi"><span>Total en cuentas</span><strong>{{ fmt(total) }}</strong><small>{{ lista.length }} cuentas</small></div>
    </div>
    <div class="tarjetas">
      <article v-for="x in lista" :key="x.c.id" class="tarjeta">
        <header><h3>{{ x.c.nombre }}</h3><span class="chip">{{ tipos[x.c.tipo] || x.c.tipo }}</span></header>
        <p class="grande monto" :class="{ negativo: x.saldo < 0 }">{{ fmt(x.saldo) }}</p>
        <template v-if="x.c.meta">
          <div class="progreso acento" role="img" :aria-label="'Meta al ' + x.pct + '%'" style="margin-top: 10px"><div :style="{ width: x.pct + '%' }"></div></div>
          <p class="nota">{{ x.pct }}% de la meta de {{ fmt(x.c.meta) }}</p>
        </template>
        <p v-if="x.c.tipo === 'emergencias' && esenciales" class="nota">
          Referencia común: un fondo de 3 a 6 meses de gastos. Con los compromisos actuales (sin aportes), entre
          {{ fmt(Math.round(esenciales * 3)) }} y {{ fmt(Math.round(esenciales * 6)) }}.
        </p>
        <p v-if="x.c.nota" class="nota">{{ x.c.nota }}</p>
        <div class="botones">
          <button type="button" class="btn chico" @click="transferir(x.c)">Transferir o retirar</button>
          <button type="button" class="btn chico" @click="ajustar(x.c)">Ajustar saldo</button>
          <button type="button" class="btn chico" @click="editarCuenta(x.c)">Editar</button>
        </div>
      </article>
    </div>
    <div class="botones"><button type="button" class="btn" @click="editarCuenta()">+ Nueva cuenta</button></div>
    <p class="nota">Los aportes a Ahorro y Emergencias son transferencias: el dinero sale de Gastos pero no se pierde, se mueve.
      Si usan el fondo de emergencia, regístrenlo como transferencia de Emergencias a Gastos (o como gasto pagado desde Emergencias).</p>
  </section>`,
  setup() {
    const saldos = computed(() => saldosCuentas(store.doc));
    const lista = computed(() => cuentas().map((c) => {
      const saldo = saldos.value[c.id] || 0;
      return { c, saldo, pct: c.meta ? Math.max(0, Math.min(100, Math.round((saldo / c.meta) * 100))) : 0 };
    }));
    const total = computed(() => lista.value.reduce((a, x) => a + x.saldo, 0));
    const esenciales = computed(() => presupuestoMensual(store.doc, store.periodo).esenciales);
    return {
      lista, total, esenciales, fmt, editarCuenta, tipos: TIPOS_CUENTA,
      transferir: (c) => nuevoMovimiento({ tipo: 'transferencia', cuentaId: c.id }),
      ajustar: (c) => nuevoMovimiento({ tipo: 'ajuste', cuentaId: c.id }),
    };
  },
};
