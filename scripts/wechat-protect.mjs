import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeWechat } from './wechat-smoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const inside = (base, file) => { const relative = path.relative(base, file); return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); };

export async function protectionConfig(base = root, env = process.env) {
  const project = await json(path.join(base, 'project.config.json'));
  const pkg = await json(path.join(base, 'package.json'));
  const appid = env.WECHAT_APPID || project.appid;
  if (!/^wx[0-9a-f]{16}$/.test(appid) || appid !== project.appid) throw new Error('加固 AppID 必须与项目一致。');
  const secretFile = path.resolve(env.WECHAT_FORTIFY_SECRET_CONFIG || path.join(homedir(), '.hexwar-protection', appid, 'id_rsa.conf'));
  if (inside(base, secretFile)) throw new Error('加固私钥配置必须保存在游戏工程之外。');
  return { appid, version: pkg.version, secretFile, configFile: path.join(base, 'wechat-protect.config.json'), publicFile: path.join(path.dirname(secretFile), 'public_key.pem') };
}

export async function verifyProtectionSecret(config) {
  let raw;
  try { raw = await readFile(config.secretFile, 'utf8'); }
  catch { throw new Error('尚未配置加固密钥，请先运行 npm run wechat:protect:setup 并在微信后台登记公钥。'); }
  const appid = /^\[appid\]\s*\r?\n\s*(wx[0-9a-f]{16})\s*$/m.exec(raw)?.[1];
  const pem = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/.exec(raw)?.[0];
  if (appid !== config.appid || !pem) throw new Error('加固密钥配置的 AppID 或私钥格式无效。');
  let key;
  try { key = createPrivateKey(pem); } catch { throw new Error('加固配置中的 RSA 私钥无效。'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('加固密钥必须是至少 2048 位的 RSA 密钥。');
  return createPublicKey(key).export({ type: 'spki', format: 'pem' });
}

export async function setupProtection(base = root, env = process.env) {
  const config = await protectionConfig(base, env);
  await mkdir(path.dirname(config.secretFile), { recursive: true, mode: 0o700 });
  let exists = false;
  try { await access(config.secretFile); exists = true; } catch {}
  if (!exists) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    await writeFile(config.secretFile, `[appid]\n${config.appid}\n[private_key]\n${privateKey}\n`, { flag: 'wx', mode: 0o600 });
  }
  const publicKey = await verifyProtectionSecret(config);
  await writeFile(config.publicFile, publicKey);
  console.log(`[wechat-protect] 专用密钥已准备，AppID ${config.appid}`);
  console.log(`[wechat-protect] 待登记公钥：${config.publicFile}`);
  console.log('[wechat-protect] 微信后台：开发支持 → 研发工具箱 → 密钥管理 → 添加公钥。');
  return config;
}

function validateMap(raw) {
  let map;
  try { map = JSON.parse(raw); } catch { throw new Error('加固服务未返回有效 sourcemap。'); }
  if (map.version !== 3 || !Array.isArray(map.sources) || !map.sources.length || typeof map.mappings !== 'string') throw new Error('加固 sourcemap 缺少有效的源码映射。');
}

// Each attempt gets an empty package directory. A failed or partially successful
// vendor run cannot reuse a previous release or copy the plaintext game.js.
export async function protectBuild({ base = root, env = process.env, protector, smoke = smokeWechat } = {}) {
  const config = await protectionConfig(base, env);
  await verifyProtectionSecret(config);
  const sourceDir = path.join(base, 'dist/wechat');
  const source = await readFile(path.join(sourceDir, 'game.js'));
  const sourceMap = await readFile(path.join(sourceDir, 'game.js.map'));
  const settings = await readFile(config.configFile);
  const parsed = JSON.parse(settings);
  if (!parsed.watermark?.files?.includes('game.js') || !parsed.obfuscation?.tasks?.some(task => [1, 2, 3].includes(task.level) && task.files?.includes('game.js'))) throw new Error('请同时为 game.js 配置水印与有效混淆等级。');
  validateMap(sourceMap);
  const runId = `${Date.now()}-${randomUUID()}`;
  const outputDir = path.join(base, 'dist/wechat-protected', runId);
  const archiveDir = path.join(base, 'artifacts/wechat-protection', config.version, runId);
  await mkdir(outputDir, { recursive: true }); await mkdir(archiveDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(archiveDir, 'original-game.js'), source),
    writeFile(path.join(archiveDir, 'original-game.js.map'), sourceMap),
    writeFile(path.join(archiveDir, 'code.fortify.config.json'), settings),
  ]);
  const provider = protector || (await import('minigame-code-fortify-cli')).protect;
  console.log('[wechat-protect] 正在请求微信混淆与水印服务…');
  const success = await provider(sourceDir, outputDir, {
    secretConfigPath: config.secretFile, protectConfigPath: config.configFile,
    networkOptions: { proxy: env.WECHAT_CI_PROXY, timeout_minute: 10 },
  });
  if (success !== true) throw new Error('微信加固失败，已停止发布。请根据上方微信返回信息检查公钥登记或服务配置。');
  let protectedCode, protectedMap;
  try { [protectedCode, protectedMap] = await Promise.all([readFile(path.join(outputDir, 'game.js')), readFile(path.join(outputDir, 'game.js.map'))]); }
  catch { throw new Error('加固结果不完整，缺少 game.js 或 sourcemap，已停止发布。'); }
  if (sha256(source) === sha256(protectedCode)) throw new Error('加固服务返回了未改写的代码，已停止发布。');
  validateMap(protectedMap);
  const smokeResult = smoke(protectedCode.toString('utf8'));
  await Promise.all([
    cp(path.join(sourceDir, 'assets'), path.join(outputDir, 'assets'), { recursive: true }),
    cp(path.join(sourceDir, 'game.json'), path.join(outputDir, 'game.json')),
    writeFile(path.join(archiveDir, 'protected-game.js'), protectedCode),
    writeFile(path.join(archiveDir, 'protected-game.js.map'), protectedMap),
    writeFile(path.join(outputDir, 'project.config.json'), JSON.stringify({ appid: config.appid, compileType: 'game', miniprogramRoot: './', projectname: 'hexwar-protected', setting: { es6: false, minified: false, urlCheck: true } }, null, 2)),
  ]);
  const manifest = {
    schema: 1, appid: config.appid, version: config.version, provider: 'minigame-code-fortify-cli', providerVersion: '0.1.8',
    createdAt: new Date().toISOString(), outputDir, archiveDir,
    sourceSha256: sha256(source), protectedSha256: sha256(protectedCode), settingsSha256: sha256(settings),
    sourceBytes: source.length, protectedBytes: protectedCode.length, smoke: smokeResult,
  };
  await writeFile(path.join(outputDir, 'protection-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[wechat-protect] 加固与启动验证通过，${source.length} → ${protectedCode.length} 字节`);
  console.log(`[wechat-protect] 发布目录：${outputDir}`);
  return manifest;
}

export async function verifyProtectedBuild(manifest, base = root, env = process.env) {
  const config = await protectionConfig(base, env);
  if (manifest?.schema !== 1 || manifest.appid !== config.appid || manifest.version !== config.version || !manifest.smoke?.startup || !manifest.smoke?.localSave || !inside(path.join(base, 'dist/wechat-protected'), manifest.outputDir)) throw new Error('加固发布记录无效或不属于当前版本。');
  const [source, output, settings] = await Promise.all([readFile(path.join(base, 'dist/wechat/game.js')), readFile(path.join(manifest.outputDir, 'game.js')), readFile(config.configFile)]);
  if (sha256(source) !== manifest.sourceSha256 || sha256(output) !== manifest.protectedSha256 || sha256(settings) !== manifest.settingsSha256 || manifest.sourceSha256 === manifest.protectedSha256) throw new Error('构建或加固产物已变更，必须重新加固。');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || 'protect';
  try {
    if (command === 'setup') await setupProtection();
    else if (command === 'protect') await protectBuild();
    else throw new Error('Use setup or protect.');
  } catch (error) { console.error(`[wechat-protect] ${error.message}`); process.exitCode = 1; }
}
