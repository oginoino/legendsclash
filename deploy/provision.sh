#!/usr/bin/env bash
#
# Provisiona/atualiza o Legends Clash numa VPS Ubuntu (ex.: Hostinger).
# Stack: Node 22 (NodeSource) + Caddy (proxy 80->8787) + serviço systemd.
#
# Pré-requisitos:
#   1. Código já presente em /opt/legendsclash (via rsync do dev ou git clone).
#   2. (Opcional) /etc/legendsclash/legendsclash.env com as variáveis do Supabase.
#
# Idempotente: rode de novo a qualquer momento para atualizar (rebuild + restart).
# Uso (como root):  bash /opt/legendsclash/deploy/provision.sh
set -euo pipefail

APP_DIR=/opt/legendsclash
APP_USER=legendsclash

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)."; exit 1; }
[ -f "$APP_DIR/package.json" ] || { echo "Código não encontrado em $APP_DIR."; exit 1; }

log "Pacotes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git ufw

log "Node.js 22 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v) / npm $(npm -v)"

log "Caddy (repositório oficial)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

log "Usuário de serviço ($APP_USER)"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Dependências + build do cliente"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/server/data"

log "Arquivo de ambiente"
install -d -m 750 /etc/legendsclash
if [ ! -f /etc/legendsclash/legendsclash.env ]; then
  install -m 600 "$APP_DIR/deploy/legendsclash.env.example" /etc/legendsclash/legendsclash.env
  echo "  -> criado /etc/legendsclash/legendsclash.env (preencha SUPABASE_SERVICE_ROLE_KEY)"
fi

log "Serviço systemd"
install -m 644 "$APP_DIR/deploy/legendsclash.service" /etc/systemd/system/legendsclash.service
systemctl daemon-reload
systemctl enable legendsclash >/dev/null
systemctl restart legendsclash

log "Caddy (proxy reverso)"
install -d /etc/caddy
# reload (graceful) e só quando a config muda: restart incondicional cortava
# todas as conexões (inclusive WebSockets de batalhas) a cada provisão
if ! cmp -s "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile; then
  install -m 644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi
systemctl enable --now caddy >/dev/null

log "Firewall (ufw)"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

log "Status"
systemctl --no-pager --full status legendsclash | head -n 10 || true
IP=$(curl -s --max-time 5 ifconfig.me || echo SEU_IP)
echo
echo "Pronto. Acesse: http://$IP/"
