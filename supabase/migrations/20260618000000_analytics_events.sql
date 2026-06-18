-- Legends Clash — telemetria de produto (eventos de funil)
--
-- Tabela append-only de eventos para medir a métrica norte (D7 Retention) e
-- validar ajustes de balanceamento (ex.: winrate por assento). O servidor grava
-- via write-through e NUNCA relê esta tabela em tempo real — a análise é por SQL
-- / dashboards. RLS habilitado sem policies públicas: só a service role acessa
-- (mesmo padrão anti-cheat das demais tabelas).

create table public.events (
  id bigint generated always as identity primary key,
  type text not null,
  user_id text,
  match_id text,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.events is
  'Eventos de funil/telemetria (append-only). Derivar D1/D7 e winrate por assento via SQL.';

-- consultas típicas: funil por tipo ao longo do tempo, e retorno por usuário (D1/D7)
create index events_type_time_idx on public.events (type, created_at desc);
create index events_user_time_idx on public.events (user_id, created_at desc);

alter table public.events enable row level security;
