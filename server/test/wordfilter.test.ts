import { describe, expect, it } from 'vitest';
import { filterText } from '../src/wordfilter.js';

describe('filtro de palavras do chat', () => {
  it('mantém mensagens normais intactas', () => {
    expect(filterText('boa partida, gg!')).toBe('boa partida, gg!');
  });

  it('censura palavrões', () => {
    const out = filterText('seu idiota');
    expect(out).not.toContain('idiota');
    expect(out).toContain('***');
  });

  it('pega variações com acento e leet speak', () => {
    expect(filterText('otário')).not.toContain('otário');
    expect(filterText('1d10ta')).not.toContain('1d10ta');
  });

  it('censura termos compostos de assédio', () => {
    const out = filterText('vai se mata');
    expect(out).not.toContain('se mata');
  });
});
