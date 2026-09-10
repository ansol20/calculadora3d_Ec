# Costeo 3D Ecuador

Calculadora de costos y precio de venta para impresión 3D, hecha para las
condiciones de Ecuador: precios en dólares, IVA del 15 %, tarifas eléctricas
locales y retenciones del SRI.

Suelta el `.3mf` que te da tu laminador y la calculadora saca sola los gramos y
el tiempo de impresión; el resto son tus números de taller.

## Qué suma

| Partida | Cómo se calcula |
| --- | --- |
| Filamento | gramos × (precio de bobina ÷ contenido), con varias bobinas si usas AMS. Si te lo venden por kilo, deja 1000 g de contenido |
| Desperdicio y purga | porcentaje sobre los gramos: torre de purga, faldas, soportes, el resto de bobina |
| Electricidad | consumo medio en W × horas × tarifa por kWh. Hay arquetipos de máquina para arrancar, pero lo exacto lo da un medidor de enchufe |
| Tiempo | lo pone el archivo. Si el proyecto no está laminado, queda en cero y el campo se marca en ámbar en vez de heredar un valor de ejemplo |
| Máquina | depreciación (precio ÷ vida útil) + mantenimiento anual repartido entre las horas que imprimes al año |
| Consumibles | valor por hora: laca, alcohol, lijas, guantes, silica |
| Mano de obra | minutos de preparación y post-proceso × tu tarifa por hora |
| Diseño | minutos de modelado × tu tarifa de diseño, una sola vez por pedido |
| Fallos | el costo de producción se divide por `1 − % de fallos`, que es lo que cuesta en promedio entregar una pieza buena |
| Empaque y envío | por pieza y por pedido; el envío se traslada sin margen |
| Margen | porcentaje sobre el costo del pedido, o una ganancia fija en dólares |
| Comisión de cobro | se suma por dentro (`precio ÷ (1 − comisión)`) para que la pasarela no se coma el margen |
| IVA | 15 %, desactivable si estás en RIMPE negocio popular |
| Retenciones | 1 %, 1.75 % o 2 % de renta y 30 %, 70 % o 100 % del IVA: no cambian tu utilidad, solo lo que llega al banco |

## Importar desde el laminador

| Archivo | De dónde salen los datos |
| --- | --- |
| `.3mf` laminado (Bambu, Orca, Creality Print) | `Metadata/slice_info.config`: peso y tiempo reales **por bandeja**, un renglón por filamento, más la miniatura |
| Bandeja exportada (`.gcode.3mf`) | los totales de `Metadata/plate_N.gcode` dentro del propio ZIP |
| `.3mf` de PrusaSlicer | `Metadata/Slic3r_PE.config`: tipo de material, densidad y precio configurado |
| Cualquier proyecto | `Metadata/project_settings.config`: impresora, filamento con su nombre comercial, perfil de proceso, relleno, boquilla y perímetros |
| Cualquier proyecto | `Metadata/model_settings.config`: qué objetos hay en cada bandeja y cómo se llaman |
| `.3mf` sin laminar (MakerWorld) | mide la geometría siguiendo las mallas externas (`p:path` → `3D/Objects/*.model`) y estima los gramos con las paredes y el relleno reales |
| `.gcode` | comentarios de totales de PrusaSlicer, Orca, Bambu Studio y Cura |

Las bandejas se muestran como una tira de miniaturas —igual que en el
laminador— y abajo solo salen los objetos de la que estés viendo, así diez
bandejas siguen cabiendo en pantalla. Cada objeto se marca o desmarca: puedes
costear toda la bandeja 1 más dos piezas sueltas de la bandeja 2, y el tiempo,
los gramos y el precio se recalculan solos. El peso real del laminador se reparte entre los
objetos según su volumen, así que el total de una bandeja completa es exacto y
el de una selección parcial es aproximado (la calculadora lo dice).

La ficha muestra impresora, perfil de proceso, filamento con su nombre
comercial, altura de capa, boquilla y relleno.

El ZIP se lee en el navegador con `DecompressionStream`, sin librerías y sin
subir nada a ningún servidor.

### Cómo guardar el proyecto laminado

En Creality Print, Bambu Studio y Orca: lamina la bandeja y luego
**Archivo → Guardar proyecto como…**. El `.3mf` guardado *después* de laminar
lleva dentro el peso y el tiempo reales. También sirve exportar la bandeja
laminada (`.gcode.3mf`). Un `.3mf` descargado de MakerWorld y guardado sin
laminar solo trae geometría, y ahí la calculadora estima.

## Usar

Es una página estática sin dependencias ni compilación obligatoria.

```bash
npm start          # servidor local en http://localhost:8080
npm test           # pruebas del motor de cálculo
npm run build      # genera dist/ con la app en un solo archivo HTML
```

- `dist/costeo3d-ecuador.html` funciona con doble clic, sin servidor.
- Para publicar en GitHub Pages: Settings → Pages → rama `main`, carpeta raíz.

## Estructura

```
index.html            Markup completo de la interfaz
assets/estilos.css    tokens de color (claro y oscuro), layout y estilos de impresión
assets/calc.js        motor de cálculo, funciones puras y probadas
assets/importar.js    lector de ZIP, .3mf y G-code
assets/app.js         wiring: formulario, ticket, perfiles guardados
tests/                25 pruebas con node:test
tools/build.mjs       empaquetado a un solo archivo
```

## Básico y avanzado

Lo básico siempre cuenta: filamento, desperdicio, tiempo, luz, margen e IVA.

Las cuatro secciones avanzadas — máquina, taller, extras y SRI — arrancan
**apagadas y no suman nada**. Se encienden al abrirlas, y una vez encendidas
siguen contando aunque las vuelvas a plegar; el enlace *no cobrar esto* las
apaga. Mientras están apagadas su resumen dice cuánto subiría el precio si las
activaras ("no se está cobrando · sumaría $4,69"), así se ve lo que se está
dejando fuera sin que nada se cobre a escondidas.

Cada campo tiene un `?` que explica de dónde sale el número, en vez de
párrafos de ayuda permanentes.

Tres escalones de precio (Ajustado, Recomendado, Premium) proponen el total
con distintos márgenes; al hacer clic, ese margen se aplica.

## Los números de arranque

Los precios de material, la tarifa eléctrica y los porcentajes de comisión son
referenciales de 2025 y sirven solo para arrancar. Ajústalos a tus facturas: la
tarifa residencial ecuatoriana ronda los $0,092–0,10 por kWh y la comercial
sube a $0,10–0,12, pero eso cambia por empresa eléctrica y por rango de
consumo.

Tus valores se guardan en el navegador (`localStorage`) y puedes tener varios
perfiles: uno por impresora o por tipo de trabajo.
