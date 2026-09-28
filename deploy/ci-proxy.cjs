// Ephemeral loopback-only CONNECT relay for WeChat CI, reached through SSH.
const http = require('node:http');
const net = require('node:net');
const sockets = new Set();
const server = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
server.on('connect', (req, client, head) => {
  const match = /^([a-zA-Z0-9.-]+):443$/.exec(req.url || '');
  const host = match?.[1].toLowerCase();
  if (!host || !(host === 'servicewechat.com' || host.endsWith('.servicewechat.com') || host === 'api.weixin.qq.com')) {
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
  }
  const upstream = net.connect({ host, port: 443 });
  sockets.add(client); sockets.add(upstream);
  const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
  upstream.setTimeout(120000, close); client.setTimeout(120000, close);
  upstream.on('error', close); client.on('error', close);
  upstream.on('close', close); client.on('close', close);
  upstream.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client); client.pipe(upstream);
  });
});
server.listen(18941, '127.0.0.1', () => console.log('HEXWAR_CI_PROXY_READY'));
function stop() { for (const socket of sockets) socket.destroy(); server.close(); process.exit(0); }
process.stdin.resume(); process.stdin.on('end', stop);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
