import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = process.env.HEXWAR_SSH_HOST || 'aliyun-139';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw new Error('Invalid SSH host.');
const id = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const staging = `/home/junte/.cache/hexwar-${id}`;
await access(path.join(root, 'dist/web/game.js'));
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const archive = path.join(root, 'artifacts', `hexwar-${id}.tgz`);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run('tar', ['-czf', archive, 'package.json', 'src/core', 'server/index.js', 'server/service.js', 'dist/web', 'deploy']);
run('ssh', ['-o', 'BatchMode=yes', host, `install -d -m 700 ${staging}`]);
run('scp', ['-q', archive, `${host}:${staging}/release.tgz`]);
run('scp', ['-q', path.join(root, 'deploy/install.sh'), `${host}:${staging}/install.sh`]);
run('ssh', ['-o', 'BatchMode=yes', host, `sudo -n bash ${staging}/install.sh ${id} ${staging}/release.tgz`]);
console.log('Live: https://www.sunny-string.cn/wechat/game/hexwar/');
