import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchSnapshot } from './game/engine.js';
import type { SessionRecord, Store, UserRecord } from './store.js';
import type { App } from './app.js';

/**
 * Snapshot do estado vivo do processo: partidas em andamento e convidados
 * (usuário + sessão), que por design existem só em memória.
 *
 * Sem isso, todo deploy/restart encerrava batalhas sem resultado e deslogava
 * convidados. O Store cobre o durável; aqui fica o efêmero que precisa
 * sobreviver à troca de processo.
 */

interface RuntimeShape {
  v: number;
  savedAt: number;
  matches: MatchSnapshot[];
  guests: { users: UserRecord[]; sessions: SessionRecord[] };
}

const VERSION = 1;
const PERIODIC_MS = 20_000;
const DIRTY_DELAY_MS = 1_000;
/** Depois disso ninguém mais espera a batalha: melhor voltar ao lobby. */
const MAX_MATCH_AGE_MS = 10 * 60_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, '..', 'data', 'runtime.json');

export class RuntimeSnapshot {
  private periodicTimer: NodeJS.Timeout | null = null;
  private dirtyTimer: NodeJS.Timeout | null = null;

  constructor(
    private app: App,
    private store: Store,
    private path: string = DEFAULT_PATH,
  ) {}

  /** Restaura o snapshot do processo anterior e liga as gravações. */
  start(): void {
    this.restore();
    this.app.onMatchesChanged = () => this.markDirty();
    this.periodicTimer = setInterval(() => this.write(), PERIODIC_MS);
  }

  private restore(): void {
    let data: RuntimeShape;
    try {
      if (!existsSync(this.path)) return;
      data = JSON.parse(readFileSync(this.path, 'utf8')) as RuntimeShape;
    } catch (err) {
      console.error('[runtime] snapshot ilegível — ignorado:', err);
      return;
    }
    try {
      if (data?.v !== VERSION) {
        console.log('[runtime] snapshot de outra versão — ignorado');
        return;
      }
      const guests = this.store.importGuests(data.guests.users, data.guests.sessions);
      const fresh = Date.now() - data.savedAt <= MAX_MATCH_AGE_MS;
      const matches = fresh ? this.app.restoreMatches(data.matches) : 0;
      if (!fresh && data.matches.length) {
        console.log(`[runtime] snapshot antigo: ${data.matches.length} partida(s) descartada(s)`);
      }
      if (matches || guests) {
        console.log(`[runtime] restaurado: ${matches} partida(s), ${guests} convidado(s)`);
      }
    } catch (err) {
      console.error('[runtime] falha na restauração — estado descartado:', err);
    }
  }

  /** Mudança estrutural (partida criada/encerrada): grava em breve. */
  private markDirty(): void {
    if (this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null;
      this.write();
    }, DIRTY_DELAY_MS);
  }

  /** Escrita atômica (tmp + rename): crash no meio não corrompe o arquivo. */
  write(): void {
    const data: RuntimeShape = {
      v: VERSION,
      savedAt: Date.now(),
      matches: this.app.exportMatches(),
      guests: this.store.exportGuests(),
    };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.path);
    } catch (err) {
      console.error('[runtime] falha ao gravar snapshot:', err);
    }
  }

  /** Desligamento (SIGTERM do deploy): última gravação, síncrona. */
  shutdown(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
    this.periodicTimer = null;
    this.dirtyTimer = null;
    this.write();
  }
}
