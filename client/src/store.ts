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
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelay = 1000;
    send({ t: 'hello', token: state.token! });
  };

  ws.onmessage = (ev) => handleServerMsg(JSON.parse(ev.data) as ServerMsg);

  ws.onclose = () => {
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

let pendingRoomCode: string | null = null;
{
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
  if (m) {
    pendingRoomCode = m[1].toUpperCase();
    history.replaceState(null, '', '/');
  }
}

function joinPendingRoom(): void {
  // aguarda o onboarding: ninguém entra numa sala sem nome de jogador
  if (pendingRoomCode && state.profile?.name) {
    send({ t: 'room:join', code: pendingRoomCode });
    pendingRoomCode = null;
  }
}

// ─── Autenticação (OTP por e-mail; o servidor media o Supabase) ──

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

export async function requestOtp(email: string): Promise<void> {
  await postJson('/api/auth/otp', { email });
}

export async function verifyOtp(email: string, code: string): Promise<{ needsProfile: boolean }> {
  const body = await postJson('/api/auth/verify', { email, code });
  localStorage.setItem('lc_token', body.token);
  setState({ token: body.token, profile: body.profile });
  connect();
  return { needsProfile: !!body.needsProfile };
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
  });
  socket?.close();
}

export function dismissGameOver(): void {
  setState({ game: null, gameOver: null, chat: [] });
}

export function clearReportSent(): void {
  setState({ reportSent: false });
}
