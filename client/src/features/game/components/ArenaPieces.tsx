import type * as React from 'react';
import { CARDS, MAX_ENERGY, commanderTitle } from '@legendsclash/shared';
import type { CreatureOnBoard, SeatView } from '@legendsclash/shared';
import { Avatar, accentVars } from '../../../cosmetics';
import {
  IcoAttack, IcoBanner, IcoBuff, IcoDeath, IcoDeck, IcoHand, IcoHealth, IcoLethal,
  IcoOverflow, IcoRules, IcoShield, IcoTarget, IcoWard, IcoWarning,
} from '../../../icons';
import { CardArt } from '../../../components/CardArt';
import { creatureHint } from '../view-model';
import type { Bubble, CombatPreview, DamageNotice, FloatFx, Ghost } from '../view-model';

function ImpactRecap({ notice }: { notice: DamageNotice }) {
  const boardHits = notice.hits.filter((hit) => hit.kind === 'creature' || hit.kind === 'defeat');
  const shownBoardHits = boardHits.slice(0, 2);
  const remaining = boardHits.length - shownBoardHits.length;
  const aria = `${notice.actionLabel} de ${notice.owner}: ${notice.source}. ${notice.summary}.${
    notice.incoming > 0 ? ` ${notice.hpAfter} de vida restante.` : ''
  }`;
  return (
    <div
      key={notice.id}
      className={`hero-impact-recap ${notice.severity}`}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={aria}
    >
      <span className="impact-source-art" aria-hidden="true">
        {notice.sourceDefId
          ? <CardArt defId={notice.sourceDefId} loading="eager" fetchPriority="high" />
          : <IcoWarning />}
      </span>
      <span className="impact-copy">
        <span className="impact-kicker"><b>{notice.actionLabel}</b> · {notice.owner}</span>
        <strong>{notice.source}</strong>
        <span className="impact-summary">
          {notice.summary}
          {notice.incoming > 0 && (
            <span className="impact-hp-after"> · {notice.hpAfter} de vida restante</span>
          )}
        </span>
      </span>
      <span className={`impact-resolution ${notice.incoming > 0 ? 'commander' : 'board'}`} aria-hidden="true">
        {notice.incoming > 0 && (
          <span className="impact-step incoming">
            <IcoAttack className="ic" /><b>{notice.incoming}</b><small>impacto</small>
          </span>
        )}
        {notice.shieldDamage > 0 && (
          <span className="impact-step shield">
            <IcoShield className="ic" /><b>−{notice.shieldDamage}</b><small>escudo</small>
          </span>
        )}
        {notice.hpDamage > 0 && (
          <span className="impact-step hp">
            <IcoHealth className="ic" /><b>−{notice.hpDamage}</b><small>vida</small>
          </span>
        )}
        {notice.incoming === 0 && shownBoardHits.map((hit, i) => (
          <span key={`${hit.iid ?? hit.target}-${i}`} className={`impact-step target ${hit.kind}`}>
            {hit.kind === 'defeat' ? <IcoDeath className="ic" /> : <IcoAttack className="ic" />}
            <b>{hit.kind === 'defeat' ? 'Caiu' : `−${hit.amount}`}</b>
            <small>{hit.target}</small>
          </span>
        ))}
        {notice.incoming === 0 && remaining > 0 && (
          <span className="impact-more">+{remaining}</span>
        )}
      </span>
    </div>
  );
}

function FxLayer({ fx }: { fx: FloatFx[] }) {
  // prefixo de forma (▼/▲ + ícone) além da cor: leitura segura para daltônicos
  return (
    <>
      {fx.map((f) => (
        <span key={f.id} className={`float-fx ${f.kind}`}>
          {f.kind === 'dmg' ? `▼ -${f.value}`
            : f.kind === 'heal' ? `▲ +${f.value}`
              : f.kind === 'shield' ? <><IcoShield className="ic" /> -{f.value}</>
                : <IcoBuff className="ic" />}
        </span>
      ))}
    </>
  );
}

function PreviewChip({ p, self, dim }: { p: CombatPreview; self?: boolean; dim?: boolean }) {
  if (self) {
    if (p.selfDmg === undefined) return null;
    return (
      <span className={`preview-chip ${p.selfDies ? 'dies' : ''}`}>
        −{p.selfDmg}{p.selfDies && <> <IcoDeath className="ic" /></>}
      </span>
    );
  }
  return (
    <span className={`preview-chip ${dim ? 'static' : ''} ${p.lethal ? 'lethal' : p.targetDies ? 'dies' : ''}`}>
      −{p.targetDmg}
      {p.targetDies && <> <IcoDeath className="ic" /></>}
      {p.overflow ? <> <IcoOverflow className="ic" />{p.overflow}</> : null}
      {p.lethal && <> <IcoLethal className="ic" /> LETAL</>}
    </span>
  );
}

function HeroPlate({ seat, seatIdx, isEnemy, onFaceClick, targetable, blocked, dropTarget, dropHovered, lethal, preview, previewDim, onHover, pendingCost = 0, energyWarn, fx, bubble, impact }: {
  seat: SeatView;
  seatIdx: number;
  isEnemy?: boolean;
  onFaceClick?: () => void;
  targetable?: boolean;
  blocked?: boolean;
  dropTarget?: boolean;
  dropHovered?: boolean;
  lethal?: boolean;
  preview?: CombatPreview | null;
  previewDim?: boolean;
  onHover?: (on: boolean) => void;
  pendingCost?: number;
  energyWarn?: boolean;
  fx: FloatFx[];
  bubble?: Bubble | null;
  impact?: DamageNotice | null;
}) {
  const hit = fx.some((f) => f.kind === 'dmg');
  const shielded = fx.some((f) => f.kind === 'shield');
  const title = commanderTitle(seat.commander);
  const deckRisk = seat.fatigue > 0 || seat.deckCount <= 3;
  return (
    <div className={`hero-plate ${isEnemy ? 'enemy' : ''} ${hit ? 'hit-received' : ''} ${shielded ? 'shield-absorbed' : ''} ${impact ? `has-impact impact-${impact.severity}` : ''}`} style={accentVars(seat.accent, seat.accentStyle)}>
      {bubble && (
        <div className={`taunt-bubble ${isEnemy ? 'down' : 'up'}`} key={bubble.id}>{bubble.text}</div>
      )}
      <button
        className={[
          'portrait',
          targetable ? 'targetable' : '',
          blocked ? 'blocked' : '',
          dropTarget ? 'drop-target' : '',
          dropHovered ? 'drop-hovered' : '',
          lethal ? 'lethal' : '',
          hit ? 'hit' : '',
          shielded ? 'shielded' : '',
        ].join(' ')}
        data-anchor={`face-${seatIdx}`}
        onClick={onFaceClick}
        disabled={!onFaceClick}
        onMouseEnter={onHover && targetable ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
        title={blocked ? 'Protegido por Provocar' : undefined}
      >
        {dropTarget && <span className={`drop-target-marker ${dropHovered ? 'active' : ''}`} aria-hidden="true"><IcoTarget /></span>}
        <Avatar
          className="portrait-avatar"
          iconId={seat.commander || seat.avatar}
          photo={null}
          frame={seat.frame}
          accent={seat.accent}
          accentStyle={seat.accentStyle}
          fill
          alt={seat.name}
        />
        <span className="hp-orb">{seat.hp}</span>
        {seat.shield > 0 && <span className="shield-orb"><IcoShield />{seat.shield}</span>}
        {preview && <PreviewChip p={preview} dim={previewDim} />}
        <FxLayer fx={fx} />
      </button>
      {impact && <ImpactRecap notice={impact} />}
      <div className="hero-info">
        <span className="hero-name">
          {seat.name}
          {!seat.connected && <em className="dc-tag"> · reconectando…</em>}
        </span>
        {title && <span className="commander-sub">{title}</span>}
        <span
          className={`energy-crystals ${energyWarn ? 'warn' : ''}`}
          title={`Energia ${seat.energy}/${seat.maxEnergy}`}
        >
          {Array.from({ length: Math.min(MAX_ENERGY, Math.max(seat.maxEnergy, seat.energy)) }, (_, i) => {
            const willSpend = pendingCost > 0 && i >= seat.energy - pendingCost && i < seat.energy;
            return <i key={i} className={`crystal ${i < seat.energy ? 'full' : ''} ${willSpend ? 'spend' : ''}`} />;
          })}
          <b>{seat.energy}/{seat.maxEnergy}</b>
        </span>
      </div>
      <div className="hero-meta">
        <span
          className={`meta-chip ${deckRisk ? 'deck-risk' : ''}`}
          title={seat.fatigue > 0
            ? `Fadiga ${seat.fatigue}: cada compra sem carta causa dano`
            : `Cartas no deck: ${seat.deckCount}`}
        >
          <IcoDeck className="ic" /> {seat.deckCount}
        </span>
        {isEnemy && <span className="meta-chip" title="Cartas na mão"><IcoHand className="ic" /> {seat.handCount}</span>}
        {seat.attackBonus > 0 && (
          <span className="meta-chip buff" title="Estandarte de Guerra"><IcoBanner className="ic" /> +{seat.attackBonus}</span>
        )}
        {seat.fatigue > 0 && <span className="meta-chip warn" title="Fadiga"><IcoDeath className="ic" /> {seat.fatigue}</span>}
      </div>
    </div>
  );
}

function Creature({ c, bonus, mine, selected, buffTarget, blocked, dropTarget, dropHovered, dropTone, warn, posIndex, lunging, sourceActive, preview, previewDim, retaliation, onHover, fx, onClick, onPointerDown, onMouseDown, onInspect, style }: {
  c: CreatureOnBoard;
  bonus: number;
  mine?: boolean;
  selected?: boolean;
  buffTarget?: boolean;
  blocked?: boolean;
  dropTarget?: boolean;
  dropHovered?: boolean;
  dropTone?: 'enemy' | 'support';
  warn?: boolean;
  /** Número da posição quando há cópias iguais na mesa (senão indefinido). */
  posIndex?: number;
  lunging?: boolean;
  sourceActive?: boolean;
  preview?: CombatPreview | null;
  previewDim?: boolean;
  retaliation?: CombatPreview | null;
  onHover?: (on: boolean) => void;
  fx: FloatFx[];
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onInspect?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}) {
  const def = CARDS[c.defId];
  const hit = fx.some((f) => f.kind === 'dmg');
  const healed = fx.some((f) => f.kind === 'heal');
  const buffed = fx.some((f) => f.kind === 'buff');
  const isTaunt = def.keywords?.includes('taunt');
  // convenção de card game: número verde = acima do impresso; vermelho = ferida
  const atkBuffed = c.attack + bonus > (def.attack ?? 0);
  const hpHurt = c.health < c.baseHealth;
  const hpBuffed = !hpHurt && c.baseHealth > (def.health ?? 0);
  const classes = [
    'creature',
    mine ? 'mine' : '',
    selected ? 'selected' : '',
    mine && c.canAttack ? 'ready' : '',
    mine && !c.canAttack ? 'exhausted' : '',
    buffTarget && mine ? 'buff-target' : '',
    blocked ? 'blocked' : '',
    dropTarget ? `drop-target drop-${dropTone ?? 'enemy'}` : '',
    dropHovered ? 'drop-hovered' : '',
    warn ? 'cant-attack' : '',
    lunging ? 'lunging' : '',
    sourceActive ? 'impact-source' : '',
    isTaunt ? 'taunt' : '',
    c.health < c.baseHealth ? 'wounded' : '',
    hit ? 'hit struck' : '',
    healed ? 'healed' : '',
    buffed ? 'buffed-flash' : '',
  ].join(' ');
  return (
    <div
      role="button"
      tabIndex={0}
      className={classes}
      data-anchor={`cr-${c.iid}`}
      style={style}
      onClick={onClick}
      onPointerDownCapture={onPointerDown}
      onMouseDownCapture={onMouseDown}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).closest('.creature-info')) return;
        e.preventDefault();
        onClick();
      }}
      title={
        blocked
          ? 'Protegido por Provocar — ataque o Golem primeiro'
          : mine && !c.canAttack
            ? 'Essa criatura não pode atacar agora (acabou de entrar ou já atacou neste turno)'
            : posIndex
              ? `${def.name} · posição ${posIndex} na mesa`
              : creatureHint(def)
      }
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {dropTarget && (
        <span className={`drop-target-marker ${dropHovered ? 'active' : ''}`} aria-hidden="true">
          {dropTone === 'support' ? <IcoBuff /> : <IcoTarget />}
        </span>
      )}
      <button
        type="button"
        className="creature-info"
        aria-label={`Ver carta: ${def.name}`}
        title={def.text ? `${def.name}: ${def.text}` : `Ver carta: ${def.name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onInspect?.(e);
        }}
      >
        <IcoRules />
      </button>
      {isTaunt && <span className="taunt-badge" title="Provocar"><IcoShield /></span>}
      {c.ward && (
        <span className="ward-badge" title="Escudo Arcano: o próximo dano será anulado"><IcoWard /></span>
      )}
      {posIndex && (
        <span className="pos-badge" title={`Posição ${posIndex} na mesa — cópia idêntica em campo`}>
          {posIndex}
        </span>
      )}
      <CardArt defId={c.defId} className="creature-art" loading="eager" fetchPriority="auto" />
      <span className="creature-name">{def.name}</span>
      <span className={`stat-gem atk ${atkBuffed ? 'buffed' : ''}`}>{c.attack + bonus}</span>
      <span className={`stat-gem hp ${hpHurt ? 'hurt' : hpBuffed ? 'buffed' : ''}`}>{c.health}</span>
      {mine && c.canAttack && <span className="ready-dot" title="Pronta para atacar" />}
      {preview && <PreviewChip p={preview} dim={previewDim} />}
      {retaliation && <PreviewChip p={retaliation} self />}
      <FxLayer fx={fx} />
    </div>
  );
}

function GhostCreature({ g }: { g: Ghost }) {
  const def = CARDS[g.creature.defId];
  return (
    // order = slot*2 - 1: a caveira fica imediatamente antes de quem assumiu
    // o lugar, animando a morte na posição exata em que a carta estava.
    <span className="creature ghost" style={{ order: g.slot * 2 - 1 }}>
      <CardArt defId={g.creature.defId} className="creature-art" loading="eager" fetchPriority="auto" />
      <span className="creature-name">{def.name}</span>
      <span className="ghost-skull"><IcoDeath /></span>
    </span>
  );
}

export { Creature, GhostCreature, HeroPlate };
