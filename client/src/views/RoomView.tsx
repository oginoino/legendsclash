import { useState } from 'react';
import { send, useAppState } from '../store';
import { Chat } from '../components/Chat';
import { LeagueBadge } from '../components/LeagueBadge';

export function RoomView() {
  const s = useAppState();
  const [copied, setCopied] = useState(false);
  const room = s.room;
  if (!room || !s.profile) return null;

  const isHost = room.members.find((m) => m.id === s.profile!.id)?.isHost ?? false;
  const full = room.members.length >= room.seats;
  const inviteLink = `${location.origin}/room/${room.code}`;

  async function copyInvite() {
    // no celular, a folha de compartilhar nativa é o menor atrito p/ convidar
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Legends Clash — duelo de cartas', url: inviteLink });
      } catch {
        // compartilhamento cancelado pelo usuário — sem fallback necessário
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // clipboard pode estar indisponível (http) — o link fica visível na tela
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="room-screen">
      <div className="panel room-panel">
        <h2>Sala privada</h2>
        <div className="room-code">{room.code}</div>
        <button className="btn" onClick={copyInvite}>
          {copied ? '✓ Link copiado!' : '🔗 Copiar link de convite'}
        </button>
        <p className="hint invite-link">{inviteLink}</p>

        <ul className="member-list">
          {Array.from({ length: room.seats }, (_, i) => {
            const m = room.members[i];
            return m ? (
              <li key={m.id}>
                <span className="avatar-lg">{m.avatar}</span>
                <strong>{m.name}</strong>
                <LeagueBadge league={m.league} />
                <span className="dim">{m.mmr} MMR</span>
                {m.isHost && <span className="host-tag">anfitrião</span>}
              </li>
            ) : (
              <li key={`empty-${i}`} className="empty-seat">Aguardando jogador…</li>
            );
          })}
        </ul>

        {isHost ? (
          <button className="btn primary big" disabled={!full} onClick={() => send({ t: 'room:start' })}>
            {full ? '⚔️ Iniciar duelo' : 'Aguardando oponente…'}
          </button>
        ) : (
          <p className="hint">O anfitrião inicia a partida quando todos chegarem.</p>
        )}
        <button className="btn ghost" onClick={() => send({ t: 'room:leave' })}>Sair da sala</button>
      </div>

      <div className="panel room-chat">
        <h2>Chat</h2>
        <Chat />
      </div>
    </div>
  );
}
