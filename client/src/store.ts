import { useSyncExternalStore } from 'react';
import type { ClientMsg, ServerMsg } from '@legendsclash/shared';
import { accountApi } from './api/account-api';
import type { SessionResponse } from './api/account-api';
import { createRealtimeConnection } from './network/realtime-connection';
import { appStateReducer, createInitialAppState } from './state/app-state';
import type { AppState, AppStateAction } from './state/app-state';

export type { AppState, RematchState } from './state/app-state';

const ACTIVE_MATCH_KEY = 'lc_active_match';

function activeMatchTicket(): string | null {
  try { return sessionStorage.getItem(ACTIVE_MATCH_KEY); } catch { return null; }
}

function rememberActiveMatch(matchId: string | null): void {
  try {
    if (matchId) sessionStorage.setItem(ACTIVE_MATCH_KEY, matchId);
    else sessionStorage.removeItem(ACTIVE_MATCH_KEY);
  } catch { /* armazenamento opcional */ }
}

/**
 * Link mágico de redefinição: lê o access_token do fragment de `/auth/reset` e
 * limpa a URL na hora (não deixa o token na barra de endereços nem no histórico).
 */
function readResetToken(): string | null {
  if (location.pathname !== '/auth/reset' || !location.hash) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('type') === 'recovery' ? params.get('access_token') : null;
  if (token) history.replaceState(null, '', '/');
  return token;
}

const initialToken = localStorage.getItem('lc_token');

let state = createInitialAppState({
  token: initialToken,
  resetToken: readResetToken(),
  faction: localStorage.getItem('lc_faction') ?? '',
  recoveringGame: !!initialToken && activeMatchTicket() != null,
});

const listeners = new Set<() => void>();

function dispatch(action: AppStateAction): void {
  state = appStateReducer(state, action);
  for (const l of listeners) l();
}

function setState(patch: Partial<AppState>): void {
  dispatch({ type: 'patch', patch });
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

let toastTimer: number | undefined;

function showToast(message: string): void {
  clearTimeout(toastTimer);
  setState({ toast: message });
  toastTimer = window.setTimeout(() => setState({ toast: null }), 4000);
}

const realtimeConnection = createRealtimeConnection({
  getSession: () => ({
    token: state.token,
    resetToken: state.resetToken,
    replaced: state.replaced,
  }),
  onOpen: () => {
    setState({ replaced: false });
    if (state.token) send({ t: 'hello', token: state.token });
  },
  onMessage: handleServerMsg,
  onClosed: () => setState({ connected: false }),
  // outra aba/dispositivo assumiu; reconectar geraria disputa entre conexões.
  onReplaced: () => setState({ replaced: true }),
});

export function send(msg: ClientMsg): void {
  realtimeConnection.send(msg);
}

export function connect(): void {
  realtimeConnection.connect();
}

/** Retoma a conexão nesta aba (substitui a aba que tinha assumido). */
export function resumeHere(): void {
  setState({ replaced: false });
  realtimeConnection.reconnectNow();
}

function handleServerMsg(msg: ServerMsg): void {
  switch (msg.t) {
    case 'hello:ok': {
      const persistedFaction = msg.profile.faction ?? '';
      const legacyFaction = state.faction;
      const faction = persistedFaction || legacyFaction;
      try { localStorage.setItem('lc_faction', faction); } catch { /* ignore */ }
      dispatch({
        type: 'server/hello',
        profile: msg.profile,
        factionsEnabled: !!msg.content?.factions,
        cosmeticsEnabled: !!msg.content?.cosmetics,
        faction,
      });
      send({ t: 'leaderboard:get' });
      send({ t: 'history:get' });
      // Migra uma escolha antiga do dispositivo para o perfil persistido.
      if (!persistedFaction && legacyFaction) send({ t: 'faction:pick', factionId: legacyFaction });
      joinPendingRoom();
      break;
    }
    case 'pong':
      break; // o onmessage já registrou o sinal de vida
    case 'error':
      if (msg.message === 'Sessão expirada. Entre novamente.') return logout();
      showToast(msg.message);
      break;
    case 'profile':
      try { localStorage.setItem('lc_faction', msg.profile.faction ?? ''); } catch { /* ignore */ }
      dispatch({ type: 'server/profile', profile: msg.profile, faction: msg.profile.faction ?? '' });
      break;
    case 'queue:status':
      dispatch({
        type: 'server/queue-status', inQueue: msg.inQueue,
        queueSize: msg.size, waitingAlone: !!msg.waitingAlone,
      });
      break;
    case 'room:state':
      dispatch({ type: 'server/room-state', room: msg.room });
      break;
    case 'game:state': {
      if (!msg.view) {
        // verdade do servidor: não há partida. Destrava a batalha fantasma
        // que sobra quando o servidor reinicia no meio do jogo — exceto se a
        // tela de resultado está aberta (o jogador fecha quando quiser).
        const interrupted = !!state.game && !state.gameOver;
        rememberActiveMatch(null);
        dispatch({ type: 'server/game-state', game: null });
        if (interrupted) showToast('A partida anterior foi encerrada no servidor.');
        break;
      }
      rememberActiveMatch(msg.view.status === 'finished' ? null : msg.view.matchId);
      dispatch({ type: 'server/game-state', game: msg.view });
      break;
    }
    case 'game:over':
      rememberActiveMatch(null);
      dispatch({ type: 'server/game-over', result: msg.result });
      send({ t: 'leaderboard:get' });
      send({ t: 'history:get' });
      break;
    case 'chat:message':
      dispatch({ type: 'server/chat-message', message: msg.message });
      break;
    case 'chat:report:ok':
      dispatch({ type: 'server/report-sent' });
      showToast('Denúncia registrada. Obrigado por ajudar a manter a comunidade saudável.');
      break;
    case 'leaderboard':
      dispatch({
        type: 'server/leaderboard', entries: msg.entries,
        myRank: msg.myRank ?? null, around: msg.around ?? [],
      });
      break;
    case 'history':
      dispatch({ type: 'server/history', entries: msg.entries });
      break;
    case 'rematch:state':
      dispatch({
        type: 'server/rematch', rematch: { status: msg.status, from: msg.from },
      });
      if (msg.status === 'unavailable') showToast('Oponente indisponível para a revanche.');
      if (msg.status === 'declined') showToast('O oponente recusou a revanche.');
      break;
    case 'profile:view':
      dispatch({ type: 'server/profile-view', profile: msg.profile });
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

function adoptSession(body: SessionResponse): { needsProfile: boolean } {
  // troca de identidade (ex.: convidado virou conta): derruba a conexão antiga
  realtimeConnection.disconnect();
  localStorage.setItem('lc_token', body.token);
  dispatch({
    type: 'session/adopt',
    token: body.token,
    profile: body.profile,
  });
  connect();
  return { needsProfile: !!body.needsProfile };
}

/** Jogar sem cadastro: sessão de convidado com nome e avatar. */
export async function loginAsGuest(name: string, avatar: string): Promise<void> {
  await adoptSession(await accountApi.loginAsGuest(name, avatar));
}

export async function registerAccount(
  email: string,
  password: string,
): Promise<{ needsProfile: boolean }> {
  // a sessão de convidado vai junto: a conta nova herda o progresso (promoção)
  return adoptSession(
    await accountApi.registerAccount(email, password, state.token ?? undefined),
  );
}

export async function loginAccount(
  email: string,
  password: string,
): Promise<{ needsProfile: boolean }> {
  return adoptSession(await accountApi.loginAccount(email, password));
}

/** Esqueci minha senha: dispara o link mágico. Resposta sempre genérica; em
 *  modo local o servidor devolve o link (devLink) para facilitar dev/testes. */
export async function requestPasswordReset(email: string): Promise<{ devLink?: string }> {
  return accountApi.requestPasswordReset(email);
}

/** Conclui a redefinição com o token do link e já entra com a senha nova. */
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ needsProfile: boolean }> {
  return adoptSession(await accountApi.resetPassword(token, password));
}

export function clearResetToken(): void {
  setState({ resetToken: null });
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
  const body = await accountApi.completeProfile(name, avatar, state.token);
  setState({ profile: body.profile });
  joinPendingRoom(); // convite por link esperava o nome
}

/** Personalização pós-onboarding (perfil + comandante); o servidor valida e
 *  responde com o perfil atualizado. Envia só os campos alterados. */
export function updateProfile(patch: {
  name?: string;
  avatar?: string;
  commander?: string;
  accent?: string;
  frame?: string;
  accentStyle?: string;
  profileCover?: string;
}): void {
  send({ t: 'profile:update', ...patch });
}

/**
 * Sobe a foto de perfil (Personalização v2). O cliente já reduz a imagem para
 * ~256px (ver `downscaleImage`); o servidor valida formato/tamanho, hospeda e
 * responde com o perfil atualizado. Lança em falha (a UI exibe a mensagem).
 */
export async function uploadAvatarPhoto(dataUrl: string): Promise<void> {
  const token = state.token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const body = await accountApi.uploadAvatarPhoto(dataUrl, token);
  if (body.profile) setState({ profile: body.profile });
}

/** Remove a foto de perfil, voltando ao ícone escolhido. */
export async function removeAvatarPhoto(): Promise<void> {
  const token = state.token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const body = await accountApi.removeAvatarPhoto(token);
  if (body.profile) setState({ profile: body.profile });
}

export function logout(): void {
  const token = state.token;
  if (token) {
    // revoga a sessão no servidor; falha de rede não impede o logout local
    void accountApi.revokeSession(token).catch(() => {});
  }
  localStorage.removeItem('lc_token');
  rememberActiveMatch(null);
  realtimeConnection.disconnect();
  dispatch({ type: 'session/logout' });
}

export function dismissGameOver(): void {
  // celebração ao voltar pra Home: vitória + sequência diária (já atualizada no profile)
  const over = state.gameOver;
  const won = !!over && over.winnerId === state.profile?.id;
  const isPractice = !!over && Object.keys(over.mmr).length === 0; // treino não conta
  const streak = state.profile?.streak ?? 0;
  dispatch({ type: 'game/dismiss-result' });
  if (won && !isPractice && streak >= 2) showToast(`Vitória! ${streak} dias de sequência.`);
  else if (won && !isPractice) showToast('Vitória registrada!');
}

// ─── Continuidade social (revanche, amigos, card de perfil) ─────

export function requestRematch(): void {
  send({ t: 'rematch:request' });
}
export function declineRematch(): void {
  send({ t: 'rematch:decline' });
  setState({ rematch: null });
}
export function addFriend(playerId: string): void {
  send({ t: 'friend:add', playerId });
  showToast('Amigo adicionado.');
}
export function removeFriend(playerId: string): void {
  send({ t: 'friend:remove', playerId });
}
export function viewProfile(playerId: string): void {
  send({ t: 'profile:get', playerId });
}
export function closeProfile(): void {
  setState({ viewedProfile: null });
}

export function pickFaction(factionId: string): void {
  try { localStorage.setItem('lc_faction', factionId); } catch { /* ignore */ }
  setState({ faction: factionId });
  send({ t: 'faction:pick', factionId });
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
