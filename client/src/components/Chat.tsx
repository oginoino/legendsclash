import { useEffect, useRef, useState } from 'react';
import { send, useAppState } from '../store';

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
      <div className="chat-messages">
        {s.chat.length === 0 && <p className="hint">Diga olá! O chat é filtrado e moderado.</p>}
        {s.chat.map((m, i) => (
          <div key={i} className={m.from.id === myId ? 'chat-msg mine' : 'chat-msg'}>
            <span className="chat-author">{m.from.avatar} {m.from.name}</span>
            <span className="chat-text">{m.text}</span>
            {m.from.id !== myId && (
              <span className="chat-actions">
                <button
                  title={muted.includes(m.from.id) ? 'Reativar' : 'Silenciar'}
                  onClick={() =>
                    send({
                      t: muted.includes(m.from.id) ? 'chat:unmute' : 'chat:mute',
                      playerId: m.from.id,
                    })
                  }
                >
                  {muted.includes(m.from.id) ? '🔊' : '🔇'}
                </button>
                <button title="Denunciar" onClick={() => setReporting({ id: m.from.id, name: m.from.name })}>
                  🚩
                </button>
              </span>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {reporting && (
        <div className="report-box">
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

      <div className="emote-row">
        {['👋 olá!', '👍 boa!', '😅 ufa…', '🔥 que jogada!', '🤝 gg'].map((e) => (
          <button key={e} type="button" className="emote" onClick={() => send({ t: 'chat:send', text: e })}>
            {e}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem…"
          maxLength={240}
        />
        <button className="btn small" disabled={!text.trim()}>Enviar</button>
      </form>
    </div>
  );
}
