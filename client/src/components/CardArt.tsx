import type { IconType } from 'react-icons';
import {
  GiArcher, GiBiceps, GiDirewolf, GiDragonHead, GiFireball, GiGolemHead,
  GiHealing, GiKnightBanner, GiLightningTrio, GiMountedKnight, GiPowerLightning,
  GiReturnArrow, GiRoundShield, GiScrollUnfurled, GiSpartanHelmet, GiSwordwoman,
} from 'react-icons/gi';
import { CARDS } from '@legendsclash/shared';

/**
 * Arte das cartas: ícones de fantasia de game-icons.net (CC BY 3.0),
 * via pacote react-icons. Cada carta tem ícone e paleta próprios; o emoji
 * do catálogo permanece como fallback para cartas sem arte mapeada.
 *
 * Atribuição: https://game-icons.net (CC BY 3.0).
 */

interface Art {
  Icon: IconType;
  fg: string;
  bg: string;
}

const ART: Record<string, Art> = {
  // Criaturas
  c_recruta: { Icon: GiSpartanHelmet, fg: '#cfd9e6', bg: 'linear-gradient(160deg, #3a4f6e, #1c2940)' },
  c_lobo: { Icon: GiDirewolf, fg: '#b9a6e8', bg: 'linear-gradient(160deg, #3d3357, #181225)' },
  c_arqueira: { Icon: GiArcher, fg: '#a8e6a0', bg: 'linear-gradient(160deg, #2e5938, #142718)' },
  c_cavaleiro: { Icon: GiMountedKnight, fg: '#d8e0ec', bg: 'linear-gradient(160deg, #4a5668, #232a36)' },
  c_golem: { Icon: GiGolemHead, fg: '#d9b896', bg: 'linear-gradient(160deg, #5d4a35, #2a2014)' },
  c_campea: { Icon: GiSwordwoman, fg: '#ffd970', bg: 'linear-gradient(160deg, #8a6420, #3a2a0c)' },
  c_dragao: { Icon: GiDragonHead, fg: '#ff9d86', bg: 'linear-gradient(160deg, #6e2c20, #2a0f0a)' },
  // Magias
  s_faisca: { Icon: GiPowerLightning, fg: '#ffe066', bg: 'linear-gradient(160deg, #6e5a16, #2a230a)' },
  s_bola_de_fogo: { Icon: GiFireball, fg: '#ffb059', bg: 'linear-gradient(160deg, #7a3a14, #2e1406)' },
  s_bencao: { Icon: GiHealing, fg: '#8ef0a0', bg: 'linear-gradient(160deg, #1f5e3a, #0c2618)' },
  s_fortalecer: { Icon: GiBiceps, fg: '#ff8c86', bg: 'linear-gradient(160deg, #6e2436, #290d14)' },
  // Artefatos
  a_escudo: { Icon: GiRoundShield, fg: '#c4d2e4', bg: 'linear-gradient(160deg, #44526a, #1e2633)' },
  a_estandarte: { Icon: GiKnightBanner, fg: '#e8b6b0', bg: 'linear-gradient(160deg, #6e3030, #2a1010)' },
  // Táticas
  t_reforcos: { Icon: GiScrollUnfurled, fg: '#e6d2a8', bg: 'linear-gradient(160deg, #5e4d2c, #261e10)' },
  t_surto: { Icon: GiLightningTrio, fg: '#8fd0ff', bg: 'linear-gradient(160deg, #1f4a6e, #0c1d2c)' },
  t_recuo: { Icon: GiReturnArrow, fg: '#8ee6dc', bg: 'linear-gradient(160deg, #1d5752, #0a2422)' },
};

export function CardArt({ defId, className }: { defId: string; className?: string }) {
  const art = ART[defId];
  if (!art) {
    return <span className={`card-art-frame ${className ?? ''}`}>{CARDS[defId]?.art}</span>;
  }
  return (
    <span className={`card-art-frame ${className ?? ''}`} style={{ background: art.bg }}>
      <art.Icon style={{ color: art.fg }} aria-hidden />
    </span>
  );
}
