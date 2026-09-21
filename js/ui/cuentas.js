import { store, fmt, fmtMoneda, indice, cuentasDinero, tarjetas, vivos, filtro, personaFiltro, nombrePersona } from '../store.js';
import { saldosCuentas, enLempirasAprox } from '../core/reportes.js';
import { presupuestoMensual } from '../core/presupuesto.js';
import { coincidePersona } from '../core/filtro.js';
import { TIPOS_CUENTA } from '../core/modelo.js';
import { redondear } from '../core/util.js';
import { nuevoMovimiento, editarCuenta } from './formularios.js';

const { computed } = Vue;

export const VistaCuentas = {
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Total en cuentas</p>
      <p class="hero-num" role="status" aria-live="polite" :class="{ negativo: total < 0 }">{{ fmt(total) }}</p>
      <p class="hero-texto">{{ lista.length }} {{ lista.length === 1 ? 'cuenta' : 'cuentas' }}. Los aportes a Ahorro y Emergencias son transferencias: el dinero sale de Gastos pero no se pierde, se mueve.</p>
      <p v-if="hayDolares" class="nota chica" style="margin-top: 6px">{{ notaDolares }}</p>
    </div>

    <article v-for="x in lista" :key="x.c.id" class="tarjeta">
      <div class="tarjeta-cab pegada">
        <h2>{{ x.c.nombre }}</h2>
        <span class="chip">{{ x.c.titularId ? nombrePersona(x.c.titularId) : 'Hogar' }}</span>
        <span class="chip">{{ tipos[x.c.tipo] || x.c.tipo }}</span>
        <span v-if="x.moneda === 'USD'" class="chip acento">US$</span>
      </div>
      <p class="hero-num" style="font-size: 1.85rem; margin-top: 8px" :class="{ negativo: x.saldo < 0 }">{{ fmtMoneda(x.saldo, x.moneda) }}</p>
      <div v-if="x.pct !== null" class="progreso acento" style="margin-top: 14px" role="img" :aria-label="x.pct + '% del objetivo'"><div :style="{ width: x.pct + '%' }"></div></div>
      <p v-if="x.nota" class="nota" style="margin-top: 8px">{{ x.nota }}</p>
      <div class="botones">
        <button type="button" class="btn" @click="transferir(x.c)">Transferir o retirar</button>
        <button type="button" class="btn" @click="ajustar(x.c)">Ajustar saldo</button>
        <button type="button" class="btn" @click="editarCuenta(x.c)">Editar</button>
      </div>
    </article>
    <p v-if="!lista.length && personaFiltro()" class="vacio">{{ nombrePersona(personaFiltro()) }} no tiene cuentas a su nombre. Las del hogar se ven en "Todo el hogar".</p>
    <button type="button" class="btn-punteado" @click="editarCuenta({ titularId: personaFiltro() })">+ Nueva cuenta</button>
    <p class="nota chica">Si usan el fondo de emergencia, regístrenlo como transferencia de Emergencias a Gastos, o como gasto pagado desde Emergencias.</p>
    <p class="nota chica">Las tarjetas de crédito están en <a href="#/tarjetas">Tarjetas</a>{{ hayTarjetas ? '' : ', donde se pueden agregar' }}.</p>
  </section>`,
  setup() {
    const ix = computed(indice);
    const saldos = computed(() => saldosCuentas(ix.value));
    // El fondo de emergencia se calcula con los gastos de todo el hogar.
    const esenciales = computed(() => presupuestoMensual(ix.value, store.periodo).esenciales);
    const lista = computed(() => cuentasDinero().filter((c) => coincidePersona(c.titularId || null, filtro())).map((c) => {
      const saldo = saldos.value[c.id] || 0;
      const moneda = c.moneda || 'L';
      const meta = vivos('metas').find((m) => m.cuentaId === c.id && m.activo !== false);
      let objetivo = meta?.montoObjetivo || null;
      let nota = c.nota || '';
      if (meta) {
        nota = `${Math.round((saldo / meta.montoObjetivo) * 100)}% de la meta de ${fmtMoneda(meta.montoObjetivo, moneda)}.${c.nota ? ' ' + c.nota : ''}`;
      } else if (c.tipo === 'emergencias' && esenciales.value) {
        objetivo = esenciales.value * 3;
        nota = `Referencia común: un fondo de 3 a 6 meses de gastos del hogar. Con las partidas actuales (sin aportes), entre ${fmt(Math.round(esenciales.value * 3))} y ${fmt(Math.round(esenciales.value * 6))}.`;
      } else if (c.tipo === 'gastos' && !nota) {
        nota = 'Cuenta del día a día: de aquí salen las partidas y los gastos fuera del plan.';
      } else if (c.tipo === 'reservas' && !nota) {
        const anuales = vivos('partidas').filter((p) => p.tipo === 'anual' && p.activo !== false).map((p) => p.nombre.toLowerCase());
        if (anuales.length) nota = `Aquí se acumula lo que se aparta para ${anuales.length > 1 ? anuales.slice(0, -1).join(', ') + ' y ' + anuales[anuales.length - 1] : anuales[0]}.`;
      }
      const pct = objetivo ? Math.max(0, Math.min(100, Math.round((saldo / objetivo) * 100))) : null;
      return { c, moneda, saldo, nota, pct };
    }));
    const hayDolares = computed(() => lista.value.some((x) => x.moneda === 'USD'));
    const tasa = computed(() => ix.value.tasaEn(store.periodo));
    const notaDolares = computed(() => (tasa.value
      ? `El total convierte los dólares con la tasa de este mes (${tasa.value}).`
      : 'El total no incluye las cuentas en dólares: anota la tasa del dólar en Datos y OneDrive.'));
    const total = computed(() => redondear(lista.value.reduce((a, x) => a + enLempirasAprox(ix.value, x.c.id, x.saldo), 0)));
    return {
      lista, total, hayDolares, notaDolares, fmt, fmtMoneda, editarCuenta, tipos: TIPOS_CUENTA, personaFiltro, nombrePersona, hayTarjetas: computed(() => tarjetas().length > 0),
      transferir: (c) => nuevoMovimiento({ tipo: 'transferencia', cuentaId: c.id }),
      ajustar: (c) => nuevoMovimiento({ tipo: 'ajuste', cuentaId: c.id }),
    };
  },
};
