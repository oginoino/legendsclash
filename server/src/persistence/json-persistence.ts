import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { League, MatchHistoryEntry } from '@legendsclash/shared';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
  normalizeIconId,
} from '@legendsclash/shared';
import { leagueOf } from '../elo.js';
import type {
  DbShape,
  EventRecord,
  Persistence,
  ReportRecord,
  SessionRecord,
  UserRecord,
} from './contracts.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(moduleDir, '..', '..', 'data', 'db.json');

/** Snapshot JSON local usado em desenvolvimento e nos testes isolados. */
export class JsonPersistence implements Persistence {
  private db: DbShape = { users: [], reports: [], sessions: [], events: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private path: string = DEFAULT_DB_PATH) {}

  async load(): Promise<DbShape> {
    if (existsSync(this.path)) {
      this.db = JSON.parse(readFileSync(this.path, 'utf8'));
    }
    // Shape legado: preenche os campos novos e descarta o token eterno.
    this.db.sessions ??= [];
    this.db.events ??= [];
    for (const user of this.db.users) {
      user.authUserId ??= null;
      user.commander ??= user.avatar;
      user.accent ??= DEFAULT_ACCENT;
      user.avatar = normalizeIconId(user.avatar);
      user.commander = normalizeIconId(user.commander);
      user.photo ??= null;
      user.frame ??= DEFAULT_FRAME;
      user.accentStyle ??= DEFAULT_ACCENT_STYLE;
      user.profileCover ??= DEFAULT_PROFILE_COVER;
      user.faction ??= '';
      user.guest = false;
      user.league ??= leagueOf(user.mmr) as League;
      user.streak ??= 0;
      user.lastPlayDay ??= 0;
      user.friends ??= [];
      delete (user as { token?: string }).token;
    }
    // Store muta este mesmo objeto; o snapshot sempre grava o estado atual.
    return this.db;
  }

  saveUser(_user: UserRecord): void { this.scheduleSave(); }
  saveMatch(_userId: string, _entry: MatchHistoryEntry): void { this.scheduleSave(); }
  saveReport(_report: ReportRecord): void { this.scheduleSave(); }
  saveSession(_session: SessionRecord): void { this.scheduleSave(); }
  deleteSession(_tokenHash: string): void { this.scheduleSave(); }
  saveEvent(_event: EventRecord): void { this.scheduleSave(); }

  /** Sem storage externo no modo local: a própria data URL vira a URL. */
  async uploadAvatar(_userId: string, bytes: Buffer, contentType: string): Promise<string> {
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.db, null, 2));
      } catch (err) {
        console.error('[store] falha ao salvar snapshot:', err);
      }
    }, 500);
  }
}
