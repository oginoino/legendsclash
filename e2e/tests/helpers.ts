import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';

// emoji legado → id de ícone (espelha LEGACY_ICON_MAP do shared). Inline aqui
// porque o Playwright não transpila o TS do pacote shared dentro de node_modules.
const AVATAR_IDS: Record<string, string> = {
  '🛡️': 'shield', '⚔️': 'crossed-swords', '🐺': 'wolf', '🐉': 'dragon',
  '🏹': 'bow', '🔮': 'orb', '🦅': 'eagle', '🌙': 'moon', '🧙': 'wizard', '🗡️': 'dagger',
};

/** Seletor do botão de avatar no picker: aceita emoji legado ou id de ícone. */
export function avatarButton(avatar: string): string {
  return `.avatar-picker button[data-avatar="${AVATAR_IDS[avatar] ?? avatar}"]`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SHOTS_DIR = resolve(__dirname, '..', 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

export function shotPath(name: string): string {
  return join(SHOTS_DIR, name);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.test`;
}

export const E2E_PASSWORD = 'senha-e2e-12345';

/**
 * Cria uma conta (e-mail + senha) num contexto novo e espera a home carregar.
 * O servidor dos testes roda em modo local (LC_LOCAL=1): contas em memória,
 * sem tocar o Supabase. `ctxOpts` permite contextos especiais (ex.: viewport
 * mobile com touch).
 */
export async function loginAs(
  browser: Browser,
  name: string,
  avatar: string,
  ctxOpts: BrowserContextOptions = {},
): Promise<Page> {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/');

  // passo 1: da boas-vindas para a tela de conta, no modo "criar"
  await page.click('button:has-text("Entrar ou criar conta")');
  await page.click('button:has-text("Criar conta nova")');
  await page.fill('input[type=email]', uniqueEmail(name.toLowerCase()));
  await page.fill('input[type=password]', E2E_PASSWORD);
  await page.click('button:has-text("Criar conta")');

  // passo 2: perfil do primeiro acesso
  await page.waitForSelector('input[name=name]');
  await page.fill('input[name=name]', name);
  await page.click(avatarButton(avatar));
  await page.click('button:has-text("Começar a jogar")');

  await page.waitForSelector('.home-main');
  return page;
}

/** Entra como convidado (sem cadastro) e espera a home carregar. */
export async function guestAs(
  browser: Browser,
  name: string,
  avatar: string,
  ctxOpts: BrowserContextOptions = {},
): Promise<Page> {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.fill('input[name=name]', name);
  await page.click(avatarButton(avatar));
  await page.click('button:has-text("Jogar agora")');
  await page.waitForSelector('.home-main');
  return page;
}

/**
 * Fase de mulligan (troca da mão inicial): confirma a mão como está e segue
 * para o tabuleiro. Toda partida começa nesta fase.
 */
export async function passMulligan(p: Page): Promise<void> {
  await p.locator('.mulligan-confirm').click({ timeout: 20_000 });
}

/**
 * Tutorial da 1ª partida (mostrado uma vez por dispositivo): pula se presente.
 * Contextos de teste nascem sem a flag em localStorage, então aparece no 1º jogo.
 */
export async function passTutorial(p: Page): Promise<void> {
  const skip = p.locator('.tutorial-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 6000 });
    await skip.click();
  } catch {
    // sem tutorial (já dispensado nesta sessão) — segue o jogo
  }
}

async function gameEnded(p: Page): Promise<boolean> {
  return (await p.locator('.game-over').count()) > 0;
}

/**
 * Joga um turno "guloso": invoca criaturas/artefatos pagáveis e ataca com
 * tudo (respeitando Provocar), depois encerra o turno. Retorna true se a
 * partida terminou no meio do turno.
 */
export async function greedyTurn(p: Page, opts: { watcher?: Page; onReveal?: () => void } = {}): Promise<boolean> {
  // joga cartas sem alvo (criaturas e artefatos)
  for (let k = 0; k < 4; k++) {
    if (await gameEnded(p)) return true;
    const playable = p.locator('.hand .card.playable.card-creature, .hand .card.playable.card-artifact');
    if ((await playable.count()) === 0) break;
    await playable.first().click();
    await p.waitForTimeout(250);
    if (opts.watcher && opts.onReveal) {
      try {
        await opts.watcher.locator('.card-reveal').first().waitFor({ state: 'visible', timeout: 900 });
        opts.onReveal();
      } catch {
        // revelação pode já ter expirado — verificada em outras jogadas
      }
    }
  }

  // ataca com todas as criaturas prontas
  for (let k = 0; k < 6; k++) {
    if (await gameEnded(p)) return true;
    const ready = p.locator('.my-row .creature.ready');
    if ((await ready.count()) === 0) break;
    await ready.first().click();
    await p.waitForTimeout(150);
    const faceBlocked = (await p.locator('.hero-plate.enemy .portrait.blocked').count()) > 0;
    if (faceBlocked) {
      // Provocar em jogo: ataca a criatura desbloqueada (o próprio Golem)
      const target = p.locator('.enemy-row .creature:not(.blocked):not(.ghost)').first();
      if ((await target.count()) > 0) await target.click();
      else await p.keyboard.press('Escape');
    } else {
      await p.locator('.hero-plate.enemy .portrait').click();
    }
    await p.waitForTimeout(250);
  }

  if (await gameEnded(p)) return true;
  const end = p.locator('button.end-turn');
  if ((await end.count()) > 0) await end.click();
  await p.waitForTimeout(400);
  return gameEnded(p);
}

/**
 * Alterna turnos entre as duas páginas até a partida terminar.
 * `onRound` permite capturar momentos específicos da partida real.
 */
export async function playUntilOver(
  a: Page,
  b: Page,
  opts: {
    maxRounds?: number;
    onRound?: (round: number, current: Page) => Promise<void>;
    watcherReveal?: () => void;
  } = {},
): Promise<void> {
  // a muralha de criaturas (dinâmica Yu-Gi-Oh) alonga as partidas
  const maxRounds = opts.maxRounds ?? 40;
  for (let round = 0; round < maxRounds; round++) {
    for (const p of [a, b]) {
      if ((await p.locator('.game-over').count()) > 0) return;
      if ((await p.locator('.turn-pill.mine').count()) === 0) continue;
      if (opts.onRound) await opts.onRound(round, p);
      const over = await greedyTurn(p, {
        watcher: p === a ? b : a,
        onReveal: opts.watcherReveal,
      });
      if (over) return;
    }
  }
  throw new Error(`partida não terminou em ${maxRounds} rodadas`);
}
