import { expect, test } from '@playwright/test';
import { loginAs, passMulligan, passTutorial, shotPath, surrender } from './helpers.js';

test('ranking apresenta capa e tradição e abre o perfil público personalizado', async ({ browser }) => {
  const aurelia = await loginAs(browser, 'Aurelia', 'orb');
  const brenna = await loginAs(browser, 'Brenna', 'shield');

  await aurelia.getByRole('button', { name: 'Perfil', exact: true }).click();
  await aurelia.getByRole('button', { name: 'Personalizar identidade' }).click();
  const customize = aurelia.locator('.customize-modal');
  await customize.locator('.cz-cover').filter({ hasText: 'Arquivo de Aurélia' }).click();
  await customize.getByRole('tab', { name: 'Tradição' }).click();
  await customize.locator('.cz-tradition').filter({ hasText: 'O Conclave do Éter' }).click();
  await customize.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(aurelia.locator('.profile-page-hero')).toContainText('O Conclave do Éter');
  await aurelia.getByRole('button', { name: 'Voltar' }).click();

  await aurelia.getByRole('button', { name: 'Criar sala privada' }).click();
  const code = (await aurelia.locator('.room-code').textContent())!.trim();
  await brenna.goto(`/room/${code}`);
  await expect(aurelia.locator('.member-list')).toContainText('Brenna');
  await aurelia.getByRole('button', { name: 'Iniciar duelo' }).click();
  await passMulligan(aurelia);
  await passMulligan(brenna);
  await passTutorial(aurelia);
  await passTutorial(brenna);
  await surrender(brenna);
  await expect(aurelia.locator('.game-over')).toContainText('Vitória');
  await expect(brenna.locator('.game-over')).toContainText('Derrota');
  await aurelia.getByRole('button', { name: 'Jogar de novo' }).click();
  await brenna.getByRole('button', { name: 'Jogar de novo' }).click();

  const identity = brenna.getByRole('button', { name: 'Ver perfil de Aurelia' });
  await expect(identity).toContainText('Conclave do Éter');
  await expect(identity).toHaveCSS('background-image', /aurelia-archive\.webp/);
  await identity.click();

  const publicProfile = brenna.locator('.player-profile');
  await expect(publicProfile).toBeVisible();
  await expect(publicProfile).not.toContainText('A Vanguarda da Aurora');
  await expect(publicProfile).toContainText('O Conclave do Éter');
  await expect(publicProfile).toHaveCSS('background-image', /aurelia-archive\.webp/);
  await brenna.screenshot({ path: shotPath('17-ranking-identidade-publica.png') });

  await brenna.setViewportSize({ width: 390, height: 844 });
  await publicProfile.getByRole('button', { name: 'Fechar' }).click();
  expect(await brenna.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await brenna.screenshot({ path: shotPath('18-ranking-identidade-mobile.png'), fullPage: true });

  await aurelia.context().close();
  await brenna.context().close();
});
