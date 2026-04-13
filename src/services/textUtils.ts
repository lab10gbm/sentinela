/**
 * textUtils.ts — Módulo compartilhado de utilitários de processamento de texto.
 *
 * Funções extraídas de localSearchService.ts para reuso em
 * bulletinParserService.ts e qualquer outro serviço que precise processar
 * texto de PDFs militares.
 */

import { TextToken } from "../types";
import { calibrationService } from "./calibrationService";
import { hasMultipleFormFields, isFormFieldLine } from "../core/text/formFieldSplitter";
import { SINGLE_COL_LIST_RE } from "./tableTypes";

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
  //    Também cobre: "45. 32 0" → "45.320" (ponto solto + fragmentos separados)
  //    Passo 2a: "45. 32" → "45.32" (ponto solto seguido de dígitos, em qualquer posição)
  s = s.replace(/(\d+)\.\s+(\d+)/g, '$1.$2');
  //    Passo 2b: "32.7 08" → "32.708" (fragmento decimal + dígitos curtos ≤ 3)
  s = s.replace(/(\d+\.\d+)\s+(\d{1,3})(?=\s|$)/g, '$1$2');
  //    Passo 2c: segunda passagem para casos encadeados (ex: "45.32 0" → "45.320")
  s = s.replace(/(\d+\.\d+)\s+(\d{1,3})(?=\s|$)/g, '$1$2');

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

  // 5. Normalização de RG sem ponto: 5-6 dígitos isolados → NN.NNN
  //    Regra: os últimos 3 dígitos são sempre a parte após o ponto.
  //    Ex: 53392 → 53.392, 543920 → 54.392 (não aplicar se já tem ponto)
  s = s.replace(/\b(\d{5,6})\b/g, (match) => {
    // Só normaliza se não estiver já no formato NN.NNN
    if (/^\d{1,2}\.\d{3}$/.test(match)) return match;
    const prefix = match.slice(0, match.length - 3);
    const suffix = match.slice(-3);
    return `${prefix}.${suffix}`;
  });

  // 6. Colapsa múltiplos espaços residuais
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
  if (!clean) return false;

  // EXCEÇÃO DE OURO: Se a linha parece um cabeçalho de tabela legítimo, NUNCA é lixo de página.
  // Isso protege tabelas que começam bem no topo ou pé da página.
  const up = clean.replace(/\*\*/g, '');
  if (up.includes("QTD") && (up.includes("NOME") || up.includes("POSTO") || up.includes("RG") || up.includes("OBM"))) {
    return false;
  }

  if (/^(BOLETIM|FL\.|PÁG|CONTINUAÇÃO|SUMÁRIO|RIODEJANEIRO|ESTADO DO RIO|CORPO DE BOMBEIROS)/.test(clean)) return true;
  if (/^FL\.\s*\d+/.test(clean)) return true;
  
  // Texto com letras separadas por espaço: "B O L E T I M"
  if (/^(?:[A-Z]\s+){4,}[A-Z]/.test(clean)) return true;
  if (/(?:B\s*){2}(?:O\s*){2}/.test(clean)) return true;

  // Letras duplicadas consecutivas (artefato de kerning do PDF)
  // Só filtra se não houver palavras úteis de tabela no meio.
  const letterDupPairs = (clean.match(/([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ])\1/g) || []).length;
  if (letterDupPairs >= 4 && !up.includes("NOME") && !up.includes("RG")) return true;
  
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
  // Suporta numeração com ponto ou parêntese (ex: "1. TÍTULO:", "1) TÍTULO:")
  return /^\d+[\s.)]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ].*:$/.test(clean);
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
 * 
 * CORREÇÃO #2: Detecta linhas de dados de formulário (padrão "Palavra:") e as preserva como lista.
 * CORREÇÃO #2B: Quebra linhas com múltiplos campos de dados (ex: "Data:... Horário:... Local:...")
 */
export const joinWrappedParagraphs = (text: string): string => {
  if (!text) return "";
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]; // linha sem trim para detectar indentação
    const current = raw.trim();
    const next = (i + 1 < lines.length) ? lines[i + 1].trim() : null;
    // Se a próxima linha é um marcador de parágrafo, trata como se não houvesse próxima linha
    const nextEffective = (next === '\x00PARABREAK\x00') ? null : next;

    // Marcador explícito de quebra de parágrafo (inserido pelo cleanAndFormatSlice via Y-gap).
    // NUNCA descartado — sempre vira linha vazia no output.
    if (current === '\x00PARABREAK\x00') {
      result.push("");
      continue;
    }
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
    // Inclui "- " como marcador de lista (ex: "- Ten Cel BM QOC/00 EULER...")
    const isListItem = /^(\d+[.)]\s|\d+\s+-\s+|[a-z][.)]\s|[IVX]+[.)]\s|-\s+\S)/.test(current);
    const isTableLine = current.includes('|') || current.startsWith('```');
    const isImage = current.includes('![Img]') || current.includes('![Imagem');

    // Continuação de referência incompleta: linha anterior termina com sigla que exige número
    // (ex: "PINHEIRO, RG" + "31.365;" — quebra de página no meio de dado de militar)
    const prevResult = result.length > 0 ? result[result.length - 1] : "";
    const prevResultPlain = prevResult.replace(/\*\*/g, '').trim();
    const prevEndsWithIncompleteRef = /\b(RG|Id|nº|n°|n\.|Art\.|§)\s*$/i.test(prevResultPlain) ||
      /,\s*RG\s*$/i.test(prevResultPlain);
    if (prevEndsWithIncompleteRef && /^\d/.test(currentPlain)) {
      // Une diretamente com a linha anterior no result
      result[result.length - 1] = prevResult + currentPlain;
      continue;
    }
    
    // Usa formFieldSplitter — fonte única de verdade para detecção de campos
    const isFormDataLine = isFormFieldLine(current);
    const hasMultipleFields = hasMultipleFormFields(current);
    
    // CORREÇÃO #2F: Linha com indentação de 4 espaços (criada pela quebra no formFieldSplitter)
    // Essas linhas NUNCA devem ser unidas com outras
    // IMPORTANTE: usa `raw` (sem trim) para detectar a indentação
    const hasFormIndentation = /^    /.test(raw);
    
    // Log diagnóstico para linhas com campos de formulário
    if (isFormDataLine || hasMultipleFields) {
      // Descomente para diagnóstico: console.log(`[joinWrappedParagraphs] campo="${currentPlain.substring(0,80)}" isFormDataLine=${isFormDataLine} hasMulti=${hasMultipleFields}`);
    }
    
    // Linha de dados de militar: contém RG com número, Id Funcional, ou padrão "NOME RG NÚMERO"
    // Só considera linha de dados se for curta (< 80 chars) — linhas longas são parágrafos narrativos
    const isMilitaryDataLine = currentPlain.length < 80 && (
      /\bRG\s+\d/.test(current) || /Id\s*Funcional\s+\d/i.test(current) || /,\s*RG\b/i.test(current)
    );

    // Palavras que SEMPRE iniciam um novo parágrafo em documentos oficiais militares.
    // A linha atual NUNCA deve ser unida com a próxima se a próxima começa com uma dessas.
    const OFFICIAL_PARAGRAPH_STARTERS = /^(Considerando\b|Art\.\s*\d|Parágrafo\s+único|§\s*\d|Resolve[:\s]|RESOLVE[:\s]|Em\s+conseq|Torna\s+P[úu]blica|O\s+Cel\s+BM\b|O\s+Subcomandante\b)/;
    const nextStartsNewParagraph = nextEffective ? OFFICIAL_PARAGRAPH_STARTERS.test(nextEffective.replace(/\*\*/g, '')) : false;

    // MÁXIMO RIGOR: Se for título (CAIXA ALTA), NUNCA une com a linha de baixo
    // a menos que a linha de baixo seja minúscula (continuação improvável para títulos)
    if (isHeader && nextEffective && !/^[a-zÀ-ü]/.test(nextEffective)) {
      result.push(current);
      continue;
    }

    // Linha de dados de militar ou formulário nunca é unida com a próxima
    // CORREÇÃO #2F: Inclui linhas com indentação de formulário
    if (isMilitaryDataLine || isFormDataLine || hasFormIndentation) {
      result.push(current);
      // Mesmo para linhas militares: se termina com ponto e próxima começa com maiúscula, separa
      if (endsWithStrongPunctuation && nextEffective) {
        const nextPlain = nextEffective.replace(/\*\*/g, '').trim();
        if (/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(nextPlain) && !/^[a-zÀ-ü]/.test(nextPlain) &&
            !/^(\d+|[a-z]|[IVX]+)[\s.-]/.test(nextPlain) &&
            !nextEffective.includes('|') && !nextEffective.startsWith('```')) {
          result.push("");
        }
      }
      continue;
    }

    if (!endsWithStrongPunctuation && !isTableLine && !isImage && nextEffective) {
      // nextIsListItem: número/letra seguido de ponto, parêntese ou hífen — não de espaço+parêntese
      const nextIsListItem = /^(\d+[.)]\s|\d+\s+-\s+|[a-z][.)]\s|[IVX]+[.)]\s|-\s+\S)/.test(nextEffective);
      const nextIsTable = nextEffective.includes('|') || nextEffective.startsWith('```');
      const nextIsImage = nextEffective.includes('![Img]') || nextEffective.includes('![Imagem');
      const nextIsLower = /^[a-zÀ-ü]/.test(nextEffective);
      // Fragmento curto: só considera se NÃO for header (evita unir títulos em CAIXA ALTA)
      const currentIsShortFragment = !isHeader && current.replace(/\*\*/g, '').length < 25 && !endsWithStrongPunctuation;

      if (!nextIsListItem && !nextIsTable && !nextIsImage) {
        // Nunca une se a próxima linha inicia um parágrafo de documento oficial
        if (nextStartsNewParagraph) {
          result.push(current);
          continue;
        }
        // Une se: próxima começa com minúscula, OU linha atual é fragmento curto sem pontuação
        // Para itens de lista: só une se a próxima começa com minúscula (continuação da frase)
        // Exceção: linha termina com preposição/artigo → sempre é continuação, une independente
        // Exceção 2: item de lista "- " cuja próxima linha é continuação (não começa com "- " nem é novo item)
        const endsWithPreposition = /\b(pela|pelo|pelos|pelas|da|do|das|dos|de|a|o|e|em|no|na|nos|nas|com|para|ao|aos|às|por|sob|sobre|entre|até|após|ante|perante|mediante|conforme|segundo|durante|exceto|salvo|inclusive|exclusive|via)\s*$/i.test(currentPlain);
        const isDashListItem = /^-\s+\S/.test(current);
        const nextIsDashListItem = /^-\s+\S/.test(nextEffective);
        // Continuação de item "- ": próxima não é novo item de lista e não é header
        const isDashContinuation = isDashListItem && !nextIsListItem && !isVisualHeader(nextEffective) && !nextIsDashListItem;
        if (nextIsLower || endsWithPreposition || (!isListItem && currentIsShortFragment) || isDashContinuation) {
          lines[i + 1] = current + " " + nextEffective;
          continue;
        }
        
        // Se as duas linhas são normais (não-header, não-lista), une (fluxo de parágrafo)
        if (!isHeader && !isListItem && !isVisualHeader(nextEffective) && nextEffective.length > 0) {
          lines[i + 1] = current + " " + nextEffective;
          continue;
        }
      }
    }

    result.push(current);

    // Se a linha atual termina com ponto final E a próxima começa com maiúscula
    // (novo parágrafo sem espaço extra no PDF), inserir separador de parágrafo.
    // Condição: próxima não é continuação (minúscula), não é lista, não é tabela.
    if (endsWithStrongPunctuation && nextEffective && !isTableLine && !isImage) {
      const nextPlain = nextEffective.replace(/\*\*/g, '').trim();
      const nextIsLower = /^[a-zÀ-ü]/.test(nextPlain);
      const nextIsListItem = /^(\d+|[a-z]|[IVX]+)[\s.-]/.test(nextPlain);
      const nextIsDashItem = /^-\s+\S/.test(nextPlain);
      const nextIsTable = nextEffective.includes('|') || nextEffective.startsWith('```');
      const nextStartsUpper = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(nextPlain);
      if ((nextStartsUpper && !nextIsLower && !nextIsListItem && !nextIsTable) || nextIsDashItem) {
        result.push("");
      }
    }
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
 * Detecta linhas que são DEFINITIVAMENTE parágrafos legais/narrativos (nunca tabela).
 */
export const isHardLegalParagraph = (text: string): boolean => {
  const plain = text.trim().replace(/\*\*/g, '');
  
  return (
    // Título de nota ou edital (ex: "1. CURSO DE...")
    /^\d+[.\s]+.*(CURSO|RELAÇÃO|EDITAL|NOTA|PROGRAMA|PLANO|INSCRIÇÃO|CONVOCAÇÃO|RESULTADO|GABARITO|ATA|PORTARIA|RESOLUÇÃO|DESPACHO)/i.test(plain) ||
    // Numeração hierárquica de documento (1.1., 1.1.1.)
    /^\d+\.\d+\.?\s/.test(plain) ||
    // Fórmulas fixas de introdução militar (TORNA PÚBLICA, RESOLVE, DETERMINA)
    /^\b(TORNA\s+PÚBLICA|TORNA\s+SEM\s+EFEITO|RESOLVE|DETERMINA|DESIGNA|CONCEDE|RETIFICA|ADITA|AUTORIZA|PROMOVE|INCLUI|EXCLUI|TRANSFERE|RESERVA|APOSENTA|CONVOCAR|TORNA\s+INSUFICIENTE|CONSIDERANDO)\b/i.test(plain) ||
    // Introdução de notas de instrução/curso
    /\b(relação\s+de\s+inscritos|processo\s+seletivo|à\s+saber:|conforme\s+segue\b|nos\s+termos\s+da\b|em\s+epígrafe\b|publicada\s+no\s+Boletim\b)/i.test(plain) ||
    // Começa com preposição/artigo (continuação de parágrafo)
    /^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela |pelos |pelas |ao |aos |às )/i.test(plain) ||
    // Fórmulas de encerramento de documento oficial
    /^Em\s+conseq/i.test(plain) ||
    /^Em\s+aten[çc]/i.test(plain) ||
    /^Em\s+cumprimento/i.test(plain) ||
    /^Registre[-\s]se/i.test(plain) ||
    /^Publique[-\s]se/i.test(plain) ||
    /^Cumpra[-\s]se/i.test(plain) ||
    // Autoridades e OBMs como intro
    /^\b(O\s+Cel\s+BM|O\s+Comandante|O\s+Diretor|O\s+Chefe|O\s+Subcomandante|O\s+Secretário|O\s+Estado-Maior|O\s+Cel\s+BM\s+Diretor)\b/i.test(plain) ||
    /^(GMar|GBM|DBM|CER|ABMDP|CEMAR|GBS|GSE|Primeiro\s+Grupamento|Segundo\s+Grupamento)\b/i.test(plain) && plain.length < 60 && !/\d{2}\.\d{3}/.test(plain) && !/\d+\//.test(plain) ||
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
    // Linha que parece título de nota (começa com número e tem palavras de documento)
    /^\d+[.\s]+.*(NOTA|CURSO|RELAÇÃO|LISTA|EDITAL|PROGRAMA|CRONOGRAMA|PLANO)/i.test(plain) ||
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

  // Verifica se pelo menos 70% dos tokens da linha atual se sobrepõem com algum range de tabela
  let alignedCount = 0;
  for (const tok of lineTokens) {
    // Reduzida a tolerância para 10px para evitar sobreposição acidental com parágrafos
    const overlap = tableXRanges.some(r =>
      tok.x < r.xRight + 10 && tok.x + tok.w > r.xLeft - 10
    );
    if (overlap) alignedCount++;
  }
  return alignedCount >= Math.ceil(lineTokens.length * 0.7);
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

    const wideSpaceMatches = (plain.match(/\s{3,}/g) || []).length;

    // ── SINAIS NEGATIVOS FORTES — nunca são tabela ──────────────────────────
    
    // Título centralizado em CAIXA ALTA (ex: "CHOAE/2025 - FICHA DE AVALIAÇÃO DE ESTÁGIO")
    const isAllCaps = plain === plain.toUpperCase() && plain.length > 15;
    const hasNoGaps = (plain.match(/\s{3,}/g) || []).length === 0;
    if (isAllCaps && hasNoGaps) return false;
    
    // Padrões de parágrafo legal/narrativo que nunca são tabela,
    // mesmo que contenham gaps geométricos causados por negrito.
    const isDefinitelyParagraph =
      // Título de nota ou edital (ex: "1. CURSO DE...") - Rigoroso: começa com numeração e tem palavras-chave
    // Se a linha for um cabeçalho legítimo (ex: "1. NOME RG"), isTableHeader já terá sido verificado antes ou será verificado depois.
    (/^\d+[.\s]+.*(CURSO|RELAÇÃO|EDITAL|NOTA|PROGRAMA|PLANO|INSCRIÇÃO|CONVOCAÇÃO|RESULTADO|GABARITO|ATA|PORTARIA|RESOLUÇÃO|DESPACHO)/i.test(plain) && !/QTD|ORDEM|POSTO|GRAD|NOME|RG|ID\s*FUNC|OBM/i.test(plain.toUpperCase())) ||
      // Fórmulas de introdução militar
      /^\b(TORNA\s+PÚBLICA|RESOLVE|DETERMINA|O\s+Cel\s+BM|O\s+Comandante|O\s+Diretor)\b/i.test(plain) ||
      // Numeração hierárquica de documento (1.1., 1.1.1.) ou diretriz (1), 2))
      /^\d+([.)]|\.\d+)/.test(plain) ||
      // Linha começa com letra minúscula (continuação de parágrafo)
      /^[a-zÀ-ü]/.test(plain) ||
      // Começa com preposição/artigo (continuação de parágrafo)
      /^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela |pelos |pelas |ao |aos |às )/i.test(plain) ||
      // Referência a boletim ou página (FL. 10, BOL. 05)
      /^(FL\.|BOL\.|PÁG\.|PAG\.)\s*\d+/i.test(plain) ||
      // Contém "por necessidade de serviço"
      /por\s+necessidade\s+de\s+servi[çc]o/i.test(plain) ||
      // Contém SEI (referência de processo)
      /\(SEI[-\s]\d+/.test(plain) ||
      // Linha de portaria/designação narrativa longa que termina em ponto
      (plain.length > 80 && /,$/.test(plain.replace(/\s+$/, '')) === false && /\.$/.test(plain) && (plain.match(/,/g) || []).length >= 3) ||
      // Linha que termina em hífen (palavra quebrada) - apenas se for curta
      (/-$/.test(plain) && plain.length < 50);

    if (isDefinitelyParagraph) return false;

    // ── ANÁLISE GEOMÉTRICA (quando tokens disponíveis) ──────────────────────
    if (tokens && tokens.length > 1) {
        // DATA GRID SIGNATURE: Se a linha tem 4+ tokens e eles cobrem mais de 50% da largura da página
        // (tipicamente entre X=50 e X=500), é muito provavelmente uma linha de tabela.
        const sorted = [...tokens].sort((a, b) => a.x - b.x);
        const minX = sorted[0].x;
        const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
        const span = maxX - minX;
        
        // Padrão de Cabeçalho Denso (COESCI/COER): Muitas palavras curtas alinhadas horizontalmente
        // Se a linha contém âncoras militares E tem múltiplos tokens, forçamos a detecção como tabela.
        if (tokens.length >= 3 && /QTD|ORDEM|POSTO|GRAD|NOME|RG|ID\s*FUNC|OBM/i.test(plain.toUpperCase())) {
          return true;
        }

        if (tokens.length >= 4 && span > 300 && plain.length < 250) {
          // Verifica se os tokens não estão todos "amontoados" num parágrafo curto
          const avgDist = span / tokens.length;
          if (avgDist > 25) return true;
        }

        // Usa a Assinatura de Layout para decidir se é uma estrutura rítmica (tabela)
        const signature = detectLayoutSignature(tokens);
        if (signature.isRhythmic && signature.verticalAxes.length >= 3) return true;

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
  const up = plain.toUpperCase();

  // ── REGRA DE OURO (FORÇADA) ─────────────────────────────────────────────
  // Se contiver QTD/ORDEM e qualquer outra palavra de tabela no mesmo bloco, É cabeçalho.
  const anchors = ["QTD", "ORDEM", "NOME", "POSTO", "GRAD", "RG", "ID", "OBM", "FUNCIONAL", "INSCRIÇÃO", "INSC", "RELAÇÃO", "INSCRITOS", "PÁG", "PAG", "MATRÍCULA", "IDENTIDADE", "CLASSIFICAÇÃO", "QUADRO", "CPF", "Nº", "N°"];
  const upMatch = anchors.filter(a => up.includes(a));
  
  // Detecção de Grade Militar Típica (QTD POSTO/GRAD. NOME RG ID FUNCIONAL OBM)
  // Se houver 4+ âncoras na mesma linha, é 100% de certeza que é cabeçalho.
  if (upMatch.length >= 4) return true;

  // Caso 1: QTD/ORDEM + 1 âncora = cabeçalho quase certo
  if ((up.includes("QTD") || up.includes("ORDEM")) && upMatch.length >= 2) {
    return true;
  }

  // Caso 2: Pelo menos 3 âncoras (ex: "NOME RG ID FUNCIONAL")
  if (upMatch.length >= 3 && plain.length < 150) {
    return true;
  }

  // Caso 3: Padrões de cabeçalho de grade militar muito curtos com espaços largos ou tabulações
  if (upMatch.length >= 2 && (plain.match(/\s{2,}/g) || []).length >= 1 && plain.length < 80) {
    return true;
  }

   // Caso 4: Palavras de cabeçalho puro isoladas (ex: "MILITAR", "RELACIONADOS")
   // SINGLE_COL_LIST_RE — fonte única em tableTypes.ts
   if (SINGLE_COL_LIST_RE.test(clean.trim())) return true;

   // ── REJEIÇÕES IMEDIATAS ──────────────────────────────────────────────────

   if (/;\s*$/.test(plain)) return false;
   if (/\(SEI[-\s]\d+/.test(plain)) return false;
   if (/por\s+necessidade\s+de\s+servi[çc]o/i.test(plain)) return false;
   // Sub-título numerado (ex: "3. MILITARES CAPACITADOS:", "1) VIATURA:")
   if (/^\d+[\s.)]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ].*:$/.test(plain.toUpperCase())) return false;
   // Subtítulo interno de documento: "1. DATA, HORA E LOCAL", "2) REFERÊNCIAS", "3. UNIFORME"
   // Se chegou aqui, as "Regras de Ouro" não o identificaram como cabeçalho.
   if (/^\d+[\s.)]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(plain)) return false;
   if (plain.length > 80 && /\.$/.test(plain) && (plain.match(/,/g) || []).length >= 2) return false;
   if (/^(e |de |do |da |dos |das |no |na |nos |nas |com |para |pelo |pela )/i.test(plain)) return false;
   // Campo de formulário: "Palavra:" ou "Palavra: valor" — nunca é cabeçalho
   if (/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç\s]+:/.test(plain)) return false;
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
    'NOME', 'POSTO', 'OBM', 'DBM', 'GBM', 'UNIDADE', 'GRAD', 'QTD', 'ORDEM', 'INSCRIÇÃO', 'INSC',
    'MILITAR', 'MILITARES', 'INSTRUTOR', 'INSTRUTORES', 'ALUNO', 'ALUNOS', 'INSCRITOS', 'RELAÇÃO',
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
