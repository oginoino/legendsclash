import type { IconType } from 'react-icons';
import { useEffect, useRef, useState } from 'react';
import { send, useAppState } from '../store';
import { InlineAvatar } from '../cosmetics';
import {
  IcoChat, IcoCool, IcoHandshake, IcoMuted, IcoSend, IcoSound, IcoStreak, IcoThumbUp, IcoWarning,
} from '../icons';

/** Atalhos de chat: ícone no botão, texto limpo enviado ao oponente. */
const EMOTES: { icon: IconType; text: string }[] = [
  { icon: IcoHandshake, text: 'olá!' },
  { icon: IcoThumbUp, text: 'boa!' },
  { icon: IcoCool, text: 'ufa…' },
  { icon: IcoStreak, text: 'que jogada!' },
  { icon: IcoHandshake, text: 'gg' },
];

/**
 * Chat de texto com mute e report (slide "MVP — 90 dias": moderação nasce no
 * MVP). O filtro de palavras roda no servidor; aqui ficam as ações de
 * autoproteção do jogador.
 */
export function Chat() {
  const s = useAppState();
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const myId = s.profile?.id;
  const muted = s.profile?.muted ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [s.chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim()) {
      send({ t: 'chat:send', text: text.trim() });
      setText('');
    }
  }

  return (
    <div className="chat">
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Mensagens da partida">
        {s.chat.length === 0 && (
          <div className="chat-empty">
            <IcoChat />
            <strong>Canal do Embate</strong>
            <span>O silêncio precede a primeira jogada.</span>
          </div>
        )}
        {s.chat.map((m, i) => (
          <div key={i} className={m.from.id === myId ? 'chat-msg mine' : 'chat-msg'}>
            <span className="chat-author"><InlineAvatar iconId={m.from.avatar} photo={m.from.photo} size={16} /> {m.from.name}</span>
            <span className="chat-text">{m.text}</span>
            {m.from.id !== myId && (
              <span className="chat-actions">
                <button
                  title={muted.includes(m.from.id) ? 'Reativar' : 'Silenciar'}
                  aria-label={muted.includes(m.from.id) ? `Reativar ${m.from.name}` : `Silenciar ${m.from.name}`}
                  onClick={() =>
                    send({
                      t: muted.includes(m.from.id) ? 'chat:unmute' : 'chat:mute',
                      playerId: m.from.id,
                    })
                  }
                >
                  {muted.includes(m.from.id) ? <IcoSound /> : <IcoMuted />}
                </button>
                <button title="Denunciar" aria-label="Denunciar" onClick={() => setReporting({ id: m.from.id, name: m.from.name })}>
                  <IcoWarning />
                </button>
              </span>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {reporting && (
        <div className="report-box" role="dialog" aria-label={`Denunciar ${reporting.name}`}>
          <p>Denunciar <strong>{reporting.name}</strong>:</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (ex.: ofensas no chat)"
            maxLength={200}
          />
          <div className="report-actions">
            <button
              className="btn small"
              disabled={!reason.trim()}
              onClick={() => {
                send({ t: 'chat:report', playerId: reporting.id, reason: reason.trim() });
                setReporting(null);
                setReason('');
              }}
            >
              Enviar denúncia
            </button>
            <button className="btn small ghost" onClick={() => setReporting(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="emote-row" aria-label="Respostas rápidas">
        {EMOTES.map(({ icon: Icon, text }) => (
          <button key={text} type="button" className="emote" onClick={() => send({ t: 'chat:send', text })}>
            <Icon className="ic" /> {text}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva…"
          maxLength={240}
          aria-label="Mensagem ao oponente"
          autoComplete="off"
          enterKeyHint="send"
        />
        {text.length >= 180 && <span className="chat-count" aria-live="polite">{240 - text.length}</span>}
        <button className="btn chat-send" disabled={!text.trim()} aria-label="Enviar mensagem" title="Enviar">
          <IcoSend />
        </button>
      </form>
    </div>
  );
}
