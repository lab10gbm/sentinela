/**
 * textUtils.ts — Módulo compartilhado de utilitários de processamento de texto.
 *
 * Funções extraídas de localSearchService.ts para reuso em
 * bulletinParserService.ts e qualquer outro serviço que precise processar
 * texto de PDFs militares.
 */

import { TextToken } from "../types";
import { calibrationService } from "./calibrationService";

// ──────────────────────────────────────────────
// TOC (SUMÁRIO) — TIPOS E INTERFACES
// ──────────────────────────────────────────────

/**
 * Tipos possíveis de uma linha do Sumário do boletim.
 */
export enum TocLineType {
  PARTE = 'PARTE',                   // "1ª PARTE - TÍTULO"
  SECAO = 'SECAO',                   // "I - TÍTULO" (numeral romano)
  LETRA_SECAO = 'LETRA_SECAO',       // "A - ALTERAÇÕES DE OFICIAIS"
  NOTA = 'NOTA',                     // "1. TÍTULO"
  RAIZ = 'RAIZ',                     // entradas antes da 1ª Parte
  ANEXO = 'ANEXO',                   // "ANEXO I - NOTA CHEMG/DGEI"
  SEM_ALTERACAO = 'SEM_ALTERACAO',   // "SEM ALTERAÇÃO."
  SEPARATOR = 'SEPARATOR',           // linha só com ___ ou espaços
  CONTINUATION = 'CONTINUATION',     // continuação de título anterior
  UNKNOWN = 'UNKNOWN'
}

/**
 * Representa uma linha classificada do Sumário.
 */
export interface TocLine {
  /** Texto bruto original da linha */
  raw: string;
  /** Tipo classificado da linha */
  type: TocLineType;
  /** Número de página extraído dos padrões `___N` ou `...N`, ou null se ausente */
  pageNumber: number | null;
  /** Texto do título sem underscores, pontos de preenchimento e número de página */
  titleFragment: string;
}

// ──────────────────────────────────────────────
// TOC — CLASSIFICAÇÃO DE LINHAS
// ──────────────────────────────────────────────

/** Regex para detectar número de página no final da linha (___N, ...N, espaços/tabs + N isolado, ou espaço simples + N no final) */
const PAGE_NUMBER_REGEX = /(?:[_.]{3,}\s*(\d{1,4})|[ \t]+(\d{1,4}))\s*$/;

/**
 * Classifica uma linha bruta do Sumário em um `TocLine`.
 *
 * Regras de classificação (em ordem de prioridade):
 * 1. Linha só com underscores/espaços → SEPARATOR
 * 2. Prefixo `Nª PARTE` → PARTE
 * 3. Prefixo `ANEXO NUMERAL` → ANEXO
 * 4. Prefixo `NUMERAL_ROMANO -` → SECAO
 * 5. Prefixo `LETRA -` (letra única) → LETRA_SECAO
 * 6. Prefixo `N. TÍTULO` → NOTA
 * 7. Prefixo `SEM ALTERAÇÃO` → SEM_ALTERACAO
 * 8. Qualquer outra coisa → CONTINUATION (possível continuação de título anterior)
 *
 * Em todos os casos, extrai `pageNumber` se a linha terminar com `___N`, `...N` ou espaços+N.
 */
export const classifyTocLine = (line: string): TocLine => {
  const raw = line;

  // Strip markdown bold markers (**) que o extrator de PDF às vezes injeta
  const stripped = line.replace(/^\*\*/, '').replace(/\*\*$/, '');

  // Extrair número de página antes de qualquer outra análise
  const pageMatch = PAGE_NUMBER_REGEX.exec(stripped);
  // Group 1 = after ___ or ..., Group 2 = after spaces
  const pageNumber = pageMatch ? parseInt(pageMatch[1] ?? pageMatch[2], 10) : null;

  // Remover o sufixo de página para obter o fragmento de título limpo
  const withoutPage = pageMatch ? stripped.slice(0, pageMatch.index) : stripped;
  const titleFragment = withoutPage.replace(/[_.]+\s*$/, '').trim();

  // 1. Linha só com underscores, pontos e/ou espaços → SEPARATOR
  if (/^[_.\s*]+$/.test(stripped.trim()) || stripped.trim() === '') {
    return { raw, type: TocLineType.SEPARATOR, pageNumber, titleFragment: '' };
  }

  // 2. Parte: "1ª PARTE", "2ª PARTE", etc.
  if (/^\d+ª\s*PARTE\b/i.test(titleFragment.trim())) {
    return { raw, type: TocLineType.PARTE, pageNumber, titleFragment };
  }

  // 3. Anexo: "ANEXO I", "ANEXO II", "ANEXO 1", etc. — antes de SECAO para evitar falso positivo
  if (/^ANEXO\s+[IVXLCDM\d]+/i.test(titleFragment.trim())) {
    return { raw, type: TocLineType.ANEXO, pageNumber, titleFragment };
  }

  // 4. Seção: numeral romano seguido de espaço/hífen e texto
  //    Exemplos: "I - OPERAÇÕES", "IV – ASSUNTOS GERAIS"
  if (/^[IVXLCDM]+\s*[-–—]\s*\S/i.test(titleFragment.trim())) {
    return { raw, type: TocLineType.SECAO, pageNumber, titleFragment };
  }

  // 5. Letra-Seção: letra maiúscula única seguida de hífen e texto
  //    Exemplos: "A - ALTERAÇÕES DE OFICIAIS", "B - ALTERAÇÕES DE PRAÇAS"
  if (/^[A-Z]\s*[-–]\s*\S/.test(titleFragment.trim())) {
    return { raw, type: TocLineType.LETRA_SECAO, pageNumber, titleFragment };
  }

  // 6. Nota: número seguido de ponto e texto
  //    Exemplos: "1. APOIO TÉCNICO", "12. ESCALA DE SERVIÇO"
  if (/^\d+\.?\s+\S/.test(titleFragment.trim())) {
    return { raw, type: TocLineType.NOTA, pageNumber, titleFragment };
  }

  // 7. SEM ALTERAÇÃO: indica ausência de notas em uma Parte ou Seção
  if (/^SEM\s+ALTERAÇÃO/i.test(titleFragment.trim())) {
    return { raw, type: TocLineType.SEM_ALTERACAO, pageNumber, titleFragment };
  }

  // 8. Linha com texto + número de página mas sem prefixo estrutural → RAIZ
  //    Exemplos: "FATOS HISTÓRICOS ___ 3", "TENDÊNCIA METEOROLÓGICA ___ 7"
  if (pageNumber !== null && titleFragment.trim().length > 3) {
    return { raw, type: TocLineType.RAIZ, pageNumber, titleFragment };
  }

  // 9. Qualquer outra coisa → CONTINUATION
  return { raw, type: TocLineType.CONTINUATION, pageNumber, titleFragment };
};

// ──────────────────────────────────────────────
// LIMPEZA DE ARTEFATOS
// ──────────────────────────────────────────────

/**
 * Regex agressivo para remover artefatos de cabeçalho/rodapé que quebram o texto.
 */
export const cleanHeaderArtifacts = (text: string): string => {
  const headerArtifactRegex = /\b(?:BOLETIM|BOL|FL\.|PÁG)\s*(?:DA\s+SEDEC|DO\s+CBMERJ|OSTENSIVO|RESERVADO|ADITAMENTO)?[\s\S]*?(?:FL\.|PÁG)\s*\.?\s*\d+/gi;
  const pageNumberArtifact = /^\s*\.?\s*\d+\s*$/gm;
  const ocrNoise = /\b(\w)\s+\1\b/g;

  return text
    .replace(headerArtifactRegex, " ")
    .replace(pageNumberArtifact, " ")
    .replace(ocrNoise, " ")
    .replace(/\s{2,}/g, " "); // Normaliza espaços
};

// ──────────────────────────────────────────────
// NORMALIZAÇÃO
// ──────────────────────────────────────────────

/**
 * Normaliza texto para OCR (Remove ruídos comuns).
 */
export const normalizeTextForOcr = (text: string): string => {
  const cleaned = cleanHeaderArtifacts(text);

  return cleaned
    .replace(/(\w)\s-\s(\w)/g, '$1-$2')
    .replace(/d\s+as/g, 'das')
    .replace(/in\s+í\s+cio/g, 'início')
    .replace(/t\s+é\s+r\s+i\s+m\s+o/g, 'término')
    .replace(/Subcomandante\s*-\s*Geraldo/g, 'Subcomandante-Geral do')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Normaliza um texto para busca removendo acentos e deixando tudo maiúsculo,
 * além de unificar espaços múltiplos.
 */
export const normalizeTitle = (text: string): string => {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[^A-Z0-9 /]/g, "")
    .trim();
};

/**
 * Normaliza apenas espaços múltiplos para um único espaço.
 */
export const normalizeSpaces = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * Normaliza o texto de uma célula de tabela extraída de PDF.
 *
 * Corrige artefatos comuns de extração:
 * - Horários com espaços: "0 8h" → "08h", "0 8 : 15 h" → "08:15h"
 * - Números quebrados: "32.7 08" → "32.708", "Dent/0 2" → "Dent/02"
 * - Palavras partidas por kerning: "HOR ÁRIO" → "HORÁRIO", "Ten Cel BM/QOS/Dent/0 2" → "Ten Cel BM/QOS/Dent/02"
 * - Dígitos isolados colados ao token anterior: "32.6 18" → "32.618"
 */
export const normalizeCellText = (text: string): string => {
  if (!text) return text;

  let s = text;

  // 1. Horários militares: "0 8h" → "08h", "0 8 : 15 h" → "08:15h", "0 9 : 45 h" → "09:45h"
  //    Padrão: dígito isolado + espaço + dígito(s) + espaço? + ":" + espaço? + dígito(s) + espaço? + "h"
  s = s.replace(/\b(\d)\s+(\d{1,2})\s*:\s*(\d{2})\s*h\b/gi, '$1$2:$3h');
  //    Padrão simples: "0 8h" → "08h"
  s = s.replace(/\b(\d)\s+(\d{1,2}h)\b/gi, '$1$2');

  // 2. Números decimais/RG quebrados: "32.7 08" → "32.708", "32.6 18" → "32.618"
  //    Só une se o fragmento após o espaço é puramente numérico e curto (≤ 4 dígitos)
  s = s.replace(/(\d+\.\d+)\s+(\d{1,4})(?=\s|$)/g, (match, left, right) => {
    // Evita unir se o número da direita parece ser um campo separado (ex: RG separado por coluna)
    // Heurística: une apenas se o fragmento direito tem ≤ 3 dígitos
    if (right.length <= 3) return left + right;
    return match;
  });

  // 3. Fragmentos alfanuméricos quebrados: "Dent/0 2" → "Dent/02", "QOS/Dent/0 2" → "QOS/Dent/02"
  //    Padrão: texto terminando em dígito + "/" + dígito(s) + espaço + dígito(s) curtos
  s = s.replace(/(\/\d+)\s+(\d{1,2})(?=\s|$)/g, '$1$2');

  // 4. Palavras partidas por kerning — detecta espaço entre fragmentos que juntos
  //    formam uma palavra sem espaço válida (sem vogal isolada, sem preposição).
  //    Ex: "HOR ÁRIO" → "HORÁRIO", "RADI OGRÁFICA" → "RADIOGRÁFICA"
  //    Critério: fragmento esquerdo termina em consoante E fragmento direito começa
  //    com vogal (ou vice-versa), e nenhum dos dois é uma palavra comum sozinho.
  s = s.replace(/\b([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,})\s+([ÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{1,})\b/g, (match, left, right) => {
    // Não une se o fragmento esquerdo é uma palavra comum (preposição, artigo, etc.)
    const commonWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'EM', 'NO', 'NA', 'NOS', 'NAS', 'POR', 'COM', 'SEM', 'SOB', 'AO', 'AOS', 'AS', 'OS', 'UM', 'UMA', 'CEL', 'TEN', 'CAP', 'SGT', 'CBM', 'BM', 'RG', 'QOS', 'UAO', 'OBM', 'GBM']);
    if (commonWords.has(left) || commonWords.has(right)) return match;
    // Une apenas se o fragmento direito começa com vogal acentuada (sinal de quebra de palavra)
    if (/^[ÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(right)) return left + right;
    return match;
  });

  // 5. Colapsa múltiplos espaços residuais
  s = s.replace(/\s{2,}/g, ' ').trim();

  return s;
};

// ──────────────────────────────────────────────
// DETECÇÃO VISUAL DE CABEÇALHOS
// ──────────────────────────────────────────────

/**
 * Lista de seções fixas que aparecem repetidamente em boletins militares.
 */
export const FIXED_MILITARY_SECTIONS = [
  "SERVIÇOS DIÁRIOS",
  "OPERAÇÕES E INSTRUÇÃO",
  "OPERAÇÕES",
  "INSTRUÇÃO",
  "ASSUNTOS GERAIS E ADMINISTRATIVOS",
  "ASSUNTOS GERAIS",
  "ASSUNTOS ADMINISTRATIVOS",
  "ALTERAÇÕES DE OFICIAIS",
  "ALTERAÇÕES DE PRAÇAS",
  "ALTERAÇÕES DE CIVIS",
  "JUSTIÇA E DISCIPLINA",
  "COMUNICAÇÃO SOCIAL",
  "SERVIÇO PARA O DIA",
  "SUMÁRIO"
];

export const isFixedMilitarySection = (text: string): boolean => {
  const clean = normalizeTitle(text);
  return FIXED_MILITARY_SECTIONS.some(s => clean.includes(normalizeTitle(s)));
};

/**
 * Verifica se a string é predominantemente CAIXA ALTA (Mais de 80% das letras são maiúsculas).
 * Ou se é uma seção fixa conhecida.
 */
export const isVisualHeader = (text: string): boolean => {
  if (isFixedMilitarySection(text)) return true;

  const letters = text.replace(/[^a-zA-ZÀ-Ü]/g, '');
  if (letters.length < 3) return false;

  const upperLetters = letters.replace(/[^A-ZÀ-Ü]/g, '');
  const ratio = upperLetters.length / letters.length;

  return ratio > 0.8;
};

/**
 * Detecta linhas que são apenas referências de página (TOC):
 * "1. ASSUNTO .................... 10"
 */
export const isTOCLine = (text: string): boolean => {
  return /(\.{3,}|_{3,})\s*\d+\s*$/.test(text);
};

/**
 * Calcula a densidade TOC de um conjunto de linhas.
 * Densidade = proporção de linhas não-vazias que terminam com padrão `separador + número`.
 * Retorna valor entre 0 e 1.
 *
 * _Requirements: 1.2_
 */
export const calcTocDensity = (lines: string[]): number => {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return 0;
  const tocPattern = /(?:[_.]{3,}|[ \t]{2,})\s*\d{1,4}\s*$/;
  const tocCount = nonEmpty.filter(l => tocPattern.test(l)).length;
  return tocCount / nonEmpty.length;
};

/**
 * Verifica se a linha é um cabeçalho ou rodapé de página (lixo a ser filtrado).
 */
export const isPageHeaderOrFooter = (text: string): boolean => {
  const clean = text.trim().toUpperCase();
  if (/^(BOLETIM|FL\.|PÁG|CONTINUAÇÃO|SUMÁRIO|RIODEJANEIRO|ESTADO DO RIO|CORPO DE BOMBEIROS)/.test(clean)) return true;
  if (/^FL\.\s*\d+/.test(clean)) return true;
  if (/^(?:[A-Z]\s+){4,}[A-Z]/.test(clean)) return true;
  if (/(?:B\s*){2}(?:O\s*){2}/.test(clean)) return true;
  return false;
};

/**
 * Detecta marcadores que devem SEMPRE quebrar a união de tabelas.
 * Inclui APENAS retificações reais (ONDE SE LÊ / LEIA-SE).
 * Títulos numerados como "3 MILITARES CAPACITADOS:" NÃO quebram tabela —
 * eles aparecem antes da tabela e o bridge do Pass 3 os atravessa corretamente.
 */
export const isRectificationMarker = (text: string): boolean => {
  const clean = text.trim().toUpperCase();
  if (clean.includes("ONDE SE LÊ") || clean.includes("LEIA-SE")) return true;
  return false;
};

/**
 * Detecta títulos de sub-seção dentro de notas (ex: "3 MILITARES CAPACITADOS:", "1. VIATURA:").
 * Esses títulos NÃO quebram tabelas — são apenas ruído entre blocos de tabela.
 */
export const isSubSectionTitle = (text: string): boolean => {
  const clean = text.trim().toUpperCase();
  return /^\d+[\s.]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ].*:$/.test(clean);
};

// ──────────────────────────────────────────────
// FORMATAÇÃO DE DOCUMENTO OFICIAL
// ──────────────────────────────────────────────

/**
 * Formata texto de documento oficial com quebras de linha semânticas.
 * Insere \n\n antes de "Considerando", "Art.", "Resolve", etc.
 */
export const formatOfficialDocumentText = (fullSectionContent: string): string => {
  let cleanContent = cleanHeaderArtifacts(fullSectionContent);
  cleanContent = normalizeTextForOcr(cleanContent);

  const breakUnlessComma = (match: string, prevChar: string, keyword: string) => {
    if (prevChar === ',' || prevChar === '-') return match;
    const standardizedKeyword = keyword.replace(/\b\w/g, c => c.toUpperCase());
    return `${prevChar}\n\n${standardizedKeyword}`;
  };

  cleanContent = cleanContent
    .replace(/(;|.)\s*(Considerando)/gi, '$1\n\nConsiderando')
    .replace(/(;|.)\s*(Art\.\s*\d+)/gi, '$1\n\n$2')
    .replace(/(;|.)\s*(Parágrafo\s+único)/gi, '$1\n\n$2')
    .replace(/(;|.)\s*(O\s+Cel\s+BM)/gi, breakUnlessComma)
    .replace(/(;|.)\s*(O\s+Subcomandante)/gi, breakUnlessComma)
    .replace(/(;|.)\s*(Torna\s+Pública)/gi, breakUnlessComma)
    .replace(/(;|.)\s*(Resolve)/gi, breakUnlessComma)
    .replace(/(\d{4}\.)\s*(Horário)/i, '$1\n\nHorário')
    .replace(/(facultativos\);)\s*(Local:)/i, '$1\nLocal:')
    .replace(/(Cardoso;)\s*(Endereço:)/i, '$1\nEndereço:')
    .replace(/(RJ;)\s*(Maiores)/i, '$1\nMaiores');

  return cleanContent;
};

/**
 * Une linhas que foram quebradas indevidamente por causa do PDF.
 * Baseia-se em heurísticas de pontuação e CAIXA BAIXA na linha seguinte.
 */
export const joinWrappedParagraphs = (text: string): string => {
  if (!text) return "";
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    const next = (i + 1 < lines.length) ? lines[i + 1].trim() : null;

    // Linha vazia: só preserva se a linha anterior termina com pontuação forte
    // ou é um header — caso contrário, une com a próxima (era quebra de linha do PDF)
    if (!current) {
      const prev = result.length > 0 ? result[result.length - 1] : "";
      const prevEndsStrong = /[.:;!?]$/.test(prev);
      const prevIsHeader = prev ? isVisualHeader(prev) : false;
      if (prevEndsStrong || prevIsHeader || !prev) {
        result.push("");
      }
      // Se não, descarta a linha vazia (era artefato de quebra de linha do PDF)
      continue;
    }

    const isHeader = isVisualHeader(current);
    // Remove marcadores de formatação para testar pontuação real
    const currentPlain = current.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    const endsWithStrongPunctuation = /[.:;!?]$/.test(currentPlain);
    const isListItem = /^(\d+|[a-z]|[IVX]+)[\s.-]/.test(current);
    const isTableLine = current.includes('|') || current.startsWith('```');
    const isImage = current.includes('![Img]') || current.includes('![Imagem');
    // Linha de dados de militar: contém RG com número, Id Funcional, ou padrão "NOME RG NÚMERO"
    const isMilitaryDataLine = /\bRG\s+\d/.test(current) || /Id\s*Funcional\s+\d/i.test(current) || /,\s*RG\b/i.test(current);

    // MÁXIMO RIGOR: Se for título (CAIXA ALTA), NUNCA une com a linha de baixo
    // a menos que a linha de baixo seja minúscula (continuação improvável para títulos)
    if (isHeader && next && !/^[a-zÀ-ü]/.test(next)) {
      result.push(current);
      continue;
    }

    // Linha de dados de militar nunca é unida com a próxima
    if (isMilitaryDataLine) {
      result.push(current);
      continue;
    }

    if (!endsWithStrongPunctuation && !isListItem && !isTableLine && !isImage && next) {
      const nextIsListItem = /^(\d+|[a-z]|[IVX]+)[\s.-]/.test(next);
      const nextIsTable = next.includes('|') || next.startsWith('```');
      const nextIsImage = next.includes('![Img]') || next.includes('![Imagem');
      const nextIsLower = /^[a-zÀ-ü]/.test(next);
      // Fragmento curto: só considera se NÃO for header (evita unir títulos em CAIXA ALTA)
      const currentIsShortFragment = !isHeader && current.replace(/\*\*/g, '').length < 25 && !endsWithStrongPunctuation;

      if (!nextIsListItem && !nextIsTable && !nextIsImage) {
        // Une se: próxima começa com minúscula, OU linha atual é fragmento curto sem pontuação
        if (nextIsLower || currentIsShortFragment) {
          lines[i + 1] = current + " " + next;
          continue;
        }
        
        // Se as duas linhas são normais (não-header), une (fluxo de parágrafo)
        if (!isHeader && !isVisualHeader(next) && next.length > 0) {
          lines[i + 1] = current + " " + next;
          continue;
        }
      }
    }

    result.push(current);
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n');
};

// ──────────────────────────────────────────────
// LIMPEZA DE TÍTULOS
// ──────────────────────────────────────────────

/**
 * Limpa um título de nota extraído do PDF, removendo artefatos comuns:
 * underscores, asteriscos, número isolado no final e espaços múltiplos.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4_
 */
export const cleanNoteTitle = (text: string): string => {
  return text
    .replace(/[_*]+/g, '')        // remove underscores e asteriscos (Req 4.1)
    .replace(/\s+\d+\s*$/, '')    // remove número isolado no final (Req 4.2)
    .replace(/\s{2,}/g, ' ')      // colapsa espaços múltiplos (Req 4.3)
    .trim();                       // trim final (Req 4.4)
};

/**
 * Limpa um título de seção removendo underscores, números de página soltos, etc.
 */
export const cleanHeaderTitle = (text: string): string => {
  return text
    .replace(/^[\s_]+/, '')
    .replace(/[\s_]+$/, '')
    .replace(/(?:FL\.|PÁG\.?)\s*\d+$/i, '')
    .replace(/\d+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

/**
 * Remove todos os marcadores internos de formatação ([CENTER], **, <u>) para exibição limpa (ex: títulos de UI).
 */
export const stripInternalMarkers = (text: string): string => {
  return text
    .replace(/\[CENTER\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/<u>/gi, '')
    .replace(/<\/u>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

// ──────────────────────────────────────────────
// REGEXES DE HIERARQUIA
// ──────────────────────────────────────────────

/** PARTE: "2ª PARTE - TÍTULO" */
export const REGEX_PARTE_PREFIX = /^(\d+ª\s*PARTE)\s*[\s\.\-–—]\s*(.*)$/i;

/** EIXO / CAPÍTULO: "I - TÍTULO" (Romanos) */
export const REGEX_EIXO_PREFIX = /^([IVXLCDM]+)\s*[\s\.\-–—]\s*(.*)$/i;

/** ITEM: "1. TÍTULO" ou "16 . TÍTULO" */
export const REGEX_ITEM_PREFIX = /^(\d+)\s*[\s\.\-–—]\s*(.*)$/;

/** SUB-CATEGORIA / LETRA: "A - TÍTULO" (Comum em Alterações) */
export const REGEX_LETTER_ITEM_PREFIX = /^([A-Z])\s*[\s\.\-–—]\s*(.*)$/;

/** ANEXO: "ANEXO I", "ANEXO II" */
export const REGEX_ANEXO_PREFIX = /^(ANEXO\s+[IVXLCDM\d]+)\b(.*)$/i;

/** EIXO + ITEM: "I - 1. TÍTULO" (Combinação comum em alguns boletins) */
export const REGEX_EIXO_AND_ITEM_PREFIX = /^([IVXLCDM]+)\s*[\s\.\-–—]\s*(\d+)\.\s+(.*)$/i;

/**
 * Verifica se um texto é apenas um cabeçalho de seção (Parte ou Eixo) sem conteúdo de "Item".
 */
export const isOnlySectionHeader = (text: string): boolean => {
  const clean = text.trim();
  if (REGEX_PARTE_PREFIX.test(clean)) {
    const match = clean.match(REGEX_PARTE_PREFIX);
    return match ? !/\d+\./.test(match[2]) : true;
  }
  if (REGEX_ANEXO_PREFIX.test(clean)) {
    return true;
  }
  if (REGEX_EIXO_PREFIX.test(clean)) {
    const match = clean.match(REGEX_EIXO_PREFIX);
    return match ? !/\d+\./.test(match[2]) : true;
  }
  return false;
};

/**
 * Remove prefixo numérico para busca fuzzy:
 * "2ª PARTE - X" → "X", "1. TITULO" → "TITULO", "IV - TITULO" → "TITULO"
 */
export const stripNumericPrefix = (text: string): string => {
  return text.replace(/^(\d+ª\s*PARTE\s*-\s*)|(^\d+\.\s*)|(^[IVXLCDM]+\s*-\s*)|(^[A-Z]\s*-\s*)|(^(ANEXO\s+[IVXLCDM\d]+)\s*)/i, '').trim();
};

// ──────────────────────────────────────────────
// RECONSTRUÇÃO GEOMÉTRICA (Next Gen)
// ──────────────────────────────────────────────

/**
 * Agrupa tokens em linhas visuais baseadas em coordenadas Y.
 * Retorna uma lista de linhas, onde cada linha contém seus tokens ordenados por X.
 */
export const groupTokensIntoVisualLines = (tokens: TextToken[], yEpsilon?: number) => {
  const settings = calibrationService.settings;
  const epsilon = yEpsilon ?? settings.yTolerance;
  const lines: { y: number; tokens: TextToken[] }[] = [];
  
  // Ordena por Y (decrescente para PDF.js, onde Y cresce para baixo ou para cima dependendo do viewport, 
  // mas aqui assumimos consistência do pdfWorkerService)
  const sorted = [...tokens].sort((a, b) => b.y - a.y);
  
  for (const token of sorted) {
    const existing = lines.find(l => Math.abs(token.y - l.y) <= epsilon);
    if (existing) {
      existing.tokens.push(token);
    } else {
      lines.push({ y: token.y, tokens: [token] });
    }
  }
  
  // Ordena tokens dentro de cada linha por X
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
  }
  
  // Ordena as linhas por Y (do topo para baixo)
  return lines.sort((a, b) => b.y - a.y);
};

/**
 * Identifica a "Assinatura de Layout" detectando eixos de alinhamento vertical rítmico.
 * Útil para diferenciar tabelas de parágrafos justificados.
 */
export const detectLayoutSignature = (tokens: TextToken[]): { verticalAxes: number[], isRhythmic: boolean } => {
  const lines = groupTokensIntoVisualLines(tokens);
  if (lines.length < 3) return { verticalAxes: [], isRhythmic: false };

  const xStats = new Map<number, number>();
  const round = (val: number) => Math.round(val / 5) * 5; // Tolerância de 5px

  for (const line of lines) {
    for (const tok of line.tokens) {
      const rx = round(tok.x);
      xStats.set(rx, (xStats.get(rx) || 0) + 1);
    }
  }

  // Eixos que aparecem em pelo menos 30% das linhas
  const threshold = lines.length * 0.3;
  const verticalAxes = Array.from(xStats.entries())
    .filter(([_, count]) => count >= threshold)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  // É rítmico se tivermos múltiplos eixos verticais consistentes
  const isRhythmic = verticalAxes.length >= 2;

  return { verticalAxes, isRhythmic };
};

/**
 * Reconstrói o texto a partir de tokens usando Gap Analysis (Next Gen).
 * Abandona a dependência de \n e foca no espaçamento visual.
 */
export const reconstructVisualParagraphs = (tokens: TextToken[]): string => {
  const lines = groupTokensIntoVisualLines(tokens);
  if (lines.length === 0) return "";

  const resultLines: string[] = [];
  let currentParagraphLines: string[] = [];

  // Calcula o gap mediano entre linhas para detectar quebras de parágrafo
  const lineGaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0 && gap < 100) lineGaps.push(gap);
  }
  lineGaps.sort((a, b) => a - b);
  const medianGap = lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length * 2 / 3)] : 12;
  const paragraphThreshold = medianGap * 1.5;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineText = "";
    
    // Reconstroi a linha baseada em gaps horizontais
    for (let j = 0; j < line.tokens.length; j++) {
      const tok = line.tokens[j];
      let t = tok.isBold ? `**${tok.text}**` : tok.text;
      if (tok.isUnderlined) t = `<u>${t}</u>`;
      
      lineText += t;
      
      if (j < line.tokens.length - 1) {
        const next = line.tokens[j+1];
        const gap = next.x - (tok.x + tok.w);
        if (gap > 30) lineText += "    ";
        else if (gap > 10) lineText += "  ";
        else if (gap > 2) lineText += " ";
      }
    }

    // Checa por quebra de parágrafo visual
    if (i > 0) {
      const vGap = lines[i-1].y - line.y;
      const isIndented = line.tokens[0].x > (lines[0].tokens[0].x + 20); // Simples heurística de identação
      
      if (vGap > paragraphThreshold || isIndented) {
        resultLines.push(currentParagraphLines.join(" "));
        currentParagraphLines = [];
      }
    }
    
    currentParagraphLines.push(lineText.trim());
  }

  if (currentParagraphLines.length > 0) {
    resultLines.push(currentParagraphLines.join(" "));
  }

  return resultLines.join("\n\n");
};


/**
 * Detecta linhas que são DEFINITIVAMENTE parágrafos legais/narrativos (nunca tabela).
 */
export const isHardLegalParagraph = (text: string): boolean => {
  const plain = text.trim().replace(/\*\*/g, '');
  return (
    // Numeração hierárquica de documento (1.1., 1.1.1.)
    /^\d+\.\d+\.?\s/.test(plain) ||
    // Começa com preposição/artigo (continuação de parágrafo)
    /^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela |pelos |pelas |ao |aos |às )/i.test(plain) ||
    // Contém "por necessidade de serviço"
    /por\s+necessidade\s+de\s+servi[çc]o/i.test(plain) ||
    // Contém SEI (referência de processo)
    /\(SEI[-\s]\d+/.test(plain) ||
    // Linha de portaria/designação narrativa
    /\bPortaria\b/i.test(plain) ||
    /\bdesignando\b/i.test(plain) ||
    /\bnomeando\b/i.test(plain) ||
    // Linha narrativa longa terminando em ponto com múltiplas vírgulas (parágrafo)
    (plain.length > 80 && /\.$/.test(plain) && (plain.match(/,/g) || []).length >= 2) ||
    // Referência institucional em parágrafo
    /\b(da|do|de)\s+(Diretoria|Comando|Assessoria|Corregedoria|Secretaria|Divisão|Seção)\b/i.test(plain)
  );
};

/**
 * Verifica se uma linha está geometricamente alinhada com um bloco de tabela.
 */
export const isGeometricallyAlignedWithTable = (
  lineTokens: TextToken[],
  neighboringTableTokens: TextToken[]
): boolean => {
  if (lineTokens.length === 0 || neighboringTableTokens.length === 0) return false;

  // Coleta os X-ranges das colunas das linhas de tabela vizinhas
  const tableXRanges = neighboringTableTokens.map(tok => ({ xLeft: tok.x, xRight: tok.x + tok.w }));

  // Verifica se pelo menos 50% dos tokens da linha atual se sobrepõem com algum range de tabela
  let alignedCount = 0;
  for (const tok of lineTokens) {
    const overlap = tableXRanges.some(r =>
      tok.x < r.xRight + 20 && tok.x + tok.w > r.xLeft - 20
    );
    if (overlap) alignedCount++;
  }
  return alignedCount >= Math.ceil(lineTokens.length * 0.5);
};

/**
 * Detecta se a linha possui estrutura típica de tabela.
 * Utiliza tokens geométricos para uma decisão precisa, com sinais negativos fortes
 * para evitar falsos positivos em parágrafos com negrito/formatação.
 */
export const detectTableStructure = (text: string, tokens?: TextToken[]): boolean => {
    if (!text) return false;
    if (text.includes('![Img]') || text.includes('![Imagem')) return true;
    
    const plain = text.replace(/\*\*/g, '').trim();
    if (!plain) return false;

    // ── SINAIS NEGATIVOS FORTES — nunca são tabela ──────────────────────────
    
    // Título centralizado em CAIXA ALTA (ex: "CHOAE/2025 - FICHA DE AVALIAÇÃO DE ESTÁGIO")
    const isAllCaps = plain === plain.toUpperCase() && plain.length > 15;
    const hasNoGaps = (plain.match(/\s{3,}/g) || []).length === 0;
    if (isAllCaps && hasNoGaps) return false;
    
    // Padrões de parágrafo legal/narrativo que nunca são tabela,
    // mesmo que contenham gaps geométricos causados por negrito.
    const isDefinitelyParagraph =
      // Numeração hierárquica de documento (1.1., 1.1.1.)
      /^\d+\.\d+\.?\s/.test(plain) ||
      // Começa com preposição/artigo (continuação de parágrafo)
      /^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela |pelos |pelas |ao |aos |às )/i.test(plain) ||
      // Contém "por necessidade de serviço"
      /por\s+necessidade\s+de\s+servi[çc]o/i.test(plain) ||
      // Contém SEI (referência de processo)
      /\(SEI[-\s]\d+/.test(plain) ||
      // Linha de portaria/designação: contém "Portaria" ou "designando" ou "nomeando"
      /\bPortaria\b/i.test(plain) ||
      /\bdesignando\b/i.test(plain) ||
      /\bnomeando\b/i.test(plain) ||
      /\bpromover\b/i.test(plain) ||
      /\bagregar\b/i.test(plain) ||
      // Linha narrativa longa com vírgulas e terminação em ponto (parágrafo típico)
      (plain.length > 80 && /,$/.test(plain.replace(/\s+$/, '')) === false && /\.$/.test(plain) && (plain.match(/,/g) || []).length >= 2) ||
      // Contém "da Diretoria" / "do Comando" / "da Assessoria" 
      // mas APENAS se não tiver múltiplos espaços largos (que indicariam tabela)
      (/\b(da|do|de)\s+(Diretoria|Comando|Assessoria|Corregedoria|Secretaria|Divisão|Seção)\b/i.test(plain) && (plain.match(/\s{3,}/g) || []).length < 2) ||
      // Linha de dados de militar: contém RG seguido de número
      /\bRG\s+\d/.test(plain) ||
      // Linha com vírgula antes de RG = dado de militar
      /,\s*RG\b/i.test(plain) ||
      // Linha de horário: começa com hora (08h, 08:15h, etc.)
      /^\d{1,2}[h:]\d*/.test(plain.trim()) ||
      // Linha com "Id Funcional" seguido de número = dado de militar
      /Id\s*Funcional\s+\d/i.test(plain) ||
      // Linha que termina em hífen (palavra quebrada) - apenas se for curta (indicativo de quebra)
      /-$/.test(plain) && plain.length < 50;

    if (isDefinitelyParagraph) return false;

    // ── ANÁLISE GEOMÉTRICA (quando tokens disponíveis) ──────────────────────
    if (tokens && tokens.length > 1) {
        // Usa a Assinatura de Layout para decidir se é uma estrutura rítmica (tabela)
        const signature = detectLayoutSignature(tokens);
        if (signature.isRhythmic && signature.verticalAxes.length >= 3) return true;

        const sorted = [...tokens].sort((a, b) => a.x - b.x);
        const gaps: number[] = [];
        
        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].x - (sorted[i-1].x + sorted[i-1].w);
            if (gap > 0) gaps.push(gap);
        }

        if (gaps.length === 0) return false;

        gaps.sort((a, b) => a - b);
        const maxGap = gaps[gaps.length - 1];
        const medianGap = gaps[Math.floor(gaps.length / 2)];

        // Tabela real: gaps de coluna são CONSISTENTES — vários gaps grandes do mesmo tamanho.
        // Parágrafo com negrito: 1-2 gaps grandes isolados, resto pequeno.
        const settings = calibrationService.settings;
        const largeGapThreshold = Math.max(settings.tableGapThreshold, medianGap * 4);
        const largeGaps = gaps.filter(g => g > largeGapThreshold);

        // Exige pelo menos 2 gaps grandes para confirmar estrutura de coluna
        // (1 gap grande isolado = provavelmente negrito/formatação, não coluna)
        if (largeGaps.length >= 2) return true;

        // 1 gap grande só confirma tabela se for muito grande (> 150px = coluna bem separada)
        // E a linha for muito curta (não é parágrafo com negrito no meio)
        if (largeGaps.length === 1 && maxGap > settings.tableStrictGapThreshold && plain.length < 60) return true;

        // Gap máximo pequeno = parágrafo justificado
        if (maxGap < 40) return false;

        // Gap médio-grande mas só 1 = provavelmente negrito, não tabela
        return false;
    }

    // ── FALLBACK TEXTUAL ────────────────────────────────────────────────────
    const wideSpaceMatches = (plain.match(/\s{3,}/g) || []).length;
    const hasTableArtifacts = /[|│║]/.test(plain);
    const looksLikeSentence = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇa-záéíóúâêîôûãõç]/.test(plain) && /[.;:!]$/.test(plain);
    
    if (hasTableArtifacts) return true;
    // Linha que parece sentença com poucos espaços largos = parágrafo
    if (looksLikeSentence && wideSpaceMatches < 3) return false;
    // Linha longa com sentença = parágrafo (mesmo com espaços)
    if (looksLikeSentence && plain.length > 80) return false;
    
    if (plain.length < 50 && wideSpaceMatches >= 2) return true;
    if (plain.length > 100 && wideSpaceMatches >= 4) return true; 
    if (wideSpaceMatches >= 3) return true; 

    return false;
};

/**
 * Verifica se a linha é um cabeçalho de tabela militar.
 *
 * Princípio: um cabeçalho de tabela é uma linha que contém APENAS nomes de colunas,
 * sem dados reais (nomes de pessoas, números de RG, datas, etc.).
 *
 * Estratégia em camadas:
 * 1. Rejeita imediatamente linhas que são claramente parágrafos/dados
 * 2. Aceita padrões compostos com barra (POSTO/GRAD, OBM/DBM) — evidência forte
 * 3. Conta palavras-chave "puras" (só aparecem como nome de coluna, nunca em dados)
 * 4. Conta palavras-chave "contextuais" (podem aparecer em dados, mas com restrições)
 * 5. Conta palavras-chave "ambíguas" (RG, Nº) — só valem quando isoladas (sem número após)
 */
export const isTableHeader = (text: string): boolean => {
  const clean = text.replace(/\*\*/g, '').toUpperCase().trim();
  if (!clean) return false;

  const plain = text.replace(/\*\*/g, '').trim();

  // ── REJEIÇÕES IMEDIATAS ──────────────────────────────────────────────────

  if (/;\s*$/.test(plain)) return false;
  if (/\(SEI[-\s]\d+/.test(plain)) return false;
  if (/por\s+necessidade\s+de\s+servi[çc]o/i.test(plain)) return false;
  // Sub-título numerado (ex: "3. MILITARES CAPACITADOS:", "1. VIATURA:")
  if (/^\d+[\s.]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ].*:$/.test(plain.toUpperCase())) return false;
  if (plain.length > 80 && /\.$/.test(plain) && (plain.match(/,/g) || []).length >= 2) return false;
  if (/^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela )/i.test(plain)) return false;
  // RG seguido de número = dado de militar (ex: "RG 43.544")
  if (/\bRG\s+\d/.test(plain)) return false;
  // Linha começa com horário = dado de agenda/escala (ex: "08h    ABERTURA")
  if (/^\d{1,2}[h:]\d*/.test(plain.trim())) return false;
  // Vírgula antes de RG = dado de militar
  if (/,\s*RG\b/i.test(plain)) return false;
  // Id Funcional com número = dado de militar
  if (/Id\s*Funcional\s+\d/i.test(plain)) return false;

  // ── PADRÕES COMPOSTOS COM BARRA — evidência forte de cabeçalho ──────────
  const compositeHeaderPatterns = [
    /\bPOSTO\s*\/\s*GRAD/,
    /\bGRAD\s*\/\s*ANO/,
    /\bN[°º]\s*\/\s*RG/,
    /\bRG\s*\/\s*ID/,
    /\bOBM\s*\/\s*DBM/,
    /\bNOME\s*\/\s*GUERRA/,
    /\bID\s*\/\s*FUNCIONAL/,
    /\bCLASSIF\s*\/\s*QUADRO/,
    /\bPOSTO\s*\/\s*NOME/,
    /\bMILITAR\s*\/\s*OBM/,
  ];
  if (compositeHeaderPatterns.some(p => p.test(clean))) return true;

  // Nº/N° seguido de número (com espaço) = dado, não cabeçalho (ex: "Nº 02 CARLOS SILVA")
  const hasNrWithValue = /\bN[°º]\s{0,3}\d/.test(plain);

  // Linha de dados: tem 2+ vírgulas (lista de militares) ou número longo (Id Funcional)
  const looksLikeData = (plain.match(/,/g) || []).length >= 2 || /\d{4,}/.test(plain);

  // ── PALAVRAS-CHAVE "PURAS" — só aparecem como nome de coluna ────────────
  const pureKeywords = [
    'GRADUAÇÃO', 'MATRÍCULA', 'ID FUNCIONAL', 'IDENTIDADE', 'CPF',
    'QUADRO', 'CLASSIFICAÇÃO', 'QBMP', 'QMP', 'FUNÇÃO', 'CARGO',
    'CAPACITADO', 'CAPACITADOS', 'APROVADO', 'APROVADOS',
    'VENCIMENTO', 'DESCONTO', 'SITUAÇÃO', 'OBSERVAÇÃO', 'PACIENTE', 'RESPONSÁVEL',
  ];

  // ── PALAVRAS-CHAVE "CONTEXTUAIS" — podem aparecer em dados também ────────
  // Só contam se a linha não parece ser dado e é curta.
  // Palavras precedidas de ordinal (ex: "5º GBM", "1º OBM") = nome de unidade → não contam.
  const contextualKeywords = [
    'NOME', 'POSTO', 'OBM', 'DBM', 'GBM', 'UNIDADE', 'GRAD',
    'MILITAR', 'MILITARES', 'INSTRUTOR', 'INSTRUTORES', 'ALUNO', 'ALUNOS',
    'HORÁRIO', 'PERÍODO', 'DATA', 'LOCAL', 'TEMA', 'TURMA', 'VALOR', 'RESULTADO',
  ];

  // ── PALAVRAS-CHAVE "AMBÍGUAS" — RG, Nº só valem quando isoladas ─────────
  // Isolado = não seguido de dígito (com até 3 espaços entre eles)
  const ambiguousKeywords = ['RG', 'Nº', 'N°'];

  let pureCount = 0;
  for (const h of pureKeywords) {
    if (new RegExp(`\\b${h}\\b`).test(clean)) pureCount++;
  }

  let contextCount = 0;
  if (!looksLikeData && plain.length < 80) {
    for (const h of contextualKeywords) {
      if (new RegExp(`\\b${h}\\b`).test(clean)) {
        // Rejeita se precedida por ordinal (ex: "5º GBM") = nome de unidade, não coluna
        if (!new RegExp(`\\d[°º]\\s+${h}\\b`).test(clean)) contextCount++;
      }
    }
  }

  let ambigCount = 0;
  if (!looksLikeData && !hasNrWithValue) {
    for (const h of ambiguousKeywords) {
      // Isolado = não seguido de dígito (com até 3 espaços)
      if (new RegExp(`\\b${h}\\b(?!\\s{0,3}\\d)`).test(clean)) ambigCount++;
    }
  }

  const totalCount = pureCount + contextCount + ambigCount;

  // 2+ palavras-chave = cabeçalho confirmado
  if (totalCount >= 2) return true;

  // 1 palavra-chave pura + pelo menos 1 gap de coluna
  if (pureCount >= 1) {
    const gaps = (clean.match(/\s{3,}/g) || []).length;
    if (gaps >= 1 && clean.length < 80) return true;
  }

  // 1 palavra-chave contextual/ambígua + 2+ gaps + linha muito curta
  if (contextCount + ambigCount >= 1) {
    const gaps = (clean.match(/\s{3,}/g) || []).length;
    if (gaps >= 2 && clean.length < 60) return true;
  }

  return false;
};
