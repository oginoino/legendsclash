import { useSyncExternalStore } from 'react';
import type {
  ChatMessage, ClientMsg, GameView, LeaderboardEntry, MatchHistoryEntry,
  MatchResult, Profile, RoomState, ServerMsg,
} from '@legendsclash/shared';

/**
 * Estado do cliente + conexão WebSocket. O cliente é uma casca de
 * apresentação: envia intenções e renderiza o estado autoritativo do
 * servidor — nenhuma regra de jogo é avaliada aqui.
 */

export interface AppState {
  token: string | null;
  profile: Profile | null;
  connected: boolean;
  inQueue: boolean;
  queueSize: number;
  room: RoomState | null;
  game: GameView | null;
  gameOver: MatchResult | null;
  chat: ChatMessage[];
  leaderboard: LeaderboardEntry[];
  history: MatchHistoryEntry[];
  toast: string | null;
  reportSent: boolean;
  /** Convidado pediu a tela de conta (criar/entrar) sem perder a sessão atual. */
  accountPrompt: boolean;
  /** Conexão assumida por outra aba/dispositivo — não reconectar sozinho. */
  replaced: boolean;
}

let state: AppState = {
  token: localStorage.getItem('lc_token'),
  profile: null,
  connected: false,
  inQueue: false,
  queueSize: 0,
  room: null,
  game: null,
  gameOver: null,
  chat: [],
  leaderboard: [],
  history: [],
  toast: null,
  reportSent: false,
  accountPrompt: false,
  replaced: false,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

// ─── WebSocket ──────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let toastTimer: number | undefined;
let lastServerMsgAt = 0; // última mensagem (de qualquer tipo) vinda do servidor

function showToast(message: string): void {
  clearTimeout(toastTimer);
  setState({ toast: message });
  toastTimer = window.setTimeout(() => setState({ toast: null }), 4000);
}

export function send(msg: ClientMsg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function connect(): void {
  if (!state.token || (ws && ws.readyState <= WebSocket.OPEN)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;

  socket.onopen = () => {
    reconnectDelay = 1000;
    lastServerMsgAt = Date.now();
    setState({ replaced: false });
    send({ t: 'hello', token: state.token! });
  };

  socket.onmessage = (ev) => {
    lastServerMsgAt = Date.now();
    handleServerMsg(JSON.parse(ev.data) as ServerMsg);
  };

  socket.onclose = (ev) => {
    if (ws !== socket) return; // conexão substituída (ex.: convidado virou conta)
    ws = null;
    setState({ connected: false });
    if (ev.code === 4001) {
      // outra aba/dispositivo assumiu — reconectar aqui geraria um cabo de
      // guerra infinito entre as duas conexões
      setState({ replaced: true });
      return;
    }
    if (state.token) {
      // reconexão automática — a janela anti-abandono do servidor é de 2 min
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(15_000, reconnectDelay * 2);
    }
  };
}

// ─── Vivacidade da conexão ──────────────────────────────────────
// NATs, proxies e redes móveis derrubam conexões ociosas sem avisar: o socket
// fica "aberto" porém morto e a batalha congela sem nem disparar onclose.
// Quieto demais → ping; mudo demais → fecha (e a reconexão automática assume).

const PING_IDLE_MS = 25_000;
const DEAD_AFTER_MS = 65_000;

window.setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const quiet = Date.now() - lastServerMsgAt;
  if (quiet > DEAD_AFTER_MS) ws.close();
  else if (quiet > PING_IDLE_MS) send({ t: 'ping' });
}, 10_000);

/** Rede/aba voltou: reconecta já, sem esperar o backoff. */
function reconnectNow(): void {
  if (!state.token || state.replaced) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    // socket aberto mas mudo há tempo demais (aba dormiu?) — está morto
    if (Date.now() - lastServerMsgAt > DEAD_AFTER_MS) ws.close();
    return;
  }
  reconnectDelay = 1000;
  connect();
}

window.addEventListener('online', reconnectNow);
window.addEventListener('focus', reconnectNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectNow();
});

/** Retoma a conexão nesta aba (substitui a aba que tinha assumido). */
export function resumeHere(): void {
  setState({ replaced: false });
  reconnectNow();
}

function handleServerMsg(msg: ServerMsg): void {
  switch (msg.t) {
    case 'hello:ok':
      setState({ connected: true, profile: msg.profile });
      send({ t: 'leaderboard:get' });
      send({ t: 'history:get' });
      joinPendingRoom();
      break;
    case 'pong':
      break; // o onmessage já registrou o sinal de vida
    case 'error':
      if (msg.message === 'Sessão expirada. Entre novamente.') return logout();
      showToast(msg.message);
      break;
    case 'profile':
      setState({ profile: msg.profile });
      break;
    case 'queue:status':
      setState({ inQueue: msg.inQueue, queueSize: msg.size });
      break;
    case 'room:state':
      setState({
        room: msg.room,
        chat: msg.room && state.room?.code === msg.room.code ? state.chat : [],
      });
      break;
    case 'game:state': {
      if (!msg.view) {
        // verdade do servidor: não há partida. Destrava a batalha fantasma
        // que sobra quando o servidor reinicia no meio do jogo — exceto se a
        // tela de resultado está aberta (o jogador fecha quando quiser).
        if (state.game && !state.gameOver) {
          setState({ game: null, chat: [] });
          showToast('A partida anterior foi encerrada no servidor.');
        }
        break;
      }
      const entering = !state.game || state.game.matchId !== msg.view.matchId;
      setState({
        game: msg.view,
        inQueue: false,
        room: null,
        ...(entering ? { chat: [], gameOver: null } : {}),
      });
      break;
    }
    case 'game:over':
      setState({ gameOver: msg.result });
      send({ t: 'leaderboard:get' });
      send({ t: 'history:get' });
      break;
    case 'chat:message':
      setState({ chat: [...state.chat, msg.message].slice(-100) });
      break;
    case 'chat:report:ok':
      setState({ reportSent: true });
      showToast('Denúncia registrada. Obrigado por ajudar a manter a comunidade saudável.');
      break;
    case 'leaderboard':
      setState({ leaderboard: msg.entries });
      break;
    case 'history':
      setState({ history: msg.entries });
      break;
  }
}

// ─── Convite por link (/room/CODIGO) ────────────────────────────

const PENDING_ROOM_KEY = 'lc_pending_room';
const PENDING_ROOM_TTL_MS = 30 * 60_000;

let pendingRoomCode: string | null = null;
{
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
  if (m) {
    pendingRoomCode = m[1].toUpperCase();
    history.replaceState(null, '', '/');
  } else {
    // o convite sobrevive à tela de entrada (convidado ou conta) — com validade
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_ROOM_KEY) ?? 'null') as
        | { code: string; at: number }
        | null;
      if (saved && Date.now() - saved.at < PENDING_ROOM_TTL_MS) pendingRoomCode = saved.code;
    } catch {
      // valor corrompido: ignora
    }
  }
  if (pendingRoomCode) {
    localStorage.setItem(PENDING_ROOM_KEY, JSON.stringify({ code: pendingRoomCode, at: Date.now() }));
  } else {
    localStorage.removeItem(PENDING_ROOM_KEY);
  }
}

function joinPendingRoom(): void {
  // aguarda o onboarding: ninguém entra numa sala sem nome de jogador
  if (pendingRoomCode && state.profile?.name) {
    send({ t: 'room:join', code: pendingRoomCode });
    pendingRoomCode = null;
    localStorage.removeItem(PENDING_ROOM_KEY);
  }
}

// ─── Autenticação (convidado ou e-mail+senha; o servidor media o Supabase) ──

async function postJson(
  path: string,
  body: unknown,
  token?: string,
): Promise<Record<string, any>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Falha na requisição.');
  return data;
}

function adoptSession(body: Record<string, any>): { needsProfile: boolean } {
  // troca de identidade (ex.: convidado virou conta): derruba a conexão antiga
  const oldWs = ws;
  ws = null;
  oldWs?.close();
  localStorage.setItem('lc_token', body.token);
  setState({
    token: body.token, profile: body.profile, accountPrompt: false,
    connected: false, room: null, game: null, gameOver: null, chat: [],
    history: [], inQueue: false, replaced: false,
  });
  connect();
  return { needsProfile: !!body.needsProfile };
}

/** Jogar sem cadastro: sessão de convidado com nome e avatar. */
export async function loginAsGuest(name: string, avatar: string): Promise<void> {
  await adoptSession(await postJson('/api/auth/guest', { name, avatar }));
}

export async function registerAccount(
  email: string,
  password: string,
): Promise<{ needsProfile: boolean }> {
  // a sessão de convidado vai junto: a conta nova herda o progresso (promoção)
  return adoptSession(
    await postJson('/api/auth/register', { email, password }, state.token ?? undefined),
  );
}

export async function loginAccount(
  email: string,
  password: string,
): Promise<{ needsProfile: boolean }> {
  return adoptSession(await postJson('/api/auth/login', { email, password }));
}

/** Abre/fecha a tela de conta por cima da sessão de convidado. */
export function openAccountPrompt(): void {
  setState({ accountPrompt: true });
}

export function closeAccountPrompt(): void {
  setState({ accountPrompt: false });
}

export async function completeProfile(name: string, avatar: string): Promise<void> {
  if (!state.token) throw new Error('Sessão expirada. Entre novamente.');
  const body = await postJson('/api/auth/profile', { name, avatar }, state.token);
  setState({ profile: body.profile });
  joinPendingRoom(); // convite por link esperava o nome
}

export function logout(): void {
  const token = state.token;
  if (token) {
    // revoga a sessão no servidor; falha de rede não impede o logout local
    void fetch('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  localStorage.removeItem('lc_token');
  const socket = ws;
  ws = null; // impede reconexão automática
  setState({
    token: null, profile: null, connected: false, room: null,
    game: null, gameOver: null, chat: [], inQueue: false,
    history: [], accountPrompt: false, replaced: false,
  });
  socket?.close();
}

export function dismissGameOver(): void {
  setState({ game: null, gameOver: null, chat: [] });
}

export function clearReportSent(): void {
  setState({ reportSent: false });
}

// login concluído em outra aba: esta aba adota a sessão
window.addEventListener('storage', (e) => {
  if (e.key === 'lc_token' && e.newValue && !state.token) {
    setState({ token: e.newValue });
    connect();
  }
});
