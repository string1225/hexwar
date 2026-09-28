const fs = require('node:fs');
const path = require('node:path');
const { createPrivateKey } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function configuration(base = root, env = process.env) {
  const project = readJson(path.join(base, 'project.config.json'));
  const pkg = readJson(path.join(base, 'package.json'));
  const localPath = path.join(base, 'wechat-ci.local.json');
  const local = fs.existsSync(localPath) ? readJson(localPath) : {};
  const appid = env.WECHAT_APPID || local.appid || project.appid;
  if (!/^wx[0-9a-f]{16}$/.test(appid) || appid !== project.appid) throw new Error('Configure the same real AppID in project.config.json and CI settings.');
  const key = env.WECHAT_PRIVATE_KEY_PATH || local.privateKeyPath;
  if (!key) throw new Error('Set WECHAT_PRIVATE_KEY_PATH or privateKeyPath in wechat-ci.local.json.');
  const privateKeyPath = path.resolve(base, key);
  if (!fs.existsSync(privateKeyPath)) throw new Error('The configured upload key file does not exist.');
  try { if (createPrivateKey(fs.readFileSync(privateKeyPath)).asymmetricKeyType !== 'rsa') throw new Error(); }
  catch { throw new Error('The configured file is not a valid RSA upload private key.'); }
  const robot = Number(env.WECHAT_CI_ROBOT || local.robot || 1);
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) throw new Error('CI robot must be an integer from 1 to 30.');
  const qrcodeOutputDest = path.resolve(base, env.WECHAT_QRCODE_OUTPUT || local.qrcodeOutputDest || 'artifacts/wechat-preview.jpg');
  const version = env.WECHAT_CI_VERSION || local.version || pkg.version;
  return { appid, privateKeyPath, robot, qrcodeOutputDest, version, desc: env.WECHAT_CI_DESC || local.desc || `HEXWAR ${version}` };
}

async function run(command = process.argv[2] || 'check') {
  if (!['check', 'preview', 'upload'].includes(command)) throw new Error('Use check, preview or upload.');
  const config = configuration();
  console.log(`[wechat-ci] ${config.appid} · version ${config.version} · robot ${config.robot}`);
  if (command === 'check') { console.log('[wechat-ci] local configuration and signing key are valid'); return; }
  if (!fs.existsSync(path.join(root, 'dist/wechat/game.js'))) throw new Error('Run npm run build before uploading.');
  const ci = require('miniprogram-ci');
  if (process.env.WECHAT_CI_PROXY) ci.proxy(process.env.WECHAT_CI_PROXY);
  const project = new ci.Project({ appid: config.appid, type: 'miniGame', projectPath: root, privateKeyPath: config.privateKeyPath, ignores: ['node_modules/**/*', 'artifacts/**/*', 'server/**/*', '**/*.key', '**/*.local.json', '**/.env*'] });
  const options = { project, desc: config.desc, robot: config.robot, setting: { es6: true, minify: true, minifyJS: true }, onProgressUpdate: update => { if (update.message) console.log(`[wechat-ci] ${update.message}`); } };
  if (command === 'preview') {
    fs.mkdirSync(path.dirname(config.qrcodeOutputDest), { recursive: true });
    await ci.preview({ ...options, qrcodeFormat: 'image', qrcodeOutputDest: config.qrcodeOutputDest });
    console.log(`[wechat-ci] preview QR: ${config.qrcodeOutputDest}`);
  } else {
    await ci.upload({ ...options, version: config.version });
    console.log('[wechat-ci] development version uploaded (not submitted for review or published)');
  }
}
module.exports = { configuration, run };
if (require.main === module) run().then(() => process.exit(0), error => { console.error(`[wechat-ci] ${error.message}`); process.exit(1); });
