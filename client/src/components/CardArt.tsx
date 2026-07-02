import type { IconType } from 'react-icons';
import {
  GiArcher, GiBiceps, GiBigWave, GiCoinflip, GiCrossedSabres, GiCrystalWand, GiCultist,
  GiDirewolf, GiDragonHead, GiElfHelmet, GiEvilBat, GiFairy, GiFireball, GiFrozenOrb,
  GiGiantSquid, GiGolemHead, GiHealing, GiHolyGrail, GiHolySymbol, GiHoodedAssassin,
  GiIceBolt, GiJellyfish, GiKnightBanner, GiKrakenTentacle, GiLightningStorm,
  GiLightningTrio, GiLyre, GiMagicSwirl, GiMermaid, GiMoonClaws,
  GiMountedKnight, GiMusicSpell, GiPirateCaptain, GiPirateHat, GiPowerLightning, GiPrayer,
  GiReturnArrow, GiRoundShield, GiScrollUnfurled, GiSeaSerpent, GiShadowFollower,
  GiSharkJaws, GiShield, GiShipBow, GiSpartanHelmet, GiSpectre, GiStagHead,
  GiSwordBrandish, GiSwordwoman, GiTreasureMap, GiWarhammer, GiWizardFace, GiWolfHowl,
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
  c_renegado: { Icon: GiHoodedAssassin, fg: '#e0a898', bg: 'linear-gradient(160deg, #5e3028, #241009)' },
  // Criaturas — expansão "Maré Sem Rei" (Vanguarda)
  c_escudeira: { Icon: GiShield, fg: '#e8d5a8', bg: 'linear-gradient(160deg, #6e5a2c, #2c2210)' },
  c_cleriga: { Icon: GiPrayer, fg: '#ffe9b0', bg: 'linear-gradient(160deg, #8a6a28, #382a0e)' },
  c_templario: { Icon: GiWarhammer, fg: '#f0d089', bg: 'linear-gradient(160deg, #7a5c1e, #30240a)' },
  // Criaturas — expansão "Maré Sem Rei" (Silvanos)
  c_sentinela: { Icon: GiElfHelmet, fg: '#b4e8a6', bg: 'linear-gradient(160deg, #33613a, #162916)' },
  c_duelista: { Icon: GiSwordBrandish, fg: '#9fe0b8', bg: 'linear-gradient(160deg, #275940, #10261a)' },
  c_bardo: { Icon: GiLyre, fg: '#c8e89a', bg: 'linear-gradient(160deg, #4a5e24, #1e260e)' },
  c_cervo: { Icon: GiStagHead, fg: '#b6e2a0', bg: 'linear-gradient(160deg, #3a5c2c, #172612)' },
  c_filhote: { Icon: GiDirewolf, fg: '#d0c2f0', bg: 'linear-gradient(160deg, #4c4268, #201a30)' },
  // Criaturas — expansão "Maré Sem Rei" (Éter)
  c_fada: { Icon: GiFairy, fg: '#d0b6ff', bg: 'linear-gradient(160deg, #4a3a78, #1c1430)' },
  c_elemental: { Icon: GiMagicSwirl, fg: '#9fd8ff', bg: 'linear-gradient(160deg, #24507a, #0e2032)' },
  c_maga: { Icon: GiCrystalWand, fg: '#b8c2ff', bg: 'linear-gradient(160deg, #38406e, #14182c)' },
  c_arquimago: { Icon: GiWizardFace, fg: '#c2aaff', bg: 'linear-gradient(160deg, #46327a, #1a1230)' },
  // Criaturas — expansão "Maré Sem Rei" (Profundezas)
  c_morcego: { Icon: GiEvilBat, fg: '#c89ae0', bg: 'linear-gradient(160deg, #46285e, #1b0e26)' },
  c_cultista: { Icon: GiCultist, fg: '#e0a0c0', bg: 'linear-gradient(160deg, #5e2444, #260e1c)' },
  c_espectro: { Icon: GiSpectre, fg: '#bda6e8', bg: 'linear-gradient(160deg, #3e2c60, #170f26)' },
  c_horror: { Icon: GiShadowFollower, fg: '#b088d8', bg: 'linear-gradient(160deg, #38215a, #140b24)' },
  // Criaturas — expansão "Maré Sem Rei" (Maré)
  c_grumete: { Icon: GiPirateHat, fg: '#8fe8dc', bg: 'linear-gradient(160deg, #1e5e56, #0a2622)' },
  c_corsaria: { Icon: GiPirateCaptain, fg: '#7fe0d0', bg: 'linear-gradient(160deg, #206258, #0c2823)' },
  c_aguaviva: { Icon: GiJellyfish, fg: '#a0f0e4', bg: 'linear-gradient(160deg, #1c564e, #0a221f)' },
  c_sereia: { Icon: GiMermaid, fg: '#8fe6d4', bg: 'linear-gradient(160deg, #22685c, #0e2a25)' },
  c_tubarao: { Icon: GiSharkJaws, fg: '#9fdce4', bg: 'linear-gradient(160deg, #24545e, #0e2226)' },
  c_serpente: { Icon: GiSeaSerpent, fg: '#7ce0c8', bg: 'linear-gradient(160deg, #1e5a48, #0b241d)' },
  c_kraken: { Icon: GiGiantSquid, fg: '#6fdcd0', bg: 'linear-gradient(160deg, #164e4a, #071f1e)' },
  c_tentaculo: { Icon: GiKrakenTentacle, fg: '#8ce4d8', bg: 'linear-gradient(160deg, #1c5650, #0a2320)' },
  // Magias
  s_faisca: { Icon: GiPowerLightning, fg: '#ffe066', bg: 'linear-gradient(160deg, #6e5a16, #2a230a)' },
  s_bola_de_fogo: { Icon: GiFireball, fg: '#ffb059', bg: 'linear-gradient(160deg, #7a3a14, #2e1406)' },
  s_bencao: { Icon: GiHealing, fg: '#8ef0a0', bg: 'linear-gradient(160deg, #1f5e3a, #0c2618)' },
  s_fortalecer: { Icon: GiBiceps, fg: '#ff8c86', bg: 'linear-gradient(160deg, #6e2436, #290d14)' },
  s_tempestade: { Icon: GiLightningStorm, fg: '#a6d4ff', bg: 'linear-gradient(160deg, #27466e, #0e1c2c)' },
  // Magias — expansão "Maré Sem Rei"
  s_julgamento: { Icon: GiHolySymbol, fg: '#ffe482', bg: 'linear-gradient(160deg, #8a6c1c, #362a0a)' },
  s_canto: { Icon: GiMusicSpell, fg: '#a0e8c0', bg: 'linear-gradient(160deg, #1f5e44, #0c261c)' },
  s_lanca_gelo: { Icon: GiIceBolt, fg: '#b0ecff', bg: 'linear-gradient(160deg, #1e5a72, #0a232e)' },
  s_pacto: { Icon: GiMoonClaws, fg: '#e89ab0', bg: 'linear-gradient(160deg, #641f38, #280c16)' },
  s_maremoto: { Icon: GiBigWave, fg: '#8fe0ec', bg: 'linear-gradient(160deg, #1e4e6e, #0a1f2c)' },
  // Artefatos
  a_escudo: { Icon: GiRoundShield, fg: '#c4d2e4', bg: 'linear-gradient(160deg, #44526a, #1e2633)' },
  a_estandarte: { Icon: GiKnightBanner, fg: '#e8b6b0', bg: 'linear-gradient(160deg, #6e3030, #2a1010)' },
  // Artefatos — expansão "Maré Sem Rei"
  a_relicario: { Icon: GiHolyGrail, fg: '#ffd98f', bg: 'linear-gradient(160deg, #7e5a22, #32220c)' },
  a_orbe: { Icon: GiFrozenOrb, fg: '#a6c8ff', bg: 'linear-gradient(160deg, #2c4278, #101a30)' },
  a_figura: { Icon: GiShipBow, fg: '#8adcd2', bg: 'linear-gradient(160deg, #1f5c58, #0c2524)' },
  // Táticas
  t_reforcos: { Icon: GiScrollUnfurled, fg: '#e6d2a8', bg: 'linear-gradient(160deg, #5e4d2c, #261e10)' },
  t_surto: { Icon: GiLightningTrio, fg: '#8fd0ff', bg: 'linear-gradient(160deg, #1f4a6e, #0c1d2c)' },
  t_recuo: { Icon: GiReturnArrow, fg: '#8ee6dc', bg: 'linear-gradient(160deg, #1d5752, #0a2422)' },
  // Táticas — expansão "Maré Sem Rei"
  t_matilha: { Icon: GiWolfHowl, fg: '#9ad4a8', bg: 'linear-gradient(160deg, #2c5236, #112116)' },
  t_abordagem: { Icon: GiCrossedSabres, fg: '#9ce8d2', bg: 'linear-gradient(160deg, #226052, #0d2620)' },
  t_saque: { Icon: GiTreasureMap, fg: '#b8e8c8', bg: 'linear-gradient(160deg, #2c5e46, #12261c)' },
  // Tokens de mecânica
  t_moeda: { Icon: GiCoinflip, fg: '#ffdf8f', bg: 'linear-gradient(160deg, #7a5e1e, #30240c)' },
};

export function CardArt({ defId, className }: { defId: string; className?: string }) {
  const art = ART[defId];
  if (!art) {
    return <span className={`card-art-frame ${className ?? ''}`}>{CARDS[defId]?.art}</span>;
  }
  return (
    <span
      className={`card-art-frame ${className ?? ''}`}
      // luz de palco atrás do ícone + halo na cor da arte dão profundidade à vinheta
      style={{
        background: `radial-gradient(80% 75% at 50% 38%, ${art.fg}2e 0%, transparent 70%), ${art.bg}`,
      }}
    >
      <art.Icon style={{ color: art.fg }} aria-hidden />
    </span>
  );
}
