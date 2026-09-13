// Asistente para revisar la configuración después de una actualización grande. El avance
// se guarda en config.asistente.completados, así no vuelve a aparecer en ningún dispositivo.
import { store, guardar, guardarConfig, exportar, respaldarAhora, aviso, grupos, categorias, vivos, tarjetas, nombrePersona, fmt } from '../store.js';
import { FORMAS, FRECUENCIAS } from '../core/modelo.js';
import { hoy } from '../core/util.js';
import { Icono, descargar } from './componentes.js';
import { editarIngreso } from './formularios.js';
import { editarTarjeta } from './formularios-tarjetas.js';

const { ref, computed, watch, nextTick } = Vue;

export const PASOS_ASISTENTE = [
  { id: 'e2-respaldo', titulo: 'Respaldo y novedades' },
  { id: 'e2-grupos', titulo: 'Grupos y categorías' },
  { id: 'e2-partidas', titulo: 'Cómo se paga cada partida' },
  { id: 'e2-ingresos', titulo: 'Salarios y deducciones' },
  { id: 'e2-tarjetas', titulo: 'Tarjetas de crédito' },
  { id: 'e2-recordatorios', titulo: 'Recordatorios en Outlook' },
];

// Partidas que suelen pagarse en partes.
const EN_ABONOS = /s[uú]per|comida|gasolina|combustible|restaurante|mercado|farmacia/i;

export const VistaConfigurar = {
  components: { Icono },
  template: `
  <section class="pila">
    <ol class="pasos" aria-label="Pasos">
      <li v-for="(p, i) in pasos" :key="p.id" :class="{ activo: i === actual, hecho: hecho(p.id) }">
        <button type="button" @click="actual = i">
          <span class="num-circulo" :class="{ fuera: !hecho(p.id) && i !== actual }"><icono v-if="hecho(p.id)" n="check" :t="13" :g="2.6"/><template v-else>{{ i + 1 }}</template></span>
          <span class="paso-nombre">{{ p.titulo }}</span>
        </button>
      </li>
    </ol>

    <article v-if="paso.id === 'e2-respaldo'" class="tarjeta">
      <h2>Qué cambió</h2>
      <ul class="lista-puntos">
        <li>Ya no hay fijos, fijos variables y adicionales: cada partida tiene una categoría, y las categorías se agrupan (Casa, Comida, Transporte…).</li>
        <li>Cualquier partida se puede pagar en abonos: el súper de {{ fmt(6000) }} puede ser {{ fmt(2000) }} hoy y {{ fmt(4000) }} otro día.</li>
        <li>Una partida variable se puede cerrar con menos del monto, y lo que sobra puede pasar al mes siguiente.</li>
        <li>Los salarios pueden ser quincenales, con su día de pago.</li>
        <li v-if="store.sync.ubicacion">En OneDrive los datos quedan en un archivo principal y uno por año. Antes del cambio se guardó una copia en la carpeta respaldos.</li>
        <li v-else>Antes del cambio se guardó en este dispositivo una copia de los datos anteriores.</li>
      </ul>
      <p class="nota" style="margin-top: 12px">Si quieres una copia propia, descárgala ahora.</p>
      <div class="botones">
        <button type="button" class="btn" @click="bajarRespaldo">Descargar respaldo (JSON)</button>
        <button v-if="store.sync.ubicacion" type="button" class="btn" :disabled="ocupado" @click="respaldarEnOneDrive">Guardar respaldo en OneDrive</button>
      </div>
    </article>

    <article v-else-if="paso.id === 'e2-grupos'" class="tarjeta">
      <h2>Así quedaron los grupos</h2>
      <p class="nota" style="margin: 4px 0 12px">Las categorías que ustedes crearon quedaron en Personal. Puedes moverlas, renombrar grupos o cambiar su orden.</p>
      <ul class="lista">
        <li v-for="g in listaGrupos" :key="g.grupo.id" class="fila compacta">
          <div class="fila-info">
            <span style="font-size: 0.93rem; font-weight: 600">{{ g.grupo.nombre }}</span>
            <span class="fila-sub envuelve">{{ g.categorias.map((c) => c.nombre).join(', ') || 'sin categorías' }}</span>
          </div>
        </li>
      </ul>
      <a class="btn" href="#/categorias" style="margin-top: 14px">Editar grupos y categorías</a>
    </article>

    <article v-else-if="paso.id === 'e2-partidas'" class="tarjeta">
      <h2>Cómo se paga cada partida</h2>
      <p class="nota" style="margin: 4px 0 6px">Monto fijo: se registra con un toque. Variable: se escribe el monto real y se puede cerrar con menos. En abonos: se paga en partes.</p>
      <ul class="lista">
        <li v-for="p in listaPartidas" :key="p.id" class="fila" style="flex-wrap: wrap">
          <div class="fila-info" style="min-width: 150px">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ p.nombre }}</span>
            <span class="fila-sub">{{ nombrePersona(p.responsableId) }} · {{ fmt(p.monto) }}<template v-if="sugerida(p)"> · se sugiere en abonos</template></span>
          </div>
          <div class="segmentos" role="group" :aria-label="'Cómo se paga ' + p.nombre" style="flex: 1 1 260px">
            <button v-for="(n, k) in formas" :key="k" type="button" :class="{ activo: p.forma === k }" :aria-pressed="p.forma === k" @click="cambiar(p, { forma: k })">{{ n }}</button>
          </div>
          <label class="casilla" style="flex-basis: 100%"><input type="checkbox" :checked="p.acumula" @change="cambiar(p, { acumula: $event.target.checked, acumulaDesde: $event.target.checked ? store.periodo : null })"> Lo que sobre pasa al mes siguiente</label>
        </li>
      </ul>
      <p v-if="!listaPartidas.length" class="vacio">No hay partidas de gasto.</p>
    </article>

    <article v-else-if="paso.id === 'e2-recordatorios'" class="tarjeta">
      <h2>Recordatorios en Outlook</h2>
      <ul class="lista-puntos">
        <li>La app puede poner en tu calendario de Outlook lo que vence en los próximos 60 días, con alarma: partidas con día, cuotas y pagos de tarjeta.</li>
        <li>Cada persona los activa en su celular, con su cuenta de Microsoft. Los eventos no llevan montos y se borran solos al registrar el pago.</li>
        <li>Con "Probar la alarma" se comprueba que suena en el celular.</li>
      </ul>
      <a class="btn" href="#/recordatorios" style="margin-top: 14px">Configurar recordatorios</a>
    </article>

    <article v-else-if="paso.id === 'e2-tarjetas'" class="tarjeta">
      <h2>Tarjetas de crédito</h2>
      <ul class="lista-puntos">
        <li>Cada tarjeta tiene su día de corte y su fecha límite: la app avisa 3 días antes y si queda algo sin pagar.</li>
        <li>Una compra con tarjeta es gasto en el mes de la compra; el pago de la tarjeta es el dinero que sale de la cuenta, en su fecha.</li>
        <li>Las compras en dólares se ven en dólares. En lempiras cuentan con la tasa del día en que se pagan, empezando por las más antiguas.</li>
        <li>La membresía y los seguros se suman solos en cada corte.</li>
        <li>Una compra a cuotas cuenta una cuota por mes, con sus intereses y comisión. El intrafinanciamiento usa el límite de la tarjeta; el extrafinanciamiento, no.</li>
      </ul>
      <ul v-if="listaTarjetas.length" class="lista" style="margin-top: 12px">
        <li v-for="c in listaTarjetas" :key="c.id" class="fila clic" @click="editarTarjeta(c)">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ c.nombre }}</span>
            <span class="fila-sub">{{ nombrePersona(c.titularId) }} · corte el {{ c.tarjeta?.diaCorte }} · pago hasta el {{ c.tarjeta?.diaPago }}</span>
          </div>
          <span class="btn-link">Editar</span>
        </li>
      </ul>
      <p v-else class="nota" style="margin-top: 12px">Todavía no hay tarjetas. Si usan alguna, agréguenla con lo que se debe hoy.</p>
      <div class="botones">
        <button type="button" class="btn" @click="editarTarjeta({})">Agregar tarjeta</button>
        <a v-if="listaTarjetas.length" class="btn" href="#/tarjetas">Ver tarjetas</a>
      </div>
    </article>

    <article v-else class="tarjeta">
      <h2>Salarios y deducciones</h2>
      <p class="nota" style="margin: 4px 0 6px">Si les pagan por quincena, cámbienlo aquí para que Mes muestre cada pago. En Salarios y deducciones agreguen el IHSS, el ISR y los préstamos que se descuentan por planilla: esos préstamos quedan pagados al registrar la quincena.</p>
      <ul class="lista">
        <li v-for="i in listaIngresos" :key="i.id" class="fila clic" @click="editarIngreso(i)">
          <div class="fila-info">
            <span class="fila-titulo" style="font-size: 0.93rem">{{ i.nombre }}</span>
            <span class="fila-sub">{{ nombrePersona(i.personaId) }} · {{ frecuencias[i.frecuencia] || 'Mensual' }} · {{ i.netoEsperado ? fmt(i.netoEsperado) + (i.frecuencia === 'quincenal' ? ' por quincena' : ' al mes') : 'sin monto' }}</span>
          </div>
          <span class="btn-link">Editar</span>
        </li>
      </ul>
      <p v-if="!listaIngresos.length" class="vacio">No hay salarios todavía.</p>
      <a class="btn" href="#/salarios" style="margin-top: 12px">Salarios y deducciones</a>
    </article>

    <div class="acciones">
      <button v-if="actual > 0" type="button" class="btn" @click="actual--">Anterior</button>
      <span class="espacio"></span>
      <button type="button" class="btn primario" @click="completar">{{ actual < pasos.length - 1 ? 'Listo, siguiente' : 'Terminar' }}</button>
    </div>
  </section>`,
  setup() {
    const completados = computed(() => store.doc.config.asistente?.completados || []);
    const hecho = (id) => completados.value.includes(id);
    const primeroPendiente = PASOS_ASISTENTE.findIndex((p) => !completados.value.includes(p.id));
    const actual = ref(primeroPendiente < 0 ? 0 : primeroPendiente);
    const paso = computed(() => PASOS_ASISTENTE[actual.value]);
    // En el celular la fila de pasos se desplaza: el paso elegido queda a la vista.
    watch(actual, () => nextTick(() => document.querySelector('.pasos li.activo')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })));
    const ocupado = ref(false);

    function completar() {
      const id = paso.value.id;
      if (!hecho(id)) guardarConfig({ asistente: { ...(store.doc.config.asistente || {}), completados: [...completados.value, id] } });
      if (actual.value < PASOS_ASISTENTE.length - 1) {
        actual.value++;
        window.scrollTo(0, 0);
      } else {
        aviso('Configuración revisada.', 'ok');
        location.hash = '#/inicio';
      }
    }
    const cambiar = (p, cambios) => guardar('partidas', { ...p, ...cambios });
    async function respaldarEnOneDrive() {
      ocupado.value = true;
      try {
        const nombre = await respaldarAhora();
        aviso(`Respaldo guardado: respaldos/${nombre}`, 'ok', 6000);
      } catch (e) {
        aviso(e.message, 'error', 8000);
      } finally {
        ocupado.value = false;
      }
    }

    return {
      store, pasos: PASOS_ASISTENTE, actual, paso, hecho, completar, cambiar, ocupado, respaldarEnOneDrive, fmt, nombrePersona,
      formas: FORMAS, frecuencias: FRECUENCIAS, editarIngreso, editarTarjeta, listaTarjetas: computed(tarjetas),
      sugerida: (p) => p.forma !== 'abonos' && EN_ABONOS.test(p.nombre),
      bajarRespaldo: () => descargar(`gastos-respaldo-${hoy()}.json`, exportar(), 'application/json'),
      listaGrupos: computed(() => grupos().map((grupo) => ({ grupo, categorias: categorias().filter((c) => c.grupoId === grupo.id) }))),
      listaPartidas: computed(() => vivos('partidas').filter((p) => p.tipo === 'gasto' && p.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre))),
      listaIngresos: computed(() => vivos('ingresos')),
    };
  },
};
