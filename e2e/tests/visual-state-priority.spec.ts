import { expect, test } from '@playwright/test';

test('prontidão vence a moldura defensiva e mantém o escudo acima da arte', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => {
    const creature = document.createElement('div');
    creature.className = 'creature mine taunt ready';
    creature.style.transition = 'none';
    creature.innerHTML = `
      <span class="taunt-badge"></span>
      <span class="card-art-frame creature-art"></span>
      <span class="ready-dot"></span>
    `;
    document.body.append(creature);

    const badge = creature.querySelector<HTMLElement>('.taunt-badge')!;
    const art = creature.querySelector<HTMLElement>('.creature-art')!;
    const readyDot = creature.querySelector<HTMLElement>('.ready-dot')!;
    const readyBorder = getComputedStyle(creature).borderTopColor;
    const badgeZ = Number(getComputedStyle(badge).zIndex);
    const artZRaw = getComputedStyle(art).zIndex;
    const artZ = artZRaw === 'auto' ? 0 : Number(artZRaw);
    const readyDotZ = Number(getComputedStyle(readyDot).zIndex);

    creature.classList.add('selected');
    const selectedBorder = getComputedStyle(creature).borderTopColor;
    creature.remove();

    return { readyBorder, selectedBorder, badgeZ, artZ, readyDotZ };
  });

  expect(state.readyBorder).toBe('rgb(63, 185, 80)');
  expect(state.selectedBorder).toBe('rgb(227, 179, 65)');
  expect(state.badgeZ).toBeGreaterThan(state.artZ);
  expect(state.readyDotZ).toBeGreaterThan(state.artZ);
});

test('foco mobile preserva o contexto da arena sob um scrim translúcido', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');

  const surface = await page.evaluate(() => {
    const tray = document.createElement('div');
    tray.className = 'hand-focus-tray';
    document.body.append(tray);
    const style = getComputedStyle(tray);
    const alphas = [...style.backgroundImage.matchAll(/rgba\([^)]*?,\s*([\d.]+)\)/g)]
      .map((match) => Number(match[1]));
    const result = {
      maxAlpha: Math.max(0, ...alphas),
      backdropFilter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
    };
    tray.remove();
    return result;
  });

  expect(surface.maxAlpha).toBeGreaterThan(0.3);
  expect(surface.maxAlpha).toBeLessThan(0.6);
  expect(surface.backdropFilter).toContain('blur(2px)');
  await context.close();
});
