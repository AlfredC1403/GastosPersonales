// Papelera: lo que se borró en los últimos días y se puede recuperar.
// Las marcas de borrado ya estaban en los datos desde siempre; lo que faltaba era la pantalla.
import {
  store, fmt, fmtMoneda, guardar, aviso, confirmar, buscar, nombreCuenta, nombreCategoria, nombrePersona, nombrePartida,
} from '../store.js';
import { papelera, conteoPorColeccion, NOMBRES, DIAS } from '../core/papelera.js';
import { TIPOS_MOVIMIENTO } from '../core/modelo.js';
import { fechaCorta, nombrePeriodo } from '../core/util.js';
import { Icono } from './componentes.js';

const { ref, computed } = Vue;

const fechaHora = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Cómo se describe cada cosa borrada. Sin esto, la lista sería una fila de identificadores.
function describir(x) {
  const r = x.registro;
  if (x.coleccion === 'movimientos') {
    const que = r.nota || nombrePartida(r.partidaId) || (r.categoriaId ? nombreCategoria(r.categoriaId) : '') || TIPOS_MOVIMIENTO[r.tipo] || 'Movimiento';
    return { titulo: que, detalle: `${fmtMoneda(r.monto, r.moneda)} · ${fechaCorta(r.fecha)} · ${nombreCuenta(r.cuentaId)}` };
  }
  if (x.coleccion === 'recibos') {
    return { titulo: buscar('ingresos', r.ingresoId)?.nombre || 'Pago recibido', detalle: `${fmt(r.neto)} · ${fechaCorta(r.fecha || r.ocurrencia)}` };
  }
  if (x.coleccion === 'ajustesPartida') {
    return { titulo: nombrePartida(r.partidaId) || 'Partida', detalle: `Ajuste de ${nombrePeriodo(r.periodo)}` };
  }
  if (x.coleccion === 'tasas') return { titulo: `Tasa de ${nombrePeriodo(r.periodo)}`, detalle: String(r.valor) };
  if (x.coleccion === 'topes') {
    const de = r.ambito === 'grupo' ? buscar('grupos', r.referenciaId)?.nombre : nombreCategoria(r.referenciaId);
    return { titulo: `Tope de ${de || 'algo borrado'}`, detalle: fmtMoneda(r.monto, r.moneda) };
  }
  if (x.coleccion === 'renovaciones') return { titulo: r.nombre || 'Renovación', detalle: r.vence ? `Vencía el ${fechaCorta(r.vence)}` : '' };
  if (x.coleccion === 'prestamos') return { titulo: r.nombre || 'Préstamo', detalle: r.cuota ? `Cuota de ${fmt(r.cuota)}` : '' };
  if (x.coleccion === 'cuentas') return { titulo: r.nombre || 'Cuenta', detalle: r.tipo || '' };
  if (x.coleccion === 'partidas') return { titulo: r.nombre || 'Partida', detalle: r.monto ? fmtMoneda(r.monto, r.moneda) : '' };
  return { titulo: r.nombre || NOMBRES[x.coleccion] || 'Registro', detalle: '' };
}

export const VistaPapelera = {
  components: { Icono },
  template: `
  <section class="pila">
    <div>
      <p class="etiqueta">Borrado en los últimos {{ dias }} días</p>
      <p class="hero-num">{{ todo.length }}</p>
      <p class="hero-texto">{{ todo.length
        ? 'Se puede recuperar cualquiera. Después de eso siguen en los datos como una marca, para que no vuelvan solos al sincronizar.'
        : 'Nada borrado en este tiempo. Lo que se borra aparece aquí y se puede recuperar.' }}</p>
    </div>

    <div v-if="pestanas.length > 1" class="chips-filtro">
      <button type="button" class="chip-filtro" :class="{ activo: !solo }" @click="solo = ''">Todo ({{ todo.length }})</button>
      <button v-for="t in pestanas" :key="t.coleccion" type="button" class="chip-filtro" :class="{ activo: solo === t.coleccion }"
              @click="solo = t.coleccion">{{ t.nombre }} ({{ t.cuantos }})</button>
    </div>

    <ul v-if="lista.length" class="lista">
      <li v-for="x in lista" :key="x.coleccion + ':' + x.id" class="fila">
        <div class="fila-info">
          <span class="fila-titulo">{{ x.titulo }}</span>
          <span class="fila-sub"><span class="chip-quien">{{ x.tipo }}</span>{{ x.subtitulo }}</span>
        </div>
        <button type="button" class="btn" @click="recuperar(x)">Recuperar</button>
      </li>
    </ul>
    <p v-else class="vacio">Nada borrado aquí.</p>

    <p class="nota chica">Solo se muestran los últimos {{ dias }} días. Recuperar un movimiento de un año que ya se cerró
      no se puede desde aquí: primero hay que abrir ese año en "Años anteriores".</p>
  </section>`,
  setup() {
    const solo = ref('');
    const todo = computed(() => papelera(store.doc, { hoy: store.hoy }).map((x) => {
      const d = describir(x);
      return {
        ...x, ...d,
        subtitulo: [d.detalle, `borrado el ${fechaHora.format(new Date(x.cuando))}`, x.quien ? `por ${nombrePersona(x.quien)}` : '']
          .filter(Boolean).join(' · '),
      };
    }));
    const lista = computed(() => (solo.value ? todo.value.filter((x) => x.coleccion === solo.value) : todo.value));
    const pestanas = computed(() => Object.entries(conteoPorColeccion(store.doc, { hoy: store.hoy }))
      .map(([coleccion, cuantos]) => ({ coleccion, cuantos, nombre: NOMBRES[coleccion] || coleccion }))
      .sort((a, b) => b.cuantos - a.cuantos));

    async function recuperar(x) {
      if (!await confirmar(`Vuelve a aparecer donde estaba: ${x.titulo}.`, { titulo: '¿Recuperar?', aceptar: 'Recuperar' })) return;
      const actual = buscar(x.coleccion, x.id);
      if (!actual) return aviso('Ese registro ya no está en los datos.', 'error');
      try {
        guardar(x.coleccion, { ...actual, borrado: false });
      } catch (e) {
        return aviso(e.message, 'error', 7000);
      }
      return aviso(`Recuperado: ${x.titulo}.`, 'ok', 6000, { texto: 'Deshacer', fn: () => guardar(x.coleccion, { ...buscar(x.coleccion, x.id), borrado: true }) });
    }
    return { store, solo, todo, lista, pestanas, recuperar, dias: DIAS };
  },
};
