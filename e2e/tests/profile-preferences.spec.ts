import { expect, test } from '@playwright/test';
import { guestAs, shotPath } from './helpers.js';

test('perfil centraliza progressão e preferências reativas no desktop', async ({ browser }) => {
  const page = await guestAs(browser, 'Aurelia', 'shield', {
    viewport: { width: 1366, height: 900 },
  });

  await page.getByRole('button', { name: 'Perfil', exact: true }).click();
  await expect(page).toHaveURL(/#profile$/);
  await expect(page.locator('.profile-page')).toBeVisible();
  await expect(page.locator('.profile-page-hero')).toContainText('Aurelia');
  await expect(page.getByRole('heading', { name: 'Sua jornada nas ligas' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: shotPath('12-perfil-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Personalizar identidade' }).click();
  await expect(page.locator('.customize-modal')).toBeVisible();
  await page.locator('.customize-modal').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('.customize-modal')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Preferências' }).click();
  await expect(page.getByRole('heading', { name: 'Áudio' })).toBeVisible();

  const music = page.getByRole('slider', { name: 'Volume de música' });
  await music.fill('0.4');
  await expect(music).toHaveValue('0.4');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lc_vol_music'))).toBe('0.4');

  const motion = page.getByRole('switch', { name: 'Movimento reduzido' });
  await motion.click();
  await expect(motion).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('.profile-preferences')).toHaveCSS('animation-name', 'none');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lc_preferences_v1') ?? '{}'));
  expect(stored).toMatchObject({ reducedMotion: true, haptics: true, battleHints: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shotPath('13-preferencias-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Redefinir preferências' }).click();
  const resetDialog = page.locator('.alert-modal');
  await expect(resetDialog).toContainText('Redefinir preferências?');
  await resetDialog.getByRole('button', { name: 'Redefinir', exact: true }).click();
  await expect(music).toHaveValue('0.22');
  await expect(motion).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduced');

  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page).not.toHaveURL(/#profile$/);
  await page.context().close();
});

test('perfil mantém controles acessíveis e sem overflow no mobile', async ({ browser }) => {
  const page = await guestAs(browser, 'Selene', 'moon', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  await page.getByRole('button', { name: 'Perfil', exact: true }).click();
  await expect(page.locator('.profile-page-hero')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.home-main')).toBeVisible();
  await page.getByRole('button', { name: 'Perfil', exact: true }).click();
  await expect(page.locator('.profile-page-hero')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: shotPath('14-perfil-mobile.png') });

  await page.getByRole('tab', { name: 'Preferências' }).click();
  await expect(page.getByRole('slider', { name: 'Volume de efeitos' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Resposta tátil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redefinir preferências' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: shotPath('15-preferencias-mobile.png'), fullPage: true });

  await page.setViewportSize({ width: 320, height: 700 });
  const compactOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(compactOverflow).toBeLessThanOrEqual(1);
  await page.context().close();
});
