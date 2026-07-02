/**
 * Registro central de ícones do sistema (Game Icons / react-icons/gi).
 * Fonte ÚNICA de verdade: cada CONCEITO da UI mapeia para um ícone, então o
 * mesmo conceito fica idêntico em toda a tela e trocar um ícone é um só lugar.
 * Substitui os emojis espalhados pela UI por ilustrações aderentes ao tema de
 * fantasia. Use com a classe `ic` para alinhar ícones inline ao texto.
 */
import type { IconType } from 'react-icons';
import {
  GiScrollUnfurled, GiSpellBook, GiOpenBook, GiChatBubble, GiPartyPopper, GiFlyingFlag,
  GiCancel, GiCheckMark, GiPlainSquare, GiSpeaker, GiSpeakerOff, GiMusicalNotes, GiLinkedRings,
  GiCycle, GiBackForth, GiThreeFriends, GiGamepad, GiHazardSign, GiLightBulb, GiAlarmClock,
  GiSandsOfTime, GiSparkles, GiCheckeredFlag, GiRobotGolem, GiCrossedSwords, GiSwordWound,
  GiShield, GiDeathSkull, GiSkullCrossedBones, GiUpgrade, GiLightningArc, GiCutDiamond, GiHearts,
  GiMoneyStack, GiTwoCoins, GiFlagObjective, GiCardPickup, GiPokerHand, GiCardRandom, GiStarMedal,
  GiTrophy, GiRibbonMedal, GiTargetArrows, GiPodiumWinner, GiPodiumSecond, GiPodiumThird, GiFlame,
  GiPadlock, GiRoundStar, GiSunbeams, GiStarSwirl, GiWolfHead, GiCrystalBall, GiDragonHead,
  GiShakingHands, GiBrokenHeart, GiSunglasses, GiCrenelCrown, GiThumbUp, GiWaveCrest,
  GiMagicShield,
} from 'react-icons/gi';

export {
  // — UI / navegação / controles —
  GiScrollUnfurled as IcoEvents,
  GiSpellBook as IcoCodex, // Arquivo de Aurélia
  GiOpenBook as IcoRules,
  GiChatBubble as IcoChat,
  GiPartyPopper as IcoTaunt, // alternador de provocação
  GiFlyingFlag as IcoSurrender,
  GiCancel as IcoClose,
  GiCheckMark as IcoCheck,
  GiPlainSquare as IcoUnchecked,
  GiSpeaker as IcoSound,
  GiSpeakerOff as IcoMuted,
  GiMusicalNotes as IcoMusic,
  GiLinkedRings as IcoLink,
  GiCycle as IcoRematch,
  GiBackForth as IcoSwap,
  GiThreeFriends as IcoAddFriend,
  GiGamepad as IcoPlay,
  GiHazardSign as IcoWarning,
  GiLightBulb as IcoHint,
  GiAlarmClock as IcoTimer,
  GiSandsOfTime as IcoHourglass,
  GiSparkles as IcoSparkle, // personalizar / conquista desbloqueada
  GiCheckeredFlag as IcoFinish,
  GiRobotGolem as IcoBot,

  // — combate / cartas —
  GiCrossedSwords as IcoAttack,
  GiSwordWound as IcoOverflow, // dano excedente
  GiShield as IcoShield, // escudo / Provocar / defesa
  GiMagicShield as IcoWard, // Escudo Arcano (ward) ativo na criatura
  GiDeathSkull as IcoDeath, // morte / fadiga
  GiSkullCrossedBones as IcoLethal,
  GiUpgrade as IcoBuff,
  GiLightningArc as IcoEnergy,
  GiCutDiamond as IcoCost, // custo de energia da carta
  GiHearts as IcoHealth,
  GiMoneyStack as IcoExpensive,
  GiTwoCoins as IcoCoin,
  GiFlagObjective as IcoBanner, // Estandarte de Guerra
  GiCardPickup as IcoDeck,
  GiPokerHand as IcoHand,
  GiCardRandom as IcoCardType,

  // — progressão / prestígio / ligas —
  GiStarMedal as IcoMvp,
  GiTrophy as IcoVictory,
  GiRibbonMedal as IcoMedal, // liga / conquista
  GiTargetArrows as IcoTarget,
  GiPodiumWinner as IcoGold,
  GiPodiumSecond as IcoSilver,
  GiPodiumThird as IcoBronze,
  GiFlame as IcoStreak,
  GiPadlock as IcoLock,
  GiRoundStar as IcoStar, // carta do dia / MVP

  // — facções (Arquivo de Aurélia) —
  GiSunbeams as IcoFactionLight,
  GiStarSwirl as IcoRealm,
  GiWolfHead as IcoWolf,
  GiCrystalBall as IcoArcane,
  GiDragonHead as IcoDragon,

  // — provocações expressivas —
  GiShakingHands as IcoHandshake,
  GiBrokenHeart as IcoOuch,
  GiSunglasses as IcoCool,
  GiCrenelCrown as IcoCrown,
  GiThumbUp as IcoThumbUp,
};

/** Provocações da arena: id de ícone (shared TAUNTS) → componente. */
export const TAUNT_ICONS: Record<string, IconType> = {
  handshake: GiShakingHands,
  flame: GiFlame,
  ouch: GiBrokenHeart,
  target: GiTargetArrows,
  cool: GiSunglasses,
  hourglass: GiSandsOfTime,
  crown: GiCrenelCrown,
  party: GiPartyPopper,
};

/** Sigilos de facção e ícones das notas do Arquivo de Aurélia (lore.ts). */
export const SIGIL_ICONS: Record<string, IconType> = {
  light: GiSunbeams,
  wolf: GiWolfHead,
  arcane: GiCrystalBall,
  dragon: GiDragonHead,
  tide: GiWaveCrest,
  shield: GiShield,
  death: GiDeathSkull,
};
