import type { League } from '@legendsclash/shared';

const ICON: Record<League, string> = { Bronze: '🥉', Prata: '🥈', Ouro: '🥇' };

export function LeagueBadge({ league }: { league: League }) {
  return (
    <span className={`league-badge league-${league.toLowerCase()}`}>
      {ICON[league]} {league}
    </span>
  );
}
