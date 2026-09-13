import { guardar, grupos, categorias, indice } from '../store.js';
import { colorGrupo } from '../core/reportes.js';
import { Icono } from './componentes.js';
import { editarCategoria, editarGrupo } from './formularios.js';

const { computed } = Vue;

export const VistaCategorias = {
  components: { Icono },
  template: `
  <section class="pila">
    <p class="nota">Cada categoría pertenece a un grupo. Los gráficos muestran los gastos por grupo, y los cinco primeros tienen color propio: usa las flechas para elegirlos.</p>

    <article v-for="(g, i) in lista" :key="g.grupo.id" class="tarjeta">
      <div class="tarjeta-cab centro pegada">
        <h2 class="titulo-grupo" style="flex: 1; min-width: 0"><i class="punto" :style="{ background: colorGrupo(ix, g.grupo.id) }"></i> {{ g.grupo.nombre }}</h2>
        <button type="button" class="btn-icono" :disabled="i === 0" :aria-label="'Subir ' + g.grupo.nombre" @click="mover(i, -1)"><icono n="arriba" :t="16"/></button>
        <button type="button" class="btn-icono" :disabled="i === lista.length - 1" :aria-label="'Bajar ' + g.grupo.nombre" @click="mover(i, 1)"><icono n="abajo" :t="16"/></button>
        <button type="button" class="btn-link" @click="editarGrupo(g.grupo)">Editar</button>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px">
        <button v-for="c in g.categorias" :key="c.id" type="button" class="chip clic" style="border: 0" @click="editarCategoria(c)">
          {{ c.nombre }}<template v-if="c.tipo === 'ingreso'"> · ingreso</template>
        </button>
        <span v-if="!g.categorias.length" class="nota chica">Sin categorías.</span>
      </div>
      <button type="button" class="btn-punteado" style="margin-top: 14px" @click="editarCategoria({ grupoId: g.grupo.id, tipo: g.grupo.id === 'ingresos' ? 'ingreso' : 'gasto' })">+ Agregar categoría</button>
    </article>

    <article v-if="sueltas.length" class="tarjeta">
      <h2 class="titulo-grupo">Sin grupo</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px">
        <button v-for="c in sueltas" :key="c.id" type="button" class="chip clic" style="border: 0" @click="editarCategoria(c)">{{ c.nombre }}</button>
      </div>
    </article>

    <button type="button" class="btn-punteado" @click="editarGrupo()">+ Nuevo grupo</button>
  </section>`,
  setup() {
    const ix = computed(indice);
    const lista = computed(() => grupos().map((grupo) => ({ grupo, categorias: categorias().filter((c) => c.grupoId === grupo.id) })));
    const sueltas = computed(() => categorias().filter((c) => !grupos().some((g) => g.id === c.grupoId)));

    // Cambia el orden y guarda solo los grupos cuyo número cambió.
    function mover(i, delta) {
      const orden = grupos();
      const j = i + delta;
      if (j < 0 || j >= orden.length) return;
      [orden[i], orden[j]] = [orden[j], orden[i]];
      orden.forEach((g, k) => {
        if (Number(g.orden) !== k + 1) guardar('grupos', { ...g, orden: k + 1 });
      });
    }

    return { ix, lista, sueltas, mover, colorGrupo, editarCategoria, editarGrupo };
  },
};
