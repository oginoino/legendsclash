import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AVATAR, accentStyleUnlocked, frameUnlocked, isValidAccentStyle, isValidAvatar,
  isValidCommander, isValidFrame, normalizeIconId,
} from '@legendsclash/shared';
import { Store } from '../src/store.js';
import { decodeImage } from '../src/avatar.js';

process.env.LC_LOCAL = '1'; // nunca tocar Supabase em testes

function tmpDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lc-cos-')), 'db.json');
}

describe('cosméticos v2 · normalização e validação no shared', () => {
  it('normalizeIconId converte emoji legado em id estável e mantém ids', () => {
    expect(normalizeIconId('🛡️')).toBe('shield');
    expect(normalizeIconId('👑')).toBe('crown');
    expect(normalizeIconId('🤖')).toBe('robot');
    expect(normalizeIconId('shield')).toBe('shield'); // já é id
    expect(normalizeIconId('desconhecido')).toBe('desconhecido'); // passa direto
    expect(normalizeIconId(undefined)).toBe(DEFAULT_AVATAR);
  });

  it('isValid* aceita ids e emoji legado, recusa lixo', () => {
    expect(isValidAvatar('shield')).toBe(true);
    expect(isValidAvatar('🛡️')).toBe(true); // legado normalizado
    expect(isValidAvatar('<script>')).toBe(false);
    expect(isValidCommander('crown')).toBe(true);
    expect(isValidFrame('dragon')).toBe(true);
    expect(isValidFrame('inexistente')).toBe(false);
    expect(isValidAccentStyle('aurora')).toBe(true);
    expect(isValidAccentStyle('arco-iris')).toBe(false);
  });

  it('frame/estilo de prestígio exigem a conquista', () => {
    expect(frameUnlocked('none', [])).toBe(true); // sempre liberado
    expect(frameUnlocked('dragon', [])).toBe(false);
    expect(frameUnlocked('dragon', ['veteran_50'])).toBe(true);
    expect(accentStyleUnlocked('solid', [])).toBe(true);
    expect(accentStyleUnlocked('ember', [])).toBe(false);
    expect(accentStyleUnlocked('ember', ['veteran_10'])).toBe(true);
  });
});

describe('cosméticos v2 · store', () => {
  it('updateCosmetics aplica frame/estilo só quando desbloqueados', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('cos@t.test', null);

    // 'dragon' exige veteran_50; sem partidas é recusado (anti-abuso)
    store.updateCosmetics(user.id, { frame: 'dragon', accentStyle: 'ember' });
    expect(store.userById(user.id)!.frame).toBe('none');
    expect(store.userById(user.id)!.accentStyle).toBe('solid');

    // frame/estilo comuns entram sempre
    store.updateCosmetics(user.id, { frame: 'gilded', accentStyle: 'aurora' });
    expect(store.userById(user.id)!.frame).toBe('gilded');
    expect(store.userById(user.id)!.accentStyle).toBe('aurora');

    // após desbloquear, os de prestígio entram
    user.wins = 10;
    user.losses = 40; // 50 partidas → veteran_50
    store.updateCosmetics(user.id, { frame: 'dragon', accentStyle: 'ember' });
    expect(store.userById(user.id)!.frame).toBe('dragon');
    expect(store.userById(user.id)!.accentStyle).toBe('ember');
  });

  it('updateCosmetics ignora valores fora da lista (anti-abuso)', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('lixo@t.test', null);
    store.updateCosmetics(user.id, { frame: '<b>x</b>', accentStyle: 'javascript:' });
    expect(store.userById(user.id)!.frame).toBe('none');
    expect(store.userById(user.id)!.accentStyle).toBe('solid');
  });

  it('createGuest preserva id de avatar longo e cai no padrão se inválido', async () => {
    const store = await Store.create(tmpDbPath());
    const ok = store.createGuest('Ana', 'crossed-swords'); // 14 chars — não pode truncar
    expect(ok.avatar).toBe('crossed-swords');
    const bad = store.createGuest('Bia', 'lixo-arbitrario');
    expect(bad.avatar).toBe(DEFAULT_AVATAR);
  });

  it('setPhoto define e remove a foto; profileOf a expõe', async () => {
    const store = await Store.create(tmpDbPath());
    const { user } = store.findOrCreatePlayerByAuth('foto@t.test', null);
    store.setPhoto(user.id, 'https://cdn/x.webp');
    expect(store.profileOf(store.userById(user.id)!).photo).toBe('https://cdn/x.webp');
    store.setPhoto(user.id, null);
    expect(store.profileOf(store.userById(user.id)!).photo).toBeNull();
  });

  it('uploadAvatar local devolve a própria data-URL (sem storage externo)', async () => {
    const store = await Store.create(tmpDbPath());
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const url = await store.uploadAvatar('p1', bytes, 'image/png');
    expect(url).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });
});

describe('cosméticos v2 · validação da imagem (rota de upload)', () => {
  const pngDataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;

  it('aceita PNG válido pelo magic-number', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const out = decodeImage(pngDataUrl(bytes));
    expect(out.contentType).toBe('image/png');
    expect(out.bytes.length).toBe(bytes.length);
  });

  it('recusa formato não suportado', () => {
    expect(() => decodeImage('data:image/gif;base64,AAAA')).toThrow(/suportado/i);
  });

  it('recusa magic-number inválido (payload disfarçado de PNG)', () => {
    const fake = Buffer.from('not a png really', 'utf8');
    expect(() => decodeImage(pngDataUrl(fake))).toThrow(/inválid/i);
  });

  it('recusa imagem grande demais (> 512KB)', () => {
    const big = Buffer.alloc(520 * 1024);
    big[0] = 0x89; big[1] = 0x50; // header PNG válido, mas estoura o teto
    expect(() => decodeImage(pngDataUrl(big))).toThrow(/grande/i);
  });
});
