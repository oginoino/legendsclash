import { expect, test, type Page } from '@playwright/test';
import { loginAs, passMulligan, passTutorial } from './helpers.js';

async function turnOwner(a: Page, b: Page): Promise<Page> {
  await expect.poll(async () => (
    await a.locator('.turn-pill.mine').count() > 0
    || await b.locator('.turn-pill.mine').count() > 0
  )).toBe(true);
  return await a.locator('.turn-pill.mine').count() > 0 ? a : b;
}

async function summonByDrag(page: Page, screenshotPath?: string): Promise<boolean> {
  const card = page.locator('.hand .card.playable.card-creature').first();
  if (await card.count() === 0) return false;
  const from = await card.boundingBox();
  const row = await page.locator('.my-row').boundingBox();
  if (!from || !row) return false;
  const before = await page.locator('.my-row .creature').count();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 12 });

  const floating = page.locator('.drag-card-layer.valid');
  await expect(floating).toBeVisible();
  await expect(page.locator('.my-row.card-drop-zone.ready')).toBeVisible();
  await expect(page.locator('.hand .card.drag-origin')).toBeVisible();
  const layer = await floating.evaluate((el) => {
    const style = getComputedStyle(el);
    return { position: style.position, zIndex: Number(style.zIndex) };
  });
  expect(layer.position).toBe('fixed');
  expect(layer.zIndex).toBeGreaterThan(60);
  if (screenshotPath) await page.screenshot({ path: screenshotPath });

  await page.mouse.up();
  await expect(page.locator('.my-row .creature')).toHaveCount(before + 1);
  await expect(page.locator('.drag-card-layer')).toHaveCount(0);
  return true;
}

test('carta arrastada fica acima da arena e revela destinos validos', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const a = await loginAs(browser, 'Condutora', 'orb');
  const b = await loginAs(browser, 'Destino', 'shield');

  await a.click('button:has-text("Criar sala privada")');
  const code = (await a.locator('.room-code').textContent())!.trim();
  await b.goto(`/room/${code}`);
  await a.click('button:has-text("Iniciar duelo")');
  await passMulligan(a);
  await passMulligan(b);
  await passTutorial(a);
  await passTutorial(b);

  let summoned = false;
  for (let round = 0; round < 12 && !summoned; round++) {
    const current = await turnOwner(a, b);
    summoned = await summonByDrag(
      current,
      testInfo.outputPath('drag-creature-desktop.png'),
    );
    if (!summoned) {
      await current.locator('button.end-turn').click();
      await current.waitForTimeout(350);
    }
  }
  expect(summoned, 'deveria haver uma criatura jogavel para validar a invocacao').toBe(true);

  await Promise.all([
    a.setViewportSize({ width: 390, height: 844 }),
    b.setViewportSize({ width: 390, height: 844 }),
  ]);

  let targeted = false;
  for (let round = 0; round < 16 && !targeted; round++) {
    const current = await turnOwner(a, b);
    const candidates = current.locator(
      '.hand .card.playable:has(.card-status-target), .hand .card.playable:has(.card-status-support)',
    );

    for (let i = 0; i < await candidates.count() && !targeted; i++) {
      const card = candidates.nth(i);
      await card.scrollIntoViewIfNeeded();
      const from = await card.boundingBox();
      if (!from) continue;

      await current.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await current.mouse.down();
      await current.mouse.move(from.x + from.width / 2, Math.max(60, from.y - 80), { steps: 10 });
      await expect(current.locator('.drag-card-layer')).toBeVisible();

      const marker = current.locator('.drop-target-marker').first();
      if (await marker.count() === 0) {
        await current.mouse.up();
        await expect(current.locator('.drag-card-layer')).toHaveCount(0);
        continue;
      }

      const anchor = await marker.evaluate((el) => el.parentElement?.getAttribute('data-anchor'));
      const target = anchor ? current.locator(`[data-anchor="${anchor}"]`) : marker;
      const to = await target.boundingBox();
      if (!to) {
        await current.mouse.up();
        continue;
      }
      await current.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await expect(current.locator('.drag-card-layer.valid')).toBeVisible();
      await expect(current.locator('.drop-target-marker.active')).toBeVisible();

      const overflow = await current.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await current.screenshot({ path: testInfo.outputPath('drag-effect-mobile.png') });
      await current.mouse.up();
      targeted = true;
    }

    if (!targeted) {
      // Coloca presenca dos dois lados para abrir alvos de suporte e dano.
      if (await current.locator('.my-row .creature').count() === 0) await summonByDrag(current);
      const end = current.locator('button.end-turn');
      if (await end.count() > 0) await end.click();
      await current.waitForTimeout(350);
    }
  }
  expect(targeted, 'deveria haver uma carta com ao menos um destino valido').toBe(true);

  await a.context().close();
  await b.context().close();
});
