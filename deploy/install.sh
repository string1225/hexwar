#!/usr/bin/env bash
set -euo pipefail
release_id="${1:?release id required}"
archive="${2:?archive required}"
[[ "$release_id" =~ ^[0-9]{14}$ ]] || { echo 'Invalid release id'; exit 1; }
[[ -f "$archive" ]] || { echo 'Archive missing'; exit 1; }
[[ -s /etc/hexwar/server.env ]] || { echo 'Provision /etc/hexwar/server.env first'; exit 1; }
release="/opt/hexwar/releases/$release_id"
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
[[ ! -e /opt/hexwar/current || -L /opt/hexwar/current ]] || { echo 'Current path is not a symlink'; exit 1; }
id -u hexwar >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hexwar --shell /sbin/nologin hexwar
install -d -m 755 /opt/hexwar/releases "$release" /etc/nginx/snippets
install -d -m 700 "/opt/hexwar/backups/$release_id"
backup="/opt/hexwar/backups/$release_id"
cp -p /etc/nginx/conf.d/sunny-string.conf "$backup/sunny-string.conf"
for name in /etc/nginx/snippets/hexwar-location.conf /etc/systemd/system/hexwar.service; do
    if [[ -f "$name" ]]; then cp -p "$name" "$backup/$(basename "$name")"; fi
done
previous="$(readlink /opt/hexwar/current || true)"
tar -xzf "$archive" -C "$release" --no-same-owner
chmod -R u=rwX,go=rX "$release"
install -m 644 "$release/deploy/hexwar-location.conf" /etc/nginx/snippets/hexwar-location.conf
install -m 644 "$release/deploy/hexwar.service" /etc/systemd/system/hexwar.service

rollback() {
    cp -p "$backup/sunny-string.conf" /etc/nginx/conf.d/sunny-string.conf
    if [[ -f "$backup/hexwar-location.conf" ]]; then cp -p "$backup/hexwar-location.conf" /etc/nginx/snippets/hexwar-location.conf; fi
    if [[ -f "$backup/hexwar.service" ]]; then cp -p "$backup/hexwar.service" /etc/systemd/system/hexwar.service; fi
    if [[ -n "$previous" ]]; then ln -sfn "$previous" /opt/hexwar/current; fi
    systemctl daemon-reload
    if [[ -n "$previous" ]]; then systemctl restart hexwar || true; fi
    echo 'Deployment failed; the previous Nginx configuration was restored.' >&2
}
trap rollback ERR
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/conf.d/sunny-string.conf')
text = p.read_text()
include = '    include /etc/nginx/snippets/hexwar-location.conf;'
marker = '    include /etc/nginx/snippets/remote-meeting-location.conf;'
if include not in text:
    if text.count(marker) != 1:
        raise RuntimeError('Expected HTTPS include anchor not found; leaving existing routes unchanged')
    p.write_text(text.replace(marker, marker + '\n' + include))
PY
nginx -t
ln -sfn "$release" /opt/hexwar/current
systemctl daemon-reload
systemctl enable hexwar
systemctl restart hexwar
for attempt in $(seq 1 15); do
    if curl --fail --silent http://127.0.0.1:3041/wechat/game/hexwar/api/health >/dev/null; then break; fi
    sleep 1
done
curl --fail --silent http://127.0.0.1:3041/wechat/game/hexwar/api/health
systemctl reload nginx
trap - ERR
printf '\nRelease %s deployed\n' "$release_id"
