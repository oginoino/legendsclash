/**
 * Filtro de palavras do chat (slide "Briefing": moderação é requisito, não
 * detalhe). Normaliza acentos e "leet speak" antes de comparar, e substitui
 * termos bloqueados por asteriscos.
 */

const BLOCKLIST = [
  'merda', 'bosta', 'porra', 'caralho', 'puta', 'puto', 'viado',
  'arrombado', 'desgraçado', 'desgracado', 'fdp', 'vsf', 'vtnc',
  'idiota', 'imbecil', 'otario', 'otário', 'babaca', 'corno',
  'noob lixo', 'lixo de jogador', 'se mata', 'vai morrer',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
}

const NORMALIZED_BLOCKLIST = BLOCKLIST.map(normalize);

/** Substitui cada termo bloqueado por asteriscos, preservando o resto da frase. */
export function filterText(text: string): string {
  const words = text.split(/(\s+)/); // mantém os separadores
  const normWords = words.map(normalize);

  // termos de uma palavra
  for (let i = 0; i < words.length; i++) {
    if (NORMALIZED_BLOCKLIST.includes(normWords[i].replace(/[^a-z]/g, ''))) {
      words[i] = '*'.repeat(words[i].length);
    }
  }

  // termos compostos: verifica no texto normalizado inteiro
  let result = words.join('');
  const normResult = normalize(result);
  for (const term of NORMALIZED_BLOCKLIST) {
    if (term.includes(' ') && normResult.includes(term)) {
      // censura a frase inteira por simplicidade — caso raro
      result = '*'.repeat(result.length);
      break;
    }
  }
  return result;
}

export const MAX_CHAT_LENGTH = 240;
