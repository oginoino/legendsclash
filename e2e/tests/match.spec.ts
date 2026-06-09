import { expect, test, type Page } from '@playwright/test';
import { greedyTurn, loginAs, playUntilOver, shotPath } from './helpers.js';

test.describe('partida real: matchmaking → duelo → fim de jogo', () => {
  test('dois jogadores se enfrentam do início ao fim', async ({ browser }) => {
    test.setTimeout(240_000);
    const xavier = await loginAs(browser, 'Xavier', '🐺');
    const aline = await loginAs(browser, 'Aline', '🔮');

    // matchmaking por MMR pareia os dois recém-chegados (1000 vs 1000)
    await xavier.click('button:has-text("Partida ranqueada")');
    await expect(xavier.locator('.queue-status')).toBeVisible();
    await aline.click('button:has-text("Partida ranqueada")');
    await expect(xavier.locator('.game-board')).toBeVisible({ timeout: 15_000 });
    await expect(aline.locator('.game-board')).toBeVisible({ timeout: 15_000 });

    // estado inicial autoritativo: 30 de vida, mãos de 5, energia 1
    await expect(xavier.locator('.hero-plate:not(.enemy) .hp-orb')).toHaveText('30');
    await expect(xavier.locator('.hand .card')).toHaveCount(5);
    await expect(aline.locator('.hand .card')).toHaveCount(5);
    await xavier.screenshot({ path: shotPath('04-inicio-partida.png') });

    // momentos da partida real para capturar
    let aimShot = false;
    let sawReveal = false;

    await playUntilOver(xavier, aline, {
      watcherReveal: () => { sawReveal = true; },
      onRound: async (round, current) => {
        if (round < 3 || aimShot || current !== xavier) return;
        const ready = current.locator('.my-row .creature.ready');
        if ((await ready.count()) === 0) return;

        // interação de mira: seleciona atacante e paira sobre um alvo
        await ready.first().click();
        if ((await current.locator('.my-row .creature.selected').count()) === 0) {
          await current.keyboard.press('Escape');
          return; // seleção não registrou nesta rodada — tenta na próxima
        }
        const target = current.locator('.enemy-row .creature:not(.blocked):not(.ghost)').first();
        const box = (await target.count())
          ? await target.boundingBox()
          : await current.locator('.hero-plate.enemy .portrait').boundingBox();
        if (box) {
          await current.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
          await current.waitForTimeout(300);
          await expect(current.locator('.aim-arrow')).toBeVisible();
          await expect(current.locator('.preview-chip').first()).toBeVisible();
          await current.screenshot({ path: shotPath('05-mira-e-previa.png') });
          aimShot = true;
        }
        await current.keyboard.press('Escape');
      },
    });

    // captura o tabuleiro final ainda com o overlay de resultado
    await xavier.screenshot({ path: shotPath('06-fim-de-jogo.png') });

    // a interação de mira e a revelação de jogadas aconteceram na partida
    expect(aimShot, 'a prévia de mira deveria ter sido exibida').toBe(true);
    expect(sawReveal, 'a revelação de jogada do oponente deveria ter aparecido').toBe(true);

    // fim de jogo: um venceu, outro perdeu, Elo aplicado nos dois lados
    const xOver = xavier.locator('.game-over');
    const aOver = aline.locator('.game-over');
    await expect(xOver).toBeVisible();
    await expect(aOver).toBeVisible();
    const results = [await xOver.textContent(), await aOver.textContent()];
    expect(results.filter((t) => t!.includes('Vitória')).length).toBe(1);
    expect(results.filter((t) => t!.includes('Derrota')).length).toBe(1);
    await expect(xOver.locator('.mmr-change')).toContainText('MMR');

    // de volta à home: histórico e ranking refletem a partida
    await xavier.click('button:has-text("Jogar de novo")');
    await expect(xavier.locator('.history-list li').first()).toContainText(/Vitória|Derrota/);
    await expect(xavier.locator('.board-table')).toContainText('Xavier');
    await xavier.screenshot({ path: shotPath('07-pos-partida.png') });

    await xavier.context().close();
    await aline.context().close();
  });
});

test.describe('resiliência: reconexão no meio da partida', () => {
  test('recarregar a página retoma a partida (janela anti-abandono)', async ({ browser }) => {
    test.setTimeout(180_000);
    const host = await loginAs(browser, 'Xavier', '🐺');
    const guest = await loginAs(browser, 'Aline', '🔮');

    // partida via sala privada (caminho do convite)
    await host.click('button:has-text("Criar sala privada")');
    const code = (await host.locator('.room-code').textContent())!.trim();
    await guest.goto(`/room/${code}`);
    await expect(host.locator('.member-list')).toContainText('Aline');
    await host.click('button:has-text("Iniciar duelo")');
    await expect(host.locator('.game-board')).toBeVisible({ timeout: 10_000 });
    await expect(guest.locator('.game-board')).toBeVisible({ timeout: 10_000 });

    // joga um turno para a partida ter estado real
    const current = (await host.locator('.turn-pill.mine').count()) ? host : guest;
    await greedyTurn(current);

    // o convidado cai e volta: o estado autoritativo é restaurado
    await guest.reload();
    await expect(guest.locator('.game-board')).toBeVisible({ timeout: 10_000 });
    await expect(guest.locator('.hero-plate:not(.enemy) .hp-orb')).toBeVisible();

    // desistência encerra com confirmação (dialog aceito pelo helper)
    await guest.click('button:has-text("Desistir")');
    await expect(guest.locator('.game-over')).toContainText('Derrota');
    await expect(host.locator('.game-over')).toContainText('Vitória');

    await host.context().close();
    await guest.context().close();
  });
});

/** A página segue utilizável depois da partida (sem estado preso). */
test.describe('fluxo pós-partida', () => {
  test('"Jogar de novo" limpa o estado e permite nova fila', async ({ browser }) => {
    test.setTimeout(180_000);
    const a = await loginAs(browser, 'Xavier', '🐺');
    const b = await loginAs(browser, 'Aline', '🔮');

    await a.click('button:has-text("Criar sala privada")');
    const code = (await a.locator('.room-code').textContent())!.trim();
    await b.goto(`/room/${code}`);
    await a.click('button:has-text("Iniciar duelo")');
    await expect(a.locator('.game-board')).toBeVisible({ timeout: 10_000 });

    await a.click('button:has-text("Desistir")');
    await expect(a.locator('.game-over')).toBeVisible();
    await a.click('button:has-text("Jogar de novo")');
    await expect(a.locator('.home-main')).toBeVisible();
    await expect(a.locator('button:has-text("Partida ranqueada")')).toBeEnabled();

    await a.context().close();
    await b.context().close();
  });
});
