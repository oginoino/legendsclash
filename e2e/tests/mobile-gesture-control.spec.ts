import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, passMulligan, passTutorial } from './helpers.js';

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  width: number;
  height: number;
}

async function touchDown(target: Locator, point: Point, pointerId: number): Promise<void> {
  await target.dispatchEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: point.x,
    clientY: point.y,
  });
}

async function touchWindow(page: Page, type: 'pointermove' | 'pointerup', point: Point, pointerId: number): Promise<void> {
  await page.evaluate(({ eventType, x, y, id }) => {
    window.dispatchEvent(new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: eventType === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
    }));
  }, { eventType: type, x: point.x, y: point.y, id: pointerId });
}

async function finishTurn(page: Page): Promise<void> {
  const button = page.locator('button.end-turn');
  if (await button.count() > 0) await button.click();
  await page.waitForTimeout(350);
}

async function pointNearButOutsideTarget(page: Page, box: Box): Promise<Point | null> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const options = [
    { x: box.x + box.width + 20, y: box.y + box.height / 2 },
    { x: box.x - 20, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height + 20 },
    { x: box.x + box.width / 2, y: box.y - 20 },
  ].filter((point) => (
    point.x >= 2 && point.x <= viewport.width - 2
    && point.y >= 2 && point.y <= viewport.height - 2
  ));

  for (const point of options) {
    const anchor = await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest('[data-anchor]')?.getAttribute('data-anchor') ?? null
    ), point);
    if (!anchor) return point;
  }
  return null;
}

async function playableCreatureOnPhone(phone: Page, desk: Page): Promise<Locator> {
  for (let round = 0; round < 18; round++) {
    if (await phone.locator('.turn-pill.mine').count() > 0) {
      const creature = phone.locator('.hand .card.playable.card-creature').first();
      if (await creature.count() > 0) return creature;
      await finishTurn(phone);
    } else {
      await finishTurn(desk);
    }
  }
  throw new Error('Nenhuma criatura jogável apareceu para o telefone');
}

test('toque separa rolagem, arrasto, snap e cancelamento', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const phone = await loginAs(browser, 'Gestora', 'orb', PHONE);
  const desk = await loginAs(browser, 'Contraponto', 'shield');

  await desk.click('button:has-text("Criar sala privada")');
  const code = (await desk.locator('.room-code').textContent())!.trim();
  await phone.goto(`/room/${code}`);
  await desk.click('button:has-text("Iniciar duelo")');
  await passMulligan(phone);
  await passMulligan(desk);
  await passTutorial(phone);
  await passTutorial(desk);

  const creature = await playableCreatureOnPhone(phone, desk);
  await creature.scrollIntoViewIfNeeded();
  const cardBox = await creature.boundingBox();
  const rowBox = await phone.locator('.my-row').boundingBox();
  if (!cardBox || !rowBox) throw new Error('Carta ou mesa fora da viewport mobile');
  const origin = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 };
  const handBefore = await phone.locator('.hand .card').count();
  const boardBefore = await phone.locator('.my-row .creature').count();

  // Pan lateral deliberado continua pertencendo ao scroll da mão.
  await touchDown(creature, origin, 71);
  await touchWindow(phone, 'pointermove', { x: origin.x + 44, y: origin.y + 3 }, 71);
  await expect(phone.locator('.drag-card-layer')).toHaveCount(0);
  await touchWindow(phone, 'pointerup', { x: origin.x + 44, y: origin.y + 3 }, 71);
  await expect(phone.locator('.hand .card')).toHaveCount(handBefore);
  await expect(phone.locator('.my-row .creature')).toHaveCount(boardBefore);
  await expect(phone.locator('.hand-focus-tray')).toHaveCount(0);

  // Perder o foco cancela uma intenção vertical já ativa sem deixar overlay.
  await touchDown(creature, origin, 72);
  await touchWindow(phone, 'pointermove', { x: origin.x, y: origin.y - 28 }, 72);
  await expect(phone.locator('.drag-card-layer.input-touch')).toBeVisible();
  await phone.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(phone.locator('.drag-card-layer')).toHaveCount(0);
  await expect(phone.locator('.hand .card')).toHaveCount(handBefore);

  // A área de soltura aceita alguns pixels além da moldura, mas só depois de
  // um arrasto vertical claro e suficientemente longo.
  const nearTable = {
    x: Math.max(2, rowBox.x - 14),
    y: rowBox.y + rowBox.height / 2,
  };
  await touchDown(creature, origin, 73);
  await touchWindow(phone, 'pointermove', { x: origin.x, y: origin.y - 28 }, 73);
  await touchWindow(phone, 'pointermove', nearTable, 73);
  const tableDrag = phone.locator('.drag-card-layer.input-touch.valid');
  await expect(tableDrag).toBeVisible();
  await expect(phone.locator('.my-row.card-drop-zone.ready')).toBeVisible();
  const dragBox = await tableDrag.boundingBox();
  expect(dragBox?.x ?? -1, 'a carta arrastada permanece visível na borda esquerda').toBeGreaterThanOrEqual(2);
  expect((dragBox?.x ?? 390) + (dragBox?.width ?? 0), 'a carta arrastada cabe na viewport').toBeLessThanOrEqual(388);
  await phone.screenshot({ path: testInfo.outputPath('mobile-touch-table-snap.png') });
  await touchWindow(phone, 'pointerup', nearTable, 73);
  await expect(phone.locator('.my-row .creature')).toHaveCount(boardBefore + 1);
  await expect(phone.locator('.hand .card')).toHaveCount(handBefore - 1);

  let effectApplied = false;
  let pointerId = 80;
  for (let round = 0; round < 18 && !effectApplied; round++) {
    if (await phone.locator('.turn-pill.mine').count() === 0) {
      const deskCreature = desk.locator('.hand .card.playable.card-creature').first();
      if (await deskCreature.count() > 0) await deskCreature.click();
      await finishTurn(desk);
      continue;
    }

    const candidates = phone.locator(
      '.hand .card.playable:has(.card-status-target), .hand .card.playable:has(.card-status-support)',
    );
    for (let i = 0; i < await candidates.count() && !effectApplied; i++) {
      const card = candidates.nth(i);
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (!box) continue;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const id = pointerId++;
      await touchDown(card, start, id);
      await touchWindow(phone, 'pointermove', { x: start.x, y: start.y - 28 }, id);
      await expect(phone.locator('.drag-card-layer.input-touch')).toBeVisible();

      const markers = phone.locator('.drop-target-marker');
      let target: Locator | null = null;
      for (let markerIndex = 0; markerIndex < await markers.count(); markerIndex++) {
        const marker = markers.nth(markerIndex);
        const anchor = await marker.evaluate((el) => el.parentElement?.getAttribute('data-anchor'));
        if (!anchor) continue;
        const candidate = phone.locator(`[data-anchor="${anchor}"]`);
        const targetBox = await candidate.boundingBox();
        if (targetBox && targetBox.y < 844 && targetBox.y + targetBox.height > 0) {
          target = candidate;
          break;
        }
      }

      if (!target) {
        await touchWindow(phone, 'pointerup', { x: start.x, y: start.y - 28 }, id);
        continue;
      }

      const targetBox = await target.boundingBox();
      if (!targetBox) {
        await touchWindow(phone, 'pointerup', { x: start.x, y: start.y - 28 }, id);
        continue;
      }
      const nearTarget = await pointNearButOutsideTarget(phone, targetBox);
      if (!nearTarget) {
        await touchWindow(phone, 'pointerup', { x: start.x, y: start.y - 28 }, id);
        continue;
      }
      const cardAnchor = await card.getAttribute('data-anchor');
      if (!cardAnchor) throw new Error('Carta de efeito sem data-anchor');
      await touchWindow(phone, 'pointermove', nearTarget, id);
      await expect(phone.locator('.drag-card-layer.input-touch.valid.magnetized')).toBeVisible();
      await expect(phone.locator('.drop-target-marker.active')).toBeVisible();
      await phone.screenshot({ path: testInfo.outputPath('mobile-touch-target-snap.png') });
      await touchWindow(phone, 'pointerup', nearTarget, id);
      await expect(phone.locator(`[data-anchor="${cardAnchor}"]`)).toHaveCount(0);
      effectApplied = true;
    }

    if (!effectApplied) await finishTurn(phone);
  }
  expect(effectApplied, 'uma carta de efeito deveria usar o snap de alvo no toque').toBe(true);

  await phone.context().close();
  await desk.context().close();
});
