/**
 * Visor 3D de la bandeja, en WebGL directo y sin librerías.
 *
 * Dibuja los objetos ya colocados sobre el plato, deja girar la vista con el
 * ratón o el dedo, y permite hacer clic en una pieza para incluirla o sacarla
 * del pedido — la misma idea del visor de Creality Print u Orca, pero con lo
 * mínimo necesario: unas mallas planas, una rejilla y selección por color.
 */

const VERTICE = `
attribute vec3 pos;
attribute vec3 nor;
uniform mat4 uMVP;
varying vec3 vNor;
void main() {
  vNor = nor;
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const FRAGMENTO = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPlano;
varying vec3 vNor;
void main() {
  if (uPlano > 0.5) {
    gl_FragColor = vec4(uColor, uAlpha);
    return;
  }
  vec3 n = normalize(vNor);
  float principal = max(dot(n, normalize(vec3(0.45, -0.55, 0.75))), 0.0);
  float relleno = max(dot(n, normalize(vec3(-0.6, 0.35, 0.25))), 0.0);
  vec3 c = uColor * (0.34 + 0.62 * principal) + uColor * 0.22 * relleno;
  gl_FragColor = vec4(c, uAlpha);
}`;

/* ── Matrices mínimas (columna mayor, como espera WebGL) ──────────────── */

function perspectiva(fovY, aspecto, cerca, lejos) {
  const f = 1 / Math.tan(fovY / 2);
  return [
    f / aspecto, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (lejos + cerca) / (cerca - lejos), -1,
    0, 0, (2 * lejos * cerca) / (cerca - lejos), 0,
  ];
}

function mirarDesde(ojo, centro, arriba) {
  const z = normalizar([ojo[0] - centro[0], ojo[1] - centro[1], ojo[2] - centro[2]]);
  const x = normalizar(cruz(arriba, z));
  const y = cruz(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * ojo[0] + x[1] * ojo[1] + x[2] * ojo[2]),
    -(y[0] * ojo[0] + y[1] * ojo[1] + y[2] * ojo[2]),
    -(z[0] * ojo[0] + z[1] * ojo[1] + z[2] * ojo[2]),
    1,
  ];
}

const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalizar = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function multiplicar(a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let f = 0; f < 4; f++) {
      r[c * 4 + f] = a[f] * b[c * 4] + a[4 + f] * b[c * 4 + 1] + a[8 + f] * b[c * 4 + 2] + a[12 + f] * b[c * 4 + 3];
    }
  }
  return r;
}

/** Normales por cara: cada triángulo repite la suya, para sombreado plano. */
function normalesDe(puntos) {
  const nor = new Float32Array(puntos.length);
  for (let i = 0; i < puntos.length; i += 9) {
    const ax = puntos[i], ay = puntos[i + 1], az = puntos[i + 2];
    const ux = puntos[i + 3] - ax, uy = puntos[i + 4] - ay, uz = puntos[i + 5] - az;
    const wx = puntos[i + 6] - ax, wy = puntos[i + 7] - ay, wz = puntos[i + 8] - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) {
      nor[i + k * 3] = nx / l;
      nor[i + k * 3 + 1] = ny / l;
      nor[i + k * 3 + 2] = nz / l;
    }
  }
  return nor;
}

const hexARgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

/**
 * Crea el visor sobre un canvas. Devuelve null si el navegador no trae WebGL,
 * para que la interfaz siga funcionando sin él.
 */
export function crearVisor(canvas, opciones = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true })
    || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
  if (!gl) return null;

  const compilar = (tipo, fuente) => {
    const sh = gl.createShader(tipo);
    gl.shaderSource(sh, fuente);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    }
    return sh;
  };

  const programa = gl.createProgram();
  gl.attachShader(programa, compilar(gl.VERTEX_SHADER, VERTICE));
  gl.attachShader(programa, compilar(gl.FRAGMENT_SHADER, FRAGMENTO));
  gl.linkProgram(programa);
  gl.useProgram(programa);

  const aPos = gl.getAttribLocation(programa, 'pos');
  const aNor = gl.getAttribLocation(programa, 'nor');
  const uMVP = gl.getUniformLocation(programa, 'uMVP');
  const uColor = gl.getUniformLocation(programa, 'uColor');
  const uAlpha = gl.getUniformLocation(programa, 'uAlpha');
  const uPlano = gl.getUniformLocation(programa, 'uPlano');

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const estado = {
    piezas: [],
    plato: null,
    rejilla: null,
    centro: [0, 0, 0],
    radio: 200,
    giro: -0.9,
    alto: 0.85,
    distancia: 420,
    marcadas: new Set(),
    encima: null,
    tema: opciones.tema || {},
  };

  let alClic = () => {};
  let alPasar = () => {};

  /* ── Datos ─────────────────────────────────────────────────────────── */

  function cargar({ objetos = [], plato = null }) {
    for (const p of estado.piezas) {
      gl.deleteBuffer(p.bufPos);
      gl.deleteBuffer(p.bufNor);
    }
    estado.piezas = [];

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];

    for (const o of objetos) {
      if (!o.puntos || !o.puntos.length) continue;
      const bufPos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
      gl.bufferData(gl.ARRAY_BUFFER, o.puntos, gl.STATIC_DRAW);
      const bufNor = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufNor);
      gl.bufferData(gl.ARRAY_BUFFER, normalesDe(o.puntos), gl.STATIC_DRAW);
      estado.piezas.push({ id: o.id, nombre: o.nombre, bufPos, bufNor, vertices: o.puntos.length / 3 });

      for (let i = 0; i < o.puntos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], o.puntos[i + k]);
          max[k] = Math.max(max[k], o.puntos[i + k]);
        }
      }
    }

    // Plato y rejilla, en las medidas reales de la impresora cuando se saben.
    if (estado.plato) gl.deleteBuffer(estado.plato);
    if (estado.rejilla) gl.deleteBuffer(estado.rejilla);
    const ancho = plato?.ancho || Math.max(220, (max[0] - min[0]) * 1.6 || 220);
    const fondo = plato?.fondo || Math.max(220, (max[1] - min[1]) * 1.6 || 220);

    const cara = new Float32Array([0, 0, 0, ancho, 0, 0, ancho, fondo, 0, 0, 0, 0, ancho, fondo, 0, 0, fondo, 0]);
    estado.plato = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, estado.plato);
    gl.bufferData(gl.ARRAY_BUFFER, cara, gl.STATIC_DRAW);

    const lineas = [];
    const paso = 50;
    const z = Math.max(0.4, Math.max(ancho, fondo) * 0.002);
    for (let x = paso; x < ancho - 0.01; x += paso) lineas.push(x, 0, z, x, fondo, z);
    for (let y = paso; y < fondo - 0.01; y += paso) lineas.push(0, y, z, ancho, y, z);
    // borde del plato, repetido para que se lea más grueso
    for (let k = 0; k < 2; k++) {
      const e = k * 0.6;
      lineas.push(
        e, e, z, ancho - e, e, z, ancho - e, e, z, ancho - e, fondo - e, z,
        ancho - e, fondo - e, z, e, fondo - e, z, e, fondo - e, z, e, e, z,
      );
    }
    estado.rejilla = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, estado.rejilla);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineas), gl.STATIC_DRAW);
    estado.rejillaVertices = lineas.length / 3;
    estado.medidas = { ancho, fondo };

    if (!Number.isFinite(min[0])) { min = [0, 0, 0]; max = [ancho, fondo, 50]; }
    // El encuadre lo mandan las piezas, no el plato: si el objeto es pequeño
    // en una cama de 260 mm, verlo entero de lejos no sirve de nada.
    const extension = Math.max(max[0] - min[0], max[1] - min[1], (max[2] - min[2]) * 1.6, 20);
    estado.centro = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    estado.inicio = {
      radio: Math.max(extension * 0.62, Math.max(ancho, fondo) * 0.26),
      centro: estado.centro.slice(),
    };
    estado.radio = estado.inicio.radio;
    estado.distancia = estado.radio * 3;
    dibujar();
  }

  const marcar = (ids) => { estado.marcadas = new Set(ids); dibujar(); };

  /* ── Dibujo ────────────────────────────────────────────────────────── */

  function ajustarTamano() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function camara() {
    ajustarTamano();
    const aspecto = canvas.width / Math.max(1, canvas.height);
    const d = estado.distancia;
    const ojo = [
      estado.centro[0] + d * Math.cos(estado.alto) * Math.cos(estado.giro),
      estado.centro[1] + d * Math.cos(estado.alto) * Math.sin(estado.giro),
      estado.centro[2] + d * Math.sin(estado.alto),
    ];
    const proy = perspectiva(0.7, aspecto, Math.max(1, d * 0.02), d * 6);
    return multiplicar(proy, mirarDesde(ojo, estado.centro, [0, 0, 1]));
  }

  function atar(pieza) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pieza.bufPos);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pieza.bufNor);
    gl.enableVertexAttribArray(aNor);
    gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
  }

  function dibujar(paraElegir = false) {
    const mvp = camara();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(programa);
    gl.uniformMatrix4fv(uMVP, false, mvp);

    if (paraElegir) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(uPlano, 1);
      gl.uniform1f(uAlpha, 1);
      gl.disable(gl.BLEND);
      estado.piezas.forEach((p, i) => {
        gl.uniform3f(uColor, ((i + 1) & 255) / 255, (((i + 1) >> 8) & 255) / 255, 0);
        atar(p);
        gl.drawArrays(gl.TRIANGLES, 0, p.vertices);
      });
      gl.enable(gl.BLEND);
      return;
    }

    const t = estado.tema;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Plato y rejilla
    gl.uniform1f(uPlano, 1);
    gl.disableVertexAttribArray(aNor);
    gl.vertexAttrib3f(aNor, 0, 0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, estado.plato);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniform3f(uColor, ...hexARgb(t.plato || '#c7d2d7'));
    gl.uniform1f(uAlpha, 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindBuffer(gl.ARRAY_BUFFER, estado.rejilla);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniform3f(uColor, ...hexARgb(t.rejilla || '#93a3aa'));
    gl.uniform1f(uAlpha, 0.45);
    gl.drawArrays(gl.LINES, 0, estado.rejillaVertices);

    // Piezas marcadas, sólidas
    gl.uniform1f(uPlano, 0);
    gl.uniform1f(uAlpha, 1);
    const activo = hexARgb(t.activo || '#1b7a9e');
    const resaltado = hexARgb(t.resaltado || '#e09112');
    for (const p of estado.piezas) {
      if (!estado.marcadas.has(p.id)) continue;
      gl.uniform3f(uColor, ...(estado.encima === p.id ? resaltado : activo));
      atar(p);
      gl.drawArrays(gl.TRIANGLES, 0, p.vertices);
    }

    // Piezas fuera del pedido, como fantasmas
    gl.depthMask(false);
    const apagado = hexARgb(t.apagado || '#8fa0a8');
    for (const p of estado.piezas) {
      if (estado.marcadas.has(p.id)) continue;
      gl.uniform3f(uColor, ...(estado.encima === p.id ? resaltado : apagado));
      gl.uniform1f(uAlpha, estado.encima === p.id ? 0.6 : 0.3);
      atar(p);
      gl.drawArrays(gl.TRIANGLES, 0, p.vertices);
    }
    gl.depthMask(true);
    gl.uniform1f(uAlpha, 1);
  }

  /** Qué pieza hay bajo el cursor, pintando cada una de un color distinto. */
  function elegirEn(x, y) {
    dibujar(true);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round((canvas.clientHeight - y) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    dibujar();
    const indice = px[0] + (px[1] << 8) - 1;
    return estado.piezas[indice] || null;
  }

  /* ── Interacción ───────────────────────────────────────────────────── */

  let arrastrando = false;
  let movido = false;
  let ultimo = null;
  let pendiente = false;

  const puntoEn = (ev) => {
    const r = canvas.getBoundingClientRect();
    const t = ev.touches?.[0] || ev;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const empezar = (ev) => {
    arrastrando = true;
    movido = false;
    ultimo = puntoEn(ev);
  };

  const mover = (ev) => {
    const p = puntoEn(ev);
    if (arrastrando && ultimo) {
      const dx = p.x - ultimo.x;
      const dy = p.y - ultimo.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) movido = true;
      estado.giro -= dx * 0.008;
      estado.alto = Math.max(0.08, Math.min(1.5, estado.alto + dy * 0.006));
      ultimo = p;
      dibujar();
      return;
    }
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      const pieza = elegirEn(p.x, p.y);
      const id = pieza?.id ?? null;
      if (id !== estado.encima) {
        estado.encima = id;
        canvas.style.cursor = id ? 'pointer' : 'grab';
        dibujar();
        alPasar(pieza);
      }
    });
  };

  const soltar = (ev) => {
    if (arrastrando && !movido) {
      const p = puntoEn(ev.changedTouches?.[0] || ev);
      const pieza = elegirEn(p.x, p.y);
      if (pieza) alClic(pieza);
    }
    arrastrando = false;
    ultimo = null;
  };

  canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture?.(ev.pointerId); empezar(ev); });
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointerleave', () => {
    arrastrando = false;
    if (estado.encima) { estado.encima = null; dibujar(); alPasar(null); }
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    estado.distancia = Math.max(estado.radio * 0.6, Math.min(estado.radio * 8, estado.distancia * (ev.deltaY > 0 ? 1.12 : 0.89)));
    dibujar();
  }, { passive: false });

  const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => dibujar()) : null;
  observador?.observe(canvas);

  return {
    cargar,
    marcar,
    redibujar: dibujar,
    encuadrar: () => {
      estado.giro = -0.9;
      estado.alto = 0.95;
      if (estado.inicio) {
        estado.radio = estado.inicio.radio;
        estado.centro = estado.inicio.centro.slice();
      }
      estado.distancia = estado.radio * 3;
      dibujar();
    },
    tema: (t) => { estado.tema = t; dibujar(); },
    alClic: (fn) => { alClic = fn; },
    alPasar: (fn) => { alPasar = fn; },
    destruir: () => observador?.disconnect(),
  };
}
