import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv[2];
if (!['preview', 'upload'].includes(command)) throw new Error('Use preview or upload.');
const host = process.env.HEXWAR_SSH_HOST || 'aliyun-139';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw new Error('Invalid SSH host.');
const proxyFile = '/home/junte/.cache/hexwar-ci-proxy.cjs';
const copy = spawnSync('scp', ['-q', path.join(root, 'deploy/ci-proxy.cjs'), `${host}:${proxyFile}`], { stdio: 'inherit', windowsHide: true });
if (copy.status !== 0) throw new Error('Could not prepare the SSH CI relay.');
const ssh = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:18941:127.0.0.1:18941', host, `node ${proxyFile}`], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let worker;
const cleanup = () => { ssh.stdin.end(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { worker?.kill(); cleanup(); });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH relay startup timed out.')), 15000);
    ssh.once('error', error => { clearTimeout(timer); reject(error); });
    ssh.once('exit', code => { clearTimeout(timer); reject(new Error(`SSH relay exited with ${code}`)); });
    let output = '';
    ssh.stdout.on('data', data => { output += data; if (output.includes('HEXWAR_CI_PROXY_READY')) { clearTimeout(timer); resolve(); } });
  });
  console.log('[wechat-ci] Upload traffic uses the 139 server through SSH; signing key stays local.');
  worker = spawn(process.execPath, [path.join(root, 'scripts/wechat-ci.cjs'), command], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, WECHAT_CI_PROXY: 'http://127.0.0.1:18941' } });
  process.exitCode = await new Promise((resolve, reject) => { worker.once('exit', code => resolve(code ?? 1)); worker.once('error', reject); });
} finally { cleanup(); }
