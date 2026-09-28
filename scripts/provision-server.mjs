import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const filename = process.argv[2];
if (!filename) throw new Error('Pass the path to a server environment file outside the repository.');
const data = (await readFile(filename, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
if (!/^WECHAT_APPID=wxacd4dbd0f3d625e8$/m.test(data) || !/^WECHAT_APP_SECRET=[a-f0-9]{32}$/m.test(data)) throw new Error('Environment AppID or App Secret format is invalid.');
const host = process.env.HEXWAR_SSH_HOST || 'aliyun-139';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw new Error('Invalid SSH host.');
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', host, 'sudo -n sh -c \'umask 077; mkdir -p /etc/hexwar; chmod 700 /etc/hexwar; cat > /etc/hexwar/server.env.next; chmod 600 /etc/hexwar/server.env.next; mv /etc/hexwar/server.env.next /etc/hexwar/server.env\''], { input: data, encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error('Could not provision the server environment through SSH.');
console.log('Server environment provisioned at /etc/hexwar/server.env (root only).');
