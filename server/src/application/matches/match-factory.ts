import { randomInt as secureRandomInt } from 'node:crypto';
import type { UserRecord } from '../../store.js';
import {
  Match,
  type EngineResult,
  type MatchContent,
  type MatchPlayer,
  type MatchSnapshot,
} from '../../game/engine.js';

export interface MatchContentFlags {
  factions: boolean;
  comeback: boolean;
}

export interface MatchFactoryDependencies {
  flags: MatchContentFlags;
  onUpdate(match: Match): void;
  onRankedFinish(match: Match, result: EngineResult): void;
  onPracticeFinish(match: Match, result: EngineResult): void;
  randomIndex?: (maxExclusive: number) => number;
}

export interface RankedMatchCreation {
  match: Match;
  players: MatchPlayer[];
  content: MatchContent;
}

/** Constrói partidas sem assumir registro, telemetria ou transporte. */
export class MatchFactory {
  private readonly randomIndex: (maxExclusive: number) => number;

  constructor(private readonly dependencies: MatchFactoryDependencies) {
    this.randomIndex = dependencies.randomIndex ?? secureRandomInt;
  }

  createRanked(users: UserRecord[]): RankedMatchCreation {
    const players = users.map((user) => this.playerFrom(user));
    // Fisher-Yates impede que a ordenação do matchmaking determine quem começa.
    for (let i = players.length - 1; i > 0; i--) {
      const j = this.randomIndex(i + 1);
      [players[i], players[j]] = [players[j], players[i]];
    }
    const content = this.contentFor(users);
    const match = this.createMatch(
      players,
      [],
      content,
      this.dependencies.onRankedFinish,
    );
    return { match, players, content };
  }

  createPractice(user: UserRecord): Match {
    const human = this.playerFrom(user);
    const bot: MatchPlayer = {
      id: `bot:${this.randomIndex(1_000_000_000)}`,
      name: 'Treinador IA',
      avatar: 'robot',
      commander: 'robot',
      accent: '#3fd3c6',
      photo: null,
      frame: 'none',
      accentStyle: 'aurora',
      mmr: user.mmr,
    };
    return this.createMatch(
      [human, bot],
      [bot.id],
      this.contentFor([user]),
      this.dependencies.onPracticeFinish,
    );
  }

  restoreRanked(snapshot: MatchSnapshot): Match {
    let match: Match;
    match = Match.restore(
      snapshot,
      () => this.dependencies.onUpdate(match),
      (result) => this.dependencies.onRankedFinish(match, result),
    );
    return match;
  }

  private createMatch(
    players: MatchPlayer[],
    botIds: string[],
    content: MatchContent,
    onFinish: (match: Match, result: EngineResult) => void,
  ): Match {
    let match: Match;
    match = new Match(
      players,
      () => this.dependencies.onUpdate(match),
      (result) => onFinish(match, result),
      undefined,
      true,
      botIds,
      content,
    );
    return match;
  }

  private playerFrom(user: UserRecord): MatchPlayer {
    return {
      id: user.id,
      name: user.name || 'Jogador',
      avatar: user.avatar,
      commander: user.commander,
      accent: user.accent,
      photo: user.photo,
      frame: user.frame,
      accentStyle: user.accentStyle,
      mmr: user.mmr,
      tutorialEligible: user.wins + user.losses === 0,
    };
  }

  private contentFor(users: UserRecord[]): MatchContent {
    const content: MatchContent = {};
    if (this.dependencies.flags.factions) {
      const factions: Record<string, string> = {};
      for (const user of users) {
        if (user.faction) factions[user.id] = user.faction;
      }
      if (Object.keys(factions).length) content.factions = factions;
    }
    if (this.dependencies.flags.comeback) content.comeback = true;
    return content;
  }
}
