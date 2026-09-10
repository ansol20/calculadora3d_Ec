import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcular, costoHoraMaquina, costoMaterial, cuantoSumaria, formatoDuracion, num, precioConMargen, VALORES_INICIALES,
} from '../assets/calc.js';

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

/** Escenario mínimo para aislar la parte que se está probando. */
const base = {
  ...VALORES_INICIALES,
  materiales: [{ nombre: 'PLA', precioBobina: 20, pesoBobina: 1000, gramos: 100 }],
  desperdicioPct: 0, horas: 5, minutos: 0, cantidad: 1,
  potenciaW: 200, tarifaKwh: 0.10,
  precioImpresora: 500, vidaUtilH: 5000, mantenimientoPctAnual: 10, horasAnuales: 1000,
  consumiblesHora: 0, prepMin: 0, postMin: 0, tarifaManoObra: 0,
  disenoMin: 0, fallosPct: 0, empaqueUnit: 0, envio: 0,
  margenPct: 0, comisionPct: 0, cobraIva: false,
  retRentaPct: 0, retIvaPct: 0,
  // Las pruebas de fórmulas necesitan todas las partidas activas; el
  // comportamiento apagado se prueba aparte, más abajo.
  usaMaquina: true, usaTaller: true, usaExtras: true, usaSri: true,
};

test('num acepta coma decimal y descarta basura', () => {
  cerca(num('1,5'), 1.5);
  cerca(num('2.25'), 2.25);
  cerca(num('abc', 7), 7);
  cerca(num(''), 0);
});

test('el filamento se cobra por gramo real', () => {
  const r = costoMaterial([{ precioBobina: 20, pesoBobina: 1000, gramos: 100 }], 0);
  cerca(r.costo, 2);
  cerca(r.gramos, 100);
});

test('el desperdicio aumenta gramos y costo', () => {
  const r = costoMaterial([{ precioBobina: 20, pesoBobina: 1000, gramos: 100 }], 10);
  cerca(r.gramos, 110);
  cerca(r.costo, 2.2);
});

test('suma varias bobinas con precios distintos', () => {
  const r = costoMaterial([
    { precioBobina: 20, pesoBobina: 1000, gramos: 100 },
    { precioBobina: 30, pesoBobina: 750, gramos: 75 },
  ], 0);
  cerca(r.costo, 2 + 3);
  cerca(r.gramos, 175);
});

test('la hora de máquina suma depreciación y mantenimiento', () => {
  cerca(costoHoraMaquina(base), 500 / 5000 + (500 * 0.10) / 1000);
});

test('la luz sale de vatios, horas y tarifa', () => {
  const r = calcular(base);
  cerca(r.kwh, 1);
  cerca(r.unidad.energia, 0.10);
});

test('el costo unitario suma todas las partidas', () => {
  const r = calcular({ ...base, consumiblesHora: 0.05, prepMin: 30, tarifaManoObra: 6 });
  const esperado = 2 + 0.10 + 0.15 * 5 + 0.05 * 5 + 3;
  cerca(r.unidad.costo, esperado);
});

test('la tasa de fallos reparte el costo de reimprimir', () => {
  const r = calcular({ ...base, fallosPct: 20 });
  const produccion = 2 + 0.10 + 0.75;
  cerca(r.unidad.costo, produccion / 0.8);
});

test('un 100 % de fallos no rompe el cálculo', () => {
  const r = calcular({ ...base, fallosPct: 100 });
  assert.ok(Number.isFinite(r.unidad.costo));
  assert.ok(r.unidad.costo > 0);
});

test('el margen se aplica sobre el costo del pedido', () => {
  const r = calcular({ ...base, margenPct: 50 });
  cerca(r.pedido.precioSinIva, r.pedido.costoTotal * 1.5);
  cerca(r.pedido.utilidad, r.pedido.costoTotal * 0.5);
});

test('el diseño se cobra una vez, no por pieza', () => {
  const uno = calcular({ ...base, cantidad: 1, disenoMin: 60, tarifaDiseno: 12 });
  const cuatro = calcular({ ...base, cantidad: 4, disenoMin: 60, tarifaDiseno: 12 });
  cerca(uno.pedido.diseno, 12);
  cerca(cuatro.pedido.diseno, 12);
  cerca(cuatro.pedido.costoTotal, uno.unidad.costo * 4 + 12);
});

test('el envío se traslada sin margen', () => {
  const sin = calcular({ ...base, margenPct: 40 });
  const con = calcular({ ...base, margenPct: 40, envio: 5 });
  cerca(con.pedido.precioSinIva - sin.pedido.precioSinIva, 5);
  cerca(con.pedido.utilidad, sin.pedido.utilidad);
});

test('la comisión de la pasarela no se come el margen', () => {
  const r = calcular({ ...base, margenPct: 40, comisionPct: 5 });
  cerca(r.pedido.precioSinIva * 0.05, r.pedido.comision, 1e-9);
  cerca(r.pedido.utilidad, r.pedido.costoTotal * 0.4, 1e-9);
});

test('el IVA del 15 % se suma al final y se puede apagar', () => {
  const con = calcular({ ...base, cobraIva: true, ivaPct: 15 });
  cerca(con.pedido.iva, con.pedido.precioSinIva * 0.15);
  cerca(con.pedido.total, con.pedido.precioSinIva * 1.15);

  const sin = calcular({ ...base, cobraIva: false });
  cerca(sin.pedido.iva, 0);
  cerca(sin.pedido.total, sin.pedido.precioSinIva);
});

test('las retenciones del SRI reducen lo que llega al banco, no la utilidad', () => {
  const r = calcular({ ...base, margenPct: 40, cobraIva: true, ivaPct: 15, retRentaPct: 1, retIvaPct: 70 });
  cerca(r.fiscal.retRenta, r.pedido.precioSinIva * 0.01);
  cerca(r.fiscal.retIva, r.pedido.iva * 0.70);
  cerca(r.fiscal.aRecibir, r.pedido.total - r.fiscal.retRenta - r.fiscal.retIva);
  cerca(r.pedido.utilidad, r.pedido.costoTotal * 0.4, 1e-9);
});

test('el desglose suma exactamente el precio sin IVA', () => {
  const r = calcular({
    ...base, cantidad: 3, margenPct: 45, comisionPct: 4.5, envio: 5,
    disenoMin: 45, tarifaDiseno: 15, empaqueUnit: 0.4, fallosPct: 8,
    consumiblesHora: 0.05, prepMin: 10, postMin: 20, tarifaManoObra: 6,
    desperdicioPct: 5, cobraIva: true,
  });
  const suma = r.desglose.reduce((s, d) => s + d.valor, 0);
  cerca(suma, r.pedido.precioSinIva, 1e-9);
});

test('las métricas por pieza y por hora son coherentes', () => {
  const r = calcular({ ...base, cantidad: 2, margenPct: 50, cobraIva: true, ivaPct: 15 });
  cerca(r.metricas.precioUnitario, r.pedido.precioSinIva / 2);
  cerca(r.metricas.precioUnitarioConIva, r.pedido.total / 2);
  cerca(r.metricas.ingresoPorHora, r.pedido.precioSinIva / 10);
  cerca(r.metricas.costoPorGramo, r.unidad.costo / 100);
});

test('valores vacíos o negativos no producen NaN', () => {
  const r = calcular({
    materiales: [{ nombre: '', precioBobina: '', pesoBobina: '', gramos: '' }],
    horas: '', minutos: '', potenciaW: -50, tarifaKwh: 'x', vidaUtilH: 0, horasAnuales: 0, cantidad: 0,
  });
  for (const v of [r.unidad.costo, r.pedido.total, r.pedido.utilidad, r.metricas.costoPorGramo]) {
    assert.ok(Number.isFinite(v), `valor no finito: ${v}`);
  }
  assert.equal(r.cantidad, 1);
});

test('formatoDuracion redondea a minutos', () => {
  assert.equal(formatoDuracion(4.5), '4 h 30 min');
  assert.equal(formatoDuracion(2), '2 h');
  assert.equal(formatoDuracion(0.25), '15 min');
});

test('el margen también se puede fijar como monto en dólares', () => {
  const r = calcular({ ...base, margenModo: 'monto', margenMonto: 5 });
  cerca(r.pedido.utilidad, 5);
  cerca(r.pedido.precioSinIva, r.pedido.costoTotal + 5);
});

test('el margen en monto ignora el porcentaje', () => {
  const a = calcular({ ...base, margenModo: 'monto', margenMonto: 3, margenPct: 90 });
  const b = calcular({ ...base, margenModo: 'monto', margenMonto: 3, margenPct: 10 });
  cerca(a.pedido.total, b.pedido.total);
});

test('precioConMargen no altera la entrada original', () => {
  const entrada = { ...base, margenPct: 40, cobraIva: true, ivaPct: 15 };
  const copia = JSON.stringify(entrada);
  const p60 = precioConMargen(entrada, 60);
  const p20 = precioConMargen(entrada, 20);
  assert.equal(JSON.stringify(entrada), copia);
  assert.ok(p60 > p20);
  cerca(p60, calcular({ ...entrada, margenPct: 60 }).pedido.total);
});

/* ── Básico contra avanzado ──────────────────────────────────────────────
   Las secciones avanzadas arrancan apagadas: lo que no se ve, no se cobra. */

const basico = {
  ...base,
  usaMaquina: false, usaTaller: false, usaExtras: false, usaSri: false,
  consumiblesHora: 0.05, prepMin: 30, postMin: 30, tarifaManoObra: 6,
  disenoMin: 60, tarifaDiseno: 12, fallosPct: 20,
  empaqueUnit: 0.5, envio: 5, comisionPct: 5,
  retRentaPct: 2, retIvaPct: 70, cobraIva: true, ivaPct: 15, margenPct: 0,
};

test('apagado, el costo es solo filamento y luz', () => {
  const r = calcular(basico);
  cerca(r.unidad.costo, 2 + 0.10);
  cerca(r.unidad.maquina, 0);
  cerca(r.unidad.manoObra, 0);
  cerca(r.unidad.riesgo, 0);
  cerca(r.unidad.empaque, 0);
  cerca(r.pedido.diseno, 0);
  cerca(r.pedido.envio, 0);
  cerca(r.pedido.comision, 0);
  cerca(r.fiscal.retRenta, 0);
  cerca(r.fiscal.retIva, 0);
});

test('cada sección suma solo la suya', () => {
  const conMaquina = calcular({ ...basico, usaMaquina: true });
  cerca(conMaquina.unidad.maquina, 0.15 * 5);
  cerca(conMaquina.unidad.consumibles, 0.05 * 5);
  cerca(conMaquina.unidad.manoObra, 0);

  const conTaller = calcular({ ...basico, usaTaller: true });
  cerca(conTaller.unidad.manoObra, 6);
  assert.ok(conTaller.unidad.riesgo > 0);
  cerca(conTaller.pedido.diseno, 12);
  cerca(conTaller.unidad.maquina, 0);

  const conExtras = calcular({ ...basico, usaExtras: true });
  cerca(conExtras.unidad.empaque, 0.5);
  cerca(conExtras.pedido.envio, 5);
  assert.ok(conExtras.pedido.comision > 0);

  const conSri = calcular({ ...basico, usaSri: true, margenPct: 40 });
  assert.ok(conSri.fiscal.retRenta > 0 && conSri.fiscal.retIva > 0);
});

test('encender todo equivale al cálculo completo de siempre', () => {
  const todo = { ...basico, usaMaquina: true, usaTaller: true, usaExtras: true, usaSri: true };
  const r = calcular(todo);
  const produccion = 2 + 0.10 + 0.75 + 0.25 + 6;
  cerca(r.unidad.costo, produccion / 0.8 + 0.5);
});

test('cuantoSumaria dice lo que se está dejando fuera', () => {
  const delta = cuantoSumaria(basico, 'usaTaller');
  const encendido = calcular({ ...basico, usaTaller: true }).pedido.total;
  cerca(delta, encendido - calcular(basico).pedido.total);
  assert.ok(delta > 0);
  cerca(cuantoSumaria({ ...basico, usaTaller: true }, 'usaTaller'), 0);
});
