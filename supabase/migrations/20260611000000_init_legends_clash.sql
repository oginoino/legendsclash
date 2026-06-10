-- Legends Clash — schema inicial (persistência do servidor autoritativo)
--
-- Todo acesso ao banco passa pelo servidor do jogo usando a service role key
-- (anti-cheat: clientes nunca tocam o banco). Por isso, RLS fica HABILITADO
-- em todas as tabelas SEM policies públicas: anon/authenticated não leem nem
-- escrevem nada; a service role ignora RLS por definição.

create table public.players (
  id text primary key,
  email text not null unique,
  name text not null,
  avatar text not null default '🛡️',
  token text not null unique,
  mmr integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  muted text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.players is
  'Contas do Legends Clash. Login do MVP por e-mail; token de sessão opaco.';

create table public.match_history (
  id bigint generated always as identity primary key,
  match_id text not null,
  player_id text not null references public.players (id) on delete cascade,
  opponent_id text not null,
  opponent_name text not null,
  won boolean not null,
  reason text not null check (reason in ('hp', 'surrender', 'timeout')),
  mmr_delta integer not null,
  turns integer not null,
  duration_ms integer not null,
  ended_at timestamptz not null default now()
);

comment on table public.match_history is
  'Uma linha por jogador por partida (perspectiva individual do resultado).';

create index match_history_player_recent_idx
  on public.match_history (player_id, ended_at desc);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id text not null,
  reported_id text not null,
  reason text not null,
  context text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.reports is
  'Denúncias do chat (moderação nasce no MVP). Contexto = últimas mensagens do denunciado.';

create index reports_reported_idx on public.reports (reported_id, created_at desc);

-- RLS habilitado sem policies: somente a service role do servidor acessa.
alter table public.players enable row level security;
alter table public.match_history enable row level security;
alter table public.reports enable row level security;
