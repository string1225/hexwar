import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'dist/web'), { recursive: true });
await mkdir(path.join(root, 'dist/wechat'), { recursive: true });
await Promise.all([
  build({ absWorkingDir: root, entryPoints: ['src/platform/web.js'], bundle: true, format: 'esm', target: 'es2019', minify: true, outfile: 'dist/web/game.js' }),
  build({ absWorkingDir: root, entryPoints: ['src/platform/wechat.js'], bundle: true, format: 'iife', target: 'es2019', minify: true, outfile: 'dist/wechat/game.js' }),
  cp(path.join(root, 'assets'), path.join(root, 'dist/web/assets'), { recursive: true }),
  cp(path.join(root, 'assets'), path.join(root, 'dist/wechat/assets'), { recursive: true }),
  cp(path.join(root, 'style.css'), path.join(root, 'dist/web/style.css')),
]);
const html = (await readFile(path.join(root, 'index.html'), 'utf8')).replace('/src/platform/web.js', './game.js');
await writeFile(path.join(root, 'dist/web/index.html'), html);
await writeFile(path.join(root, 'dist/wechat/game.json'), JSON.stringify({ deviceOrientation: 'portrait', showStatusBar: false }, null, 2));
console.log('Built browser client → dist/web');
console.log('Built WeChat mini game → dist/wechat (import repository root in WeChat DevTools)');
