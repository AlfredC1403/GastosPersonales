import { store, personas, soyYo, definirYo, colorPersona } from '../store.js';
import { editarPersona } from './formularios.js';

const { computed } = Vue;

export const VistaPersonas = {
  template: `
  <section class="pila">
    <article class="tarjeta">
      <h2>Quién usa este dispositivo</h2>
      <p class="nota" style="margin: 3px 0 12px">Tus registros quedan firmados con este nombre. Es distinto del filtro de persona de la cabecera, que solo cambia lo que ves.</p>
      <div class="opciones">
        <button v-for="p in listaPersonas" :key="p.id" type="button" class="opcion" :class="{ activa: store.yo === p.id }" :aria-pressed="store.yo === p.id" @click="elegirYo(p.id)">{{ p.nombre }}</button>
      </div>
      <p v-if="store.usuario" class="nota chica" style="margin-top: 10px">Cuenta de Microsoft en este dispositivo: {{ store.usuario.nombre }} ({{ store.usuario.email }})</p>
    </article>

    <article class="tarjeta">
      <h2>Personas del hogar</h2>
      <ul class="lista" style="margin-top: 8px">
        <li v-for="p in listaPersonas" :key="p.id" class="fila clic" @click="editarPersona(p)">
          <span class="avatar" :style="{ background: colorPersona(p.id), color: '#fff' }">{{ p.nombre.slice(0, 1).toUpperCase() }}</span>
          <div class="fila-info">
            <span style="font-size: 0.93rem">{{ p.nombre }}</span>
            <span class="fila-sub">{{ p.email || 'sin correo de Microsoft' }}</span>
          </div>
        </li>
      </ul>
      <p v-if="!listaPersonas.length" class="vacio">Todavía no hay personas. Agrégalas para firmar los registros y filtrar por persona.</p>
      <button type="button" class="btn-punteado" style="margin-top: 14px" @click="editarPersona()">+ Agregar persona</button>
    </article>
  </section>`,
  setup() {
    return {
      store, colorPersona, editarPersona,
      listaPersonas: computed(personas),
      elegirYo: (id) => (store.usuario ? soyYo(id) : definirYo(id)),
    };
  },
};
