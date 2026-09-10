/** Interfaz de la calculadora: lee el formulario, calcula y pinta el ticket. */
import {
  calcular, formatoDuracion, num, precioConMargen,
  MATERIALES, MEDIOS_COBRO, RETENCIONES, TIPOS_IMPRESORA, VALORES_INICIALES,
} from './calc.js';
import { importarArchivo, estimarGramos } from './importar.js';

const $ = (id) => document.getElementById(id);
const CLAVE_ESTADO = 'costeo3d-ec:estado';
const CLAVE_PERFILES = 'costeo3d-ec:perfiles';

const usd = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' });
const usdFino = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 });
const dinero = (n) => usd.format(Number.isFinite(n) ? n : 0);
const numero = (n, d = 2) => new Intl.NumberFormat('es-EC', { maximumFractionDigits: d }).format(Number.isFinite(n) ? n : 0);
const escapar = (t) => String(t ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const COLOR = {
  material: '--c1', energia: '--c4', maquina: '--c2', consumibles: '--c5',
  manoObra: '--c3', riesgo: '--c6', empaque: '--c7', diseno: '--c-diseno',
  envio: '--c-envio', comision: '--c-comision', utilidad: '--c-utilidad',
};

const ESCALONES = [
  { nombre: 'Ajustado', pct: 25, pista: 'para clientes que repiten' },
  { nombre: 'Recomendado', pct: 45, pista: 'pieza a pedido' },
  { nombre: 'Premium', pct: 90, pista: 'diseño y acabado' },
];

let estado = estructurar(VALORES_INICIALES);
let importacion = null;              // ficha del último archivo leído
let seleccion = new Set();           // objetos marcados: "bandeja:idObjeto"
let rellenoSel = 15;                 // relleno con el que se estima
let objetosSel = 0;                  // cuántos objetos entran en una copia

function estructurar(base) {
  return { ...base, materiales: base.materiales.map((m) => ({ ...m })) };
}

/* ── Selects fijos ────────────────────────────────────────────────────── */
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
  for (const m of MEDIOS_COBRO) {
    const o = document.createElement('option');
    o.value = String(m.valor);
    o.textContent = m.valor > 0 ? `${m.etiqueta} — ${numero(m.valor, 1)} %` : m.etiqueta;
    medio.append(o);
  }

  const tipo = $('tipoImpresora');
  tipo.innerHTML = '<option value="">Elige la más parecida…</option>';
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
  const coincide = MEDIOS_COBRO.find((m) => m.valor === num(estado.comisionPct));
  $('medioCobro').value = coincide ? String(coincide.valor) : '';
  marcarModoMargen();
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

/** Marca visualmente cuál de los dos campos de margen manda. */
function marcarModoMargen() {
  const monto = estado.margenModo === 'monto';
  $('margenPct').closest('.campo').style.opacity = monto ? '.5' : '1';
  $('margenMonto').closest('.campo').style.opacity = monto ? '1' : '.5';
}

/* ── Resultados ───────────────────────────────────────────────────────── */

/** Cómo se llama lo que estamos costeando: una pieza o un juego de objetos. */
function etiquetaUnidad() {
  if (objetosSel > 1) return { corta: `Por juego de ${objetosSel}`, larga: `juego de ${objetosSel} objetos` };
  return { corta: 'Por pieza', larga: 'pieza' };
}

function pintar() {
  const r = calcular(estado);
  const unidad = etiquetaUnidad();
  const veces = r.cantidad === 1 ? '' : `${r.cantidad} × `;

  $('r-total').textContent = dinero(r.pedido.total);
  $('r-total-movil').textContent = dinero(r.pedido.total);
  $('r-total-nota').textContent = `${veces}${unidad.larga}${r.pedido.ivaPct > 0 ? ` · IVA ${numero(r.pedido.ivaPct, 0)} % incluido` : ' · sin IVA'}`;

  $('r-unitario-et').textContent = unidad.corta;
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

  const suma = r.desglose.reduce((s, d) => s + d.valor, 0) || 1;
  $('barra').innerHTML = r.desglose
    .map((d) => `<span style="width:${(d.valor / suma) * 100}%;background:var(${COLOR[d.clave]})"></span>`)
    .join('');
  $('barra').setAttribute('aria-label', `Composición del precio: ${r.desglose.map((d) => `${d.etiqueta} ${dinero(d.valor)}`).join(', ')}.`);
  $('leyenda').innerHTML = r.desglose
    .map((d) => `<li><i style="background:var(${COLOR[d.clave]})"></i>${d.etiqueta}<b>${dinero(d.valor)}</b></li>`)
    .join('');

  r.unidad.detalleMaterial.forEach((m, i) => {
    const el = $(`mat-resumen-${i}`);
    if (el) {
      el.textContent = m.gramos > 0
        ? `${numero(m.gramos, 1)} g · ${dinero(m.precioGramo * 1000)} el kg · ${dinero(m.costo)} por ${unidad.corta.toLowerCase().replace('por ', '')}`
        : 'Sin consumo';
    }
  });

  pintarEscalones();
  pintarResumenes(r);
  return r;
}

/** Tres precios de referencia; al hacer clic, ese margen se aplica. */
function pintarEscalones() {
  const activo = estado.margenModo !== 'monto' ? num(estado.margenPct) : null;
  $('escalones').innerHTML = ESCALONES.map((e) => `
    <button type="button" class="escalon" data-pct="${e.pct}" aria-pressed="${activo === e.pct}">
      <span class="escalon__nombre">${e.nombre}</span>
      <span class="escalon__pct">${e.pct} % · ${e.pista}</span>
      <span class="escalon__precio">${dinero(precioConMargen(estado, e.pct))}</span>
    </button>`).join('');
}

/** Lo esencial de cada sección plegada, para no tener que abrirla. */
function pintarResumenes(r) {
  $('res-maquina').textContent = [
    String(estado.modeloImpresora || '').trim() || 'sin modelo',
    `${numero(estado.potenciaW, 0)} W`,
    `${dinero(r.horaMaquina)}/h de máquina`,
  ].join(' · ');

  $('res-taller').textContent = [
    `${numero(num(estado.prepMin) + num(estado.postMin), 0)} min de trabajo`,
    `${dinero(estado.tarifaManoObra)}/h`,
    `${numero(estado.fallosPct, 0)} % de fallos`,
  ].join(' · ');

  const extras = [];
  if (num(estado.empaqueUnit) > 0) extras.push(`empaque ${dinero(estado.empaqueUnit)}`);
  if (num(estado.envio) > 0) extras.push(`envío ${dinero(estado.envio)}`);
  if (num(estado.comisionPct) > 0) extras.push(`comisión ${numero(estado.comisionPct, 1)} %`);
  $('res-extras').textContent = extras.length ? extras.join(' · ') : 'sin empaque, envío ni comisiones';

  const ret = [];
  if (num(estado.retRentaPct) > 0) ret.push(`renta ${numero(estado.retRentaPct, 2)} %`);
  if (num(estado.retIvaPct) > 0) ret.push(`IVA ${numero(estado.retIvaPct, 0)} %`);
  $('res-sri').textContent = ret.length ? `${ret.join(' · ')} · recibes ${dinero(r.fiscal.aRecibir)}` : 'sin retenciones';
}

/* ── Importar .3mf / .gcode ───────────────────────────────────────────── */

const preset = (nombre) => MATERIALES.find((m) => m.nombre.toLowerCase() === String(nombre || '').toLowerCase())
  || MATERIALES.find((m) => String(nombre || '').toUpperCase().startsWith(m.nombre.toUpperCase()));

/** Gramos de un objeto; si la bandeja no está laminada, se estiman al vuelo. */
function gramosDe(bandeja, objeto) {
  if (!bandeja.estimado) return objeto.gramos || 0;
  return estimarGramos({
    volumenCm3: objeto.volumenCm3 || 0,
    superficieCm2: objeto.superficieCm2 || 0,
    densidad: importacion?.densidad || preset(importacion?.tipo3d)?.densidad || 1.24,
    rellenoPct: rellenoSel,
    paredes: importacion?.paredes,
    boquilla: importacion?.boquilla,
  });
}

const marcado = (b, o) => seleccion.has(`${b.indice}:${o.id}`);

/** Suma de lo que está marcado, repartiendo los filamentos de cada bandeja. */
function totalesSeleccion() {
  const info = importacion;
  const t = { segundos: 0, gramos: 0, objetos: 0, porTipo: new Map(), estimado: false };
  if (!info) return t;

  for (const b of info.bandejas) {
    const sel = b.objetos.filter((o) => marcado(b, o));
    if (!sel.length) continue;
    const gramosBandeja = b.objetos.reduce((s, o) => s + gramosDe(b, o), 0);
    const gramosSel = sel.reduce((s, o) => s + gramosDe(b, o), 0);

    t.objetos += sel.length;
    t.gramos += gramosSel;
    t.segundos += sel.reduce((s, o) => s + (o.segundos || 0), 0);
    if (b.estimado) t.estimado = true;

    const parte = gramosBandeja > 0 ? gramosSel / gramosBandeja : 0;
    if (b.filamentos?.length) {
      for (const f of b.filamentos) t.porTipo.set(f.tipo, (t.porTipo.get(f.tipo) || 0) + f.gramos * parte);
    } else {
      const tipo = info.tipo3d || 'PLA';
      t.porTipo.set(tipo, (t.porTipo.get(tipo) || 0) + gramosSel);
    }
  }
  return t;
}

function aplicarImportacion() {
  const info = importacion;
  if (!info) return;
  const t = totalesSeleccion();
  objetosSel = t.objetos;

  if (t.segundos > 0) {
    estado.horas = Math.floor(t.segundos / 3600);
    estado.minutos = Math.round((t.segundos % 3600) / 60);
  }

  const nombreBonito = (tipo) => {
    const comercial = String(info.filamento || '').trim();
    if (!comercial) return tipo;
    return comercial.toUpperCase().includes(String(tipo).toUpperCase()) ? comercial : `${comercial} ${tipo}`;
  };

  const tipos = [...t.porTipo].filter(([, g]) => g > 0.01);
  if (tipos.length) {
    estado.materiales = tipos.map(([tipo, gramos]) => {
      const p = preset(tipo);
      return {
        nombre: tipos.length === 1 ? nombreBonito(tipo) : tipo,
        precioBobina: info.precioKg || p?.precioBobina || 22,
        pesoBobina: 1000,
        gramos: Math.round(gramos * 10) / 10,
      };
    });
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

  const t = totalesSeleccion();
  const estimando = info.bandejas.some((b) => b.estimado);
  const bandejaVista = info.bandejas.find((b) => b.objetos.some((o) => marcado(b, o))) || info.bandejas[0];

  const ficha = [
    info.impresora ? ['Impresora', info.impresora] : null,
    info.perfil ? ['Perfil', info.perfil] : null,
    info.filamento || info.tipo3d ? ['Filamento', [info.filamento || info.tipo3d, info.marca ? `(${info.marca})` : ''].join(' ').trim()] : null,
    info.alturaCapa ? ['Capa y boquilla', `${numero(info.alturaCapa, 2)} mm · boquilla ${numero(info.boquilla || 0.4, 2)} mm`] : null,
    info.relleno != null ? ['Relleno del perfil', `${numero(info.relleno, 0)} %`] : null,
  ].filter(Boolean);

  const listaBandejas = info.bandejas.map((b) => {
    const sel = b.objetos.filter((o) => marcado(b, o)).length;
    const gramos = b.objetos.reduce((s, o) => s + gramosDe(b, o), 0);
    const resumen = [
      b.segundos ? formatoDuracion(b.segundos / 3600) : null,
      `${numero(gramos, 1)} g`,
      `${b.objetos.length} ${b.objetos.length === 1 ? 'objeto' : 'objetos'}`,
    ].filter(Boolean).join(' · ');

    const items = b.objetos.map((o) => `
      <label class="objetos__item">
        <input type="checkbox" data-obj="${b.indice}:${escapar(o.id)}"${marcado(b, o) ? ' checked' : ''}>
        <span>${escapar(o.nombre)}</span>
        <span class="mono">${numero(gramosDe(b, o), 1)} g${o.segundos ? ` · ${formatoDuracion(o.segundos / 3600)}` : ''}</span>
      </label>`).join('');

    return `
      <div class="objetos__bandeja">
        <input type="checkbox" data-bandeja="${b.indice}" aria-label="Marcar toda la bandeja ${b.indice}"${sel === b.objetos.length ? ' checked' : ''}>
        <span>Bandeja ${b.indice}${b.nombre ? ` · ${escapar(b.nombre)}` : ''}</span>
        <span class="mono">${resumen}</span>
      </div>
      ${items}`;
  }).join('');

  caja.innerHTML = `
    ${bandejaVista?.miniatura || info.miniatura ? `<img src="${bandejaVista?.miniatura || info.miniatura}" alt="Vista previa de la bandeja">` : ''}
    <div class="importado__cuerpo">
      <span class="importado__titulo">${escapar(info.archivo)}</span>
      <span class="importado__aviso">Leído ${info.origen || 'del archivo'}.</span>
      ${ficha.length ? `<dl class="ficha">${ficha.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapar(v)}</dd></div>`).join('')}</dl>` : ''}

      ${estimando ? `
        <label class="importado__campo">Relleno para estimar
          <select id="relleno-import">
            ${[10, 15, 20, 25, 40, 60, 100].map((v) => `<option value="${v}"${v === rellenoSel ? ' selected' : ''}>${v} %</option>`).join('')}
          </select>
        </label>` : ''}

      <div class="objetos">
        ${listaBandejas}
        <p class="objetos__total">${t.objetos
          ? `Vas a costear ${t.objetos} ${t.objetos === 1 ? 'objeto' : 'objetos'} · ${numero(t.gramos, 1)} g${t.segundos ? ` · ${formatoDuracion(t.segundos / 3600)}` : ''}`
          : 'No has marcado ningún objeto todavía.'}</p>
      </div>

      ${(info.avisos || []).map((a) => `<span class="importado__aviso"><strong>Ojo:</strong> ${a}</span>`).join('')}
      ${!t.segundos ? '<span class="importado__aviso"><strong>Ojo:</strong> falta el tiempo de impresión. Escríbelo en Tiempo de impresión y luz.</span>' : ''}
    </div>`;

  caja.querySelectorAll('[data-obj]').forEach((el) => el.addEventListener('change', (ev) => {
    const clave = ev.target.dataset.obj;
    if (ev.target.checked) seleccion.add(clave); else seleccion.delete(clave);
    aplicarImportacion();
    refrescarSeleccion();
  }));

  caja.querySelectorAll('[data-bandeja]').forEach((el) => el.addEventListener('change', (ev) => {
    const bandeja = info.bandejas.find((b) => String(b.indice) === ev.target.dataset.bandeja);
    for (const o of bandeja.objetos) {
      const clave = `${bandeja.indice}:${o.id}`;
      if (ev.target.checked) seleccion.add(clave); else seleccion.delete(clave);
      const casilla = caja.querySelector(`[data-obj="${CSS.escape(clave)}"]`);
      if (casilla) casilla.checked = ev.target.checked;
    }
    aplicarImportacion();
    refrescarSeleccion();
  }));

  // El relleno sí cambia los gramos de cada objeto: hay que repintar la lista.
  $('relleno-import')?.addEventListener('change', (ev) => {
    rellenoSel = num(ev.target.value, 15);
    aplicarImportacion();
    tarjetaImportacion();
  });

  refrescarSeleccion();
}

/**
 * Refresca solo el total y las casillas de bandeja, sin reconstruir la lista:
 * marcar objetos no debe hacer parpadear la tarjeta ni perder el foco.
 */
function refrescarSeleccion() {
  const info = importacion;
  const caja = $('importado');
  if (!info || caja.hidden) return;

  for (const b of info.bandejas) {
    const casilla = caja.querySelector(`[data-bandeja="${b.indice}"]`);
    if (!casilla) continue;
    const marcados = b.objetos.filter((o) => marcado(b, o)).length;
    casilla.checked = marcados === b.objetos.length;
    casilla.indeterminate = marcados > 0 && marcados < b.objetos.length;
  }

  const t = totalesSeleccion();
  const total = caja.querySelector('.objetos__total');
  if (total) {
    total.textContent = t.objetos
      ? `Vas a costear ${t.objetos} ${t.objetos === 1 ? 'objeto' : 'objetos'} · ${numero(t.gramos, 1)} g${t.segundos ? ` · ${formatoDuracion(t.segundos / 3600)}` : ''}`
      : 'No has marcado ningún objeto todavía.';
  }
}

async function manejarArchivo(archivo) {
  if (!archivo) return;
  const caja = $('importado');
  caja.hidden = false;
  caja.className = 'importado';
  caja.innerHTML = `<div class="importado__cuerpo"><span class="importado__titulo">Leyendo ${escapar(archivo.name)}…</span></div>`;
  try {
    importacion = await importarArchivo(archivo);
    rellenoSel = importacion.relleno != null ? num(importacion.relleno, 15) : 15;
    seleccion = new Set();
    for (const b of importacion.bandejas) for (const o of b.objetos) seleccion.add(`${b.indice}:${o.id}`);
    aplicarImportacion();
    tarjetaImportacion();
  } catch (err) {
    importacion = null;
    objetosSel = 0;
    caja.className = 'importado importado--error';
    caja.innerHTML = `<div class="importado__cuerpo">
      <span class="importado__titulo">No se pudo leer ${escapar(archivo.name)}</span>
      <span class="importado__aviso">${escapar(err.message)}</span>
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
      estado = estructurar({
        ...VALORES_INICIALES,
        ...datos,
        materiales: datos.materiales?.length ? datos.materiales : VALORES_INICIALES.materiales,
      });
    }
  } catch { /* datos corruptos: se ignoran */ }
}

const leerPerfiles = () => {
  try { return JSON.parse(localStorage.getItem(CLAVE_PERFILES) || '{}'); } catch { return {}; }
};

function pintarPerfiles() {
  const sel = $('perfiles');
  sel.innerHTML = '<option value="">Perfiles…</option>';
  for (const nombre of Object.keys(leerPerfiles())) {
    const o = document.createElement('option');
    o.value = nombre;
    o.textContent = nombre;
    sel.append(o);
  }
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

/* ── Cotización en texto ──────────────────────────────────────────────── */
function textoCotizacion() {
  const r = calcular(estado);
  const unidad = etiquetaUnidad();
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

  const impresora = String(estado.modeloImpresora || '').trim();
  const linea = (a, b) => `${a.padEnd(24, ' ')}${dinero(b).padStart(11, ' ')}`;

  return [
    'COTIZACIÓN — IMPRESIÓN 3D',
    `${r.cantidad} × ${unidad.larga} · ${materiales || 'sin material'} · ${formatoDuracion(r.tiempoH)} de impresión`,
    impresora ? `Impresora: ${impresora}` : null,
    ''.padEnd(35, '-'),
    ...filas.map(([a, b]) => linea(a, b)),
    linea('Subtotal', r.pedido.precioSinIva),
    r.pedido.ivaPct > 0 ? linea(`IVA ${numero(r.pedido.ivaPct, 0)} %`, r.pedido.iva) : 'Sin IVA',
    ''.padEnd(35, '-'),
    linea('TOTAL', r.pedido.total),
    `${unidad.corta}: ${dinero(r.metricas.precioUnitarioConIva)}`,
    r.fiscal.retRenta + r.fiscal.retIva > 0 ? `Con retenciones recibes: ${dinero(r.fiscal.aRecibir)}` : null,
  ].filter(Boolean).join('\n');
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

  // El último campo de margen que tocas es el que manda.
  $('margenPct').addEventListener('input', () => { estado.margenModo = 'pct'; marcarModoMargen(); alCambiar(); });
  $('margenMonto').addEventListener('input', (ev) => {
    estado.margenModo = num(ev.target.value) > 0 ? 'monto' : 'pct';
    marcarModoMargen();
    alCambiar();
  });

  $('escalones').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-pct]');
    if (!btn) return;
    estado.margenModo = 'pct';
    estado.margenPct = num(btn.dataset.pct);
    estado.margenMonto = 0;
    pintarFormulario();
    pintar();
    guardar();
  });

  $('medioCobro').addEventListener('change', (ev) => { $('comisionPct').value = ev.target.value; alCambiar(); });
  $('comisionPct').addEventListener('input', () => {
    const coincide = MEDIOS_COBRO.find((m) => m.valor === num($('comisionPct').value));
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
    importacion = null;
    seleccion = new Set();
    objetosSel = 0;
    pintarFormulario();
    pintar();
    guardar();
    $('importado').hidden = true;
  });

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
