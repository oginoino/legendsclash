import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { League, MatchHistoryEntry, Profile } from '@legendsclash/shared';
import { BASE_MMR, leagueOf } from './elo.js';

/**
 * Persistência do MVP: snapshot JSON em disco com escrita debounced.
 * O destino de produção é PostgreSQL (slide "Riscos, mitigação e
 * arquitetura"); este módulo concentra todo o acesso a dados para que a
 * troca seja localizada.
 */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatar: string;
  token: string;
  mmr: number;
  wins: number;
  losses: number;
  muted: string[];
  history: MatchHistoryEntry[];
  createdAt: number;
}

export interface ReportRecord {
  reporterId: string;
  reportedId: string;
  reason: string;
  context: string; // últimas mensagens do denunciado na sala/partida
  at: number;
}

interface DbShape {
  users: UserRecord[];
  reports: ReportRecord[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'db.json');

export class Store {
  private db: DbShape = { users: [], reports: [] };
  private byToken = new Map<string, UserRecord>();
  private byId = new Map<string, UserRecord>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private path: string = DEFAULT_DB_PATH) {
    if (existsSync(this.path)) {
      this.db = JSON.parse(readFileSync(this.path, 'utf8'));
      for (const u of this.db.users) {
        this.byToken.set(u.token, u);
        this.byId.set(u.id, u);
      }
    }
  }

  /** Login do MVP: e-mail identifica a conta (Google OAuth é fase Next). */
  loginOrRegister(email: string, name: string, avatar: string): UserRecord {
    const normEmail = email.trim().toLowerCase();
    let user = this.db.users.find((u) => u.email === normEmail);
    if (!user) {
      user = {
        id: randomBytes(8).toString('hex'),
        email: normEmail,
        name: name.trim().slice(0, 24) || 'Jogador',
        avatar: avatar || '🛡️',
        token: randomBytes(24).toString('hex'),
        mmr: BASE_MMR,
        wins: 0,
        losses: 0,
        muted: [],
        history: [],
        createdAt: Date.now(),
      };
      this.db.users.push(user);
      this.byId.set(user.id, user);
      this.byToken.set(user.token, user);
    } else {
      if (name.trim()) user.name = name.trim().slice(0, 24);
      if (avatar) user.avatar = avatar;
    }
    this.scheduleSave();
    return user;
  }

  userByToken(token: string): UserRecord | undefined {
    return this.byToken.get(token);
  }

  userById(id: string): UserRecord | undefined {
    return this.byId.get(id);
  }

  recordMatch(userId: string, entry: MatchHistoryEntry, newMmr: number, won: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    u.history.unshift(entry);
    u.history = u.history.slice(0, 50);
    u.mmr = newMmr;
    if (won) u.wins++; else u.losses++;
    this.scheduleSave();
  }

  setMuted(userId: string, targetId: string, muted: boolean): void {
    const u = this.byId.get(userId);
    if (!u) return;
    if (muted && !u.muted.includes(targetId)) u.muted.push(targetId);
    if (!muted) u.muted = u.muted.filter((id) => id !== targetId);
    this.scheduleSave();
  }

  addReport(report: ReportRecord): void {
    this.db.reports.push(report);
    this.scheduleSave();
  }

  leaderboard(limit = 20): UserRecord[] {
    return [...this.db.users]
      .filter((u) => u.wins + u.losses > 0)
      .sort((a, b) => b.mmr - a.mmr)
      .slice(0, limit);
  }

  profileOf(u: UserRecord): Profile {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      mmr: u.mmr,
      league: leagueOf(u.mmr) as League,
      wins: u.wins,
      losses: u.losses,
      muted: u.muted,
    };
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
