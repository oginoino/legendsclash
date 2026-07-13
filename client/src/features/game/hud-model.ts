import { CARDS } from '@legendsclash/shared';
import type { CardInHand, SeatView } from '@legendsclash/shared';

export type CoachTone = 'wait' | 'end' | 'play' | 'attack' | 'lethal' | 'bot';

export interface ActionCoach {
  done: boolean;
  label: string;
  aria: string;
}

export interface TurnCoach {
  tone: CoachTone;
  title: string;
  body: string;
}

export interface GameHudModel {
  noMovesLeft: boolean;
  actionCoach: ActionCoach | null;
  turnCoach: TurnCoach;
  readyDamage: number;
  enemyBoardDamage: number;
  enemyFatiguePressure: boolean;
}

export function deriveGameHud({
  hand,
  player,
  enemy,
  myTurn,
}: {
  hand: CardInHand[];
  player: SeatView;
  enemy: SeatView;
  myTurn: boolean;
}): GameHudModel {
  const playableCardCount = myTurn
    ? hand.filter((card) => CARDS[card.defId].cost <= player.energy).length
    : 0;
  const readyAttackerCount = myTurn
    ? player.board.filter((creature) => creature.canAttack).length
    : 0;
  const noMovesLeft = myTurn && playableCardCount === 0 && readyAttackerCount === 0;
  const playableCardText = playableCardCount === 1
    ? '1 carta jogável'
    : `${playableCardCount} cartas jogáveis`;
  const readyAttackerText = readyAttackerCount === 1
    ? '1 atacante pronto'
    : `${readyAttackerCount} atacantes prontos`;
  const actionCoach = myTurn
    ? {
      done: noMovesLeft,
      label: noMovesLeft ? 'Encerrar' : `${playableCardCount} cartas · ${readyAttackerCount} ataques`,
      aria: noMovesLeft
        ? 'Sem ações disponíveis. Encerre o turno.'
        : `${playableCardText}. ${readyAttackerText}.`,
    }
    : null;
  const readyDamage = myTurn
    ? player.board
      .filter((creature) => creature.canAttack)
      .reduce((sum, creature) => sum + creature.attack + player.attackBonus, 0)
    : 0;
  const enemyBoardDamage = enemy.board.reduce(
    (sum, creature) => sum + creature.attack + enemy.attackBonus,
    0,
  );
  const enemyFatiguePressure = enemy.fatigue > 0
    || (enemy.deckCount <= 3 && enemy.deckCount >= 0);
  const faceShielded = enemy.board.length > 0;
  const isPracticeOpponent = enemy.playerId.startsWith('bot:');

  const turnCoach: TurnCoach = myTurn
    ? noMovesLeft
      ? {
        tone: 'end',
        title: 'Sem ações restantes',
        body: 'Encerre o turno para manter o ritmo.',
      }
      : readyAttackerCount > 0 && !faceShielded
        ? {
          tone: 'lethal',
          title: 'Alvo direto aberto',
          body: 'O comandante inimigo está vulnerável.',
        }
        : readyAttackerCount > 0
          ? {
            tone: 'attack',
            title: 'Ataque a mesa',
            body: `${enemy.board.length} ${enemy.board.length === 1 ? 'criatura protege' : 'criaturas protegem'} o comandante.`,
          }
          : playableCardCount > 0
            ? {
              tone: 'play',
              title: 'Use sua energia',
              body: `${playableCardText}; priorize presença cedo.`,
            }
            : {
              tone: 'wait',
              title: 'Procure a próxima janela',
              body: 'Sem ataques prontos. Avalie encerrar depois de revisar a mão.',
            }
    : isPracticeOpponent
      ? {
        tone: 'bot',
        title: 'Treinador avaliando a mesa',
        body: `${enemy.handCount} ${enemy.handCount === 1 ? 'carta' : 'cartas'} na mão · ${enemy.board.length} na mesa.`,
      }
      : {
        tone: 'wait',
        title: 'Planeje a resposta',
        body: `${enemy.name} tem ${enemy.handCount} ${enemy.handCount === 1 ? 'carta' : 'cartas'} na mão.`,
      };

  return {
    noMovesLeft,
    actionCoach,
    turnCoach,
    readyDamage,
    enemyBoardDamage,
    enemyFatiguePressure,
  };
}
