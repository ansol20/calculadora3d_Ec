/**
 * Lectura de proyectos .3mf y de G-code para sacar gramos, tiempo y la ficha
 * del laminado (bandejas, objetos, filamento, perfil e impresora).
 *
 * Un .3mf es un ZIP. En vez de cargar una librería, aquí se lee el directorio
 * central del ZIP a mano y se descomprime con DecompressionStream('deflate-raw'),
 * que ya viene en el navegador.
 *
 * Qué archivo aporta qué:
 *   · Metadata/slice_info.config      → peso y tiempo reales, por bandeja
 *   · Metadata/model_settings.config  → qué objetos hay en cada bandeja
 *   · Metadata/project_settings.config→ impresora, filamento, perfil, relleno
 *   · Metadata/Slic3r_PE.config       → lo mismo, en proyectos de PrusaSlicer
 *   · Metadata/plate_N.gcode          → totales, si es una bandeja exportada
 *   · 3D/3dmodel.model + 3D/Objects/  → geometría, si no está laminado
 */

const FIRMA_EOCD = 0x06054b50;
const FIRMA_EOCD64 = 0x06064b50;
const FIRMA_LOCALIZADOR64 = 0x07064b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

const texto = (bytes) => new TextDecoder('utf-8').decode(bytes);

/** Abre el ZIP y devuelve el índice de entradas sin descomprimir nada todavía. */
export async function abrirZip(archivo) {
  const buf = await archivo.arrayBuffer();
  const dv = new DataView(buf);

  let eocd = -1;
  const desde = Math.max(0, buf.byteLength - 66000);
  for (let i = buf.byteLength - 22; i >= desde; i--) {
    if (dv.getUint32(i, true) === FIRMA_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no parece un ZIP válido.');

  let total = dv.getUint16(eocd + 10, true);
  let inicioCentral = dv.getUint32(eocd + 16, true);

  if (inicioCentral === 0xffffffff || total === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === FIRMA_LOCALIZADOR64) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z64, true) === FIRMA_EOCD64) {
        total = Number(dv.getBigUint64(z64 + 32, true));
        inicioCentral = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }

  const entradas = new Map();
  let p = inicioCentral;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== FIRMA_CENTRAL) break;
    const metodo = dv.getUint16(p + 10, true);
    let tamComprimido = dv.getUint32(p + 20, true);
    let tamOriginal = dv.getUint32(p + 24, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComentario = dv.getUint16(p + 32, true);
    let desplazamiento = dv.getUint32(p + 42, true);
    const nombre = texto(new Uint8Array(buf, p + 46, largoNombre));

    // Campos zip64: solo vienen los que estaban marcados con 0xffffffff.
    if (tamOriginal === 0xffffffff || tamComprimido === 0xffffffff || desplazamiento === 0xffffffff) {
      let x = p + 46 + largoNombre;
      const fin = x + largoExtra;
      while (x + 4 <= fin) {
        const id = dv.getUint16(x, true);
        const largo = dv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (tamOriginal === 0xffffffff) { tamOriginal = Number(dv.getBigUint64(q, true)); q += 8; }
          if (tamComprimido === 0xffffffff) { tamComprimido = Number(dv.getBigUint64(q, true)); q += 8; }
          if (desplazamiento === 0xffffffff) { desplazamiento = Number(dv.getBigUint64(q, true)); }
          break;
        }
        x += 4 + largo;
      }
    }

    entradas.set(nombre, { metodo, tamComprimido, tamOriginal, desplazamiento });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }

  return { buf, dv, entradas };
}

/** Devuelve el contenido de una entrada del ZIP como Uint8Array. */
export async function leerEntrada(zip, nombre) {
  const e = zip.entradas.get(nombre);
  if (!e) return null;
  const { dv, buf } = zip;
  if (dv.getUint32(e.desplazamiento, true) !== FIRMA_LOCAL) return null;
  const largoNombre = dv.getUint16(e.desplazamiento + 26, true);
  const largoExtra = dv.getUint16(e.desplazamiento + 28, true);
  const inicio = e.desplazamiento + 30 + largoNombre + largoExtra;
  const datos = new Uint8Array(buf, inicio, Math.min(e.tamComprimido, buf.byteLength - inicio));
  if (e.metodo === 0) return datos;
  if (e.metodo !== 8) throw new Error(`Compresión no soportada en ${nombre}.`);
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

const leerTexto = async (zip, nombre) => {
  const datos = await leerEntrada(zip, nombre);
  return datos ? texto(datos) : null;
};

const buscarEntrada = (zip, sufijo) => {
  const objetivo = sufijo.toLowerCase();
  for (const nombre of zip.entradas.keys()) {
    if (nombre.toLowerCase().endsWith(objetivo)) return nombre;
  }
  return null;
};

const comoXml = (txt) => {
  if (!txt) return null;
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
};

/* ── Ficha del laminado ───────────────────────────────────────────────── */

/**
 * slice_info.config de Bambu Studio, Orca y Creality Print: el peso y el
 * tiempo reales, una entrada por bandeja.
 */
function leerSliceInfo(txt) {
  const doc = comoXml(txt);
  if (!doc) return null;
  const bandejas = [];
  for (const placa of doc.querySelectorAll('plate')) {
    const meta = (clave) => placa.querySelector(`metadata[key="${clave}"]`)?.getAttribute('value') ?? null;
    const filamentos = [...placa.querySelectorAll('filament')].map((f) => ({
      tipo: f.getAttribute('type') || 'Filamento',
      color: f.getAttribute('color') || null,
      gramos: parseFloat(f.getAttribute('used_g') || '0') || 0,
      metros: parseFloat(f.getAttribute('used_m') || '0') || 0,
    })).filter((f) => f.gramos > 0);

    const gramos = filamentos.reduce((s, f) => s + f.gramos, 0) || parseFloat(meta('weight') || '0') || 0;
    const segundos = parseFloat(meta('prediction') || '0') || 0;
    if (!gramos && !segundos) continue;

    bandejas.push({
      indice: parseInt(meta('index') || String(bandejas.length + 1), 10),
      gramos,
      segundos,
      metros: filamentos.reduce((s, f) => s + f.metros, 0),
      filamentos,
    });
  }
  return bandejas.length ? bandejas : null;
}

/**
 * model_settings.config: qué objetos hay en cada bandeja y cómo se llaman.
 * Es lo que permite decir "Bandeja 2 · 4 objetos" aunque no esté laminado.
 */
function leerModelSettings(txt) {
  const doc = comoXml(txt);
  if (!doc) return null;

  const nombres = new Map();
  for (const o of doc.querySelectorAll('config > object')) {
    const nombre = o.querySelector(':scope > metadata[key="name"]')?.getAttribute('value');
    if (o.getAttribute('id')) nombres.set(o.getAttribute('id'), nombre || `Objeto ${o.getAttribute('id')}`);
  }

  const bandejas = [];
  for (const placa of doc.querySelectorAll('plate')) {
    const meta = (clave) => placa.querySelector(`:scope > metadata[key="${clave}"]`)?.getAttribute('value') ?? null;
    const ids = [...placa.querySelectorAll('model_instance')]
      .map((i) => i.querySelector('metadata[key="object_id"]')?.getAttribute('value'))
      .filter(Boolean);
    bandejas.push({
      indice: parseInt(meta('plater_id') || String(bandejas.length + 1), 10),
      nombre: meta('plater_name') || '',
      miniaturaRuta: meta('thumbnail_file') || null,
      objetosId: ids,
      objetos: ids.map((id) => nombres.get(id)).filter(Boolean),
    });
  }
  return { bandejas, nombres };
}

/** Slic3r_PE.config de PrusaSlicer: no trae estimación, pero sí el material. */
function leerConfigPrusa(txt) {
  if (!txt) return null;
  const dato = (clave) => {
    const m = txt.match(new RegExp(`^;\\s*${clave}\\s*=\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  const primero = (v) => (v ? v.split(';')[0].trim() : null);
  const tipo = primero(dato('filament_type'));
  if (!tipo) return null;
  return {
    origen: 'PrusaSlicer',
    tipo3d: tipo,
    filamento: primero(dato('filament_settings_id'))?.replace(/^"|"$/g, '') || null,
    densidad: parseFloat(primero(dato('filament_density')) || '0') || null,
    precioKg: parseFloat(primero(dato('filament_cost')) || '0') || null,
    relleno: parseFloat((primero(dato('fill_density')) || '').replace('%', '')) || null,
    paredes: parseInt(primero(dato('perimeters')) || '2', 10) || 2,
    boquilla: parseFloat(primero(dato('nozzle_diameter')) || '0.4') || 0.4,
    alturaCapa: parseFloat(primero(dato('layer_height')) || '0') || null,
    impresora: dato('printer_model'),
    perfil: dato('print_settings_id'),
  };
}

/**
 * project_settings.config: el JSON de ajustes de Creality Print, Orca y Bambu.
 * Aunque el proyecto no esté laminado, aquí están la impresora, el filamento
 * con su nombre comercial, el perfil de proceso y el relleno.
 */
function leerAjustes(txt) {
  let d;
  try { d = JSON.parse(txt); } catch { return null; }
  if (!d || typeof d !== 'object') return null;

  const primero = (v) => (Array.isArray(v) ? v[0] : v);
  const numero = (v) => {
    const n = parseFloat(String(primero(v) ?? '').replace('%', ''));
    return Number.isFinite(n) ? n : null;
  };
  // "Hyper PLA @SPARKX i7 0.4 nozzle" → "Hyper PLA"
  const limpiar = (v) => (v ? String(v).split('@')[0].trim() : null);

  const tipo = primero(d.filament_type);
  const impresora = limpiar(primero(d.printer_model)) || limpiar(primero(d.printer_settings_id));
  if (!tipo && !impresora) return null;

  return {
    tipo3d: tipo || null,
    filamento: limpiar(primero(d.filament_settings_id)),
    marca: primero(d.filament_vendor) || null,
    color: primero(d.filament_colour) || null,
    densidad: numero(d.filament_density),
    precioKg: numero(d.filament_cost),
    relleno: numero(d.sparse_infill_density),
    paredes: numero(d.wall_loops) || 2,
    boquilla: numero(d.nozzle_diameter) || 0.4,
    alturaCapa: numero(d.layer_height),
    impresora,
    perfil: limpiar(d.print_settings_id),
    plato: medidasPlato(d.printable_area, numero(d.printable_height)),
  };
}

/** "260x260" en las esquinas de printable_area → tamaño del plato en mm. */
function medidasPlato(area, alto) {
  if (!Array.isArray(area) || !area.length) return null;
  let ancho = 0;
  let fondo = 0;
  for (const punto of area) {
    const [x, y] = String(punto).split('x').map(Number);
    if (Number.isFinite(x)) ancho = Math.max(ancho, x);
    if (Number.isFinite(y)) fondo = Math.max(fondo, y);
  }
  return ancho > 0 && fondo > 0 ? { ancho, fondo, alto: alto || 250 } : null;
}

/* ── Geometría ────────────────────────────────────────────────────────── */

/* ── Geometría ────────────────────────────────────────────────────────── */

/** Transformada 3mf: 12 números, filas de la base y traslación al final. */
const IDENTIDAD = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function comoMatriz(attr) {
  if (!attr) return IDENTIDAD;
  const n = attr.trim().split(/\s+/).map(Number);
  return n.length >= 12 && n.every(Number.isFinite) ? n : IDENTIDAD;
}

/** Aplica `hija` y después `padre`, como manda el anidamiento de componentes. */
function componer(hija, padre) {
  const r = new Array(12);
  for (let i = 0; i < 4; i++) {
    const x = hija[i * 3];
    const y = hija[i * 3 + 1];
    const z = hija[i * 3 + 2];
    const t = i === 3 ? 1 : 0;
    r[i * 3] = x * padre[0] + y * padre[3] + z * padre[6] + t * padre[9];
    r[i * 3 + 1] = x * padre[1] + y * padre[4] + z * padre[7] + t * padre[10];
    r[i * 3 + 2] = x * padre[2] + y * padre[5] + z * padre[8] + t * padre[11];
  }
  return r;
}

/**
 * Lee la geometría de cada objeto de la placa y la deja en coordenadas del
 * plato, lista tanto para medirla como para dibujarla en el visor 3D.
 *
 * Los proyectos de MakerWorld abiertos en Creality Print, Bambu Studio u Orca
 * no guardan las mallas dentro de 3dmodel.model: cada objeto vive en su propio
 * archivo bajo 3D/Objects/ y se referencia con el atributo p:path de la
 * extensión "production" del formato.
 */
async function leerGeometria(zip, rutaRaiz, limiteTriangulos = 1200000) {
  const partes = new Map();
  let triangulos = 0;
  let truncado = false;

  const cargarParte = async (ruta) => {
    const clave = ruta.replace(/^\//, '');
    if (partes.has(clave)) return partes.get(clave);
    const objetos = new Map();
    const doc = comoXml(await leerTexto(zip, clave));
    if (doc) for (const o of doc.querySelectorAll('resources > object')) objetos.set(o.getAttribute('id'), o);
    const parte = { doc, objetos };
    partes.set(clave, parte);
    return parte;
  };

  /** Vuelca la malla de un objeto, ya transformada, en el acumulador. */
  const volcarMalla = (objeto, m, acc) => {
    const malla = objeto.querySelector(':scope > mesh');
    if (!malla) return;

    const crudos = malla.querySelectorAll('vertices > vertex');
    const vs = new Float64Array(crudos.length * 3);
    let k = 0;
    for (const v of crudos) {
      const x = parseFloat(v.getAttribute('x')) || 0;
      const y = parseFloat(v.getAttribute('y')) || 0;
      const z = parseFloat(v.getAttribute('z')) || 0;
      vs[k++] = x * m[0] + y * m[3] + z * m[6] + m[9];
      vs[k++] = x * m[1] + y * m[4] + z * m[7] + m[10];
      vs[k++] = x * m[2] + y * m[5] + z * m[8] + m[11];
    }

    for (const t of malla.querySelectorAll('triangles > triangle')) {
      const a = (+t.getAttribute('v1')) * 3;
      const b = (+t.getAttribute('v2')) * 3;
      const c = (+t.getAttribute('v3')) * 3;
      if (!(a >= 0 && b >= 0 && c >= 0) || c + 2 >= vs.length) continue;

      const ax = vs[a], ay = vs[a + 1], az = vs[a + 2];
      const bx = vs[b], by = vs[b + 1], bz = vs[b + 2];
      const cx = vs[c], cy = vs[c + 1], cz = vs[c + 2];

      acc.v6 += ax * (by * cz - cy * bz) - ay * (bx * cz - cx * bz) + az * (bx * cy - cx * by);

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      acc.a2 += Math.hypot(nx, ny, nz);

      if (triangulos < limiteTriangulos) {
        acc.puntos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        triangulos++;
      } else {
        truncado = true;
      }
    }
  };

  const recorrer = async (ruta, id, m, acc, visitados) => {
    const marca = `${ruta}#${id}`;
    if (visitados.has(marca)) return;
    visitados.add(marca);
    const parte = await cargarParte(ruta);
    const objeto = parte.objetos.get(id);
    if (!objeto) return;

    volcarMalla(objeto, m, acc);
    for (const c of objeto.querySelectorAll(':scope > components > component')) {
      const rutaHija = c.getAttribute('p:path') || ruta;
      await recorrer(rutaHija, c.getAttribute('objectid'), componer(comoMatriz(c.getAttribute('transform')), m), acc, visitados);
    }
  };

  const raiz = await cargarParte(rutaRaiz);
  if (!raiz.doc) return null;

  const unidad = raiz.doc.documentElement.getAttribute('unit') || 'millimeter';
  const aMm = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unidad] ?? 1;
  const escalaUnidad = aMm === 1 ? IDENTIDAD : [aMm, 0, 0, 0, aMm, 0, 0, 0, aMm, 0, 0, 0];

  const items = [...raiz.doc.querySelectorAll('build > item')];
  const fuentes = items.length
    ? items.map((i) => ({ id: i.getAttribute('objectid'), m: comoMatriz(i.getAttribute('transform')), imprimible: i.getAttribute('printable') !== '0' }))
    : [...raiz.objetos.keys()].map((id) => ({ id, m: IDENTIDAD, imprimible: true }));

  const porObjeto = new Map();
  for (const f of fuentes) {
    if (!f.imprimible) continue;
    const acc = { v6: 0, a2: 0, puntos: [] };
    await recorrer(rutaRaiz, f.id, componer(f.m, escalaUnidad), acc, new Set());
    const cm3 = Math.abs(acc.v6) / 6 / 1000;
    if (!(cm3 > 0)) continue;

    const previo = porObjeto.get(f.id);
    const entrada = {
      cm3: (previo?.cm3 || 0) + cm3,
      cm2: (previo?.cm2 || 0) + acc.a2 / 2 / 100,
      puntos: previo ? Float32Array.from([...previo.puntos, ...acc.puntos]) : Float32Array.from(acc.puntos),
    };
    porObjeto.set(f.id, entrada);
  }

  if (!porObjeto.size) return null;
  porObjeto.truncado = truncado;
  return porObjeto;
}

/**
 * Estimación de gramos a partir de la geometría, cuando el .3mf no viene
 * laminado. Se calcula el cascarón (superficie × espesor de pared) y el
 * interior se llena según el porcentaje de relleno. Es una aproximación, pero
 * usa los perímetros y la boquilla reales del proyecto, no un número mágico.
 */
export function estimarGramos({ volumenCm3, superficieCm2 = 0, densidad = 1.24, rellenoPct = 15, paredes = 2, boquilla = 0.4 }) {
  const espesorCm = (Math.max(1, paredes) * Math.max(0.1, boquilla)) / 10;
  const cascara = Math.min(volumenCm3, superficieCm2 * espesorCm);
  const interior = Math.max(0, volumenCm3 - cascara);
  const solido = cascara + interior * (Math.max(0, rellenoPct) / 100);
  return solido * densidad;
}

/* ── Lectura de .3mf ──────────────────────────────────────────────────── */

const imagenDe = async (zip, ruta) => {
  if (!ruta || !zip.entradas.has(ruta)) return null;
  const datos = await leerEntrada(zip, ruta);
  return datos ? URL.createObjectURL(new Blob([datos], { type: 'image/png' })) : null;
};

/** Totales que dejan los laminadores en los comentarios del G-code. */
function totalesDeGcode(txt) {
  const sumaLista = (re) => {
    const m = txt.match(re);
    return m ? m[1].split(',').reduce((s, x) => s + (parseFloat(x) || 0), 0) : 0;
  };

  const gramos = sumaLista(/^;\s*filament used \[g\]\s*[:=]\s*(.+)$/mi)
    || sumaLista(/^;\s*total filament weight \[g\]\s*[:=]\s*(.+)$/mi)
    || sumaLista(/^;\s*Filament weight\s*[:=]\s*(.+)$/mi);

  let segundos = 0;
  const hms = txt.match(/^;\s*(?:estimated printing time.*|total estimated time)\s*[:=]\s*(.+)$/mi);
  if (hms) {
    const t = hms[1];
    const d = parseInt(t.match(/(\d+)\s*d/i)?.[1] || '0', 10);
    const h = parseInt(t.match(/(\d+)\s*h/i)?.[1] || '0', 10);
    const m = parseInt(t.match(/(\d+)\s*m/i)?.[1] || '0', 10);
    const s = parseInt(t.match(/(\d+)\s*s/i)?.[1] || '0', 10);
    segundos = d * 86400 + h * 3600 + m * 60 + s;
  }
  if (!segundos) segundos = parseInt(txt.match(/^;TIME:(\d+)/mi)?.[1] || '0', 10) || 0;

  const metros = sumaLista(/^;\s*filament used \[mm\]\s*[:=]\s*(.+)$/mi) / 1000
    || parseFloat(txt.match(/^;Filament used:\s*([\d.]+)m/mi)?.[1] || '0');

  return { gramos, segundos, metros };
}

/** Lee un .3mf completo: bandejas, objetos, material, impresora y perfil. */
export async function leer3mf(archivo) {
  const zip = await abrirZip(archivo);
  const r = { archivo: archivo.name, tipo: '3mf', avisos: [], bandejas: [], laminado: false };

  // Ajustes del proyecto: impresora, filamento, perfil, relleno.
  const rutaAjustes = buscarEntrada(zip, 'project_settings.config');
  const ajustes = rutaAjustes ? leerAjustes(await leerTexto(zip, rutaAjustes)) : null;
  const prusa = leerConfigPrusa(await leerTexto(zip, buscarEntrada(zip, 'Slic3r_PE.config') || ''));
  Object.assign(r, prusa || {}, ajustes || {});
  if (ajustes) r.origen = 'de los ajustes del proyecto';
  if (prusa) r.origen = 'PrusaSlicer';

  // Qué objetos tiene cada bandeja.
  const rutaModelo = buscarEntrada(zip, 'model_settings.config');
  const modelo = rutaModelo ? leerModelSettings(await leerTexto(zip, rutaModelo)) : null;

  // Peso y tiempo reales, si el proyecto está laminado.
  const rutaSlice = buscarEntrada(zip, 'slice_info.config');
  const laminado = rutaSlice ? leerSliceInfo(await leerTexto(zip, rutaSlice)) : null;
  if (laminado) {
    r.laminado = true;
    r.origen = 'del laminado del proyecto (datos reales)';
  }

  // La geometría se mide siempre: sin laminado sirve para estimar, y con
  // laminado sirve para repartir el peso real entre los objetos de la bandeja.
  const rutaMalla = buscarEntrada(zip, '3D/3dmodel.model');
  const porObjeto = rutaMalla ? await leerGeometria(zip, rutaMalla) : null;
  if (porObjeto?.truncado) {
    r.avisos.push('El modelo es enorme, así que el visor muestra solo una parte de la malla. Los gramos y el tiempo no se ven afectados.');
  }

  // Bandejas exportadas como G-code dentro del propio .3mf.
  const gcodes = [...zip.entradas.keys()].filter((n) => /plate_\d+\.gcode$/i.test(n)).sort();

  const cuantas = Math.max(
    laminado?.length || 0,
    modelo?.bandejas.length || 0,
    gcodes.length,
    porObjeto ? 1 : 0,
    1,
  );

  // Cuánto plástico lleva cada objeto según su geometría. Es el reparto que
  // permite marcar objetos sueltos de una bandeja.
  const volumenImpreso = (m) => estimarGramos({
    volumenCm3: m.cm3,
    superficieCm2: m.cm2,
    densidad: 1,
    rellenoPct: r.relleno ?? 15,
    paredes: r.paredes,
    boquilla: r.boquilla,
  });

  for (let i = 0; i < cuantas; i++) {
    const indice = i + 1;
    const deModelo = modelo?.bandejas.find((b) => b.indice === indice) || modelo?.bandejas[i] || null;
    const deLaminado = laminado?.find((b) => b.indice === indice) || laminado?.[i] || null;

    const bandeja = {
      indice,
      nombre: deModelo?.nombre || '',
      gramos: deLaminado?.gramos || 0,
      segundos: deLaminado?.segundos || 0,
      metros: deLaminado?.metros || 0,
      filamentos: deLaminado?.filamentos || [],
      estimado: !deLaminado,
      objetos: [],
      miniatura: await imagenDe(zip, deModelo?.miniaturaRuta || `Metadata/plate_${indice}.png`),
    };

    // Bandeja exportada como G-code dentro del propio .3mf.
    if (!bandeja.gramos && gcodes.length) {
      const ruta = gcodes.find((n) => n.includes(`plate_${indice}.`)) || (cuantas === 1 ? gcodes[0] : null);
      const entrada = ruta ? zip.entradas.get(ruta) : null;
      if (entrada && entrada.tamOriginal < 120 * 1024 * 1024) {
        const totales = totalesDeGcode(await leerTexto(zip, ruta));
        if (totales.gramos) {
          Object.assign(bandeja, totales, { estimado: false });
          r.laminado = true;
          r.origen = 'del G-code de la bandeja (datos reales)';
        }
      }
    }

    // Objetos de la bandeja, con su volumen medido.
    const ids = deModelo?.objetosId?.length
      ? deModelo.objetosId
      : (cuantas === 1 && porObjeto ? [...porObjeto.keys()] : []);

    const medidos = ids.map((id) => ({
      id,
      nombre: modelo?.nombres.get(id) || `Objeto ${id}`,
      medida: porObjeto?.get(id) || null,
    })).filter((o) => o.medida);

    const reparto = medidos.map((o) => volumenImpreso(o.medida));
    const sumaReparto = reparto.reduce((s, v) => s + v, 0);

    if (medidos.length && sumaReparto > 0) {
      const densidad = r.densidad || 1.24;
      bandeja.objetos = medidos.map((o, k) => {
        const parte = reparto[k] / sumaReparto;
        const gramos = bandeja.gramos > 0 ? bandeja.gramos * parte : reparto[k] * densidad;
        return {
          id: o.id,
          nombre: o.nombre,
          gramos,
          segundos: bandeja.segundos * parte,
          volumenCm3: o.medida.cm3,
          superficieCm2: o.medida.cm2,
          puntos: o.medida.puntos,
          estimado: bandeja.gramos <= 0,
        };
      });
      if (!bandeja.gramos) {
        bandeja.gramos = bandeja.objetos.reduce((s, o) => s + o.gramos, 0);
        bandeja.estimado = true;
      }
    } else if (bandeja.gramos > 0) {
      // Sin geometría utilizable, la bandeja entera es un solo bloque.
      bandeja.objetos = [{
        id: `b${indice}`,
        nombre: `Bandeja ${indice} completa`,
        gramos: bandeja.gramos,
        segundos: bandeja.segundos,
        estimado: false,
      }];
    }

    if (bandeja.objetos.length) r.bandejas.push(bandeja);
  }

  // Los gramos por objeto se reparten según el volumen, no según el G-code.
  if (r.laminado && r.bandejas.some((b) => b.objetos.length > 1)) {
    r.avisos.push('El peso de cada objeto se reparte según su volumen, así que marcar objetos sueltos da un número aproximado. El total de la bandeja completa sí es el exacto del laminador.');
  }

  r.miniatura = r.bandejas[0]?.miniatura || await imagenDe(zip, 'Metadata/plate_1.png');

  if (!r.laminado && r.bandejas.some((b) => b.volumenCm3)) {
    r.avisos.push('El proyecto no viene laminado, así que los gramos son una estimación de la geometría. Para el dato exacto: lamina en tu programa y usa Archivo → Guardar proyecto como, o exporta la bandeja laminada.');
  }
  if (!r.bandejas.length) {
    throw new Error('El archivo no trae laminado ni mallas que se puedan medir. Escribe los gramos y el tiempo a mano.');
  }
  return r;
}

/** G-code suelto de PrusaSlicer, Orca, Bambu o Cura. */
export async function leerGcode(archivo) {
  const trozo = 200 * 1024;
  const cabeza = await archivo.slice(0, Math.min(trozo, archivo.size)).text();
  const cola = archivo.size > trozo ? await archivo.slice(archivo.size - trozo).text() : '';
  const txt = `${cabeza}\n${cola}`;

  const r = { archivo: archivo.name, tipo: 'gcode', origen: 'del G-code (datos reales)', avisos: [], laminado: true, bandejas: [] };
  const totales = totalesDeGcode(txt);

  r.tipo3d = txt.match(/^;\s*filament_type\s*=\s*([^;\r\n]+)/mi)?.[1]?.trim() || null;
  r.filamento = txt.match(/^;\s*filament_settings_id\s*=\s*"?([^";\r\n]+)/mi)?.[1]?.trim() || null;
  r.impresora = txt.match(/^;\s*printer_model\s*=\s*([^;\r\n]+)/mi)?.[1]?.trim() || null;
  r.perfil = txt.match(/^;\s*print_settings_id\s*=\s*"?([^";\r\n]+)/mi)?.[1]?.trim() || null;
  r.precioKg = parseFloat(txt.match(/^;\s*filament_cost\s*=\s*([\d.]+)/mi)?.[1] || '0') || null;
  r.alturaCapa = parseFloat(txt.match(/^;\s*layer_height\s*=\s*([\d.]+)/mi)?.[1] || '0') || null;

  if (!totales.gramos && totales.metros > 0) {
    const densidad = parseFloat(txt.match(/^;\s*filament_density\s*=\s*([\d.]+)/mi)?.[1] || '1.24');
    const diametro = parseFloat(txt.match(/^;\s*filament_diameter\s*=\s*([\d.]+)/mi)?.[1] || '1.75');
    totales.gramos = totales.metros * 100 * Math.PI * (diametro / 20) ** 2 * densidad;
    r.avisos.push('El G-code no traía el peso; se calculó a partir de los metros de filamento.');
  }
  if (!totales.gramos && !totales.segundos) {
    throw new Error('No se encontraron los totales del laminado en el G-code.');
  }

  r.bandejas.push({
    indice: 1, nombre: '', filamentos: [], miniatura: null, estimado: false, ...totales,
    objetos: [{ id: 'g1', nombre: 'Toda la impresión', gramos: totales.gramos, segundos: totales.segundos, estimado: false }],
  });
  return r;
}

/** Punto de entrada único: decide según la extensión del archivo. */
export async function importarArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.3mf')) return leer3mf(archivo);
  if (nombre.endsWith('.gcode') || nombre.endsWith('.gco') || nombre.endsWith('.g')) return leerGcode(archivo);
  throw new Error('Formato no soportado. Sube un .3mf o un .gcode.');
}
