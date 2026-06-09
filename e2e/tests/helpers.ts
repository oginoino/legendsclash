import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SHOTS_DIR = resolve(__dirname, '..', 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

export function shotPath(name: string): string {
  return join(SHOTS_DIR, name);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.test`;
}

/** Faz login num contexto novo e espera a home carregar. */
export async function loginAs(
  browser: Browser,
  name: string,
  avatar: string,
): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.fill('input[type=email]', uniqueEmail(name.toLowerCase()));
  await page.fill('input[type=text]', name);
  await page.click(`.avatar-picker button:has-text("${avatar}")`);
  await page.click('button:has-text("Entrar e jogar")');
  await page.waitForSelector('.home-main');
  return page;
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
