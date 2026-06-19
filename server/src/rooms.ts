import type { RoomState } from '@legendsclash/shared';
import { leagueOf } from './elo.js';

/**
 * Lobby: criar sala, entrar e convidar por link (slide "MVP — 90 dias":
 * a alavanca de viralidade). Salas têm assentos — o limite vem de
 * configuração, não da estrutura, para habilitar 2v2/N-player depois.
 */

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  photo?: string | null;
  mmr: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos
export const ROOM_SEATS = 2; // MVP: 1v1

export interface Room {
  code: string;
  hostId: string;
  members: RoomPlayer[];
  seats: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byPlayer = new Map<string, string>(); // playerId → code

  create(host: RoomPlayer): Room {
    let code: string;
    do {
      code = Array.from({ length: 6 }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room: Room = { code, hostId: host.id, members: [host], seats: ROOM_SEATS };
    this.rooms.set(code, room);
    this.byPlayer.set(host.id, code);
    return room;
  }

  join(code: string, player: RoomPlayer): Room {
    const room = this.rooms.get(code.toUpperCase().trim());
    if (!room) throw new Error('Sala não encontrada. Confira o código.');
    if (room.members.some((m) => m.id === player.id)) return room;
    if (room.members.length >= room.seats) throw new Error('A sala está cheia.');
    room.members.push(player);
    this.byPlayer.set(player.id, room.code);
    return room;
  }

  leave(playerId: string): Room | null {
    const code = this.byPlayer.get(playerId);
    if (!code) return null;
    this.byPlayer.delete(playerId);
    const room = this.rooms.get(code);
    if (!room) return null;
    room.members = room.members.filter((m) => m.id !== playerId);
    if (room.members.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostId === playerId) room.hostId = room.members[0].id;
    return room;
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.byPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Remove a sala quando a partida começa. */
  dissolve(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const m of room.members) this.byPlayer.delete(m.id);
    this.rooms.delete(code);
  }

  toState(room: Room): RoomState {
    return {
      code: room.code,
      seats: room.seats,
      members: room.members.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        photo: m.photo ?? null,
        mmr: m.mmr,
        league: leagueOf(m.mmr),
        isHost: m.id === room.hostId,
      })),
    };
  }
}
