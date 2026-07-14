import {
  TAUNTS,
  type ChatMessage,
  type Profile,
  type ServerMsg,
} from '@legendsclash/shared';
import type { ReportRecord, UserRecord } from '../../store.js';
import { RateLimiter } from '../../ratelimit.js';
import { filterText, MAX_CHAT_LENGTH } from '../../wordfilter.js';

const REPORT_FLAG_THRESHOLD = 3;

/** Dependência mínima de persistência exigida pelas regras de chat. */
export interface ChatStore {
  userById(id: string): UserRecord | undefined;
  setMuted(userId: string, targetId: string, muted: boolean): void;
  addReport(report: ReportRecord): void;
  profileOf(user: UserRecord): Profile;
}

export interface ChatCoordinatorDependencies {
  store: ChatStore;
  recipientsFor(userId: string): string[];
  sendTo(userId: string, message: ServerMsg): void;
  warn?: (message: string) => void;
}

/** Validação esperada de chat que deve ser devolvida ao cliente. */
export class ChatError extends Error {}

/**
 * Coordena chat efêmero, provocações e moderação sem conhecer WebSocket,
 * salas ou partidas. Esses contextos entram pelas dependências de transporte.
 */
export class ChatCoordinator {
  private recentChat = new Map<string, string[]>();
  private reportsByTarget = new Map<string, Set<string>>();
  private chatLimiter = new RateLimiter(5, 1);
  private tauntLimiter = new RateLimiter(1, 0.4);

  constructor(private readonly dependencies: ChatCoordinatorDependencies) {}

  send(user: UserRecord, rawText: string): void {
    const text = filterText(String(rawText).slice(0, MAX_CHAT_LENGTH).trim());
    if (!text) return;
    // Acima do limite, descarta em silêncio; o cliente também aplica throttle.
    if (!this.chatLimiter.take(user.id)) return;
    this.deliver(user, text);
  }

  sendTaunt(user: UserRecord, id: string): void {
    const taunt = TAUNTS.find((candidate) => candidate.id === id);
    if (!taunt) throw new ChatError('Provocação inválida.');
    // O cooldown do cliente é só UX; o limite autoritativo vive no servidor.
    if (!this.tauntLimiter.take(user.id)) return;
    this.deliver(user, taunt.text);
  }

  setMuted(user: UserRecord, targetId: string, muted: boolean): void {
    if (targetId === user.id) return;
    this.dependencies.store.setMuted(user.id, targetId, muted);
    this.dependencies.sendTo(user.id, {
      t: 'profile',
      profile: this.dependencies.store.profileOf(user),
    });
  }

  report(user: UserRecord, targetId: string, reason: string): void {
    if (targetId === user.id) throw new ChatError('Você não pode se denunciar.');
    if (!this.dependencies.recipientsFor(user.id).includes(targetId)) {
      throw new ChatError('Só dá para denunciar quem está na sua sala ou partida.');
    }

    // Alívio imediato para o denunciante enquanto a denúncia é revisada.
    this.dependencies.store.setMuted(user.id, targetId, true);
    this.dependencies.store.addReport({
      reporterId: user.id,
      reportedId: targetId,
      reason: String(reason).slice(0, 500),
      context: (this.recentChat.get(targetId) ?? []).join(' | '),
      at: Date.now(),
    });

    const reporters = this.reportsByTarget.get(targetId) ?? new Set<string>();
    reporters.add(user.id);
    this.reportsByTarget.set(targetId, reporters);
    if (reporters.size >= REPORT_FLAG_THRESHOLD) {
      const warn = this.dependencies.warn ?? console.warn;
      warn(`[moderação] ${targetId} acumulou ${reporters.size} denunciantes distintos — revisar`);
    }

    this.dependencies.sendTo(user.id, { t: 'chat:report:ok' });
  }

  /** Libera os baldes da conexão encerrada e evita crescimento sem limite. */
  forget(userId: string): void {
    this.chatLimiter.forget(userId);
    this.tauntLimiter.forget(userId);
  }

  private deliver(user: UserRecord, text: string): void {
    const recent = this.recentChat.get(user.id) ?? [];
    recent.push(text);
    this.recentChat.set(user.id, recent.slice(-10));

    const recipients = this.dependencies.recipientsFor(user.id);
    if (!recipients.length) throw new ChatError('Você não está em uma sala ou partida.');

    const message: ChatMessage = {
      from: {
        id: user.id,
        name: user.name || 'Jogador',
        avatar: user.avatar,
        photo: user.photo,
      },
      text,
      at: Date.now(),
    };
    for (const recipientId of recipients) {
      const recipient = this.dependencies.store.userById(recipientId);
      if (recipient?.muted.includes(user.id)) continue;
      this.dependencies.sendTo(recipientId, { t: 'chat:message', message });
    }
  }
}
