/**
 * hierarchyService.ts
 *
 * Fonte única de verdade para toda a lógica de hierarquia do boletim SEDEC/CBMERJ.
 * Antes estava duplicada em bulletinParserService.ts e localSearchService.ts.
 */

import { normalizeTitle, isVisualHeader, cleanHeaderTitle, REGEX_PARTE_PREFIX, REGEX_EIXO_PREFIX, REGEX_ITEM_PREFIX, REGEX_LETTER_ITEM_PREFIX, REGEX_ANEXO_PREFIX, REGEX_EIXO_AND_ITEM_PREFIX } from "./textUtils";

// ──────────────────────────────────────────────
// MAPEAMENTO ESTRITO DE EIXOS POR PARTE
// ──────────────────────────────────────────────

const STRICT_PART_EIXO_MAP: Record<string, string[]> = {
  "1ª PARTE": [],
  "2ª PARTE": ["OPERAÇÕES", "INSTRUÇÃO"],
  "3ª PARTE": ["ASSUNTOS GERAIS", "ASSUNTOS ADMINISTRATIVOS"],
  "4ª PARTE": [],
  "5ª PARTE": [],
};

export const isAllowedEixoForParte = (parteTitle: string, eixoContent: string): boolean => {
  const cleanParte = parteTitle.toUpperCase();
  const cleanEixo = normalizeTitle(eixoContent);
  for (const [key, allowed] of Object.entries(STRICT_PART_EIXO_MAP)) {
    if (cleanParte.includes(key)) {
      return allowed.some(a => cleanEixo.includes(normalizeTitle(a)));
    }
  }
  return true;
};

// ──────────────────────────────────────────────
// ESQUELETO CANÔNICO FIXO DO BOLETIM SEDEC/CBMERJ
// ──────────────────────────────────────────────

export interface CanonicalNode {
  key: string;
  label: string;
  level: 'parte' | 'secao' | 'letra';
  parent?: string;
}

export const CANONICAL_STRUCTURE: CanonicalNode[] = [
  { key: '1 PARTE', label: '1ª PARTE - SERVIÇOS DIÁRIOS', level: 'parte' },
  { key: '2 PARTE', label: '2ª PARTE - OPERAÇÕES E INSTRUÇÃO', level: 'parte' },
  { key: 'I OPERACOES', label: 'I - OPERAÇÕES', level: 'secao', parent: '2 PARTE' },
  { key: 'II INSTRUCAO', label: 'II - INSTRUÇÃO', level: 'secao', parent: '2 PARTE' },
  { key: '3 PARTE', label: '3ª PARTE - ASSUNTOS GERAIS E ADMINISTRATIVOS', level: 'parte' },
  { key: 'I ASSUNTOS GERAIS', label: 'I - ASSUNTOS GERAIS', level: 'secao', parent: '3 PARTE' },
  { key: 'II ASSUNTOS ADMINISTRATIVOS', label: 'II - ASSUNTOS ADMINISTRATIVOS', level: 'secao', parent: '3 PARTE' },
  { key: 'A ALTERACOES DE OFICIAIS', label: 'A - ALTERAÇÕES DE OFICIAIS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: 'A ALTERACOES DE PRACAS ESPECIAIS', label: 'A - ALTERAÇÕES DE PRAÇAS ESPECIAIS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: 'A1 ALTERACOES DE PRACAS ESPECIAIS', label: 'A - ALTERAÇÕES DE PRAÇAS ESPECIAIS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: 'A 1 ALTERACOES DE PRACAS ESPECIAIS', label: 'A - ALTERAÇÕES DE PRAÇAS ESPECIAIS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: 'B ALTERACOES DE PRACAS', label: 'B - ALTERAÇÕES DE PRAÇAS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: 'C ALTERACOES DE CIVIS', label: 'C - ALTERAÇÕES DE CIVIS', level: 'letra', parent: 'II ASSUNTOS ADMINISTRATIVOS' },
  { key: '4 PARTE', label: '4ª PARTE - JUSTIÇA E DISCIPLINA', level: 'parte' },
  { key: '5 PARTE', label: '5ª PARTE - COMUNICAÇÃO SOCIAL', level: 'parte' },
];

/**
 * Normalização agressiva para matching fuzzy: remove tudo exceto letras e números.
 */
export const fuzzyKey = (text: string): string =>
  text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Tenta casar uma linha normalizada com um nó canônico.
 */
export const matchCanonical = (lineNorm: string): CanonicalNode | null => {
  const sorted = [...CANONICAL_STRUCTURE].sort((a, b) => b.key.length - a.key.length);
  for (const node of sorted) {
    const nodeKeyNorm = fuzzyKey(node.key);
    if (lineNorm.includes(nodeKeyNorm) || nodeKeyNorm.includes(lineNorm)) {
      if (node.level === 'parte') {
        if (!/\d/.test(node.key)) continue;
        const digit = node.key.match(/\d+/)?.[0];
        if (digit && !new RegExp(`\\b${digit}\\b`).test(lineNorm)) continue;
      }
      return node;
    }
  }
  return null;
};

// ──────────────────────────────────────────────
// CONSTRUÇÃO DE HIERARQUIA (pilha de seções)
// ──────────────────────────────────────────────

export interface SectionStackItem {
  level: number;
  title: string;
}

export const buildHierarchy = (
  lineText: string,
  sectionStack: SectionStackItem[]
): { hierarchy: string; updatedStack: SectionStackItem[] } => {
  let match: RegExpMatchArray | null;
  let stack = [...sectionStack];

  if ((match = lineText.match(REGEX_PARTE_PREFIX))) {
    const prefix = match[1];
    const rawContent = match[2];
    const content = rawContent.split(/\s\d+\./)[0].trim();
    if (isVisualHeader(content)) {
      const title = cleanHeaderTitle(`${prefix} - ${content}`);
      stack = [{ level: 1, title }];
    }
  } else if ((match = lineText.match(REGEX_ANEXO_PREFIX))) {
    const prefix = match[1];
    const content = (match[2] || "").trim();
    const title = cleanHeaderTitle(content ? `${prefix} - ${content}` : prefix);
    stack = [{ level: 1, title }];
  } else if ((match = lineText.match(REGEX_EIXO_PREFIX))) {
    const prefix = match[1];
    const rawContent = match[2];
    const content = rawContent.split(/\s\d+\./)[0].trim();
    const currentParte = stack.find(s => s.level === 1)?.title || "";
    const isAllowed = isAllowedEixoForParte(currentParte, content);
    if (isVisualHeader(content) && isAllowed) {
      const title = cleanHeaderTitle(`${prefix} - ${content}`);
      stack = stack.filter(s => s.level < 2);
      stack.push({ level: 2, title });
    }
  } else if ((match = lineText.match(REGEX_ITEM_PREFIX))) {
    const prefix = match[1];
    const content = match[2];
    if (isVisualHeader(content)) {
      const title = cleanHeaderTitle(`${prefix}. ${content}`);
      stack = stack.filter(s => s.level < 3);
      stack.push({ level: 3, title });
    }
  } else if ((match = lineText.match(REGEX_LETTER_ITEM_PREFIX))) {
    const prefix = match[1];
    const content = match[2];
    if (isVisualHeader(content)) {
      const title = cleanHeaderTitle(`${prefix}. ${content}`);
      stack = stack.filter(s => s.level < 3);
      stack.push({ level: 3, title });
    }
  } else if ((match = lineText.match(REGEX_EIXO_AND_ITEM_PREFIX))) {
    const eixoPrefix = match[1];
    const itemNum = match[2];
    const content = match[3];
    stack = stack.filter(s => s.level < 2);
    stack.push({ level: 2, title: cleanHeaderTitle(eixoPrefix) });
    const itemTitle = cleanHeaderTitle(`${itemNum}. ${content}`);
    stack.push({ level: 3, title: itemTitle });
  }

  const parents = stack.filter(s => s.level < 3);
  const hierarchy = parents.map(s => s.title).join(' > ');
  return { hierarchy, updatedStack: stack };
};
