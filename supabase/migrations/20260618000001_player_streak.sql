-- Legends Clash — sequência diária (gancho de retorno / retenção D7)
--
-- Acrescenta ao perfil a sequência de dias consecutivos com partida e o último
-- dia jogado (dia epoch UTC). O servidor mantém os valores (write-through) e eles
-- alimentam a "missão do dia" e a sequência exibidas na home. Sem efeito de regra
-- (não é pay-to-win; é progresso por hábito).
alter table public.players
  add column if not exists streak integer not null default 0,
  add column if not exists last_play_day integer not null default 0;

comment on column public.players.streak is
  'Dias consecutivos com ao menos uma partida (gancho de retenção). Mantido pelo servidor.';
comment on column public.players.last_play_day is
  'Último dia (epoch UTC) com partida — base do cálculo da sequência.';
