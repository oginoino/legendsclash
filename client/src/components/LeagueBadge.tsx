import type { IconType } from 'react-icons';
import type { League } from '@legendsclash/shared';
import { IcoBronze, IcoGold, IcoSilver } from '../icons';

const ICON: Record<League, IconType> = { Bronze: IcoBronze, Prata: IcoSilver, Ouro: IcoGold };

export function LeagueBadge({ league }: { league: League }) {
  const Icon = ICON[league];
  return (
    <span className={`league-badge league-${league.toLowerCase()}`}>
      <Icon className="ic" /> {league}
    </span>
  );
}
