import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_STYLE,
  DEFAULT_FRAME,
  DEFAULT_PROFILE_COVER,
} from '@legendsclash/shared';
import { JsonPersistence } from '../src/persistence/json-persistence.js';
import type { EventRecord } from '../src/persistence/contracts.js';

const tempDirs: string[] = [];

function tempDbPath(nested = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'legendsclash-json-'));
  tempDirs.push(dir);
  return nested ? join(dir, 'nested', 'db.json') : join(dir, 'db.json');
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('JsonPersistence', () => {
  it('inicia com o shape vazio quando o snapshot ainda nao existe', async () => {
    const persistence = new JsonPersistence(tempDbPath());

    await expect(persistence.load()).resolves.toEqual({
      users: [],
      reports: [],
      sessions: [],
      events: [],
    });
  });

  it('normaliza snapshots legados sem perpetuar token ou convidado', async () => {
    const path = tempDbPath();
    writeFileSync(path, JSON.stringify({
      users: [{
        id: 'legacy-1',
        email: 'legacy@example.com',
        name: 'Legado',
        avatar: '\u{1F6E1}\uFE0F',
        guest: true,
        mmr: 1150,
        wins: 3,
        losses: 1,
        muted: [],
        history: [],
        createdAt: Date.UTC(2026, 6, 10),
        token: 'token-eterno',
      }],
      reports: [],
    }));

    const db = await new JsonPersistence(path).load();
    const [user] = db.users;

    expect(db.sessions).toEqual([]);
    expect(db.events).toEqual([]);
    expect(user).toMatchObject({
      id: 'legacy-1',
      avatar: 'shield',
      commander: 'shield',
      accent: DEFAULT_ACCENT,
      photo: null,
      frame: DEFAULT_FRAME,
      accentStyle: DEFAULT_ACCENT_STYLE,
      profileCover: DEFAULT_PROFILE_COVER,
      faction: '',
      authUserId: null,
      guest: false,
      league: 'Prata',
      streak: 0,
      lastPlayDay: 0,
      friends: [],
    });
    expect('token' in user).toBe(false);
  });

  it('grava o objeto compartilhado uma vez ao fim da janela de debounce', async () => {
    vi.useFakeTimers();
    const path = tempDbPath(true);
    const persistence = new JsonPersistence(path);
    const db = await persistence.load();
    const first: EventRecord = {
      type: 'session_start',
      userId: 'player-1',
      matchId: null,
      props: {},
      at: 100,
    };
    const second: EventRecord = {
      type: 'queue_join',
      userId: 'player-1',
      matchId: null,
      props: { mode: 'ranked' },
      at: 200,
    };

    db.events.push(first);
    persistence.saveEvent(first);
    vi.advanceTimersByTime(250);
    db.events.push(second);
    persistence.saveEvent(second);
    vi.advanceTimersByTime(249);
    expect(existsSync(path)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      users: [],
      reports: [],
      sessions: [],
      events: [first, second],
    });
  });

  it('mantem avatar local como data URL sem storage externo', async () => {
    const persistence = new JsonPersistence(tempDbPath());

    await expect(persistence.uploadAvatar(
      'player-1',
      Buffer.from([0, 1, 2]),
      'image/webp',
    )).resolves.toBe('data:image/webp;base64,AAEC');
  });
});
