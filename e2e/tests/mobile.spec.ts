import { expect, test, type Page } from '@playwright/test';
import { loginAs, passMulligan, passTutorial, shotPath } from './helpers.js';

/**
 * Experiência mobile: login a 390px, partida por toque (tap-tap), gaveta de
 * log/chat com badge de não lidas e ausência de overflow horizontal.
 * O contexto usa hasTouch + viewport de iPhone; o oponente joga no desktop.
 */

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function noHorizontalScroll(p: Page): Promise<void> {
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'página não deve ter rolagem horizontal').toBeLessThanOrEqual(1);
}

test.describe('mobile: login, partida por toque e gaveta', () => {
  test('fluxo completo num viewport de celular', async ({ browser }) => {
    test.setTimeout(180_000);

    // login nos 3 passos com teclado/touch de celular
    const phone = await loginAs(browser, 'Mobi', '🐉', PHONE);
    await noHorizontalScroll(phone);
    await phone.screenshot({ path: shotPath('08-mobile-home.png') });

    // desktop cria a sala; o celular entra pelo link de convite
    const desk = await loginAs(browser, 'Aline', '🔮');
    await desk.click('button:has-text("Criar sala privada")');
    const code = (await desk.locator('.room-code').textContent())!.trim();
    await phone.goto(`/room/${code}`);
    await expect(phone.locator('.member-list')).toContainText('Aline');
    await noHorizontalScroll(phone);

    await desk.click('button:has-text("Iniciar duelo")');
    // fase de mulligan: ambos confirmam a mão antes do tabuleiro
    await passMulligan(phone);
    await passMulligan(desk);
    await passTutorial(phone);
    await passTutorial(desk);
    await expect(phone.locator('.game-board')).toBeVisible({ timeout: 10_000 });
    await expect(desk.locator('.game-board')).toBeVisible({ timeout: 10_000 });

    // chrome mobile: topbar visível, gaveta fechada, sem overflow
    await expect(phone.locator('.mobile-topbar')).toBeVisible();
    await noHorizontalScroll(phone);

    // badge de não lidas: desktop manda mensagem com a gaveta fechada
    await desk.fill('.chat-input input', 'boa sorte!');
    await desk.click('.chat-input button');
    await expect(phone.locator('.unread-badge')).toHaveText('1');
    await phone.tap('.mobile-topbar button[title="Chat"]');
    await expect(phone.locator('.game-side')).toHaveClass(/open pane-chat/);
    await expect(phone.locator('.chat-msg')).toContainText('boa sorte');
    await expect(phone.locator('.unread-badge')).toHaveCount(0); // lidas
    await phone.tap('.drawer-close');
    await expect(phone.locator('.game-side')).not.toHaveClass(/open/);

    // joga por TOQUE até ter uma criatura pronta para atacar
    let attacked = false;
    for (let round = 0; round < 20 && !attacked; round++) {
      const mine = phone.locator('.turn-pill.mine');
      if ((await mine.count()) === 0) {
        // turno do desktop: passa a vez rapidinho
        if ((await desk.locator('.turn-pill.mine').count()) > 0) {
          const end = desk.locator('button.end-turn');
          if ((await end.count()) > 0) await end.click();
        }
        await phone.waitForTimeout(700);
        continue;
      }

      // tap em carta de criatura jogável (sem alvo) invoca na mesa
      const playable = phone.locator('.hand .card.playable.card-creature');
      if ((await playable.count()) > 0) {
        const before = await phone.locator('.my-row .creature').count();
        await playable.first().tap();
        await expect(phone.locator('.my-row .creature')).toHaveCount(before + 1);
      }

      // tap-tap: seleciona atacante → prévia estática + cancelar visíveis
      const ready = phone.locator('.my-row .creature.ready');
      if ((await ready.count()) > 0) {
        await ready.first().tap();
        await expect(phone.locator('.my-row .creature.selected')).toBeVisible();
        await expect(phone.locator('.cancel-pill')).toBeVisible();
        // prévia de dano sem hover: chip estático no alvo válido (a face)
        await expect(phone.locator('.preview-chip').first()).toBeVisible();
        await phone.screenshot({ path: shotPath('09-mobile-mira.png') });

        // tap em área vazia da arena cancela a seleção
        await phone.tap('.enemy-row');
        await expect(phone.locator('.my-row .creature.selected')).toHaveCount(0);

        // tap-tap de verdade: seleciona e ataca a face (mesa inimiga vazia)
        await ready.first().tap();
        const face = phone.locator('.hero-plate.enemy .portrait');
        const blocked = (await phone.locator('.hero-plate.enemy .portrait.blocked').count()) > 0;
        const target = blocked
          ? phone.locator('.enemy-row .creature:not(.blocked):not(.ghost)').first()
          : face;
        await target.tap();
        await expect(phone.locator('.my-row .creature.ready')).toHaveCount(0);
        attacked = true;
        break;
      }

      // encerra o turno pelo botão (alcançável) e espera a vez voltar
      const end = phone.locator('button.end-turn');
      if ((await end.count()) > 0) await end.tap();
      await phone.waitForTimeout(700);
    }
    expect(attacked, 'o ataque por tap-tap deveria ter acontecido').toBe(true);

    // fim de partida legível no celular
    await desk.click('button:has-text("Desistir")');
    await expect(phone.locator('.game-over')).toContainText('Vitória');
    await phone.screenshot({ path: shotPath('10-mobile-fim.png') });

    await phone.context().close();
    await desk.context().close();
  });
});

test.describe('gestos: arrastar para mirar (pointer events)', () => {
  test('arrasto mostra seta + prévia e executa o ataque ao soltar', async ({ browser }) => {
    test.setTimeout(180_000);
    const a = await loginAs(browser, 'Arrasta', '🏹');
    const b = await loginAs(browser, 'Alvo', '🌙');

    await a.click('button:has-text("Criar sala privada")');
    const code = (await a.locator('.room-code').textContent())!.trim();
    await b.goto(`/room/${code}`);
    await a.click('button:has-text("Iniciar duelo")');
    // fase de mulligan: ambos confirmam a mão antes do tabuleiro
    await passMulligan(a);
    await passMulligan(b);
    await passTutorial(a);
    await passTutorial(b);
    await expect(a.locator('.game-board')).toBeVisible({ timeout: 10_000 });

    // joga até A ter uma criatura pronta no seu turno
    let dragged = false;
    for (let round = 0; round < 20 && !dragged; round++) {
      const current = (await a.locator('.turn-pill.mine').count()) > 0 ? a : b;
      if (current === b) {
        const end = b.locator('button.end-turn');
        if ((await end.count()) > 0) await end.click();
        await a.waitForTimeout(700);
        continue;
      }

      const playable = a.locator('.hand .card.playable.card-creature');
      if ((await playable.count()) > 0) {
        // espera o estado autoritativo voltar: o tabuleiro re-centraliza e as
        // posições mudam — só então vale capturar boundingBox para o arrasto
        const before = await a.locator('.my-row .creature').count();
        await playable.first().click();
        await expect(a.locator('.my-row .creature')).toHaveCount(before + 1);
      }

      const ready = a.locator('.my-row .creature.ready');
      if ((await ready.count()) === 0) {
        const end = a.locator('button.end-turn');
        if ((await end.count()) > 0) await end.click();
        await a.waitForTimeout(700);
        continue;
      }

      // arrasto: pressiona na criatura, move até o alvo, observa seta+prévia
      const from = (await ready.first().boundingBox())!;
      const blocked = (await a.locator('.hero-plate.enemy .portrait.blocked').count()) > 0;
      const targetLoc = blocked
        ? a.locator('.enemy-row .creature:not(.blocked):not(.ghost)').first()
        : a.locator('.hero-plate.enemy .portrait');
      const to = (await targetLoc.boundingBox())!;

      await a.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await a.mouse.down();
      await a.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await expect(a.locator('.aim-arrow')).toBeVisible();
      await expect(a.locator('.preview-chip').first()).toBeVisible();
      await a.screenshot({ path: shotPath('11-arrasto-mira.png') });
      await a.mouse.up();

      // soltou no alvo: o ataque saiu (criatura deixa de estar pronta)
      await expect(a.locator('.my-row .creature.ready')).toHaveCount(0);
      await expect(a.locator('.aim-arrow')).toHaveCount(0);
      dragged = true;
    }
    expect(dragged, 'o ataque por arrasto deveria ter acontecido').toBe(true);

    // arrasto solto no vazio cancela em vez de agir
    await a.context().close();
    await b.context().close();
  });
});
