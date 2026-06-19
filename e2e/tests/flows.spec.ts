import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, avatarButton, guestAs, loginAs, shotPath, uniqueEmail } from './helpers.js';

test.describe('entrada: convidado e conta', () => {
  test('convidado: nome + avatar → home, com convites para criar conta', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.login-card')).toBeVisible();
    await page.screenshot({ path: shotPath('01-login.png') });

    // jogar é imediato: nome, avatar e pronto
    await page.fill('input[name=name]', 'Xavier');
    await page.click(avatarButton('🐺'));
    await page.click('button:has-text("Jogar agora")');

    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.profile-chip')).toContainText('Xavier');
    await expect(page.locator('.profile-chip .guest-badge')).toContainText('convidado');
    await expect(page.locator('button:has-text("Partida ranqueada")')).toBeVisible();
    // os benefícios de conta ficam visíveis, não escondidos
    await expect(page.locator('.account-cta')).toHaveCount(2); // ranking + histórico
    await page.screenshot({ path: shotPath('02-home.png') });
  });

  test('conta: criar → perfil → home; senha errada e duplicata têm erro claro', async ({ page }) => {
    const email = uniqueEmail('lenda');
    await page.goto('/');
    await page.click('button:has-text("Entrar ou criar conta")');
    await page.click('button:has-text("Criar conta nova")');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.screenshot({ path: shotPath('01b-criar-conta.png') });
    await page.click('button:has-text("Criar conta")');

    // primeiro acesso pede nome e avatar
    await expect(page.locator('input[name=name]')).toBeVisible();
    await page.fill('input[name=name]', 'Lenda');
    await page.click(avatarButton('🦅'));
    await page.click('button:has-text("Começar a jogar")');

    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.profile-chip')).toContainText('Lenda');
    await expect(page.locator('.profile-chip .guest-badge')).toHaveCount(0); // conta, não convidado
    await expect(page.locator('.profile-chip .league-badge')).toContainText('Bronze');
    // progressão visível: barra até a próxima liga (Bronze < Ouro)
    await expect(page.locator('.league-progress')).toBeVisible();

    // sair e errar a senha → mensagem clara, sem vazar se a conta existe
    await page.click('button:has-text("Sair")');
    await page.click('button:has-text("Entrar ou criar conta")');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'senha-errada-123');
    await page.click('form button:has-text("Entrar")');
    await expect(page.locator('.form-error')).toContainText('E-mail ou senha incorretos');

    // registrar o mesmo e-mail de novo → conflito honesto
    await page.click('button:has-text("Criar conta nova")');
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.click('button:has-text("Criar conta")');
    await expect(page.locator('.form-error')).toContainText('já tem uma conta');

    // com a senha certa, entra sem repetir o onboarding
    await page.click('button:has-text("Já tenho conta")');
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.click('form button:has-text("Entrar")');
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.profile-chip')).toContainText('Lenda');
  });

  test('recuperar senha: link mágico redefine a senha e entra direto', async ({ page }) => {
    const email = uniqueEmail('recupera');
    const NEW_PW = 'senha-nova-98765';

    // cria a conta e completa o perfil
    await page.goto('/');
    await page.click('button:has-text("Entrar ou criar conta")');
    await page.click('button:has-text("Criar conta nova")');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.click('button:has-text("Criar conta")');
    await page.fill('input[name=name]', 'Esquecida');
    await page.click(avatarButton('🐺'));
    await page.click('button:has-text("Começar a jogar")');
    await expect(page.locator('.home-main')).toBeVisible();

    // sai e pede a redefinição
    await page.click('button:has-text("Sair")');
    await page.click('button:has-text("Entrar ou criar conta")');
    await page.click('button:has-text("Esqueci minha senha")');
    await page.fill('input[type=email]', email);
    await page.click('button:has-text("Enviar link de redefinição")');

    // modo local: o servidor expõe o link de dev; segue-o para a tela de nova senha
    const devLink = page.locator('a:has-text("abrir link de redefinição")');
    await expect(devLink).toBeVisible();
    const href = await devLink.getAttribute('href');
    expect(href).toContain('/auth/reset#access_token=');
    await page.goto(href!);

    await page.fill('input[type=password]', NEW_PW);
    await page.click('button:has-text("Salvar nova senha")');
    await expect(page.locator('.home-main')).toBeVisible(); // logou com a senha nova
    await expect(page.locator('.profile-chip')).toContainText('Esquecida');

    // a senha antiga não vale mais; a nova entra
    await page.click('button:has-text("Sair")');
    await page.click('button:has-text("Entrar ou criar conta")');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.click('form button:has-text("Entrar")');
    await expect(page.locator('.form-error')).toContainText('E-mail ou senha incorretos');
    await page.fill('input[type=password]', NEW_PW);
    await page.click('form button:has-text("Entrar")');
    await expect(page.locator('.home-main')).toBeVisible();
  });

  test('sessão persiste ao recarregar e relogin não repete o onboarding', async ({ browser }) => {
    const home = await loginAs(browser, 'Tenaz', '🦅');
    await home.reload();
    await expect(home.locator('.home-main')).toBeVisible(); // sessão sobreviveu
    await expect(home.locator('.profile-chip')).toContainText('Tenaz');
    await home.context().close();
  });

  test('convidado vira conta sem sair do jogo e herda a identidade da sessão', async ({ browser }) => {
    const page = await guestAs(browser, 'Promovida', '🔮');
    await page.click('.profile-chip button:has-text("Criar conta")');

    // a tela de conta abre por cima da sessão; dá para voltar sem perder nada
    await expect(page.locator('button:has-text("← Voltar ao jogo")')).toBeVisible();
    await page.click('button:has-text("← Voltar ao jogo")');
    await expect(page.locator('.profile-chip')).toContainText('Promovida');

    await page.click('.profile-chip button:has-text("Criar conta")');
    await expect(page.locator('.login-step-info')).toContainText('o progresso desta sessão vai junto');
    await page.fill('input[type=email]', uniqueEmail('promovida'));
    await page.fill('input[type=password]', E2E_PASSWORD);
    await page.click('button:has-text("Criar conta")');

    // promoção herda nome e avatar: nada de onboarding, direto à home
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.profile-chip')).toContainText('Promovida');
    await expect(page.locator('.profile-chip .guest-badge')).toHaveCount(0); // agora é conta
    await page.context().close();
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

    // quem tem conta entra navegando direto pelo link
    const amiga = await loginAs(browser, 'Aline', '🔮');
    await amiga.goto(`/room/${code}`);
    await expect(amiga.locator('.member-list')).toContainText('Xavier');
    await expect(host.locator('.member-list')).toContainText('Aline');

    // chat com filtro de palavras server-side
    await amiga.fill('.chat-input input', 'gg, seu idiota');
    await amiga.click('.chat-input button');
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
    await amiga.context().close();
  });

  test('convidado entra pelo link sem cadastro e conversa no chat da sala', async ({ browser }) => {
    const host = await loginAs(browser, 'Xavier', '🐺');
    await host.click('button:has-text("Criar sala privada")');
    const code = (await host.locator('.room-code').textContent())!.trim();

    // a alavanca de viralidade, agora sem atrito: o link leva ao jogo na hora
    const ctx = await browser.newContext();
    const visitor = await ctx.newPage();
    await visitor.goto(`/room/${code}`);
    await visitor.fill('input[name=name]', 'Curiosa');
    await visitor.click('button:has-text("Jogar agora")');
    await expect(visitor.locator('.member-list')).toContainText('Xavier');
    await expect(host.locator('.member-list')).toContainText('Curiosa');

    // o chat da sala é efêmero — convidado participa de igual para igual
    await visitor.fill('.chat-input input', 'cheguei!');
    await visitor.click('.chat-input button');
    await expect(host.locator('.chat-msg .chat-text').last()).toContainText('cheguei');
    await host.fill('.chat-input input', 'boas-vindas!');
    await host.click('.chat-input button');
    await expect(visitor.locator('.chat-msg .chat-text').last()).toContainText('boas-vindas');
    await visitor.screenshot({ path: shotPath('03b-sala-convidado.png') });

    await host.context().close();
    await ctx.close();
  });
});
