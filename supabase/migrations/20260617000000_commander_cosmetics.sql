-- Legends Clash — personalização de comandante
--
-- Acrescenta o retrato do comandante e a cor de destaque ao perfil. São
-- cosméticos exibidos na arena; o servidor valida os valores contra as listas
-- do pacote shared antes de gravar (anti-abuso). Contas existentes herdam o
-- avatar como retrato e o dourado padrão.

alter table public.players
  add column if not exists commander text not null default '🛡️',
  add column if not exists accent text not null default '#e3b341';

comment on column public.players.commander is
  'Retrato (emoji) do comandante exibido na arena. Validado contra COMMANDERS no servidor.';
comment on column public.players.accent is
  'Cor de destaque (hex) do comandante. Validada contra ACCENTS no servidor.';
