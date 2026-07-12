-- Legends Clash - tradição persistida no perfil público
--
-- A escolha já era validada pelo servidor e usada para inclinar o deck, mas
-- vivia apenas no navegador/processo. Persisti-la evita perda após deploy e
-- permite apresentar a identidade escolhida no ranking e no perfil público.

alter table public.players
  add column if not exists faction text not null default '';

alter table public.players
  drop constraint if exists players_faction_check;

alter table public.players
  add constraint players_faction_check
  check (faction in ('', 'vanguarda', 'silvanos', 'eter', 'profundezas', 'mares'));

comment on column public.players.faction is
  'Tradição pública do jogador e inclinação de deck; vazio representa perfil neutro.';
