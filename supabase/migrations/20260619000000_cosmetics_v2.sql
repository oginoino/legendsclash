-- Legends Clash — personalização v2 (foto, molduras e estilos de cor)
--
-- Acrescenta ao perfil: foto enviada pelo jogador (URL no Storage), moldura
-- decorativa e estilo de cor (gradiente/brilho). São cosméticos exibidos no
-- perfil e na arena (a foto é VISÍVEL AO OPONENTE); o servidor valida frame e
-- accent_style contra as listas do pacote shared e o formato/tamanho da foto
-- antes de gravar. A troca emoji→id de ícone (avatar/commander) é normalizada
-- em runtime na carga, então NÃO precisa de migração de dados aqui.
--
-- Esta feature roda atrás da flag LC_COSMETICS_V2; aplique esta migração e crie
-- o bucket abaixo antes de ligar a flag em produção.

alter table public.players
  add column if not exists photo text,
  add column if not exists frame text not null default 'none',
  add column if not exists accent_style text not null default 'solid';

comment on column public.players.photo is
  'Foto de perfil (URL pública no bucket avatars) ou null. Validada (mime/tamanho) no servidor.';
comment on column public.players.frame is
  'Moldura decorativa (id). Validada contra FRAMES no servidor.';
comment on column public.players.accent_style is
  'Estilo de cor do realce (id). Validado contra ACCENT_STYLES no servidor.';

-- ── Bucket público das fotos de perfil ────────────────────────────
-- Leitura pública (a foto aparece para o oponente); a escrita é feita só pelo
-- servidor com a service role (que ignora RLS), então não há policy de insert
-- pública — clientes nunca falam direto com o Storage.

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');
