import { expect, test, type Page } from '@playwright/test';
import { loginAs, passMulligan } from './helpers.js';

async function pausedClockLabel(page: Page): Promise<string> {
  const clock = page.locator('.turn-pill.paused');
  await expect(clock).toBeVisible();
  return (await clock.getAttribute('aria-label')) ?? '';
}

test('tutorial inicial preserva o turno e apresenta um cronometro responsivo', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const a = await loginAs(browser, 'Aprendiz', 'shield');
  const b = await loginAs(browser, 'Mentora', 'orb');

  await a.click('button:has-text("Criar sala privada")');
  const code = (await a.locator('.room-code').textContent())!.trim();
  await b.goto(`/room/${code}`);
  await a.click('button:has-text("Iniciar duelo")');
  await passMulligan(a);
  await passMulligan(b);

  await expect(a.locator('.tutorial-pause-status.active')).toContainText('Cronômetro pausado');
  await expect(b.locator('.tutorial-pause-status.active')).toContainText('Tempo de turno preservado');
  const before = await pausedClockLabel(a);
  await a.waitForTimeout(1_400);
  expect(await pausedClockLabel(a)).toBe(before);

  // Um jogador pronto ainda aguarda o tutorial do outro; a pausa e o turno
  // permanecem os mesmos, mas o HUD volta a ficar visivel para ele.
  await a.locator('.tutorial-skip').click();
  await expect(a.locator('.panel.tutorial')).toHaveCount(0);
  await expect(a.locator('.turn-pill.paused')).toBeVisible();
  await expect(a.locator('button.end-turn')).toHaveCount(0);
  await a.screenshot({ path: testInfo.outputPath('timer-paused-desktop.png') });

  await b.setViewportSize({ width: 390, height: 844 });
  await expect(b.locator('.panel.tutorial')).toBeVisible();
  const overflow = await b.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await b.screenshot({ path: testInfo.outputPath('tutorial-paused-mobile.png') });

  await b.locator('.tutorial-skip').click();
  await expect(a.locator('.turn-pill.paused')).toHaveCount(0);
  const owner = (await a.locator('.turn-pill.mine').count()) > 0 ? a : b;
  await expect(owner.locator('button.end-turn')).toBeVisible();
  const resumedBefore = await owner.locator('.turn-pill').getAttribute('aria-label');
  await owner.waitForTimeout(1_250);
  const resumedAfter = await owner.locator('.turn-pill').getAttribute('aria-label');
  expect(resumedAfter).not.toBe(resumedBefore);
  await owner.keyboard.press('Escape');
  await owner.mouse.move(4, 4);
  await expect(owner.locator('.card-inspect')).toHaveCount(0);
  await owner.screenshot({ path: testInfo.outputPath('timer-running.png') });

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.mouse.move(4, 4);
  await expect(owner.locator('.turn-pill')).toBeVisible();
  const runningOverflow = await owner.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(runningOverflow).toBeLessThanOrEqual(1);
  await owner.screenshot({ path: testInfo.outputPath('timer-running-mobile.png') });

  await a.context().close();
  await b.context().close();
});
