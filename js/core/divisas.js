// Dólares en la tarjeta: cada compra en US$ se convierte a lempiras con la tasa de los pagos
// que la cubren, aplicados de la compra más antigua a la más nueva (Decreto 34-2025). Lo que
// todavía no se paga se estima con la última tasa usada.

const porFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);

/**
 * @param cargos [{ clave, fecha, usd }] montos en centavos de dólar.
 * @param pagos  [{ fecha, usd, tasa }] lo pagado en dólares y la tasa de ese día.
 * @param tasaEstimada tasa para lo que no se ha pagado.
 * @returns Map clave → { c (centavos de lempira), estimado, pendienteUSD }.
 */
export function asignarTasas(cargos, pagos, tasaEstimada = 0) {
  // El mismo día, primero la compra y después el pago.
  const eventos = [
    ...cargos.map((c) => ({ ...c, esCargo: true })),
    ...pagos.map((p) => ({ ...p, esCargo: false })),
  ].sort((a, b) => porFecha(a, b) || (a.esCargo === b.esCargo ? 0 : a.esCargo ? -1 : 1));

  const abiertos = []; // cargos con saldo, del más antiguo al más nuevo
  const aFavor = []; // lo pagado de más, con su tasa: cubre las compras siguientes
  const resultado = new Map();

  for (const e of eventos) {
    if (e.esCargo) {
      const cargo = { clave: e.clave, pendiente: Math.max(0, e.usd), lempiras: 0 };
      while (cargo.pendiente > 0 && aFavor.length) {
        const credito = aFavor[0];
        const toma = Math.min(credito.usd, cargo.pendiente);
        cargo.pendiente -= toma;
        cargo.lempiras += toma * credito.tasa;
        credito.usd -= toma;
        if (!credito.usd) aFavor.shift();
      }
      abiertos.push(cargo);
      resultado.set(cargo.clave, cargo);
      continue;
    }
    let resto = Math.max(0, e.usd);
    for (const cargo of abiertos) {
      if (!resto) break;
      if (!cargo.pendiente) continue;
      const toma = Math.min(cargo.pendiente, resto);
      cargo.pendiente -= toma;
      cargo.lempiras += toma * e.tasa;
      resto -= toma;
    }
    if (resto > 0) aFavor.push({ usd: resto, tasa: e.tasa });
  }

  return new Map([...resultado].map(([clave, c]) => [clave, {
    c: Math.round(c.lempiras + c.pendiente * tasaEstimada),
    estimado: c.pendiente > 0,
    pendienteUSD: c.pendiente,
  }]));
}
