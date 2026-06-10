-- Login por código OTP (Supabase Auth) + sessões opacas do servidor.
--
-- O cliente nunca fala com o Supabase: o servidor media o envio/validação do
-- código e emite um token de sessão próprio. No banco fica apenas o sha-256
-- do token (vazamento do banco não vaza sessões), com expiração deslizante.

alter table public.players add column auth_user_id uuid unique;
comment on column public.players.auth_user_id is
  'Vínculo com auth.users (login OTP). Null em contas antigas até o primeiro login por código.';

create table public.sessions (
  token_hash   text primary key,
  player_id    text not null references public.players (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);
comment on table public.sessions is
  'Sessões do servidor do jogo (token_hash = sha256 do token bruto). Expiração deslizante de ~30 dias.';

create index sessions_player_idx on public.sessions (player_id);
create index sessions_expiry_idx on public.sessions (expires_at);

-- Como nas demais tabelas: RLS ligado sem policies públicas — só a service
-- role (servidor do jogo) lê e escreve.
alter table public.sessions enable row level security;

-- O token eterno do MVP morre com o login real; usuários existentes apenas
-- refazem login por OTP (perfil, MMR e histórico são preservados pelo e-mail).
alter table public.players drop column token;
