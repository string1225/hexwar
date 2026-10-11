import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createPublicKey } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { protectionConfig, setupProtection, verifyProtectionSecret, protectBuild, verifyProtectedBuild } from '../scripts/wechat-protect.mjs';
import { smokeWechat } from '../scripts/wechat-smoke.mjs';

const { protectedSettings, protectedIgnores } = createRequire(import.meta.url)('../scripts/wechat-ci.cjs');
const appid = 'wxacd4dbd0f3d625e8';
const bundle = build({ entryPoints: ['src/platform/wechat.js'], bundle: true, write: false, format: 'iife', target: 'es2019', sourcemap: 'external', outfile: 'game.js' });

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexwar-protection-test-'));
  const base = path.join(directory, 'project'), secretFile = path.join(directory, 'secret/id_rsa.conf');
  const env = { WECHAT_FORTIFY_SECRET_CONFIG: secretFile };
  await mkdir(path.join(base, 'dist/wechat/assets'), { recursive: true });
  await writeFile(path.join(base, 'project.config.json'), JSON.stringify({ appid }));
  await writeFile(path.join(base, 'package.json'), JSON.stringify({ version: '1.5.0' }));
  await writeFile(path.join(base, 'wechat-protect.config.json'), JSON.stringify({ watermark: { files: ['game.js'] }, obfuscation: { tasks: [{ level: 2, files: ['game.js'] }] } }));
  const { outputFiles } = await bundle;
  const source = outputFiles.find(f => path.basename(f.path) === 'game.js').text;
  const sourceMap = outputFiles.find(f => path.basename(f.path) === 'game.js.map').text;
  await writeFile(path.join(base, 'dist/wechat/game.js'), source);
  await writeFile(path.join(base, 'dist/wechat/game.js.map'), sourceMap);
  await writeFile(path.join(base, 'dist/wechat/game.json'), '{"deviceOrientation":"portrait"}');
  await writeFile(path.join(base, 'dist/wechat/assets/logo.png'), 'asset-bytes');
  await setupProtection(base, env);
  const protector = async (_source, output) => {
    // Simulate vendor output only for control-flow tests. Actual protection must
    // come from the official service and is not certified by these fixtures.
    await writeFile(path.join(output, 'game.js'), source + '\n/* simulated vendor output */');
    await writeFile(path.join(output, 'game.js.map'), sourceMap);
    return true;
  };
  const cleanup = async () => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('hexwar-protection-test-')) throw new Error('Unsafe test cleanup target');
    await rm(resolved, { recursive: true, force: true });
  };
  return { base, env, secretFile, source, protector, cleanup };
}

test('setup keeps the private key outside the game, emits the matching public key, and never rotates an existing key', async () => {
  const f = await fixture();
  try {
    const config = await protectionConfig(f.base, f.env), before = await readFile(f.secretFile, 'utf8');
    assert.equal(await readFile(config.publicFile, 'utf8'), await verifyProtectionSecret(config));
    const publicKey = createPublicKey(await readFile(config.publicFile, 'utf8'));
    assert.equal(publicKey.asymmetricKeyType, 'rsa'); assert.ok(publicKey.asymmetricKeyDetails.modulusLength >= 2048);
    await setupProtection(f.base, f.env); assert.equal(await readFile(f.secretFile, 'utf8'), before);
    await assert.rejects(protectionConfig(f.base, { WECHAT_FORTIFY_SECRET_CONFIG: path.join(f.base, 'id_rsa.conf') }), /工程之外/);
    const wrong = before.replace(appid, 'wx0000000000000000'); await writeFile(f.secretFile, wrong);
    await assert.rejects(verifyProtectionSecret(config), /AppID/);
  } finally { await f.cleanup(); }
});

test('verified packages preserve exact vendor JS, archive maps, and carry only a separate WeChat project', async () => {
  const f = await fixture();
  try {
    const manifest = await protectBuild({ base: f.base, env: f.env, protector: f.protector });
    assert.notEqual(manifest.sourceSha256, manifest.protectedSha256);
    assert.equal(await readFile(path.join(manifest.outputDir, 'game.js'), 'utf8'), f.source + '\n/* simulated vendor output */');
    assert.equal(await readFile(path.join(manifest.archiveDir, 'original-game.js'), 'utf8'), f.source);
    assert.equal(await readFile(path.join(manifest.archiveDir, 'protected-game.js'), 'utf8'), await readFile(path.join(manifest.outputDir, 'game.js'), 'utf8'));
    assert.equal(await readFile(path.join(manifest.outputDir, 'assets/logo.png'), 'utf8'), 'asset-bytes');
    const project = JSON.parse(await readFile(path.join(manifest.outputDir, 'project.config.json'), 'utf8'));
    assert.equal(project.miniprogramRoot, './'); assert.equal(project.appid, appid); assert.equal(project.setting.minified, false);
    assert.deepEqual(await verifyProtectedBuild(manifest, f.base, f.env), manifest);
  } finally { await f.cleanup(); }
});

test('failed, partial, unchanged or broken vendor results cannot produce a publishable package', async () => {
  const f = await fixture();
  try {
    for (const protector of [
      async () => false,
      async () => true,
      async (_source, output) => { await writeFile(path.join(output, 'game.js'), f.source); await writeFile(path.join(output, 'game.js.map'), '{"version":3,"sources":["game.js"],"mappings":""}'); return true; },
      async (_source, output) => { await writeFile(path.join(output, 'game.js'), 'throw new Error("broken output")'); await writeFile(path.join(output, 'game.js.map'), '{"version":3,"sources":["game.js"],"mappings":""}'); return true; },
    ]) await assert.rejects(protectBuild({ base: f.base, env: f.env, protector }));
    await assert.rejects(protectBuild({ base: f.base, env: f.env, protector: async (_source, output) => { await f.protector(_source, output); await writeFile(path.join(output, 'game.js.map'), 'invalid'); return true; } }), /sourcemap/);
  } finally { await f.cleanup(); }
});

test('source rebuilds, output changes, version changes and config edits invalidate a previously protected release', async () => {
  const f = await fixture();
  try {
    const manifest = await protectBuild({ base: f.base, env: f.env, protector: f.protector });
    const sourceFile = path.join(f.base, 'dist/wechat/game.js');
    await writeFile(sourceFile, f.source + '\n// rebuilt'); await assert.rejects(verifyProtectedBuild(manifest, f.base, f.env), /重新加固/);
    await writeFile(sourceFile, f.source);
    const outputFile = path.join(manifest.outputDir, 'game.js'), originalOutput = await readFile(outputFile);
    await writeFile(outputFile, 'changed'); await assert.rejects(verifyProtectedBuild(manifest, f.base, f.env), /重新加固/); await writeFile(outputFile, originalOutput);
    const settingsFile = path.join(f.base, 'wechat-protect.config.json'), settings = await readFile(settingsFile);
    await writeFile(settingsFile, settings + '\n'); await assert.rejects(verifyProtectedBuild(manifest, f.base, f.env), /重新加固/); await writeFile(settingsFile, settings);
    await writeFile(path.join(f.base, 'package.json'), '{"version":"1.5.1"}'); await assert.rejects(verifyProtectedBuild(manifest, f.base, f.env), /版本/);
  } finally { await f.cleanup(); }
});

test('upload settings disable JS rewriting and exclude maps, backups, manifests and private credentials', () => {
  assert.deepEqual(protectedSettings, { es6: false, minify: false, minifyJS: false });
  for (const file of ['**/*.map', '**/*.bak', 'protection-manifest.json', '**/id_rsa.conf', '**/*.key']) assert.ok(protectedIgnores.includes(file));
});

test('a WeChat-only startup check rejects empty code and code that requires browser globals', () => {
  assert.throws(() => smokeWechat(''), /启动/);
  assert.throws(() => smokeWechat('document.createElement("canvas")'), /document/);
});
