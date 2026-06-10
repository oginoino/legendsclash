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
    send({ t: 'hello', token: state.token! });
  };

  socket.onmessage = (ev) => handleServerMsg(JSON.parse(ev.data) as ServerMsg);

  socket.onclose = () => {
    if (ws !== socket) return; // conexão substituída (ex.: convidado virou conta)
    ws = null;
    setState({ connected: false });
    if (state.token) {
      // reconexão automática — a janela anti-abandono do servidor é de 2 min
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(15_000, reconnectDelay * 2);
    }
  };
}

function handleServerMsg(msg: ServerMsg): void {
  switch (msg.t) {
    case 'hello:ok':
      setState({ connected: true, profile: msg.profile });
      send({ t: 'leaderboard:get' });
      send({ t: 'history:get' });
      joinPendingRoom();
      break;
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
    history: [], inQueue: false,
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
    history: [], accountPrompt: false,
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
