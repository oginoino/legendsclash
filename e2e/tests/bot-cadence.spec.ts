import { expect, test } from '@playwright/test';
import { guestAs, passMulligan, passTutorial, shotPath } from './helpers.js';

test('Treinador IA delibera, revela cartas e sinaliza cada ataque', async ({ browser }) => {
  test.setTimeout(120_000);
  const player = await guestAs(browser, 'Cadencia', 'shield', {
    viewport: { width: 1280, height: 860 },
  });

  await player.getByRole('button', { name: /Treino/ }).click();
  await passMulligan(player);
  await passTutorial(player);
  await expect(player.locator('.game-board')).toBeVisible();

  const endTurn = player.getByRole('button', { name: /Encerrar turno/ });
  await endTurn.click();
  const botCoach = player.locator('.turn-coach.bot');
  await expect(botCoach).toContainText('Treinador avaliando a mesa');

  // A primeira ação não acontece no mesmo frame em que o humano encerra a vez.
  await player.waitForTimeout(550);
  await expect(player.locator('.card-reveal')).toHaveCount(0);

  await expect(player.locator('.card-reveal').first()).toBeVisible({ timeout: 3_000 });
  await expect(botCoach).toBeVisible();
  await expect(endTurn).toBeVisible({ timeout: 20_000 });

  // Encontra uma mesa da IA. Em mãos muito caras, os turnos seguintes aumentam
  // a energia até que uma criatura seja invocada.
  const enemyCreatures = player.locator('.enemy-row .creature:not(.ghost)');
  for (let turn = 0; turn < 5 && await enemyCreatures.count() === 0; turn++) {
    await endTurn.click();
    await expect(botCoach).toBeVisible();
    await expect(endTurn).toBeVisible({ timeout: 25_000 });
  }
  expect(await enemyCreatures.count()).toBeGreaterThan(0);

  // Criaturas que já estavam em campo ficam prontas no próximo turno da IA.
  // A ação estruturada deve mover a origem para baixo, em direção ao humano.
  await player.evaluate(() => {
    const trackedWindow = window as typeof window & { __enemyLungeSeen?: boolean };
    trackedWindow.__enemyLungeSeen = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('.enemy-row .creature.lunging')) {
        trackedWindow.__enemyLungeSeen = true;
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await endTurn.click();
  await expect(botCoach).toBeVisible();
  await expect.poll(() => player.evaluate(() => (
    window as typeof window & { __enemyLungeSeen?: boolean }
  ).__enemyLungeSeen), { timeout: 25_000 }).toBe(true);
  await player.screenshot({ path: shotPath('17-treino-ia-cadencia.png') });

  await player.context().close();
});
