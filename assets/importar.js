/**
 * Lectura de proyectos .3mf y de G-code para sacar gramos y tiempo de impresión.
 *
 * Un .3mf es un ZIP. En vez de cargar una librería, aquí se lee el directorio
 * central del ZIP a mano y se descomprime con DecompressionStream('deflate-raw'),
 * que ya viene en el navegador.
 *
 * De dónde sale cada dato:
 *   · Bambu Studio / Orca  → Metadata/slice_info.config (peso y tiempo reales)
 *   · PrusaSlicer          → Metadata/Slic3r_PE.config (material y densidad)
 *   · Cualquier .3mf       → 3D/3dmodel.model (volumen de la malla, aproximado)
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

const buscarEntrada = (zip, sufijo) => {
  const objetivo = sufijo.toLowerCase();
  for (const nombre of zip.entradas.keys()) {
    if (nombre.toLowerCase().endsWith(objetivo)) return nombre;
  }
  return null;
};

/** slice_info.config de Bambu Studio / Orca Slicer: peso y tiempo reales. */
function leerSliceInfo(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const placas = [...doc.querySelectorAll('plate')];
  if (!placas.length) return null;

  const placa = placas[0];
  const meta = (clave) => placa.querySelector(`metadata[key="${clave}"]`)?.getAttribute('value') ?? null;

  const filamentos = [...placa.querySelectorAll('filament')].map((f) => ({
    tipo: f.getAttribute('type') || 'Filamento',
    color: f.getAttribute('color') || null,
    gramos: parseFloat(f.getAttribute('used_g') || '0') || 0,
    metros: parseFloat(f.getAttribute('used_m') || '0') || 0,
  })).filter((f) => f.gramos > 0);

  const pesoMeta = parseFloat(meta('weight') || '0') || 0;
  const gramos = filamentos.reduce((s, f) => s + f.gramos, 0) || pesoMeta;
  const segundos = parseFloat(meta('prediction') || '0') || 0;
  if (!gramos && !segundos) return null;

  return {
    origen: 'Bambu Studio / Orca Slicer',
    gramos,
    segundos,
    filamentos,
    placas: placas.length,
    impresora: meta('printer_model_id') || null,
  };
}

/** Slic3r_PE.config de PrusaSlicer: no trae estimación, pero sí el material. */
function leerConfigPrusa(txt) {
  const dato = (clave) => {
    const m = txt.match(new RegExp(`^;\\s*${clave}\\s*=\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  const primero = (v) => (v ? v.split(';')[0].trim() : null);
  const tipo = primero(dato('filament_type'));
  if (!tipo) return null;
  return {
    origen: 'PrusaSlicer',
    tipo,
    densidad: parseFloat(primero(dato('filament_density')) || '0') || null,
    precioKg: parseFloat(primero(dato('filament_cost')) || '0') || null,
    relleno: parseFloat((primero(dato('fill_density')) || '').replace('%', '')) || null,
    impresora: dato('printer_model'),
  };
}

/**
 * project_settings.config: el JSON de ajustes que guardan Creality Print,
 * Orca y Bambu Studio. Aunque el proyecto no esté laminado, aquí están la
 * impresora, el material y el relleno con los que se abrió.
 */
function leerAjustes(json) {
  let d;
  try { d = JSON.parse(json); } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  const primero = (v) => (Array.isArray(v) ? v[0] : v);
  const numero = (v) => {
    const n = parseFloat(String(primero(v) ?? '').replace('%', ''));
    return Number.isFinite(n) ? n : null;
  };
  const tipo = primero(d.filament_type);
  const impresora = primero(d.printer_model) || primero(d.printer_settings_id);
  if (!tipo && !impresora) return null;
  return {
    tipo3d: tipo || null,
    densidad: numero(d.filament_density),
    precioKg: numero(d.filament_cost),
    relleno: numero(d.sparse_infill_density),
    paredes: numero(d.wall_loops) || 2,
    boquilla: numero(d.nozzle_diameter) || 0.4,
    alturaCapa: numero(d.layer_height),
    impresora: impresora || null,
  };
}

/**
 * Volumen y superficie de la malla, siguiendo las partes externas.
 *
 * Los proyectos de MakerWorld abiertos en Creality Print, Bambu Studio u Orca
 * no guardan las mallas dentro de 3dmodel.model: cada objeto vive en su propio
 * archivo bajo 3D/Objects/ y se referencia con el atributo p:path de la
 * extensión "production" del formato. Hay que ir a buscarlos.
 */
async function medirModelo(zip, rutaRaiz) {
  const partes = new Map();

  const cargarParte = async (ruta) => {
    const clave = ruta.replace(/^\//, '');
    if (partes.has(clave)) return partes.get(clave);
    let objetos = new Map();
    const datos = await leerEntrada(zip, clave);
    if (datos) {
      const doc = new DOMParser().parseFromString(texto(datos), 'application/xml');
      if (!doc.querySelector('parsererror')) {
        for (const o of doc.querySelectorAll('resources > object')) objetos.set(o.getAttribute('id'), o);
        partes.set(clave, { doc, objetos });
        return partes.get(clave);
      }
    }
    partes.set(clave, { doc: null, objetos });
    return partes.get(clave);
  };

  /** Volumen (mm³) y superficie (mm²) de la malla propia de un objeto. */
  const medirMalla = (objeto) => {
    const malla = objeto.querySelector(':scope > mesh');
    if (!malla) return { v: 0, a: 0 };
    const vs = [...malla.querySelectorAll('vertices > vertex')].map((v) => [
      parseFloat(v.getAttribute('x')) || 0,
      parseFloat(v.getAttribute('y')) || 0,
      parseFloat(v.getAttribute('z')) || 0,
    ]);
    let v6 = 0;
    let a2 = 0;
    for (const t of malla.querySelectorAll('triangles > triangle')) {
      const a = vs[+t.getAttribute('v1')];
      const b = vs[+t.getAttribute('v2')];
      const c = vs[+t.getAttribute('v3')];
      if (!a || !b || !c) continue;
      v6 += a[0] * (b[1] * c[2] - c[1] * b[2])
          - a[1] * (b[0] * c[2] - c[0] * b[2])
          + a[2] * (b[0] * c[1] - c[0] * b[1]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cx = u[1] * w[2] - u[2] * w[1];
      const cy = u[2] * w[0] - u[0] * w[2];
      const cz = u[0] * w[1] - u[1] * w[0];
      a2 += Math.hypot(cx, cy, cz);
    }
    return { v: Math.abs(v6) / 6, a: a2 / 2 };
  };

  /** Factor de escala de una transformada 3mf (12 números, 4×3). */
  const escalaDe = (attr) => {
    if (!attr) return 1;
    const n = attr.trim().split(/\s+/).map(Number);
    if (n.length < 9 || n.some((x) => !Number.isFinite(x))) return 1;
    const det = n[0] * (n[4] * n[8] - n[5] * n[7])
              - n[1] * (n[3] * n[8] - n[5] * n[6])
              + n[2] * (n[3] * n[7] - n[4] * n[6]);
    return Math.abs(det) || 1;
  };

  const medirObjeto = async (ruta, id, visitados) => {
    const marca = `${ruta}#${id}`;
    if (visitados.has(marca)) return { v: 0, a: 0 };
    visitados.add(marca);
    const parte = await cargarParte(ruta);
    const objeto = parte.objetos.get(id);
    if (!objeto) return { v: 0, a: 0 };

    const propio = medirMalla(objeto);
    let v = propio.v;
    let a = propio.a;

    for (const c of objeto.querySelectorAll(':scope > components > component')) {
      const rutaHijo = c.getAttribute('p:path') || c.getAttributeNS('*', 'path') || ruta;
      const escala = escalaDe(c.getAttribute('transform'));
      const hijo = await medirObjeto(rutaHijo, c.getAttribute('objectid'), visitados);
      v += hijo.v * escala;
      a += hijo.a * escala ** (2 / 3);
    }
    return { v, a };
  };

  const raiz = await cargarParte(rutaRaiz);
  if (!raiz.doc) return null;

  const unidad = raiz.doc.documentElement.getAttribute('unit') || 'millimeter';
  const aMm = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unidad] ?? 1;

  let mm3 = 0;
  let mm2 = 0;
  let piezas = 0;
  const items = [...raiz.doc.querySelectorAll('build > item')];
  for (const item of items) {
    if (item.getAttribute('printable') === '0') continue;
    const escala = escalaDe(item.getAttribute('transform'));
    const m = await medirObjeto(rutaRaiz, item.getAttribute('objectid'), new Set());
    mm3 += m.v * escala;
    mm2 += m.a * escala ** (2 / 3);
    piezas++;
  }
  if (!piezas) {
    for (const id of raiz.objetos.keys()) {
      const m = await medirObjeto(rutaRaiz, id, new Set());
      mm3 += m.v;
      mm2 += m.a;
      piezas++;
    }
  }

  if (!(mm3 > 0)) return null;
  return { cm3: (mm3 * aMm ** 3) / 1000, cm2: (mm2 * aMm ** 2) / 100, piezas };
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

const miniatura = async (zip) => {
  for (const candidato of ['Metadata/plate_1.png', 'Metadata/thumbnail.png', 'Metadata/plate_1_small.png']) {
    if (zip.entradas.has(candidato)) {
      const datos = await leerEntrada(zip, candidato);
      if (datos) return URL.createObjectURL(new Blob([datos], { type: 'image/png' }));
    }
  }
  return null;
};

/** Lee un .3mf completo y devuelve todo lo que se pudo averiguar. */
export async function leer3mf(archivo) {
  const zip = await abrirZip(archivo);
  const resultado = { archivo: archivo.name, tipo: '3mf', avisos: [] };

  const nombreSlice = buscarEntrada(zip, 'slice_info.config');
  if (nombreSlice) {
    const info = leerSliceInfo(texto(await leerEntrada(zip, nombreSlice)));
    if (info) {
      Object.assign(resultado, info);
      if (info.placas > 1) {
        resultado.avisos.push(`El proyecto tiene ${info.placas} placas; se usaron los datos de la placa 1.`);
      }
    }
  }

  const nombrePrusa = buscarEntrada(zip, 'Slic3r_PE.config');
  if (nombrePrusa) {
    const cfg = leerConfigPrusa(texto(await leerEntrada(zip, nombrePrusa)));
    if (cfg) {
      resultado.origen = resultado.origen || cfg.origen;
      resultado.tipo3d = cfg.tipo;
      resultado.densidad = cfg.densidad;
      resultado.precioKg = cfg.precioKg;
      resultado.relleno = cfg.relleno;
      resultado.impresora = resultado.impresora || cfg.impresora;
    }
  }

  const nombreAjustes = buscarEntrada(zip, 'project_settings.config');
  if (nombreAjustes) {
    const cfg = leerAjustes(texto(await leerEntrada(zip, nombreAjustes)));
    if (cfg) {
      resultado.tipo3d = resultado.tipo3d || cfg.tipo3d;
      resultado.densidad = resultado.densidad || cfg.densidad;
      resultado.precioKg = resultado.precioKg || cfg.precioKg;
      resultado.relleno = resultado.relleno ?? cfg.relleno;
      resultado.paredes = cfg.paredes;
      resultado.boquilla = cfg.boquilla;
      resultado.alturaCapa = cfg.alturaCapa;
      resultado.impresora = resultado.impresora || cfg.impresora;
      resultado.origen = resultado.origen || 'ajustes del proyecto';
    }
  }

  if (!resultado.gramos) {
    const nombreModelo = buscarEntrada(zip, '3D/3dmodel.model');
    if (nombreModelo) {
      const medida = await medirModelo(zip, nombreModelo);
      if (medida) {
        resultado.volumenCm3 = medida.cm3;
        resultado.superficieCm2 = medida.cm2;
        resultado.piezas = medida.piezas;
        resultado.avisos.push(medida.piezas > 1
          ? `El proyecto no está laminado: los gramos son una estimación de los ${medida.piezas} objetos de la placa. Para el dato exacto, lamina en Creality Print y guarda el proyecto otra vez.`
          : 'El proyecto no está laminado: los gramos son una estimación a partir de la geometría. Para el dato exacto, lamina y guarda el proyecto otra vez.');
      }
    }
  }

  resultado.miniatura = await miniatura(zip);
  if (!resultado.gramos && !resultado.volumenCm3) {
    throw new Error('El archivo no trae mallas ni datos de laminado que se puedan medir. Escribe los gramos y el tiempo a mano.');
  }
  return resultado;
}

/** G-code de PrusaSlicer, Orca, Bambu o Cura: los totales están en comentarios. */
export async function leerGcode(archivo) {
  const trozo = 200 * 1024;
  const cabeza = await archivo.slice(0, Math.min(trozo, archivo.size)).text();
  const cola = archivo.size > trozo ? await archivo.slice(archivo.size - trozo).text() : '';
  const txt = `${cabeza}\n${cola}`;
  const resultado = { archivo: archivo.name, tipo: 'gcode', origen: 'G-code', avisos: [] };

  const sumaLista = (re) => {
    const m = txt.match(re);
    if (!m) return 0;
    return m[1].split(',').reduce((s, x) => s + (parseFloat(x) || 0), 0);
  };

  resultado.gramos = sumaLista(/^;\s*filament used \[g\]\s*[:=]\s*(.+)$/mi)
    || sumaLista(/^;\s*total filament weight \[g\]\s*[:=]\s*(.+)$/mi)
    || sumaLista(/^;\s*Filament weight\s*[:=]\s*(.+)$/mi);

  const hms = txt.match(/^;\s*(?:estimated printing time.*|total estimated time)\s*[:=]\s*(.+)$/mi);
  if (hms) {
    const t = hms[1];
    const d = parseInt(t.match(/(\d+)\s*d/i)?.[1] || '0', 10);
    const h = parseInt(t.match(/(\d+)\s*h/i)?.[1] || '0', 10);
    const m = parseInt(t.match(/(\d+)\s*m/i)?.[1] || '0', 10);
    const s = parseInt(t.match(/(\d+)\s*s/i)?.[1] || '0', 10);
    resultado.segundos = d * 86400 + h * 3600 + m * 60 + s;
  }
  if (!resultado.segundos) {
    const cura = txt.match(/^;TIME:(\d+)/mi);
    if (cura) resultado.segundos = parseInt(cura[1], 10);
  }

  const tipo = txt.match(/^;\s*filament_type\s*=\s*([^;\r\n]+)/mi) || txt.match(/^;\s*filament_settings_id\s*=\s*"?([^";\r\n]+)/mi);
  if (tipo) resultado.tipo3d = tipo[1].trim();
  const precio = txt.match(/^;\s*filament_cost\s*=\s*([\d.]+)/mi);
  if (precio) resultado.precioKg = parseFloat(precio[1]);

  if (!resultado.gramos) {
    const metros = sumaLista(/^;\s*filament used \[mm\]\s*[:=]\s*(.+)$/mi) / 1000
      || (parseFloat(txt.match(/^;Filament used:\s*([\d.]+)m/mi)?.[1] || '0'));
    if (metros > 0) {
      const densidad = parseFloat(txt.match(/^;\s*filament_density\s*=\s*([\d.]+)/mi)?.[1] || '1.24');
      const diametro = parseFloat(txt.match(/^;\s*filament_diameter\s*=\s*([\d.]+)/mi)?.[1] || '1.75');
      const areaCm2 = Math.PI * (diametro / 20) ** 2;
      resultado.gramos = metros * 100 * areaCm2 * densidad;
      resultado.avisos.push('El G-code no traía el peso; se calculó a partir de los metros de filamento.');
    }
  }

  if (!resultado.gramos && !resultado.segundos) {
    throw new Error('No se encontraron los totales del laminado en el G-code.');
  }
  return resultado;
}

/** Punto de entrada único: decide según la extensión del archivo. */
export async function importarArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.3mf')) return leer3mf(archivo);
  if (nombre.endsWith('.gcode') || nombre.endsWith('.gco') || nombre.endsWith('.g')) return leerGcode(archivo);
  throw new Error('Formato no soportado. Sube un .3mf o un .gcode.');
}
