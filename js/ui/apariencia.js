import { prefs, definirTema, definirPendientes } from '../tema.js';

export const VistaApariencia = {
  template: `
  <section class="pila">
    <article class="tarjeta">
      <h2>Tema</h2>
      <p class="nota" style="margin: 3px 0 12px">Se guarda solo en este dispositivo.</p>
      <div class="segmentos" role="group" aria-label="Tema">
        <button v-for="o in temas" :key="o.id" type="button" :class="{ activo: (prefs.tema || 'sistema') === o.id }"
                :aria-pressed="(prefs.tema || 'sistema') === o.id" @click="definirTema(o.id === 'sistema' ? null : o.id)">{{ o.nombre }}</button>
      </div>
    </article>

    <article class="tarjeta">
      <div class="fila" style="border-top: 0; padding-top: 0">
        <div class="fila-info">
          <span style="font-size: 0.95rem; font-weight: 600">Pendientes por día</span>
          <span class="fila-sub envuelve">En Inicio, agrupa los pendientes del mes como una agenda.</span>
        </div>
        <button type="button" class="interruptor" :class="{ on: prefs.pendientes === 'agenda' }" role="switch" :aria-checked="prefs.pendientes === 'agenda'"
                aria-label="Pendientes por día" @click="definirPendientes(prefs.pendientes === 'agenda' ? 'lista' : 'agenda')"><span></span></button>
      </div>
    </article>
  </section>`,
  setup() {
    const temas = [
      { id: 'sistema', nombre: 'Como el sistema' },
      { id: 'claro', nombre: 'Claro' },
      { id: 'oscuro', nombre: 'Oscuro' },
    ];
    return { prefs, temas, definirTema, definirPendientes };
  },
};
