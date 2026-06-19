-- Legends Clash — lista de amigos (continuidade social pós-partida)
--
-- Acrescenta ao perfil a lista de amigos (ids de jogadores que você enfrentou e
-- quis manter por perto). O servidor mantém os valores (write-through); alimenta
-- a revanche, o card de perfil do oponente e os "oponentes recentes". Sem efeito
-- de regra (não é pay-to-win; é social).
--
-- ⚠️ DEPLOY: o upsert de `players` (store.ts) passa a gravar a coluna `friends`.
-- Subir o código em prod SEM aplicar esta migração faz o upsert FALHAR (mesma
-- armadilha da migração de streak). Aplicar ANTES/junto do deploy. Em modo local
-- (snapshot JSON) é no-op.
alter table public.players
  add column if not exists friends text[] not null default '{}';

comment on column public.players.friends is
  'Ids de jogadores adicionados como amigos (continuidade social). Mantido pelo servidor.';
