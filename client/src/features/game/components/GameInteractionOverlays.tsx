import { CARDS } from '@legendsclash/shared';
import { CardView } from '../../../components/CardView';
import {
  IcoAttack,
  IcoBuff,
  IcoCheck,
  IcoClose,
  IcoHand,
  IcoSparkle,
  IcoTarget,
} from '../../../icons';
import { AimOverlay } from './AimOverlay';
import type { AimMode } from './AimOverlay';
import type { DragCardVisual } from '../drag-gesture-model';
import type { Reveal } from '../feedback-model';
import type { ArrowGeometry } from '../targeting-model';
import type { HandFocus, InspectCard } from '../view-model';

export interface TargetHint {
  mode: 'attack' | 'support' | 'spell';
  title: string;
  body: string;
}

export interface HandConfirm {
  mode: 'play';
  title: string;
  body: string;
  actionLabel: string;
}

interface GameInteractionOverlaysProps {
  dragCard: DragCardVisual | null;
  targetHint: TargetHint | null;
  handConfirm: HandConfirm | null;
  handFocus: HandFocus;
  onClearAim: () => void;
  onConfirmFocusedHandPlay: () => void;
  arrow: ArrowGeometry | null;
  lockOn: boolean;
  aimMode: AimMode;
  tacticAim: boolean;
  reveals: Reveal[];
  inspect: InspectCard | null;
  banner: { text: string; at: number } | null;
  hideBanner: boolean;
  teach: { id: string; text: string; at: number } | null;
  onDismissTeach: () => void;
}

function DragCardOverlay({ dragCard }: { dragCard: DragCardVisual }) {
  const supportsFriendly = CARDS[dragCard.defId]?.target === 'friendly-creature';
  return (
    <div
      className={[
        'drag-card-layer',
        `drag-${dragCard.mode}`,
        `input-${dragCard.pointerType}`,
        dragCard.valid ? 'valid' : '',
        dragCard.magnetized ? 'magnetized' : '',
        supportsFriendly ? 'support' : '',
        dragCard.y < 240 ? 'place-below' : 'place-above',
      ].filter(Boolean).join(' ')}
      style={{
        left: `clamp(74px, ${dragCard.x}px, calc(100vw - 74px))`,
        top: dragCard.y,
      }}
      aria-hidden="true"
    >
      <CardView
        defId={dragCard.defId}
        as="div"
        className="drag-card-preview"
        imageLoading="eager"
        imagePriority="high"
      />
      <span className="drag-card-label">
        {dragCard.mode === 'play'
          ? <IcoCheck className="ic" />
          : supportsFriendly
            ? <IcoBuff className="ic" />
            : <IcoTarget className="ic" />}
        <strong>{dragCard.label}</strong>
      </span>
    </div>
  );
}

function CommandIcon({ mode }: { mode: TargetHint['mode'] }) {
  if (mode === 'attack') return <IcoAttack />;
  if (mode === 'support') return <IcoBuff />;
  return <IcoSparkle />;
}

function TargetInstructions({ hint, onClearAim }: {
  hint: TargetHint;
  onClearAim: () => void;
}) {
  return (
    <>
      <div className={`target-hint ${hint.mode}`}>
        <span className="target-hint-icon"><CommandIcon mode={hint.mode} /></span>
        <span className="target-hint-text">
          <strong>{hint.title}</strong>
          <span>{hint.body}</span>
        </span>
        <button className="btn small hint-cancel" onClick={onClearAim}>
          <IcoClose className="ic" /> Cancelar
        </button>
      </div>

      <div className={`touch-command ${hint.mode}`} role="status" aria-live="polite">
        <span className="touch-command-icon"><CommandIcon mode={hint.mode} /></span>
        <span className="touch-command-text">
          <strong>{hint.title}</strong>
          <span>{hint.body}</span>
        </span>
        <button className="btn small cancel-pill" onClick={onClearAim} aria-label="Cancelar mira">
          <IcoClose className="ic" /> Cancelar
        </button>
      </div>
    </>
  );
}

function HandFocusOverlay({ focus, confirm, onConfirm, onClearAim }: {
  focus: NonNullable<HandFocus>;
  confirm: HandConfirm;
  onConfirm: () => void;
  onClearAim: () => void;
}) {
  return (
    <div className="hand-focus-tray" role="dialog" aria-live="polite" aria-label={`Carta focada: ${confirm.title}`}>
      <div className="hand-focus-card" aria-hidden="true">
        <CardView
          defId={focus.defId}
          as="div"
          selected
          className="focus-preview-card"
          imageLoading="eager"
          imagePriority="high"
          statusLabel="Pronta"
          statusTone="good"
        />
      </div>
      <div className="hand-focus-panel">
        <span className="touch-command-icon"><IcoHand /></span>
        <span className="touch-command-text">
          <strong>{confirm.title}</strong>
          <span>{confirm.body}</span>
        </span>
        <div className="hand-focus-buttons">
          <button
            className="btn small play-pill"
            onClick={onConfirm}
            aria-label={`${confirm.actionLabel} ${confirm.title}`}
          >
            <IcoCheck className="ic" /> {confirm.actionLabel}
          </button>
          <button className="btn small cancel-pill" onClick={onClearAim} aria-label="Fechar carta focada">
            <IcoClose className="ic" /> Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function InspectOverlay({ inspect }: { inspect: InspectCard }) {
  const edge = inspect.source === 'creature' ? 160 : 130;
  return (
    <div
      className={`card-inspect ${inspect.source === 'creature' ? 'board-inspect' : ''}`}
      style={{
        left: Math.min(Math.max(inspect.x, edge), window.innerWidth - edge),
        top: inspect.source === 'creature'
          ? Math.min(Math.max(inspect.y, 460), window.innerHeight - 12)
          : inspect.y,
      }}
    >
      <CardView defId={inspect.defId} />
    </div>
  );
}

export function GameInteractionOverlays({
  dragCard,
  targetHint,
  handConfirm,
  handFocus,
  onClearAim,
  onConfirmFocusedHandPlay,
  arrow,
  lockOn,
  aimMode,
  tacticAim,
  reveals,
  inspect,
  banner,
  hideBanner,
  teach,
  onDismissTeach,
}: GameInteractionOverlaysProps) {
  return (
    <>
      {dragCard && <DragCardOverlay dragCard={dragCard} />}
      {targetHint && <TargetInstructions hint={targetHint} onClearAim={onClearAim} />}
      {handConfirm && handFocus && (
        <HandFocusOverlay
          focus={handFocus}
          confirm={handConfirm}
          onConfirm={onConfirmFocusedHandPlay}
          onClearAim={onClearAim}
        />
      )}
      {arrow && <AimOverlay arrow={arrow} lockOn={lockOn} mode={aimMode} tactic={tacticAim} />}

      <div className="reveal-stack">
        {reveals.map((reveal) => (
          <div key={reveal.id} className="card-reveal">
            <span className="reveal-label">Oponente jogou</span>
            <CardView defId={reveal.cardId} />
          </div>
        ))}
      </div>

      {inspect && <InspectOverlay inspect={inspect} />}
      {banner && !hideBanner && (
        <div className="turn-banner" key={banner.at} role="status" aria-live="assertive">
          {banner.text}
        </div>
      )}
      {teach && (
        <div className="teach-toast" key={teach.id} role="status" aria-live="polite">
          <span>{teach.text}</span>
          <button className="btn small ghost" onClick={onDismissTeach} aria-label="Fechar dica">
            <IcoClose />
          </button>
        </div>
      )}
    </>
  );
}
