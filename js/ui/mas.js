import { store, fmtEntero, vivos, cuentas, buscar } from '../store.js';
import { estadoPrestamo, saldosCuentas, presupuestoMensual } from '../core/finanzas.js';
import { prefs, esOscuro, alternarTema, definirPendientes } from '../tema.js';
import { Icono } from './componentes.js';

const { computed } = Vue;

export const VistaMas = {
  components: { Icono },
  template: `
  <section class="pila">
    <article class="tarjeta sin-relleno">
      <a v-for="e in enlaces" :key="e.ruta" class="enlace-mas" :href="'#/' + e.ruta">
        <span class="icono"><icono :n="e.icono" :t="20" :g="1.7"/></span>
        <span style="flex: 1">{{ e.nombre }}</span>
        <span class="valor">{{ e.valor }}</span>
        <icono n="der" :t="18" style="color: var(--tinta3)"/>
      </a>
    </article>

    <article class="tarjeta">
      <h2>Este dispositivo</h2>
      <p class="nota" style="margin: 4px 0 14px">{{ textoDispositivo }}</p>
      <div class="fila">
        <span style="flex: 1; font-size: 0.93rem">Modo oscuro</span>
        <button type="button" class="interruptor" :class="{ on: oscuro }" role="switch" :aria-checked="oscuro" aria-label="Modo oscuro" @click="alternarTema"><span></span></button>
      </div>
      <div class="fila">
        <div class="fila-info">
          <span style="font-size: 0.93rem">Pendientes por día</span>
          <span class="fila-sub">En Inicio, agrupa los pendientes como una agenda.</span>
        </div>
        <button type="button" class="interruptor" :class="{ on: prefs.pendientes === 'agenda' }" role="switch" :aria-checked="prefs.pendientes === 'agenda'"
                aria-label="Pendientes por día" @click="definirPendientes(prefs.pendientes === 'agenda' ? 'lista' : 'agenda')"><span></span></button>
      </div>
    </article>
  </section>`,
  setup() {
    const enlaces = computed(() => {
      const deuda = vivos('prestamos').map((p) => estadoPrestamo(p, store.doc.movimientos)).reduce((a, e) => a + e.saldo, 0);
      const saldos = saldosCuentas(store.doc);
      const totalCuentas = cuentas().reduce((a, c) => a + (saldos[c.id] || 0), 0);
      const egresos = presupuestoMensual(store.doc, store.periodo).egresos;
      return [
        { ruta: 'prestamos', nombre: 'Préstamos y plan', icono: 'tendencia', valor: fmtEntero(deuda) },
        { ruta: 'presupuesto', nombre: 'Presupuesto', icono: 'pastel', valor: `${fmtEntero(egresos)}/mes` },
        { ruta: 'cuentas', nombre: 'Cuentas', icono: 'banco', valor: fmtEntero(totalCuentas) },
        { ruta: 'ajustes', nombre: 'Ajustes', icono: 'ajustes', valor: '' },
      ];
    });
    const textoDispositivo = computed(() => {
      const yo = buscar('personas', store.yo)?.nombre;
      const quien = yo ? `Registras como ${yo}.` : 'Todavía no elegiste quién usa este dispositivo.';
      const ub = store.sync.ubicacion;
      if (!ub) return `${quien} Los datos están solo en este navegador; conéctalo a OneDrive en Ajustes.`;
      return `${quien} El archivo está en ${ub.propio ? 'tu OneDrive' : 'el OneDrive de ' + (ub.dueno || 'otra persona')} y se sincroniza con el resto del hogar.`;
    });
    return { enlaces, textoDispositivo, prefs, oscuro: computed(esOscuro), alternarTema, definirPendientes };
  },
};
