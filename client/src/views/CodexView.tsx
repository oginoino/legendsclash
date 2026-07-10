import { useEffect, useMemo, useRef, useState } from 'react';
import { CARDS, keywordDesc, keywordLabel } from '@legendsclash/shared';
import type { CardType } from '@legendsclash/shared';
import { CardView } from '../components/CardView';
import { CARD_LORE, FACTIONS, WORLD } from '../lore';
import { IcoClose, IcoAttack, IcoHealth, IcoCost, IcoEvents } from '../icons';
import { Sigil } from '../cosmetics';
import { ILLUSTRATION_ASSETS, allCardImageIds, preloadCardImages, preloadImageUrls, warmCardImages } from '../preload';

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

const FACTION_ORDER = ['vanguarda', 'silvanos', 'eter', 'profundezas', 'mares'];

export function CodexView({ onClose, initialFaction = null }: { onClose: () => void; initialFaction?: string | null }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [factionFilter, setFactionFilter] = useState<string | null>(initialFaction);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // tokens concedidos por mecânica (ex.: a Moeda) não fazem parte do Arquivo
  const allIds = useMemo(() => Object.keys(CARDS).filter((id) => !CARDS[id].token), []);
  const filteredIds = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR');
    if (!q) return allIds;
    return allIds.filter((id) => {
      const def = CARDS[id];
      const lore = CARD_LORE[id];
      const haystack = [
        def.name,
        TYPE_LABEL[def.type],
        def.text,
        ...(def.keywords ?? []).map((k) => `${keywordLabel(k)} ${keywordDesc(k)}`),
        lore?.epithet,
        lore?.story,
        lore ? FACTIONS[lore.factionId]?.name : undefined,
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return haystack.includes(q);
    });
  }, [allIds, query]);
  const byFaction = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const id of filteredIds) {
      const fid = CARD_LORE[id]?.factionId ?? 'eter';
      (map[fid] ??= []).push(id);
    }
    return map;
  }, [filteredIds]);

  const shownFactions = factionFilter ? [factionFilter] : FACTION_ORDER;

  useEffect(() => {
    void preloadImageUrls([ILLUSTRATION_ASSETS.aureliaArchive], { priority: 'high', decode: false });
    preloadCardImages(allIds.slice(0, 8), { priority: 'auto', decode: false });
    warmCardImages(allCardImageIds(), { batchSize: 4, priority: 'low' });
  }, [allIds]);

  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selected, factionFilter]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel codex" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <button className="btn small ghost codex-close" onClick={onClose}><IcoClose className="ic" /> Fechar</button>

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

            <div className="codex-storyline" aria-label="Linha da história de Aurélia">
              {WORLD.storyBeats.map((beat, i) => (
                <article key={beat.title} className="codex-storybeat">
                  <span className="codex-storybeat-step">{i + 1}</span>
                  <div>
                    <em>{beat.kicker}</em>
                    <strong>{beat.title}</strong>
                    <p>{beat.text}</p>
                  </div>
                </article>
              ))}
            </div>

            <h3 className="codex-section-title">As Cinco Tradições</h3>
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
                    <span className="codex-faction-sigil"><Sigil id={f.sigil} className="ic" /></span>
                    <strong>{f.name}</strong>
                    <em className="codex-faction-motto">"{f.motto}"</em>
                    <span className="codex-faction-blurb">{f.blurb}</span>
                  </button>
                );
              })}
            </div>

            <div className="codex-filterbar">
              <label className="codex-search">
                <span className="sr-only">Buscar cartas</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar carta, efeito ou lore"
                  autoComplete="off"
                />
              </label>
              <span className="dim">{filteredIds.length}/{allIds.length} cartas</span>
              <button
                className={`codex-pill ${!factionFilter ? 'active' : ''}`}
                onClick={() => setFactionFilter(null)}
              >
                Todas
              </button>
              {FACTION_ORDER.map((fid) => (
                <button
                  key={fid}
                  className={`codex-pill ${factionFilter === fid ? 'active' : ''}`}
                  style={{ '--accent': FACTIONS[fid].color } as React.CSSProperties}
                  onClick={() => setFactionFilter(fid)}
                >
                  <Sigil id={FACTIONS[fid].sigil} className="ic" /> {FACTIONS[fid].name.replace(/^(A |O |Os )/, '')}
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
                    <span className="codex-faction-sigil sm"><Sigil id={f.sigil} className="ic" /></span> {f.name}
                  </h4>
                  <div className="codex-gallery">
                    {ids.map((id) => (
                      <CodexTile key={id} defId={id} onClick={() => setSelected(id)} />
                    ))}
                  </div>
                </section>
              );
            })}
            {filteredIds.length === 0 && (
              <p className="codex-empty">Nenhuma carta encontrada para essa busca.</p>
            )}

            <h3 className="codex-section-title">Da história à mesa</h3>
            <div className="codex-notes">
              {WORLD.codexNotes.map((n) => (
                <div key={n.title} className="codex-note">
                  <span className="codex-note-icon"><Sigil id={n.icon} className="ic" /></span>
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
  const lore = CARD_LORE[defId];
  return (
    <div
      className="codex-tile"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick();
      }}
    >
      <CardView
        defId={defId}
        as="div"
        className="codex-tile-card"
        imageLoading="lazy"
        imagePriority="low"
      />
      {lore && <span className="codex-tile-epithet">{lore.epithet}</span>}
    </div>
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
        <CardView
          defId={defId}
          as="div"
          className="codex-detail-card"
          imageLoading="eager"
          imagePriority="high"
        />
        <div className="codex-detail-id">
          {faction && (
            <span className="codex-faction-chip"><Sigil id={faction.sigil} className="ic" /> {faction.name}</span>
          )}
          <h2>{def.name}</h2>
          {lore && <p className="codex-epithet">"{lore.epithet}"</p>}
          <div className="codex-stat-row">
            <span className="codex-stat"><IcoCost className="ic" /> {def.cost} de energia</span>
            <span className="codex-stat">{TYPE_LABEL[def.type]}</span>
            {def.type === 'creature' && (
              <>
                <span className="codex-stat atk"><IcoAttack className="ic" /> {def.attack}</span>
                <span className="codex-stat hp"><IcoHealth className="ic" /> {def.health}</span>
              </>
            )}
            {def.keywords?.map((k) => (
              <span key={k} className="codex-stat keyword" title={keywordDesc(k)}>{keywordLabel(k)}</span>
            ))}
          </div>
        </div>
      </div>

      {lore && (
        <section className="codex-prose">
          <h4><IcoEvents className="ic" /> Crônica</h4>
          <p>{lore.story}</p>
        </section>
      )}

      <section className="codex-prose mechanic">
        <h4><IcoAttack className="ic" /> Na mesa</h4>
        <p>{def.text}</p>
      </section>
    </div>
  );
}
