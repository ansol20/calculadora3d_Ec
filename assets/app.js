/** Interfaz de la calculadora: lee el formulario, calcula y pinta el ticket. */
import {
  calcular, formatoDuracion, num,
  MATERIALES, MEDIOS_COBRO, RETENCIONES, TIPOS_IMPRESORA, VALORES_INICIALES,
} from './calc.js';
import { importarArchivo, estimarGramos } from './importar.js';

const $ = (id) => document.getElementById(id);
const CLAVE_ESTADO = 'costeo3d-ec:estado';
const CLAVE_PERFILES = 'costeo3d-ec:perfiles';

const usd = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' });
const usdFino = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 });
const dec = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 });
const dinero = (n) => usd.format(Number.isFinite(n) ? n : 0);
const numero = (n, d = 2) => new Intl.NumberFormat('es-EC', { maximumFractionDigits: d }).format(Number.isFinite(n) ? n : 0);

const COLOR = {
  material: '--c1', energia: '--c4', maquina: '--c2', consumibles: '--c5',
  manoObra: '--c3', riesgo: '--c6', empaque: '--c7', diseno: '--c-diseno',
  envio: '--c-envio', comision: '--c-comision', utilidad: '--c-utilidad',
};

let estado = estructurar(VALORES_INICIALES);

function estructurar(base) {
  return { ...base, materiales: base.materiales.map((m) => ({ ...m })) };
}

/* ── Poblar los selects fijos ─────────────────────────────────────────── */
function poblarSelects() {
  const lista = document.createElement('datalist');
  lista.id = 'lista-materiales';
  for (const m of MATERIALES) {
    const o = document.createElement('option');
    o.value = m.nombre;
    o.label = `${dinero(m.precioBobina)} / kg`;
    lista.append(o);
  }
  document.body.append(lista);

  const medio = $('medioCobro');
  MEDIOS_COBRO.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = String(m.valor);
    o.textContent = m.valor > 0 ? `${m.etiqueta} — ${dec.format(m.valor)} %` : m.etiqueta;
    o.dataset.indice = String(i);
    medio.append(o);
  });

  const tipo = $('tipoImpresora');
  tipo.innerHTML = '<option value="">Elige para autocompletar…</option>';
  for (const t of TIPOS_IMPRESORA) {
    const o = document.createElement('option');
    o.value = String(t.potenciaW);
    o.textContent = `${t.etiqueta} — ${t.potenciaW} W`;
    tipo.append(o);
  }

  for (const [id, opciones] of [['retRentaPct', RETENCIONES.renta], ['retIvaPct', RETENCIONES.iva]]) {
    const sel = $(id);
    for (const o of opciones) {
      const op = document.createElement('option');
      op.value = String(o.valor);
      op.textContent = o.etiqueta;
      sel.append(op);
    }
  }
}

/* ── Filamentos ───────────────────────────────────────────────────────── */
function pintarMateriales() {
  const cont = $('materiales');
  cont.textContent = '';
  estado.materiales.forEach((m, i) => {
    const fila = document.createElement('div');
    fila.className = 'material';
    fila.style.borderLeftColor = `var(${['--c1', '--c3', '--c5', '--c7'][i % 4]})`;
    fila.innerHTML = `
      <label class="campo">
        <span class="campo__nombre">Material</span>
        <span class="campo__control"><input type="text" id="mat-nombre-${i}" list="lista-materiales" data-m="nombre" autocomplete="off"></span>
      </label>
      <label class="campo">
        <span class="campo__nombre">Precio bobina</span>
        <span class="campo__control"><span class="campo__unidad campo__unidad--izq">$</span><input type="number" id="mat-precio-${i}" data-m="precioBobina" min="0" step="0.5" inputmode="decimal"></span>
      </label>
      <label class="campo">
        <span class="campo__nombre">Bobina de</span>
        <span class="campo__control"><input type="number" id="mat-peso-${i}" data-m="pesoBobina" min="1" step="50" inputmode="numeric"><span class="campo__unidad">g</span></span>
      </label>
      <label class="campo">
        <span class="campo__nombre">Usados</span>
        <span class="campo__control"><input type="number" id="mat-gramos-${i}" data-m="gramos" min="0" step="1" inputmode="decimal"><span class="campo__unidad">g</span></span>
      </label>
      <button type="button" class="material__quitar" data-quitar="${i}" aria-label="Quitar este filamento" title="Quitar">&times;</button>
      <p class="material__resumen mono" id="mat-resumen-${i}"></p>`;

    fila.querySelector('[data-m="nombre"]').value = m.nombre ?? '';
    fila.querySelector('[data-m="precioBobina"]').value = m.precioBobina ?? '';
    fila.querySelector('[data-m="pesoBobina"]').value = m.pesoBobina ?? '';
    fila.querySelector('[data-m="gramos"]').value = m.gramos ?? '';
    fila.querySelector('[data-quitar]').hidden = estado.materiales.length < 2;
    cont.append(fila);
  });
}

function leerMateriales() {
  estado.materiales = [...document.querySelectorAll('.material')].map((fila) => ({
    nombre: fila.querySelector('[data-m="nombre"]').value,
    precioBobina: num(fila.querySelector('[data-m="precioBobina"]').value),
    pesoBobina: num(fila.querySelector('[data-m="pesoBobina"]').value, 1000),
    gramos: num(fila.querySelector('[data-m="gramos"]').value),
  }));
}

/* ── Formulario ───────────────────────────────────────────────────────── */
function pintarFormulario() {
  for (const el of document.querySelectorAll('[data-campo]')) {
    const clave = el.dataset.campo;
    if (el.type === 'checkbox') el.checked = estado[clave] !== false;
    else el.value = estado[clave] ?? '';
  }
  const medio = MEDIOS_COBRO.findIndex((m) => m.valor === num(estado.comisionPct));
  $('medioCobro').value = medio >= 0 ? String(MEDIOS_COBRO[medio].valor) : String(MEDIOS_COBRO[0].valor);
  pintarMateriales();
}

function leerFormulario() {
  for (const el of document.querySelectorAll('[data-campo]')) {
    const clave = el.dataset.campo;
    if (el.type === 'checkbox') estado[clave] = el.checked;
    else if (el.type === 'text') estado[clave] = el.value;
    else estado[clave] = num(el.value);
  }
  leerMateriales();
}

/* ── Pintar resultados ────────────────────────────────────────────────── */
function pintar() {
  const r = calcular(estado);
  const piezas = r.cantidad === 1 ? '1 pieza' : `${r.cantidad} piezas`;

  $('r-total').textContent = dinero(r.pedido.total);
  $('r-total-movil').textContent = dinero(r.pedido.total);
  $('r-total-nota').textContent = r.pedido.ivaPct > 0
    ? `${piezas} · IVA ${numero(r.pedido.ivaPct, 0)} % incluido`
    : `${piezas} · sin IVA`;

  $('r-unitario').textContent = dinero(r.metricas.precioUnitarioConIva);
  $('r-costo').textContent = dinero(r.pedido.costoTotal + r.pedido.envio);
  $('r-utilidad').textContent = dinero(r.pedido.utilidad);

  $('r-produccion').textContent = dinero(r.pedido.produccion);
  $('r-diseno').textContent = dinero(r.pedido.diseno);
  $('r-utilidad2').textContent = dinero(r.pedido.utilidad);
  $('r-margen').textContent = `${numero(r.metricas.margenReal, 0)} % del precio`;
  $('r-envio').textContent = dinero(r.pedido.envio);
  $('r-comision').textContent = dinero(r.pedido.comision);
  $('r-subtotal').textContent = dinero(r.pedido.precioSinIva);
  $('r-iva-pct').textContent = `${numero(r.pedido.ivaPct, 0)} %`;
  $('r-iva').textContent = dinero(r.pedido.iva);
  $('r-facturar').textContent = dinero(r.pedido.total);

  const hayRet = r.fiscal.retRenta > 0 || r.fiscal.retIva > 0;
  $('retenciones').hidden = !hayRet;
  if (hayRet) {
    $('r-ret-renta').textContent = `−${dinero(r.fiscal.retRenta)}`;
    $('r-ret-iva').textContent = `−${dinero(r.fiscal.retIva)}`;
    $('r-recibir').textContent = dinero(r.fiscal.aRecibir);
  }

  $('m-hora').textContent = `${dinero(r.horaMaquina)} / h`;
  $('m-gramo').textContent = `${usdFino.format(r.metricas.costoPorGramo)} / g`;
  $('m-ingreso').textContent = `${dinero(r.metricas.ingresoPorHora)} / h`;
  $('m-kwh').textContent = `${numero(r.kwh, 2)} kWh`;
  $('m-gramos').textContent = `${numero(r.gramosTotales, 1)} g`;
  $('m-tiempo').textContent = formatoDuracion(r.tiempoH * r.cantidad);

  // Barra y leyenda
  const suma = r.desglose.reduce((s, d) => s + d.valor, 0) || 1;
  $('barra').innerHTML = r.desglose
    .map((d) => `<span style="width:${(d.valor / suma) * 100}%;background:var(${COLOR[d.clave]})"></span>`)
    .join('');
  $('barra').setAttribute('aria-label', `Composición del precio: ${r.desglose.map((d) => `${d.etiqueta} ${dinero(d.valor)}`).join(', ')}.`);
  $('leyenda').innerHTML = r.desglose
    .map((d) => `<li><i style="background:var(${COLOR[d.clave]})"></i>${d.etiqueta}<b>${dinero(d.valor)}</b></li>`)
    .join('');

  // Resumen por filamento
  r.unidad.detalleMaterial.forEach((m, i) => {
    const el = $(`mat-resumen-${i}`);
    if (el) el.textContent = m.gramos > 0
      ? `${numero(m.gramos, 1)} g · ${dinero(m.precioGramo * 1000)} el kg · ${dinero(m.costo)} por pieza`
      : 'Sin consumo';
  });

  return r;
}

/* ── Importar .3mf / .gcode ───────────────────────────────────────────── */
let importacion = null;      // última ficha leída
let bandejaSel = '1';        // '1', '2'… o 'todas'
let rellenoSel = 15;

const bandejasElegidas = (info, seleccion) => (seleccion === 'todas'
  ? info.bandejas
  : info.bandejas.filter((b) => String(b.indice) === String(seleccion)));

/** Busca el precio y la densidad que ya conocemos para un tipo de filamento. */
const preset = (nombre) => MATERIALES.find((m) => m.nombre.toLowerCase() === String(nombre || '').toLowerCase())
  || MATERIALES.find((m) => String(nombre || '').toUpperCase().startsWith(m.nombre.toUpperCase()));

function aplicarImportacion() {
  const info = importacion;
  if (!info) return;
  const elegidas = bandejasElegidas(info, bandejaSel);
  if (!elegidas.length) return;

  const segundos = elegidas.reduce((s, b) => s + (b.segundos || 0), 0);
  if (segundos > 0) {
    estado.horas = Math.floor(segundos / 3600);
    estado.minutos = Math.round((segundos % 3600) / 60);
  }

  // Un renglón por tipo de filamento, sumando las bandejas elegidas.
  const porTipo = new Map();
  for (const b of elegidas) {
    for (const f of b.filamentos || []) {
      const clave = f.tipo || info.tipo3d || 'PLA';
      porTipo.set(clave, (porTipo.get(clave) || 0) + f.gramos);
    }
  }

  const nombreBonito = (tipo) => {
    const comercial = String(info.filamento || '').trim();
    if (!comercial) return tipo;
    // "Hyper PLA" ya dice de qué material es; no lo repitas.
    return comercial.toUpperCase().includes(String(tipo).toUpperCase()) ? comercial : `${comercial} ${tipo}`;
  };

  if (porTipo.size) {
    estado.materiales = [...porTipo].map(([tipo, gramos]) => {
      const p = preset(tipo);
      return {
        nombre: porTipo.size === 1 ? nombreBonito(tipo) : tipo,
        precioBobina: info.precioKg || p?.precioBobina || 22,
        pesoBobina: 1000,
        gramos: Math.round(gramos * 10) / 10,
      };
    });
  } else {
    const gramosLaminados = elegidas.reduce((s, b) => s + (b.gramos || 0), 0);
    const tipo = info.tipo3d || 'PLA';
    const p = preset(tipo);
    let gramos = gramosLaminados;

    if (!gramos) {
      const volumen = elegidas.reduce((s, b) => s + (b.volumenCm3 || 0), 0);
      const superficie = elegidas.reduce((s, b) => s + (b.superficieCm2 || 0), 0);
      if (volumen > 0) {
        gramos = estimarGramos({
          volumenCm3: volumen,
          superficieCm2: superficie,
          densidad: info.densidad || p?.densidad || 1.24,
          rellenoPct: rellenoSel,
          paredes: info.paredes,
          boquilla: info.boquilla,
        });
      }
    }

    if (gramos > 0) {
      estado.materiales = [{
        nombre: nombreBonito(tipo),
        precioBobina: info.precioKg || p?.precioBobina || 22,
        pesoBobina: 1000,
        gramos: Math.round(gramos * 10) / 10,
      }];
    }
  }

  if (info.impresora && !String(estado.modeloImpresora || '').trim()) {
    estado.modeloImpresora = info.impresora;
  }

  pintarFormulario();
  pintar();
  guardar();
}

function tarjetaImportacion() {
  const info = importacion;
  const caja = $('importado');
  caja.hidden = false;
  caja.className = 'importado';

  const elegidas = bandejasElegidas(info, bandejaSel);
  const segundos = elegidas.reduce((s, b) => s + (b.segundos || 0), 0);
  const gramos = elegidas.reduce((s, b) => s + (b.gramos || 0), 0);
  const metros = elegidas.reduce((s, b) => s + (b.metros || 0), 0);
  const volumen = elegidas.reduce((s, b) => s + (b.volumenCm3 || 0), 0);
  const objetos = elegidas.flatMap((b) => b.objetos || []);
  const estimando = !gramos && volumen > 0;

  const etiquetaBandeja = (b) => {
    const partes = [];
    if (b.segundos) partes.push(formatoDuracion(b.segundos / 3600));
    if (b.gramos) partes.push(`${numero(b.gramos, 1)} g`);
    else if (b.volumenCm3) partes.push(`${numero(b.volumenCm3, 0)} cm³`);
    if (b.objetos?.length) partes.push(`${b.objetos.length} ${b.objetos.length === 1 ? 'objeto' : 'objetos'}`);
    return `Bandeja ${b.indice}${b.nombre ? ` · ${b.nombre}` : ''}${partes.length ? ` — ${partes.join(' · ')}` : ''}`;
  };

  const ficha = [
    info.impresora ? ['Impresora', info.impresora] : null,
    info.perfil ? ['Perfil', info.perfil] : null,
    info.filamento || info.tipo3d ? ['Filamento', [info.filamento || info.tipo3d, info.marca ? `(${info.marca})` : ''].join(' ').trim()] : null,
    info.alturaCapa ? ['Capa y boquilla', `${numero(info.alturaCapa, 2)} mm · boquilla ${numero(info.boquilla || 0.4, 2)} mm`] : null,
    info.relleno != null ? ['Relleno del perfil', `${numero(info.relleno, 0)} %`] : null,
    gramos ? ['Filamento usado', `${numero(gramos, 2)} g${metros ? ` · ${numero(metros, 2)} m` : ''}`] : null,
    !gramos && volumen ? ['Volumen medido', `${numero(volumen, 1)} cm³`] : null,
    segundos ? ['Tiempo de impresión', formatoDuracion(segundos / 3600)] : null,
    objetos.length ? ['Objetos', objetos.slice(0, 6).join(', ') + (objetos.length > 6 ? ` y ${objetos.length - 6} más` : '')] : null,
  ].filter(Boolean);

  const opciones = [
    ...info.bandejas.map((b) => `<option value="${b.indice}"${String(b.indice) === bandejaSel ? ' selected' : ''}>${etiquetaBandeja(b)}</option>`),
    info.bandejas.length > 1
      ? `<option value="todas"${bandejaSel === 'todas' ? ' selected' : ''}>Las ${info.bandejas.length} bandejas juntas</option>`
      : '',
  ].join('');

  caja.innerHTML = `
    ${info.miniatura ? `<img src="${elegidas[0]?.miniatura || info.miniatura}" alt="Vista previa de la bandeja">` : ''}
    <div class="importado__cuerpo">
      <span class="importado__titulo">${info.archivo}</span>
      <span class="importado__aviso">Leído ${info.origen || 'del archivo'}.</span>

      ${info.bandejas.length > 1 ? `
        <label class="importado__campo">Qué costeo
          <select id="sel-bandeja">${opciones}</select>
        </label>` : ''}

      ${ficha.length ? `<dl class="ficha">${ficha.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}

      ${estimando ? `
        <label class="importado__campo">Relleno para estimar
          <select id="relleno-import">
            ${[10, 15, 20, 25, 40, 60, 100].map((v) => `<option value="${v}"${v === rellenoSel ? ' selected' : ''}>${v} %</option>`).join('')}
          </select>
        </label>` : ''}

      ${(info.avisos || []).map((a) => `<span class="importado__aviso"><strong>Ojo:</strong> ${a}</span>`).join('')}
      ${!segundos ? '<span class="importado__aviso"><strong>Ojo:</strong> falta el tiempo de impresión. Escríbelo abajo.</span>' : ''}
    </div>`;

  $('sel-bandeja')?.addEventListener('change', (ev) => {
    bandejaSel = ev.target.value;
    aplicarImportacion();
    tarjetaImportacion();
  });

  $('relleno-import')?.addEventListener('change', (ev) => {
    rellenoSel = num(ev.target.value, 15);
    aplicarImportacion();
    tarjetaImportacion();
  });
}

async function manejarArchivo(archivo) {
  if (!archivo) return;
  const caja = $('importado');
  caja.hidden = false;
  caja.className = 'importado';
  caja.innerHTML = `<div class="importado__cuerpo"><span class="importado__titulo">Leyendo ${archivo.name}…</span></div>`;
  try {
    importacion = await importarArchivo(archivo);
    bandejaSel = String(importacion.bandejas[0]?.indice ?? 1);
    rellenoSel = importacion.relleno != null ? num(importacion.relleno, 15) : 15;
    aplicarImportacion();
    tarjetaImportacion();
  } catch (err) {
    importacion = null;
    caja.className = 'importado importado--error';
    caja.innerHTML = `<div class="importado__cuerpo">
      <span class="importado__titulo">No se pudo leer ${archivo.name}</span>
      <span class="importado__aviso">${err.message}</span>
      <span class="importado__aviso">Puedes escribir los gramos y el tiempo a mano: el resto del cálculo funciona igual.</span>
    </div>`;
  }
}

/* ── Persistencia ─────────────────────────────────────────────────────── */
function guardar() {
  try { localStorage.setItem(CLAVE_ESTADO, JSON.stringify(estado)); } catch { /* modo privado */ }
}

function cargar() {
  try {
    const crudo = localStorage.getItem(CLAVE_ESTADO);
    if (!crudo) return;
    const datos = JSON.parse(crudo);
    if (datos && typeof datos === 'object') {
      estado = estructurar({ ...VALORES_INICIALES, ...datos, materiales: datos.materiales?.length ? datos.materiales : VALORES_INICIALES.materiales });
    }
  } catch { /* datos corruptos: se ignoran */ }
}

const leerPerfiles = () => {
  try { return JSON.parse(localStorage.getItem(CLAVE_PERFILES) || '{}'); } catch { return {}; }
};

function pintarPerfiles() {
  const sel = $('perfiles');
  const perfiles = leerPerfiles();
  sel.innerHTML = '<option value="">Perfiles…</option>';
  for (const nombre of Object.keys(perfiles)) {
    const o = document.createElement('option');
    o.value = nombre;
    o.textContent = nombre;
    sel.append(o);
  }
}

/* ── Cotización en texto ──────────────────────────────────────────────── */
function textoCotizacion() {
  const r = calcular(estado);
  const filas = [
    ['Costo de producción', r.pedido.produccion],
    r.pedido.diseno > 0 ? ['Diseño', r.pedido.diseno] : null,
    ['Utilidad', r.pedido.utilidad],
    r.pedido.envio > 0 ? ['Envío', r.pedido.envio] : null,
    r.pedido.comision > 0 ? ['Comisión de cobro', r.pedido.comision] : null,
  ].filter(Boolean);

  const materiales = estado.materiales
    .filter((m) => num(m.gramos) > 0)
    .map((m) => `${m.nombre} ${numero(num(m.gramos), 1)} g`)
    .join(' + ');

  const linea = (a, b) => `${a.padEnd(24, ' ')}${dinero(b).padStart(11, ' ')}`;

  const impresora = String(estado.modeloImpresora || '').trim();

  return [
    'COTIZACIÓN — IMPRESIÓN 3D',
    `${r.cantidad} ${r.cantidad === 1 ? 'pieza' : 'piezas'} · ${materiales || 'sin material'} · ${formatoDuracion(r.tiempoH)} por pieza`,
    impresora ? `Impresora: ${impresora}` : null,
    ''.padEnd(35, '-'),
    ...filas.map(([a, b]) => linea(a, b)),
    linea('Subtotal', r.pedido.precioSinIva),
    r.pedido.ivaPct > 0 ? linea(`IVA ${numero(r.pedido.ivaPct, 0)} %`, r.pedido.iva) : 'Sin IVA',
    ''.padEnd(35, '-'),
    linea('TOTAL', r.pedido.total),
    `Precio por pieza: ${dinero(r.metricas.precioUnitarioConIva)}`,
    r.fiscal.retRenta + r.fiscal.retIva > 0 ? `Con retenciones recibes: ${dinero(r.fiscal.aRecibir)}` : null,
  ].filter(Boolean).join('\n');
}

/** Mensaje breve en la esquina, sin usar alert(). */
function avisar(texto) {
  let caja = $('aviso');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'aviso';
    caja.className = 'aviso';
    caja.setAttribute('role', 'status');
    document.body.append(caja);
  }
  caja.textContent = texto;
  caja.classList.add('aviso--visible');
  clearTimeout(caja.dataset.t);
  caja.dataset.t = setTimeout(() => caja.classList.remove('aviso--visible'), 2200);
}

/* ── Arranque ─────────────────────────────────────────────────────────── */
function iniciar() {
  poblarSelects();
  cargar();
  pintarFormulario();
  pintarPerfiles();
  pintar();

  const alCambiar = () => { leerFormulario(); pintar(); guardar(); };
  $('formulario').addEventListener('input', alCambiar);
  $('formulario').addEventListener('change', alCambiar);

  $('medioCobro').addEventListener('change', (ev) => {
    $('comisionPct').value = ev.target.value;
    alCambiar();
  });

  $('comisionPct').addEventListener('input', () => {
    const v = num($('comisionPct').value);
    const coincide = MEDIOS_COBRO.find((m) => m.valor === v);
    $('medioCobro').value = coincide ? String(coincide.valor) : '';
  });

  $('tipoImpresora').addEventListener('change', (ev) => {
    if (!ev.target.value) return;
    $('potenciaW').value = ev.target.value;
    alCambiar();
  });

  $('btn-material').addEventListener('click', () => {
    leerFormulario();
    estado.materiales.push({ nombre: 'PETG', precioBobina: 26, pesoBobina: 1000, gramos: 0 });
    pintarMateriales();
    pintar();
    guardar();
  });

  $('materiales').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-quitar]');
    if (!btn) return;
    leerFormulario();
    estado.materiales.splice(Number(btn.dataset.quitar), 1);
    if (!estado.materiales.length) estado.materiales = estructurar(VALORES_INICIALES).materiales;
    pintarMateriales();
    pintar();
    guardar();
  });

  // Archivo: clic, teclado y arrastrar
  const soltar = $('soltar');
  soltar.addEventListener('click', () => $('archivo').click());
  soltar.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('archivo').click(); }
  });
  $('archivo').addEventListener('change', (ev) => manejarArchivo(ev.target.files[0]));
  for (const evento of ['dragenter', 'dragover']) {
    soltar.addEventListener(evento, (ev) => { ev.preventDefault(); soltar.classList.add('activa'); });
  }
  for (const evento of ['dragleave', 'drop']) {
    soltar.addEventListener(evento, (ev) => { ev.preventDefault(); soltar.classList.remove('activa'); });
  }
  soltar.addEventListener('drop', (ev) => manejarArchivo(ev.dataTransfer?.files?.[0]));
  document.addEventListener('dragover', (ev) => ev.preventDefault());
  document.addEventListener('drop', (ev) => ev.preventDefault());

  // Perfiles
  $('btn-perfil-guardar').addEventListener('click', () => {
    const campo = $('perfil-nombre');
    campo.hidden = false;
    campo.value = campo.value || 'Mi impresora';
    campo.focus();
    campo.select();
  });

  $('perfil-nombre').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.currentTarget.hidden = true; return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const nombre = ev.currentTarget.value.trim();
    if (!nombre) return;
    const perfiles = leerPerfiles();
    perfiles[nombre] = estado;
    try { localStorage.setItem(CLAVE_PERFILES, JSON.stringify(perfiles)); } catch { /* modo privado */ }
    pintarPerfiles();
    $('perfiles').value = nombre;
    ev.currentTarget.hidden = true;
    avisar('Perfil guardado');
  });

  $('perfil-nombre').addEventListener('blur', (ev) => { ev.currentTarget.hidden = true; });

  $('perfiles').addEventListener('change', (ev) => {
    const perfil = leerPerfiles()[ev.target.value];
    if (!perfil) return;
    estado = estructurar({ ...VALORES_INICIALES, ...perfil });
    pintarFormulario();
    pintar();
    guardar();
  });

  $('btn-reset').addEventListener('click', () => {
    estado = estructurar(VALORES_INICIALES);
    pintarFormulario();
    pintar();
    guardar();
    importacion = null;
    $('importado').hidden = true;
  });

  // Acciones del ticket
  $('btn-imprimir').addEventListener('click', () => window.print());
  $('btn-copiar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(textoCotizacion());
      btn.textContent = 'Copiada';
    } catch {
      btn.textContent = 'No se pudo copiar';
    }
    setTimeout(() => { btn.textContent = original; }, 1800);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
