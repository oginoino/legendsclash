-- Legends Clash — capa pública de perfil
--
-- Adiciona um cosmético leve ao perfil social: a capa do card/perfil. O valor é
-- um id validado pelo servidor contra PROFILE_COVERS; usuários antigos recebem
-- o fallback 'aurelia'. Não cria tabela nova nem nova superfície pública.

alter table public.players
  add column if not exists profile_cover text not null default 'aurelia';

comment on column public.players.profile_cover is
  'Capa pública do card/perfil social (id em PROFILE_COVERS). Validada no servidor.';
