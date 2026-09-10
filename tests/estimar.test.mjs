import test from 'node:test';
import assert from 'node:assert/strict';
import { estimarGramos } from '../assets/importar.js';

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

/** Cubo macizo de 2 cm: 8 cm³ de volumen y 24 cm² de superficie. */
const cubo = { volumenCm3: 8, superficieCm2: 24, densidad: 1.24 };

test('con paredes de 0.8 mm el cascarón no se pasa del volumen', () => {
  const g = estimarGramos({ ...cubo, rellenoPct: 0, paredes: 2, boquilla: 0.4 });
  cerca(g, 24 * 0.08 * 1.24);            // 1.92 cm³ de cascarón
});

test('más relleno pesa más, y al 100 % es la pieza maciza', () => {
  const vacio = estimarGramos({ ...cubo, rellenoPct: 0 });
  const medio = estimarGramos({ ...cubo, rellenoPct: 50 });
  const macizo = estimarGramos({ ...cubo, rellenoPct: 100 });
  assert.ok(vacio < medio && medio < macizo);
  cerca(macizo, 8 * 1.24);
});

test('más perímetros engordan el cascarón', () => {
  const dos = estimarGramos({ ...cubo, rellenoPct: 10, paredes: 2, boquilla: 0.4 });
  const cuatro = estimarGramos({ ...cubo, rellenoPct: 10, paredes: 4, boquilla: 0.4 });
  assert.ok(cuatro > dos);
});

test('una malla fina se cobra como maciza, no más', () => {
  // Una celosía: mucha superficie para muy poco volumen.
  const g = estimarGramos({ volumenCm3: 2, superficieCm2: 400, densidad: 1.24, rellenoPct: 15 });
  cerca(g, 2 * 1.24);
});

test('sin superficie conocida se cae al relleno sobre el volumen', () => {
  const g = estimarGramos({ volumenCm3: 10, superficieCm2: 0, densidad: 1.2, rellenoPct: 20 });
  cerca(g, 10 * 0.2 * 1.2);
});

test('valores raros no producen NaN', () => {
  for (const entrada of [
    { volumenCm3: 0, superficieCm2: 0 },
    { volumenCm3: 5, superficieCm2: 10, paredes: 0, boquilla: 0 },
    { volumenCm3: 5, superficieCm2: 10, rellenoPct: -30 },
  ]) {
    const g = estimarGramos(entrada);
    assert.ok(Number.isFinite(g) && g >= 0, `resultado inválido: ${g}`);
  }
});
