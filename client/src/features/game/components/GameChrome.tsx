import type { GameLogEntry, SeatView } from '@legendsclash/shared';
import { Chat } from '../../../components/Chat';
import { SoundControl } from '../../../components/SoundControl';
import {
  IcoAttack,
  IcoBanner,
  IcoChat,
  IcoCodex,
  IcoDeath,
  IcoDeck,
  IcoEvents,
  IcoHand,
  IcoHint,
  IcoRules,
  IcoShield,
  IcoSparkle,
  IcoSurrender,
  IcoTimer,
  IcoWarning,
} from '../../../icons';

export type SidePane = 'log' | 'chat' | null;

interface ChromeActions {
  onShowRules: () => void;
  onShowCodex: () => void;
  onSurrender: () => void;
}

interface MobileGameToolbarProps extends ChromeActions {
  sidePane: SidePane;
  unreadChat: number;
  onPaneChange: (pane: SidePane) => void;
}

export function MobileGameToolbar({
  sidePane,
  unreadChat,
  onPaneChange,
  onShowRules,
  onShowCodex,
  onSurrender,
}: MobileGameToolbarProps) {
  return (
    <div className="mobile-topbar">
      <button
        className={`btn small ghost ${sidePane === 'log' ? 'active' : ''}`}
        onClick={() => onPaneChange(sidePane === 'log' ? null : 'log')}
        title="Eventos"
        aria-label="Eventos da partida"
      >
        <IcoEvents />
      </button>
      <button
        className={`btn small ghost ${sidePane === 'chat' ? 'active' : ''}`}
        onClick={() => onPaneChange(sidePane === 'chat' ? null : 'chat')}
        title="Chat"
        aria-label={`Chat${unreadChat > 0 ? ` (${unreadChat} não lidas)` : ''}`}
      >
        <IcoChat />
        {unreadChat > 0 && sidePane !== 'chat' && <span className="unread-badge">{unreadChat}</span>}
      </button>
      <button className="btn small ghost" onClick={onShowRules} title="Como jogar" aria-label="Como jogar">
        <IcoRules />
      </button>
      <button className="btn small ghost" onClick={onShowCodex} title="Arquivo de Aurélia" aria-label="Arquivo de Aurélia">
        <IcoCodex />
      </button>
      <SoundControl />
      <button
        className="btn small ghost danger"
        onClick={onSurrender}
        title="Desistir"
        aria-label="Desistir da partida"
      >
        <IcoSurrender />
      </button>
    </div>
  );
}

type LogTone = 'turn' | 'damage' | 'summon' | 'spell' | 'fatigue' | 'shield' | 'surrender' | 'neutral';

function logTone(text: string): LogTone {
  const normalized = text.toLocaleLowerCase('pt-BR');
  if (normalized.includes('turno')) return 'turn';
  if (normalized.includes('fadiga') || normalized.includes('baralho')) return 'fatigue';
  if (normalized.includes('desist')) return 'surrender';
  if (normalized.includes('escudo')) return 'shield';
  if (normalized.includes('dano') || normalized.includes('ataca') || normalized.includes('derrot')) return 'damage';
  if (normalized.includes('invoc') || normalized.includes('entra')) return 'summon';
  if (normalized.includes('magia') || normalized.includes('jogou') || normalized.includes('compra')) return 'spell';
  return 'neutral';
}

function LogIcon({ tone }: { tone: LogTone }) {
  switch (tone) {
    case 'turn': return <IcoTimer />;
    case 'damage': return <IcoAttack />;
    case 'summon': return <IcoBanner />;
    case 'spell': return <IcoSparkle />;
    case 'fatigue': return <IcoDeath />;
    case 'shield': return <IcoShield />;
    case 'surrender': return <IcoSurrender />;
    default: return <IcoEvents />;
  }
}

interface GameSidePanelProps extends ChromeActions {
  sidePane: SidePane;
  player: SeatView;
  enemy: SeatView;
  readyDamage: number;
  enemyBoardDamage: number;
  log: GameLogEntry[];
  onClose: () => void;
}

export function GameSidePanel({
  sidePane,
  player,
  enemy,
  readyDamage,
  enemyBoardDamage,
  log,
  onClose,
  onShowRules,
  onShowCodex,
  onSurrender,
}: GameSidePanelProps) {
  return (
    <aside className={`game-side ${sidePane ? `open pane-${sidePane}` : ''}`}>
      <button className="btn small ghost drawer-close" onClick={onClose}>
        ▾ Fechar {sidePane === 'log' ? 'Eventos' : sidePane === 'chat' ? 'Chat' : 'Painel'}
      </button>
      <div className="side-top">
        <span>
          <SoundControl />
          <button className="btn small ghost" onClick={onShowRules} title="Como jogar" aria-label="Como jogar">
            <IcoRules />
          </button>
          <button className="btn small ghost" onClick={onShowCodex} title="Arquivo de Aurélia" aria-label="Arquivo de Aurélia">
            <IcoCodex />
          </button>
        </span>
        <button className="btn small ghost danger" onClick={onSurrender}>
          <IcoSurrender className="ic" /> Desistir
        </button>
      </div>

      <div className="panel match-brief" aria-label="Leitura rápida da partida">
        <h3><IcoHint className="ic" /> Leitura da mesa</h3>
        <div className="brief-grid">
          <span title="Suas criaturas em campo">
            <IcoBanner className="ic" />
            <b>{player.board.length}</b>
            sua mesa
          </span>
          <span title="Criaturas inimigas em campo">
            <IcoWarning className="ic" />
            <b>{enemy.board.length}</b>
            inimiga
          </span>
          <span title="Dano disponível para atacar neste turno">
            <IcoAttack className="ic" />
            <b>{readyDamage}</b>
            dano pronto
          </span>
          <span title="Força total da mesa inimiga">
            <IcoDeath className="ic" />
            <b>{enemyBoardDamage}</b>
            ameaça
          </span>
          <span title="Cartas no seu baralho">
            <IcoDeck className="ic" />
            <b>{player.deckCount}</b>
            seu deck
          </span>
          <span title="Cartas na mão inimiga">
            <IcoHand className="ic" />
            <b>{enemy.handCount}</b>
            mão inimiga
          </span>
        </div>
      </div>

      <div className="panel log-panel">
        <h3><IcoEvents className="ic" /> Eventos</h3>
        <ul className="game-log" role="log" aria-live="polite" aria-label="Eventos da partida">
          {log.slice(-14).reverse().map((entry, index) => {
            const tone = logTone(entry.text);
            return (
              <li key={log.length - index} className={`log-${tone}`}>
                <span className="log-mark" aria-hidden><LogIcon tone={tone} /></span>
                <span>{entry.text}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel side-chat">
        <h3><IcoChat className="ic" /> Chat</h3>
        <Chat />
      </div>
    </aside>
  );
}
