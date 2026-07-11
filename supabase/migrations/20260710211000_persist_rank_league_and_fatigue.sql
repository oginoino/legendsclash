-- Legends Clash — ranking persistido e histórico de fadiga
--
-- A liga exibida no ranking passa a existir no banco como coluna gerada a
-- partir do MMR. O servidor ainda recalcula em memória como fallback, mas as
-- respostas do ranking em produção conseguem refletir diretamente a verdade
-- persistida no Supabase.

alter table public.players
  add column if not exists league text generated always as (
    case
      when mmr >= 1300 then 'Ouro'
      when mmr >= 1100 then 'Prata'
      else 'Bronze'
    end
  ) stored;

comment on column public.players.league is
  'Liga derivada do MMR e persistida para consultas de ranking (Bronze/Prata/Ouro).';

create index if not exists players_rank_idx
  on public.players (mmr desc, wins desc, losses asc, created_at asc)
  where wins > 0 or losses > 0;

-- O motor já encerra partidas por fadiga; a constraint inicial só aceitava
-- hp/surrender/timeout, fazendo inserts de match_history falharem nesse caso.
alter table public.match_history
  drop constraint if exists match_history_reason_check;

alter table public.match_history
  add constraint match_history_reason_check
  check (reason in ('hp', 'surrender', 'timeout', 'fatigue'));
