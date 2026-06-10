# Deploy — Legends Clash na VPS (Hostinger)

Servidor **autoritativo e com estado em memória**: roda como **uma única instância**
(sem réplicas / load balancer). Stack de produção:

```
Internet ──80──> Caddy (proxy reverso) ──8787──> Node (systemd) ──> Supabase (Postgres)
                                                        └─> serve client/dist (build do Vite)
```

- **Node + systemd** (`legendsclash.service`): processo sempre ativo, reinício automático no boot/crash.
- **Caddy** (`Caddyfile`): porta 80 → 8787, com upgrade de WebSocket automático. Trocar `:80` por um domínio habilita HTTPS/WSS via Let's Encrypt.
- **Supabase**: persistência via `EnvironmentFile`. Sem as variáveis, cai no snapshot JSON local.

## Primeiro deploy

Na máquina de desenvolvimento (envia o código; exclui o que é gerado/secreto):

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude 'client/dist' \
  --exclude .env --exclude 'server/data' --exclude e2e \
  ./ root@SEU_IP:/opt/legendsclash/
```

Na VPS (como root) — preencha o ambiente e provisione:

```bash
install -d -m 750 /etc/legendsclash
cp /opt/legendsclash/deploy/legendsclash.env.example /etc/legendsclash/legendsclash.env
nano /etc/legendsclash/legendsclash.env        # cole a SUPABASE_SERVICE_ROLE_KEY
chmod 600 /etc/legendsclash/legendsclash.env

bash /opt/legendsclash/deploy/provision.sh      # instala Node+Caddy, builda, sobe os serviços
```

Acesse `http://SEU_IP/`. O `provision.sh` é **idempotente**.

## Atualizar (novo deploy)

```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude 'client/dist' \
  --exclude .env --exclude 'server/data' --exclude e2e ./ root@SEU_IP:/opt/legendsclash/
ssh root@SEU_IP 'bash /opt/legendsclash/deploy/provision.sh'
```

## Operação

```bash
systemctl status legendsclash         # estado do serviço
journalctl -u legendsclash -f         # logs ao vivo (procure "[store] Supabase conectado")
systemctl restart legendsclash        # reiniciar
systemctl reload caddy                # recarregar o proxy após editar o Caddyfile
```

## Habilitar domínio + HTTPS (depois)

1. Aponte um registro **A** do domínio para o IP da VPS.
2. Em `/etc/caddy/Caddyfile`, troque `:80 {` pelo domínio (ex.: `legendsclash.cutia.tech {`).
3. `systemctl reload caddy` — o TLS é emitido automaticamente. O cliente passa a usar `wss://` sozinho.

## Notas

- **Não exponha a porta 8787** — só o Caddy fala com o Node (a `ufw` libera apenas 22/80/443).
- Game state vive em memória: **não rode duas instâncias** do serviço.
- Banco e migrações: ver `supabase/migrations/` e o `README.md` da raiz.
