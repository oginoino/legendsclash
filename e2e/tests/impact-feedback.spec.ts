import { expect, test, type Page } from '@playwright/test';
import { loginAs, passMulligan, passTutorial } from './helpers.js';

async function expectRecapInsideHero(page: Page): Promise<void> {
  const hero = page.locator('.hero-plate:not(.enemy)');
  const recap = hero.locator('.hero-impact-recap');
  await expect(recap).toBeVisible();
  await expect(recap).not.toContainText('Ação inimiga');
  await expect(recap.locator('.impact-source-art')).toBeVisible();
  await expect(recap.locator('.impact-resolution.commander')).toBeVisible();
  await expect(recap.locator('.impact-step.incoming')).toBeVisible();
  await expect(recap.locator('.impact-step.hp')).toBeVisible();

  const [heroBox, recapBox] = await Promise.all([hero.boundingBox(), recap.boundingBox()]);
  expect(heroBox).not.toBeNull();
  expect(recapBox).not.toBeNull();
  expect(recapBox!.x).toBeGreaterThanOrEqual(heroBox!.x);
  expect(recapBox!.y).toBeGreaterThanOrEqual(heroBox!.y);
  expect(recapBox!.x + recapBox!.width).toBeLessThanOrEqual(heroBox!.x + heroBox!.width + 1);
  expect(recapBox!.y + recapBox!.height).toBeLessThanOrEqual(heroBox!.y + heroBox!.height + 1);
}

test('feedback de impacto liga origem e resultado sem cobrir a arena', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const a = await loginAs(browser, 'Impacto', '🐉');
  const b = await loginAs(browser, 'Defesa', '🛡️');

  await a.click('button:has-text("Criar sala privada")');
  const code = (await a.locator('.room-code').textContent())!.trim();
  await b.goto(`/room/${code}`);
  await a.click('button:has-text("Iniciar duelo")');
  await passMulligan(a);
  await passMulligan(b);
  await passTutorial(a);
  await passTutorial(b);

  // B mantém a mesa vazia. A prepara uma criatura e, no turno seguinte,
  // consegue atacar o comandante sem bloqueio — cenário determinístico para
  // validar a resolução "impacto → escudo → vida".
  let attacked = false;
  for (let round = 0; round < 20 && !attacked; round++) {
    if ((await a.locator('.turn-pill.mine').count()) > 0) {
      const ready = a.locator('.my-row .creature.ready');
      if ((await ready.count()) > 0) {
        await ready.first().click();
        await a.locator('.hero-plate.enemy .portrait').click();
        attacked = true;
        break;
      }
      if ((await a.locator('.my-row .creature').count()) === 0) {
        const creature = a.locator('.hand .card.playable.card-creature').first();
        if ((await creature.count()) > 0) await creature.click();
      }
      await a.locator('button.end-turn').click();
      await a.waitForTimeout(350);
    }
    if ((await b.locator('.turn-pill.mine').count()) > 0) {
      await b.locator('button.end-turn').click();
      await b.waitForTimeout(350);
    }
  }

  expect(attacked, 'a criatura preparada deveria atacar o comandante').toBe(true);
  await expect(b.locator('.enemy-row .creature.impact-source')).toBeVisible();
  await expectRecapInsideHero(b);
  await b.screenshot({ path: testInfo.outputPath('impact-desktop.png') });

  await b.setViewportSize({ width: 390, height: 844 });
  await expectRecapInsideHero(b);
  const overflow = await b.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await b.screenshot({ path: testInfo.outputPath('impact-mobile.png') });

  await a.context().close();
  await b.context().close();
});
