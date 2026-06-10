import { expect, test } from '@playwright/test';
import { loginAs, shotPath, uniqueEmail } from './helpers.js';

test.describe('login e onboarding', () => {
  test('login OTP em 3 passos: e-mail → código → perfil → home', async ({ page }) => {
    const email = uniqueEmail('xavier');
    await page.goto('/');
    await expect(page.locator('.login-card')).toBeVisible();
    await page.screenshot({ path: shotPath('01-login.png') });

    // passo 1: e-mail recebe o código
    await page.fill('input[type=email]', email);
    await page.click('button:has-text("Receber código")');
    await expect(page.locator('input[name=code]')).toBeVisible();
    await expect(page.locator('.login-step-info')).toContainText(email);

    // passo 2: código de 6 dígitos (exposto pelo servidor em modo local)
    const { code } = await (
      await page.request.get(`/api/auth/dev-code?email=${encodeURIComponent(email)}`)
    ).json();
    await page.fill('input[name=code]', code);
    await page.screenshot({ path: shotPath('01b-login-codigo.png') });
    await page.click('button:has-text("Entrar")');

    // passo 3: primeiro acesso pede nome e avatar
    await expect(page.locator('input[name=name]')).toBeVisible();
    await page.fill('input[name=name]', 'Xavier');
    await page.click('.avatar-picker button:has-text("🐺")');
    await page.click('button:has-text("Começar a jogar")');

    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.profile-chip')).toContainText('Xavier');
    await expect(page.locator('.profile-chip .league-badge')).toContainText('Bronze');
    await expect(page.locator('button:has-text("Partida ranqueada")')).toBeVisible();
    // progressão visível: barra até a próxima liga (Bronze < Ouro)
    await expect(page.locator('.league-progress')).toBeVisible();
    await page.screenshot({ path: shotPath('02-home.png') });
  });

  test('sessão persiste ao recarregar e relogin não repete o onboarding', async ({ browser }) => {
    const home = await loginAs(browser, 'Tenaz', '🦅');
    await home.reload();
    await expect(home.locator('.home-main')).toBeVisible(); // sessão sobreviveu
    await expect(home.locator('.profile-chip')).toContainText('Tenaz');
    await home.context().close();
  });

  test('modal "Como jogar" explica as regras em uma tela', async ({ browser }) => {
    const home = await loginAs(browser, 'Aline', '🔮');
    await home.click('button:has-text("Como jogar")');
    await expect(home.locator('.rules-modal')).toContainText('Provocar');
    await expect(home.locator('.rules-modal')).toContainText('30 a 0');
    await home.click('button:has-text("Entendi, vamos jogar!")');
    await expect(home.locator('.rules-modal')).toHaveCount(0);
    await home.context().close();
  });
});

test.describe('lobby: sala privada e convite por link', () => {
  test('criar sala, entrar pelo link de convite e conversar com filtro', async ({ browser }) => {
    const host = await loginAs(browser, 'Xavier', '🐺');
    await host.click('button:has-text("Criar sala privada")');
    await expect(host.locator('.room-code')).toBeVisible();
    const code = (await host.locator('.room-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // a alavanca de viralidade: o convidado entra navegando direto pelo link
    const guest = await loginAs(browser, 'Aline', '🔮');
    await guest.goto(`/room/${code}`);
    await expect(guest.locator('.member-list')).toContainText('Xavier');
    await expect(host.locator('.member-list')).toContainText('Aline');

    // chat com filtro de palavras server-side
    await guest.fill('.chat-input input', 'gg, seu idiota');
    await guest.click('.chat-input button');
    const msg = host.locator('.chat-msg .chat-text').last();
    await expect(msg).not.toContainText('idiota');
    await expect(msg).toContainText('***');

    // moderação ao alcance de um clique: silenciar e denunciar
    await expect(host.locator('.chat-actions button[title="Silenciar"]').first()).toBeVisible();
    await host.locator('.chat-actions button[title="Denunciar"]').first().click();
    await host.fill('.report-box input', 'ofensa no chat');
    await host.click('button:has-text("Enviar denúncia")');
    await expect(host.locator('.toast')).toContainText('Denúncia registrada');

    await host.screenshot({ path: shotPath('03-sala-convite.png') });
    await host.context().close();
    await guest.context().close();
  });
});
