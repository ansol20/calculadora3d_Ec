/**
 * Empaqueta la app en un solo archivo HTML, sin dependencias externas.
 *
 *   dist/costeo3d-ecuador.html → página completa (doble clic y funciona)
 *   dist/fragmento.html        → solo el cuerpo, para publicar como Artifact
 *
 * No es un bundler de verdad: los tres módulos son propios y se concatenan en
 * orden, quitando los import/export locales.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => readFile(join(raiz, rel), 'utf8');

const desmodular = (src) => src
  .replace(/^import\s[\s\S]*?from\s+'\.\/[^']+';\s*$/gm, '')
  .replace(/^export\s+(?=(?:async\s+)?(?:const|function|class|let|var)\b)/gm, '')
  .replace(/^export\s*\{[^}]*\};\s*$/gm, '')
  .trim();

const html = await leer('index.html');
const css = await leer('assets/estilos.css');
const modulos = await Promise.all(
  ['assets/calc.js', 'assets/importar.js', 'assets/app.js'].map(leer),
);
const js = modulos.map(desmodular).join('\n\n');

const cuerpo = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .replace(/^\s*<script type="module" src="assets\/app\.js"><\/script>\s*$/m, '')
  .trim();

const fuentes = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">';

const bloques = `<style>\n${css}\n</style>`;
const script = `<script>\n(() => {\n${js}\n})();\n</script>`;

await mkdir(join(raiz, 'dist'), { recursive: true });

await writeFile(join(raiz, 'dist/costeo3d-ecuador.html'), `<!doctype html>
<html lang="es-EC">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Costeo 3D Ecuador</title>
<meta name="description" content="Calculadora de costos y precio de venta para impresión 3D en Ecuador.">
${fuentes}
${bloques}
</head>
<body>
${cuerpo}
${script}
</body>
</html>
`);

await writeFile(join(raiz, 'dist/fragmento.html'), `<title>Costeo 3D Ecuador</title>
${fuentes}
${bloques}
${cuerpo}
${script}
`);

console.log('dist/costeo3d-ecuador.html y dist/fragmento.html generados.');
