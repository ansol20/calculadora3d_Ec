/**
 * Motor de cálculo de costos de impresión 3D para Ecuador.
 *
 * Funciones puras, sin DOM: se usan igual desde el navegador que desde
 * `node --test`. Todos los valores monetarios están en USD (moneda del país)
 * y el IVA por defecto es el vigente en Ecuador desde abril de 2024: 15 %.
 */

export const IVA_EC = 15;

/**
 * Precios referenciales de bobina de 1 kg puestos en Ecuador (USD, 2025).
 * Son un punto de partida editable: el precio real depende del proveedor,
 * del importador y de si compras por unidad o por caja.
 */
export const MATERIALES = [
  { nombre: 'PLA',        precioBobina: 22, pesoBobina: 1000, densidad: 1.24 },
  { nombre: 'PLA Matte',  precioBobina: 25, pesoBobina: 1000, densidad: 1.22 },
  { nombre: 'PLA Silk',   precioBobina: 26, pesoBobina: 1000, densidad: 1.24 },
  { nombre: 'PETG',       precioBobina: 26, pesoBobina: 1000, densidad: 1.27 },
  { nombre: 'ABS',        precioBobina: 24, pesoBobina: 1000, densidad: 1.04 },
  { nombre: 'ASA',        precioBobina: 34, pesoBobina: 1000, densidad: 1.07 },
  { nombre: 'TPU 95A',    precioBobina: 32, pesoBobina: 1000, densidad: 1.21 },
  { nombre: 'Nylon PA',   precioBobina: 45, pesoBobina: 1000, densidad: 1.14 },
  { nombre: 'PLA-CF',     precioBobina: 45, pesoBobina: 1000, densidad: 1.30 },
  { nombre: 'PETG-CF',    precioBobina: 48, pesoBobina: 1000, densidad: 1.30 },
  { nombre: 'Resina 405nm', precioBobina: 45, pesoBobina: 1000, densidad: 1.10 },
];

/** Retenciones del SRI que aplica un cliente que es agente de retención. */
export const RETENCIONES = {
  renta: [
    { etiqueta: 'No aplica', valor: 0 },
    { etiqueta: '1 % — venta de bienes', valor: 1 },
    { etiqueta: '1.75 % — régimen general', valor: 1.75 },
    { etiqueta: '2 % — prestación de servicios', valor: 2 },
  ],
  iva: [
    { etiqueta: 'No aplica', valor: 0 },
    { etiqueta: '30 % del IVA — bienes', valor: 30 },
    { etiqueta: '70 % del IVA — servicios', valor: 70 },
    { etiqueta: '100 % del IVA', valor: 100 },
  ],
};

/**
 * Arquetipos de impresora con su consumo medio aproximado. No son fichas
 * técnicas: son órdenes de magnitud medidos en máquinas parecidas para que
 * tengas de dónde partir mientras consigues un medidor de consumo.
 */
export const TIPOS_IMPRESORA = [
  { etiqueta: 'FDM abierta 220×220 (Ender, Kobra)', potenciaW: 110 },
  { etiqueta: 'FDM rápida CoreXY 250×250 (K1, A1, P1S)', potenciaW: 140 },
  { etiqueta: 'FDM con cámara calefactada (K2, X1C)', potenciaW: 200 },
  { etiqueta: 'FDM de formato grande 350×350', potenciaW: 250 },
  { etiqueta: 'Resina LCD', potenciaW: 55 },
];

/** Comisiones referenciales de los medios de cobro más usados en Ecuador. */
export const MEDIOS_COBRO = [
  { etiqueta: 'Efectivo o transferencia', valor: 0 },
  { etiqueta: 'DeUna / Peigo (QR)', valor: 0 },
  { etiqueta: 'PayPhone', valor: 4.5 },
  { etiqueta: 'Datafast / tarjeta corriente', valor: 5.5 },
  { etiqueta: 'Tarjeta diferido 3 meses', valor: 7.5 },
];

export const VALORES_INICIALES = {
  materiales: [{ nombre: 'PLA', precioBobina: 22, pesoBobina: 1000, gramos: 45 }],
  desperdicioPct: 5,
  horas: 4,
  minutos: 30,
  cantidad: 1,
  modeloImpresora: '',
  potenciaW: 120,
  tarifaKwh: 0.10,
  precioImpresora: 480,
  vidaUtilH: 6000,
  mantenimientoPctAnual: 8,
  horasAnuales: 1200,
  consumiblesHora: 0.05,
  prepMin: 10,
  postMin: 15,
  tarifaManoObra: 6,
  disenoMin: 0,
  tarifaDiseno: 12,
  fallosPct: 8,
  empaqueUnit: 0.35,
  envio: 0,
  margenPct: 45,
  comisionPct: 0,
  cobraIva: true,
  ivaPct: IVA_EC,
  retRentaPct: 0,
  retIvaPct: 0,
};

/** Convierte cualquier entrada del formulario a número (acepta coma decimal). */
export function num(valor, porDefecto = 0) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : porDefecto;
  const n = parseFloat(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : porDefecto;
}

const noNeg = (valor, porDefecto = 0) => Math.max(0, num(valor, porDefecto));

/** Costo por hora de tener la máquina encendida: depreciación + mantenimiento. */
export function costoHoraMaquina(e) {
  const precio = noNeg(e.precioImpresora);
  const vida = noNeg(e.vidaUtilH);
  const horasAnio = noNeg(e.horasAnuales);
  const depreciacion = vida > 0 ? precio / vida : 0;
  const mantenimiento = horasAnio > 0 ? (precio * noNeg(e.mantenimientoPctAnual) / 100) / horasAnio : 0;
  return depreciacion + mantenimiento;
}

/** Gramos y costo del filamento, sumando todas las bobinas usadas. */
export function costoMaterial(materiales = [], desperdicioPct = 0) {
  const merma = 1 + noNeg(desperdicioPct) / 100;
  let gramos = 0;
  let costo = 0;
  const detalle = [];
  for (const m of materiales) {
    const g = noNeg(m.gramos) * merma;
    const peso = noNeg(m.pesoBobina);
    const precioGramo = peso > 0 ? noNeg(m.precioBobina) / peso : 0;
    gramos += g;
    costo += g * precioGramo;
    detalle.push({ nombre: m.nombre || 'Filamento', gramos: g, precioGramo, costo: g * precioGramo });
  }
  return { gramos, costo, detalle };
}

/**
 * Cálculo completo de una cotización.
 * @param {object} entrada valores del formulario (ver VALORES_INICIALES)
 */
export function calcular(entrada) {
  const e = { ...VALORES_INICIALES, ...entrada };

  const tiempoH = noNeg(e.horas) + noNeg(e.minutos) / 60;
  const cantidad = Math.max(1, Math.round(noNeg(e.cantidad, 1)));

  // --- Costos directos por unidad -----------------------------------------
  const material = costoMaterial(e.materiales, e.desperdicioPct);
  const kwh = (noNeg(e.potenciaW) / 1000) * tiempoH;
  const energia = kwh * noNeg(e.tarifaKwh);
  const horaMaquina = costoHoraMaquina(e);
  const maquina = horaMaquina * tiempoH;
  const consumibles = noNeg(e.consumiblesHora) * tiempoH;
  const manoObra = ((noNeg(e.prepMin) + noNeg(e.postMin)) / 60) * noNeg(e.tarifaManoObra);

  const produccion = material.costo + energia + maquina + consumibles + manoObra;

  // Tasa de fallos: si p de cada impresión se pierde, el costo esperado de
  // entregar una pieza buena es costo / (1 - p). Se limita a 60 % para no
  // dividir por cero cuando alguien escribe 100.
  const p = Math.min(0.6, noNeg(e.fallosPct) / 100);
  const riesgo = produccion / (1 - p) - produccion;

  const empaque = noNeg(e.empaqueUnit);
  const costoUnitario = produccion + riesgo + empaque;

  // --- Pedido completo ------------------------------------------------------
  const diseno = (noNeg(e.disenoMin) / 60) * noNeg(e.tarifaDiseno);
  const costoTotal = costoUnitario * cantidad + diseno;

  const margenPct = noNeg(e.margenPct);
  const utilidadBruta = costoTotal * (margenPct / 100);
  const envio = noNeg(e.envio);

  // El envío se traslada al cliente sin margen; la comisión de la pasarela se
  // suma "por dentro" para que el margen no se lo coma el medio de cobro.
  const antesComision = costoTotal + utilidadBruta + envio;
  const comPct = Math.min(0.5, noNeg(e.comisionPct) / 100);
  const precioSinIva = comPct > 0 ? antesComision / (1 - comPct) : antesComision;
  const comision = precioSinIva - antesComision;

  const ivaPct = e.cobraIva === false ? 0 : noNeg(e.ivaPct);
  const iva = precioSinIva * (ivaPct / 100);
  const total = precioSinIva + iva;

  const utilidad = precioSinIva - comision - envio - costoTotal;

  // --- Retenciones del SRI (cuando factura a un agente de retención) --------
  const retRenta = precioSinIva * (noNeg(e.retRentaPct) / 100);
  const retIva = iva * (noNeg(e.retIvaPct) / 100);
  const aRecibir = total - retRenta - retIva;

  const desglose = [
    { clave: 'material', etiqueta: 'Filamento', valor: material.costo * cantidad },
    { clave: 'energia', etiqueta: 'Electricidad', valor: energia * cantidad },
    { clave: 'maquina', etiqueta: 'Máquina', valor: maquina * cantidad },
    { clave: 'consumibles', etiqueta: 'Consumibles', valor: consumibles * cantidad },
    { clave: 'manoObra', etiqueta: 'Mano de obra', valor: manoObra * cantidad },
    { clave: 'riesgo', etiqueta: 'Fallos', valor: riesgo * cantidad },
    { clave: 'empaque', etiqueta: 'Empaque', valor: empaque * cantidad },
    { clave: 'diseno', etiqueta: 'Diseño', valor: diseno },
    { clave: 'envio', etiqueta: 'Envío', valor: envio },
    { clave: 'comision', etiqueta: 'Comisión de cobro', valor: comision },
    { clave: 'utilidad', etiqueta: 'Utilidad', valor: utilidad },
  ].filter((d) => d.valor > 0.0001);

  return {
    tiempoH,
    cantidad,
    kwh: kwh * cantidad,
    gramos: material.gramos,
    gramosTotales: material.gramos * cantidad,
    horaMaquina,
    unidad: {
      material: material.costo,
      detalleMaterial: material.detalle,
      energia,
      maquina,
      consumibles,
      manoObra,
      riesgo,
      empaque,
      costo: costoUnitario,
    },
    pedido: {
      produccion: costoUnitario * cantidad,
      diseno,
      costoTotal,
      utilidadBruta,
      envio,
      comision,
      precioSinIva,
      ivaPct,
      iva,
      total,
      utilidad,
    },
    fiscal: { retRenta, retIva, aRecibir },
    metricas: {
      costoPorGramo: material.gramos > 0 ? costoUnitario / material.gramos : 0,
      precioUnitario: cantidad > 0 ? precioSinIva / cantidad : 0,
      precioUnitarioConIva: cantidad > 0 ? total / cantidad : 0,
      margenReal: precioSinIva > 0 ? (utilidad / precioSinIva) * 100 : 0,
      ingresoPorHora: tiempoH > 0 ? precioSinIva / (tiempoH * cantidad) : 0,
      utilidadPorHora: tiempoH > 0 ? utilidad / (tiempoH * cantidad) : 0,
      puntoEquilibrio: costoTotal + envio,
    },
    desglose,
  };
}

/** "4 h 30 min" a partir de horas decimales. */
export function formatoDuracion(horasDecimales) {
  const total = Math.round(noNeg(horasDecimales) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
