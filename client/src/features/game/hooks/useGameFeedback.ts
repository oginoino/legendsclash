import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { CARDS } from '@legendsclash/shared';
import type { ChatMessage, GameView as GameViewState, MatchResult } from '@legendsclash/shared';
import { sfx } from '../../../sounds';
import {
  BUBBLE_TTL,
  DAMAGE_NOTICE_TTL,
  FX_TTL,
  GHOST_TTL,
  REVEAL_TTL,
  deriveSnapshotFeedback,
} from '../feedback-model';
import type { Bubble, DamageNotice, FloatFx, Ghost, Reveal } from '../feedback-model';

export interface UseGameFeedbackArgs {
  battleHints: boolean;
  chat: ChatMessage[];
  game: GameViewState | null;
  gameOver: MatchResult | null;
  now: number;
  onTurnChanged: () => void;
  profileId?: string;
}

export interface GameFeedbackState {
  attackFx: { iid: string; at: number } | null;
  banner: { text: string; at: number } | null;
  bubbles: Bubble[];
  damageNotice: DamageNotice | null;
  dismissTeach: () => void;
  effects: FloatFx[];
  ghosts: Ghost[];
  reveals: Reveal[];
  setAttackFx: Dispatch<SetStateAction<{ iid: string; at: number } | null>>;
  teach: { id: string; text: string; at: number } | null;
}

let feedbackId = 1;

export function useGameFeedback({
  battleHints,
  chat,
  game,
  gameOver,
  now,
  onTurnChanged,
  profileId,
}: UseGameFeedbackArgs): GameFeedbackState {
  const [effects, setEffects] = useState<FloatFx[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [banner, setBanner] = useState<{ text: string; at: number } | null>(null);
  const [damageNotice, setDamageNotice] = useState<DamageNotice | null>(null);
  const [teach, setTeach] = useState<{ id: string; text: string; at: number } | null>(null);
  const [attackFx, setAttackFx] = useState<{ iid: string; at: number } | null>(null);
  const previousGameRef = useRef<GameViewState | null>(null);
  const previousChatLengthRef = useRef(0);
  const onTurnChangedRef = useRef(onTurnChanged);
  onTurnChangedRef.current = onTurnChanged;

  useEffect(() => {
    setEffects((current) => (
      current.length && now - current[0].at > FX_TTL
        ? current.filter((effect) => now - effect.at < FX_TTL)
        : current
    ));
    setGhosts((current) => (
      current.length && now - current[0].at > GHOST_TTL
        ? current.filter((ghost) => now - ghost.at < GHOST_TTL)
        : current
    ));
    setReveals((current) => (
      current.length && now - current[0].at > REVEAL_TTL
        ? current.filter((reveal) => now - reveal.at < REVEAL_TTL)
        : current
    ));
    setBubbles((current) => (
      current.length && now - current[0].at > BUBBLE_TTL
        ? current.filter((bubble) => now - bubble.at < BUBBLE_TTL)
        : current
    ));
    setBanner((current) => (current && now - current.at > 1500 ? null : current));
    setDamageNotice((current) => (
      current && now - current.at > DAMAGE_NOTICE_TTL ? null : current
    ));
    setTeach((current) => (current && now - current.at > 7000 ? null : current));
  }, [now]);

  useEffect(() => {
    const previous = previousGameRef.current;
    previousGameRef.current = game;
    const feedback = deriveSnapshotFeedback(previous, game, Date.now(), () => feedbackId++);

    if (feedback.effects.length) {
      setEffects((current) => [...current, ...feedback.effects]);
    }
    if (feedback.ghosts.length) {
      setGhosts((current) => [...current, ...feedback.ghosts]);
    }
    if (feedback.reveals.length) {
      setReveals((current) => [...current, ...feedback.reveals]);
    }
    if (feedback.attackFx) setAttackFx(feedback.attackFx);
    if (feedback.damageNotice) setDamageNotice(feedback.damageNotice);
    if (feedback.banner) setBanner(feedback.banner);
    for (const cue of feedback.sounds) sfx[cue]();
    if (feedback.resetAim) onTurnChangedRef.current();
  }, [game]);

  useEffect(() => {
    if (!battleHints || !game || game.yourSeat < 0 || game.status !== 'active') return;
    const seen = (key: string) => {
      try { return localStorage.getItem(key) === '1'; } catch { return true; }
    };
    const mark = (key: string) => {
      try { localStorage.setItem(key, '1'); } catch { /* armazenamento opcional */ }
    };
    const enemyIdx = game.seats.findIndex((_, seat) => seat !== game.yourSeat);
    const player = game.seats[game.yourSeat];
    if (
      enemyIdx >= 0
      && !seen('lc_taught_taunt')
      && game.seats[enemyIdx].board.some(
        (creature) => CARDS[creature.defId].keywords?.includes('taunt'),
      )
    ) {
      setTeach({
        id: 'taunt',
        text: 'Provocar: criaturas com Provocar precisam ser atacadas antes das outras. Derrote-a primeiro.',
        at: Date.now(),
      });
      mark('lc_taught_taunt');
      return;
    }
    if (player && player.fatigue > 0 && !seen('lc_taught_fatigue')) {
      setTeach({
        id: 'fatigue',
        text: 'Fadiga: seu baralho esgotou — cada compra agora tira vida. Feche a partida logo.',
        at: Date.now(),
      });
      mark('lc_taught_fatigue');
    }
  }, [battleHints, game]);

  useEffect(() => {
    if (!game) return;
    if (chat.length < previousChatLengthRef.current) previousChatLengthRef.current = 0;
    const fresh = chat.slice(previousChatLengthRef.current);
    previousChatLengthRef.current = chat.length;
    if (!fresh.length) return;

    const at = Date.now();
    const added = fresh.flatMap((message): Bubble[] => {
      const seatIdx = game.seats.findIndex((seat) => seat.playerId === message.from.id);
      return seatIdx >= 0
        ? [{ id: feedbackId++, seatIdx, text: message.text, at }]
        : [];
    });
    if (added.length) setBubbles((current) => [...current, ...added]);
    // Mantém a semântica anterior: o efeito reage a novas mensagens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  const gameOverSignature = gameOver?.matchId;
  useEffect(() => {
    if (!gameOverSignature || !profileId || !gameOver) return;
    if (gameOver.winnerId === profileId) sfx.victory();
    else sfx.defeat();
    // Mantém a fanfarra vinculada a uma única transição de partida encerrada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOverSignature]);

  return {
    attackFx,
    banner,
    bubbles,
    damageNotice,
    dismissTeach: () => setTeach(null),
    effects,
    ghosts,
    reveals,
    setAttackFx,
    teach,
  };
}
