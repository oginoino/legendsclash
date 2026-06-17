import { useMemo, useState } from 'react';
import { CARDS } from '@legendsclash/shared';
import type { CardType } from '@legendsclash/shared';
import { CardArt } from '../components/CardArt';
import { CARD_LORE, FACTIONS, WORLD } from '../lore';

/**
 * O Arquivo de Aurélia — o "local de consulta" das cartas. Reúne todo o
 * catálogo num só lugar, com a história de cada lenda dentro do mesmo
 * universo (ver `lore.ts`). Camada de apresentação pura: nenhuma regra de
 * jogo é avaliada aqui.
 */

const TYPE_LABEL: Record<CardType, string> = {
  creature: 'Criatura',
  spell: 'Magia',
  artifact: 'Artefato',
  tactic: 'Tática',
};

const KEYWORD_LABEL: Record<string, string> = { taunt: '🛡 Provocar' };

const FACTION_ORDER = ['vanguarda', 'silvanos', 'eter', 'profundezas'];

export function CodexView({ onClose }: { onClose: () => void }) {
  const [factionFilter, setFactionFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const allIds = useMemo(() => Object.keys(CARDS), []);
  const byFaction = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const id of allIds) {
      const fid = CARD_LORE[id]?.factionId ?? 'eter';
      (map[fid] ??= []).push(id);
    }
    return map;
  }, [allIds]);

  const shownFactions = factionFilter ? [factionFilter] : FACTION_ORDER;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel codex" onClick={(e) => e.stopPropagation()}>
        <button className="btn small ghost codex-close" onClick={onClose}>✕ Fechar</button>

        {selected ? (
          <CardLorePage defId={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <header className="codex-hero">
              <p className="codex-kicker">Arquivo de</p>
              <h1 className="codex-realm">{WORLD.realm}</h1>
              <p className="codex-tagline">{WORLD.tagline}</p>
            </header>

            <div className="codex-intro">
              {WORLD.intro.map((p, i) => <p key={i}>{p}</p>)}
            </div>

            <h3 className="codex-section-title">As Quatro Tradições</h3>
            <div className="codex-factions">
              {FACTION_ORDER.map((fid) => {
                const f = FACTIONS[fid];
                const active = factionFilter === fid;
                return (
                  <button
                    key={fid}
                    className={`codex-faction-card ${active ? 'active' : ''}`}
                    style={{ '--accent': f.color } as React.CSSProperties}
                    onClick={() => setFactionFilter(active ? null : fid)}
                    title={active ? 'Mostrar todas' : `Filtrar por ${f.name}`}
                  >
                    <span className="codex-faction-sigil">{f.sigil}</span>
                    <strong>{f.name}</strong>
                    <em className="codex-faction-motto">"{f.motto}"</em>
                    <span className="codex-faction-blurb">{f.blurb}</span>
                  </button>
                );
              })}
            </div>

            <div className="codex-filterbar">
              <span className="dim">Cartas</span>
              <button
                className={`codex-pill ${!factionFilter ? 'active' : ''}`}
                onClick={() => setFactionFilter(null)}
              >
                Todas ({allIds.length})
              </button>
              {FACTION_ORDER.map((fid) => (
                <button
                  key={fid}
                  className={`codex-pill ${factionFilter === fid ? 'active' : ''}`}
                  style={{ '--accent': FACTIONS[fid].color } as React.CSSProperties}
                  onClick={() => setFactionFilter(fid)}
                >
                  {FACTIONS[fid].sigil} {FACTIONS[fid].name.replace(/^(A |O |Os )/, '')}
                </button>
              ))}
            </div>

            {shownFactions.map((fid) => {
              const f = FACTIONS[fid];
              const ids = byFaction[fid] ?? [];
              if (ids.length === 0) return null;
              return (
                <section key={fid} className="codex-group" style={{ '--accent': f.color } as React.CSSProperties}>
                  <h4 className="codex-group-title">
                    <span className="codex-faction-sigil sm">{f.sigil}</span> {f.name}
                  </h4>
                  <div className="codex-gallery">
                    {ids.map((id) => (
                      <CodexTile key={id} defId={id} onClick={() => setSelected(id)} />
                    ))}
                  </div>
                </section>
              );
            })}

            <h3 className="codex-section-title">Da história à mesa</h3>
            <div className="codex-notes">
              {WORLD.codexNotes.map((n) => (
                <div key={n.title} className="codex-note">
                  <span className="codex-note-icon">{n.icon}</span>
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Tile de índice — a carta vista de relance, com o epíteto sob o nome. */
function CodexTile({ defId, onClick }: { defId: string; onClick: () => void }) {
  const def = CARDS[defId];
  const lore = CARD_LORE[defId];
  return (
    <button className={`codex-tile card-${def.type}`} onClick={onClick}>
      <span className="card-cost">{def.cost}</span>
      <CardArt defId={defId} className="codex-tile-art" />
      <span className="codex-tile-name">{def.name}</span>
      {lore && <span className="codex-tile-epithet">{lore.epithet}</span>}
      <span className="card-type">{TYPE_LABEL[def.type]}</span>
      {def.type === 'creature' && (
        <span className="codex-tile-stats">
          <b className="atk">⚔ {def.attack}</b>
          <b className="hp">❤ {def.health}</b>
        </span>
      )}
    </button>
  );
}

/** Página de lore de uma carta — a crônica completa dentro do universo. */
function CardLorePage({ defId, onBack }: { defId: string; onBack: () => void }) {
  const def = CARDS[defId];
  const lore = CARD_LORE[defId];
  const faction = lore ? FACTIONS[lore.factionId] : null;
  const accent = faction?.color ?? 'var(--gold)';

  return (
    <div className="codex-detail" style={{ '--accent': accent } as React.CSSProperties}>
      <button className="btn small ghost codex-back" onClick={onBack}>← Voltar ao Arquivo</button>

      <div className="codex-detail-head">
        <CardArt defId={defId} className="codex-detail-art" />
        <div className="codex-detail-id">
          {faction && (
            <span className="codex-faction-chip">{faction.sigil} {faction.name}</span>
          )}
          <h2>{def.name}</h2>
          {lore && <p className="codex-epithet">"{lore.epithet}"</p>}
          <div className="codex-stat-row">
            <span className="codex-stat">💎 {def.cost} de energia</span>
            <span className="codex-stat">{TYPE_LABEL[def.type]}</span>
            {def.type === 'creature' && (
              <>
                <span className="codex-stat atk">⚔ {def.attack}</span>
                <span className="codex-stat hp">❤ {def.health}</span>
              </>
            )}
            {def.keywords?.map((k) => (
              <span key={k} className="codex-stat keyword">{KEYWORD_LABEL[k] ?? k}</span>
            ))}
          </div>
        </div>
      </div>

      {lore && (
        <section className="codex-prose">
          <h4>📜 Crônica</h4>
          <p>{lore.story}</p>
        </section>
      )}

      <section className="codex-prose mechanic">
        <h4>⚔️ Na mesa</h4>
        <p>{def.text}</p>
      </section>
    </div>
  );
}
