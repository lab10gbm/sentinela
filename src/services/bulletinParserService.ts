import { extractTextFromPdf } from "./pdfWorkerService";
import { BulletinNota, TextToken, TableData, MilitaryPerson, SearchPreferences } from "../types";
import {
  normalizeTitle,
  stripNumericPrefix,
  isTOCLine,
  isPageHeaderOrFooter,
  isRectificationMarker,
  isSubSectionTitle,
  stripInternalMarkers,
  cleanNoteTitle,
  REGEX_PARTE_PREFIX,
  REGEX_EIXO_PREFIX,
  REGEX_ITEM_PREFIX,
  REGEX_LETTER_ITEM_PREFIX,
  REGEX_ANEXO_PREFIX,
  detectTableStructure,
  isTableHeader,
  joinWrappedParagraphs,
  calcTocDensity,
} from "./textUtils";
import { reconstructTable } from "./TableReconstructor";
import {
  CANONICAL_STRUCTURE,
  fuzzyKey,
  matchCanonical,
  buildHierarchy,
  SectionStackItem,
} from "./hierarchyService";
import { matchPersonnelInLine } from "./localSearchService";

// ──────────────────────────────────────────────
// TIPOS INTERNOS
// ──────────────────────────────────────────────

export interface SummaryItem {
  cleanTitle: string;
  originalRaw: string;
  expectedPage: number | null;
  foundLineIndex?: number;
  hierarchy?: string;
  parentCategory?: string;
  isSemAlteracao?: boolean;
  notaEmissor?: string;
  notaNumero?: string;
}

// ──────────────────────────────────────────────
// EXTRAÇÃO DO BLOCO DO SUMÁRIO (Page-aware)
// ──────────────────────────────────────────────

type PageMapEntry = { page: number; text: string; tokens: TextToken[]; lines: { text: string; y: number }[] };

// ──────────────────────────────────────────────
// PADRÕES ESTRUTURAIS FIXOS DO BOLETIM SEDEC
// ──────────────────────────────────────────────

/**
 * Seções e eixos que se repetem em todo boletim SEDEC/CBMERJ.
 * Usados para detectar o bloco do Sumário sem depender da palavra "SUMÁRIO".
 */
const KNOWN_TOC_ANCHORS = [
  /^\d+ª\s*PARTE\b/i,                          // "1ª PARTE", "2ª PARTE" …
  /^FATOS\s+HIST[ÓO]RICOS/i,
  /^ESTAT[ÍI]STICA\s+DE\s+SOCORROS/i,
  /^TEND[EÊ]NCIA\s+METEOROL[ÓO]GICA/i,
  /^SERVI[ÇC]OS?\s+DI[ÁA]RIOS/i,
  /^OPERA[ÇC][ÕO]ES\s+E\s+INSTRU[ÇC][ÃA]O/i,
  /^ASSUNTOS\s+GERAIS/i,
  /^ASSUNTOS\s+ADMINISTRATIVOS/i,
  /^JUSTI[ÇC]A\s+E\s+DISCIPLINA/i,
  /^COMUNICA[ÇC][ÃA]O\s+SOCIAL/i,
  /^ANEXO\s+[IVXLCDM\d]+/i,
];

/** Retorna true se a linha parece ser um âncora estrutural do sumário */
const isTocAnchorLine = (line: string): boolean => {
  const t = line.trim();
  return KNOWN_TOC_ANCHORS.some(re => re.test(t));
};

/**
 * Extrai as linhas brutas do bloco do Sumário a partir do pageMap.
 *
 * Estratégia principal: páginas 2-4 (índices 1-3) são o sumário.
 * Coleta todas as linhas dessas páginas que contenham padrões TOC
 * (separador ___/... + número) OU que sejam âncoras estruturais conhecidas.
 * Continua para a página seguinte enquanto houver densidade TOC suficiente.
 *
 * Não depende da palavra "SUMÁRIO" em nenhum momento.
 */
export const extractTocBlock = (pageMap: PageMapEntry[]): string[] => {
  // O sumário está sempre nas páginas 2 e 3 (índices 1 e 2), podendo se estender até a 4 (índice 3)
  const TOC_PAGE_INDICES = [1, 2, 3].filter(i => i < pageMap.length);
  const TOC_LINE_PATTERN = /(?:[_.]{3,}|[ \t]{2,})\s*\d{1,4}\s*$/;
  const MIN_TOC_LINES_PER_PAGE = 3;

  const allTocLines: string[] = [];

  for (const pageIdx of TOC_PAGE_INDICES) {
    const lines = pageMap[pageIdx].lines.map(l => l.text);

    // Conta linhas com padrão TOC ou âncoras estruturais nesta página
    const tocCount = lines.filter(l => TOC_LINE_PATTERN.test(l) || isTocAnchorLine(l)).length;

    // Se a página não tem densidade mínima de TOC, para de coletar
    if (allTocLines.length > 0 && tocCount < MIN_TOC_LINES_PER_PAGE) break;

    // Inclui a página se tiver pelo menos uma âncora estrutural ou padrão TOC
    if (tocCount >= MIN_TOC_LINES_PER_PAGE || (allTocLines.length === 0 && tocCount > 0)) {
      for (const line of lines) {
        const trimmed = line.trim();
        // Ignora cabeçalhos/rodapés de página e linhas de marcação interna
        if (/^---\s*\[INÍCIO DA PÁGINA/i.test(trimmed)) continue;
        if (/^BOLETIM\s+DA\s+SEDEC/i.test(trimmed)) continue;
        if (/^FL\.\s*\d+$/i.test(trimmed)) continue;
        if (/^!\[.*?\]\(data:image\//i.test(trimmed)) continue; // imagens base64
        allTocLines.push(line);
      }
    }
  }

  if (allTocLines.length > 0) return allTocLines;

  // Fallback: heurística de densidade para cobrir layouts atípicos
  const MIN_DENSITY = 0.25;
  const candidateIndices = [1, 2, 3, 4, 0].filter(i => i < pageMap.length);

  let bestPageIdx = -1;
  let bestDensity = 0;

  for (const pageIdx of candidateIndices) {
    const lines = pageMap[pageIdx].lines.map(l => l.text);
    const density = calcTocDensity(lines);
    if (density > MIN_DENSITY && density > bestDensity) {
      bestDensity = density;
      bestPageIdx = pageIdx;
    }
  }

  if (bestPageIdx !== -1) {
    return pageMap[bestPageIdx].lines.map(l => l.text);
  }

  console.warn("[extractTocBlock] Sumário não encontrado nas primeiras páginas.");
  return [];
};

// ──────────────────────────────────────────────
// PARSER DE LINHAS DO SUMÁRIO (Canonical-Anchored)
// ──────────────────────────────────────────────

/**
 * Converte as linhas brutas do Sumário em SummaryItems usando o esqueleto canônico
 * como âncora (importado de hierarchyService).
 */
export const parseTocLines = (rawLines: string[]): SummaryItem[] => {
  const pending: Array<SummaryItem & { _isHeader: boolean; isSemAlteracao?: boolean }> = [];

  // Contexto atual — atualizado quando um nó canônico é encontrado
  let currentParte = "";
  let currentSecao = "";
  let currentLetraSecao = "";
  let foundFirstParte = false;

  // Extrai número de página do final da linha (suporta ___, ..., espaços duplos, ou espaço simples antes de número isolado)
  const extractPage = (text: string): { page: number | null; title: string } => {
    // Separador explícito: ___ ou ... ou tabs/espaços duplos
    const explicit = /(?:[_.]{2,}|[ \t]{2,})\s*(\d{1,4})\s*$/.exec(text);
    if (explicit) {
      return {
        page: parseInt(explicit[1], 10),
        title: text.slice(0, explicit.index).replace(/[_.]+\s*$/, '').trim(),
      };
    }

    // Caso especial: número de página colado no final de um ano de nota (ex: "NOTA CI/JD 123/202636")
    // Padrão: /20\d\d seguido diretamente de 2 dígitos de página sem espaço
    // Também cobre: título terminando em dígito colado com página (ex: "098/20263737" → "098/2026" pg 37)
    const yearGlued = /^(.*\/20\d{2})(\d{1,3})\s*$/.exec(text);
    if (yearGlued) {
      const pageCandidate = parseInt(yearGlued[2], 10);
      // Só aceita se a página candidata for razoável (1-999) e não for parte do ano
      if (pageCandidate >= 1 && pageCandidate <= 999) {
        return {
          page: pageCandidate,
          title: yearGlued[1].trim(),
        };
      }
    }

    // Número isolado no final separado por espaço simples (ex: "B ALTERACOES DE PRACAS 22")
    const implicit = /^(.*\S)\s+(\d{1,4})\s*$/.exec(text);
    if (implicit) {
      return {
        page: parseInt(implicit[2], 10),
        title: implicit[1].replace(/[_.]+\s*$/, '').trim(),
      };
    }
    return { page: null, title: text.replace(/[_.]+\s*$/, '').trim() };
  };

  const appendToLast = (raw: string, title: string, page: number | null): boolean => {
    // Busca o último item que NÃO seja header canônico (ignora headers intermediários)
    let targetIdx = -1;
    for (let k = pending.length - 1; k >= 0; k--) {
      if (!pending[k]._isHeader) { targetIdx = k; break; }
    }
    if (targetIdx === -1) return false;
    const target = pending[targetIdx];
    target.originalRaw += ' ' + raw.trim();
    target.cleanTitle = normalizeTitle(target.cleanTitle + ' ' + title);
    if (page !== null && target.expectedPage === null) target.expectedPage = page;
    return true;
  };

  const lines = [...rawLines]; // cópia mutável para permitir inserção de linhas extras
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    // Strip markdown bold markers before any processing
    const trimmed = lines[lineIdx].trim().replace(/\*\*/g, '');
    if (!trimmed) continue;
    if (/^[_.\s*]+$/.test(trimmed)) continue; // separadores puros

    // ── SEM ALTERAÇÃO colado com próximo item (ex: "SEM ALTERAÇÃO. 38 ANEXO I - ...")
    // Detecta e emite o SEM ALTERAÇÃO separadamente, depois reinsere o restante
    const semAlteracaoMatch = trimmed.match(/^(SEM\s+ALTERA[ÇC][ÃA]O\.?)\s+(\d+)\s+(.+)$/i);
    if (semAlteracaoMatch) {
      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      pending.push({ originalRaw: semAlteracaoMatch[1], cleanTitle: normalizeTitle(semAlteracaoMatch[1]), expectedPage: null, parentCategory: parent || undefined, _isHeader: false, isSemAlteracao: true });
      // Reinsere o restante como próxima linha a processar
      lines.splice(lineIdx + 1, 0, `${semAlteracaoMatch[3]}  ${semAlteracaoMatch[2]}`);
      continue;
    }

    const { page, title } = extractPage(trimmed);
    if (!title) continue;

    // Normaliza espaços internos
    const titleNorm = title.replace(/\s{2,}/g, ' ').trim();
    const lineKey = fuzzyKey(titleNorm);

    // ── Tenta casar com o esqueleto canônico ──────────────────────────────
    const canonical = matchCanonical(lineKey);
    if (canonical) {
      if (canonical.level === 'parte') {
        currentParte = canonical.label;
        currentSecao = '';
        currentLetraSecao = '';
        foundFirstParte = true;
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: undefined, _isHeader: true });
      } else if (canonical.level === 'secao') {
        currentSecao = canonical.label;
        currentLetraSecao = '';
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: currentParte || undefined, _isHeader: true });
      } else if (canonical.level === 'letra') {
        currentLetraSecao = canonical.label;
        // Tolera hierarquia incompleta: se a seção pai não foi encontrada, infere do canônico
        if (!currentSecao && canonical.parent) {
          const parentNode = CANONICAL_STRUCTURE.find(n => n.key === canonical.parent);
          if (parentNode) currentSecao = parentNode.label;
        }
        const parent = [currentParte, currentSecao].filter(Boolean).join(' > ');
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: parent || undefined, _isHeader: true });
      }
      continue;
    }

    // ── ANEXO (não está no canônico fixo pois varia por boletim) ──────────
    if (/^ANEXO\s+[IVXLCDM\d]+/i.test(titleNorm)) {
      currentParte = titleNorm;
      currentSecao = '';
      currentLetraSecao = '';
      foundFirstParte = true;
      pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: undefined, _isHeader: true });
      continue;
    }

    // ── SEM ALTERAÇÃO (caso simples, sem item colado) ─────────────────────
    if (/SEM\s*ALTERA/i.test(lineKey)) {
      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      pending.push({ originalRaw: titleNorm, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: parent || undefined, _isHeader: false, isSemAlteracao: true });
      continue;
    }

    // ── NOTA (começa com número) ───────────────────────────────────────────
    if (/^\d+[.\s]/.test(titleNorm)) {
      // Antes de criar nova nota, verifica se o item anterior (não-header) ainda não tem página
      // — se não tem, esta linha é quase certamente uma continuação do título quebrado
      let lastNonHeader: (typeof pending[0]) | null = null;
      for (let k = pending.length - 1; k >= 0; k--) {
        if (!pending[k]._isHeader) { lastNonHeader = pending[k]; break; }
      }
      if (lastNonHeader && lastNonHeader.expectedPage === null) {
        appendToLast(trimmed, titleNorm, page);
        continue;
      }

      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      // Extrai emissor e número da nota (ex: "NOTA CI/JD 123/2026" → emissor="CI/JD", numero="123/2026")
      // Correção 1.4: regex aceita até 3 tokens separados por espaço no emissor (ex: "DI/DIV. INST/CECIU")
      const notaMatch = titleNorm.match(/NOTA\s+((?:[A-Z][A-Z0-9/.\-]+)(?:\s+[A-Z][A-Z0-9/.\-]+){0,2})\s+(\d+\/20\d{2})/i);
      pending.push({
        originalRaw: trimmed,
        cleanTitle: normalizeTitle(cleanNoteTitle(titleNorm)),
        expectedPage: page,
        parentCategory: parent || undefined,
        _isHeader: false,
        notaEmissor: notaMatch?.[1],
        notaNumero: notaMatch?.[2],
      });
      continue;
    }

    // ── RAIZ (antes da 1ª Parte, com número de página) ────────────────────
    if (!foundFirstParte && page !== null) {
      pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: undefined, _isHeader: false });
      continue;
    }

    // ── CONTINUAÇÃO ────────────────────────────────────────────────────────
    // Caso especial: linha que é só "NNN/20YY" ou "EMISSOR NNN/20YY" sem separador de página
    // → é a segunda linha de um título quebrado, deve ser concatenada ao item anterior
    const isBrokenTitleTail = /^([A-Z][A-Z0-9/.\- ]*\s+)?\d{1,4}\/20\d{2}\s*$/.test(titleNorm);
    if (isBrokenTitleTail) {
      if (!appendToLast(trimmed, titleNorm, page)) {
        const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
        pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: parent || undefined, _isHeader: false });
      }
      continue;
    }

    if (!appendToLast(trimmed, titleNorm, page)) {
      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: parent || undefined, _isHeader: false });
    }
  }

  return pending
    .filter(item => {
      // Rejeita itens cujo cleanTitle ainda contém artefatos residuais
      if (/_{2,}/.test(item.cleanTitle)) return false;
      if (/\*{2,}/.test(item.cleanTitle)) return false;
      // Rejeita itens que são só número
      if (/^\d+$/.test(item.cleanTitle.trim())) return false;
      const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
      // Mantém: headers sempre, SEM_ALTERACAO sempre, notas com página, e notas numeradas
      // com conteúdo suficiente mesmo sem página (título pode ter sido quebrado sem separador)
      const isNumberedNota = /^\d+[.\s]/.test(item.originalRaw.trim());
      return hasContent && (item._isHeader || item.isSemAlteracao || item.expectedPage !== null || isNumberedNota);
    })
    .map(({ _isHeader, isSemAlteracao, ...rest }) => ({ ...rest, isSemAlteracao }));
};

// ──────────────────────────────────────────────
// FORMATAÇÃO DO SUMÁRIO PARA EXIBIÇÃO
// ──────────────────────────────────────────────

/**
 * Formata a lista de SummaryItems como texto indentado para exibição.
 *
 * Regras de indentação (Requirements 5.2, 5.3):
 * - Parte (parentCategory undefined): sem indentação
 * - Seção (parentCategory = nome da Parte, sem ">"): 2 espaços
 * - Nota (parentCategory contém ">"): 4 espaços
 *
 * Inclui número de página ao lado do título quando disponível.
 *
 * _Requirements: 5.2, 5.3_
 */
export const formatTocForDisplay = (items: SummaryItem[]): string => {
  const lines: string[] = [];

  for (const item of items) {
    // Req 2.3: never produce [p. null]
    const pageStr = item.expectedPage !== null ? `  [p. ${item.expectedPage}]` : '';

    let prefix: string;
    let displayText: string;

    if (!item.parentCategory) {
      // Parte-level header: originalRaw is already the canonical label (e.g. "2ª PARTE")
      // Req 2.1: use canonical label, never raw PDF text
      prefix = 'PARTE:';
      displayText = item.originalRaw.trim();
    } else if (item.parentCategory.includes(' > ')) {
      // parentCategory has two levels (Parte > Seção) → LETRA_SECAO or NOTA
      const isLetraSecao = /^[A-Z]\s*[-–]\s*\S/.test(item.originalRaw.trim()) ||
                           /^[A-Z] ALTERACOES DE (OFICIAIS|PRACAS|CIVIS)/.test(item.cleanTitle);
      if (isLetraSecao) {
        // Req 2.1: canonical label for letra-seção headers
        prefix = 'LETRA_SECAO:';
        displayText = item.originalRaw.trim();
      } else {
        // Req 2.2: always use cleanTitle for notes, never originalRaw
        prefix = 'NOTA:';
        displayText = item.cleanTitle;
      }
    } else {
      // Seção-level header: originalRaw is already the canonical label (e.g. "I - OPERAÇÕES")
      // Req 2.1: use canonical label
      prefix = 'SECAO:';
      displayText = item.originalRaw.trim();
    }

    // Req 2.4: ensure no ___ or ** leak into output
    const safeLine = `${prefix}${displayText}${pageStr}`
      .replace(/_{2,}/g, '')
      .replace(/\*{2,}/g, '');

    lines.push(safeLine);
  }

  return lines.join('\n');
};

// ──────────────────────────────────────────────
// LIMPEZA E FORMATAÇÃO DE FATIA (GRID GEOMÉTRICO)
// ──────────────────────────────────────────────

const cleanAndFormatSlice = (
  lines: { text: string; page: number; tokens: TextToken[]; y: number }[]
): { text: string; pages: number[]; tables: TableData[] } => {
  const detectedPages = new Set<number>();
  
  const filtered = lines.filter(l => {
    const trimmed = l.text.trim();
    if (!trimmed) return true;
    detectedPages.add(l.page);
    const plain = trimmed.replace(/\*\*/g, '');
    
    if (/^F\s*L\s*\.\s*\d+$/i.test(plain)) {
      const m = plain.match(/\d+/);
      if (m) detectedPages.add(parseInt(m[0], 10));
      return false;
    }
    if (plain.toLowerCase().includes('voltar_ao_sumário')) return false;
    if (isPageHeaderOrFooter(plain)) return false;
    if (/^\d{1,3}$/.test(plain)) return false;
    if (/BOLETIM DA SEDEC.*FL\.\s*\d+/i.test(plain)) return false;
    // Filtra linhas de TOC (entradas do sumário com separador ___N ou ...N)
    if (isTOCLine(plain)) return false;
    
    return true;
  });

  const processedLines: string[] = [];
  let tableLines: { text: string; tokens: TextToken[]; y: number; isBridge?: boolean }[] = [];
  const foundTables: TableData[] = [];

  const flushTable = () => {
    if (tableLines.length === 0) return;

    // Verifica se o bloco tem pelo menos uma linha de cabeçalho reconhecida.
    // Se não tiver, descarta o bloco como parágrafo (falso positivo de tabela).
    const hasRealHeader = tableLines.some(l => !l.isBridge && isTableHeader(l.text));
    if (!hasRealHeader) {
      // Descarta: emite as linhas como parágrafos normais
      tableLines.filter(l => !l.isBridge).forEach(l => processedLines.push(l.text));
      tableLines = [];
      return;
    }

    // Verifica se o bloco tem pelo menos 2 linhas não-bridge com conteúdo real.
    // Blocos de 1 linha só são tabela se tiverem cabeçalho E dados (mínimo 2 linhas).
    const realLines = tableLines.filter(l => !l.isBridge && l.text.trim().length > 0);
    if (realLines.length < 2) {
      tableLines.filter(l => !l.isBridge).forEach(l => processedLines.push(l.text));
      tableLines = [];
      return;
    }
    
    const allTableTokens: TextToken[] = [];
    tableLines.forEach(line => {
      // Se for uma linha de "ponte" (ruído), ignoramos seus tokens para não sujar a tabela
      if (line.isBridge) return;

      const relevantTokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 4);
      allTableTokens.push(...relevantTokens);
    });

    if (allTableTokens.length > 0) {
      const uniqueTokens = Array.from(new Map(allTableTokens.map(t => [`${t.page || 0}-${t.x}-${t.y}-${t.text}`, t])).values());
      const data = reconstructTable(uniqueTokens);
      
      if (data.columnCount > 1) {
        const tableIdx = foundTables.length;
        foundTables.push(data);
        const gridLines = data.rows.map(row => row.map(cell => cell.text).join(" | "));
        processedLines.push(`\`\`\`grid-tab-${tableIdx}\n` + gridLines.join("\n") + "\n```");
      } else {
        const fallbackLines = tableLines.filter(l => !l.isBridge).map(l => l.text.trim().replace(/\s{2,}/g, ' | '));
        processedLines.push("```grid\n" + fallbackLines.join("\n") + "\n```");
      }
    } else {
      const fallbackLines = tableLines.filter(l => !l.isBridge).map(l => l.text.trim().replace(/\s{2,}/g, ' | '));
      processedLines.push("```grid\n" + fallbackLines.join("\n") + "\n```");
    }
    tableLines = [];
  };

  const lineTypes = filtered.map(l => {
     const lineTokens = l.tokens.filter(t => Math.abs(t.y - l.y) <= 4);
     const isPageNoise = isPageHeaderOrFooter(l.text);
     // Linhas que são exclusivamente uma imagem nunca são tabela — devem ser renderizadas como parágrafo
     const isImageOnly = /^\[CENTER\]!\[|^!\[/.test(l.text.trim());
     return {
       obj: l,
       isTable: !isPageNoise && !isImageOnly && !isRectificationMarker(l.text) && (detectTableStructure(l.text, lineTokens) || isTableHeader(l.text)),
       len: l.text.length,
       isBridge: false
     };
  });

  // Pass 2: Smooth table blocks
  // Helper: detecta linhas que são DEFINITIVAMENTE parágrafos legais (nunca tabela),
  // mesmo quando estão entre linhas de tabela.
  const isHardLegalParagraph = (text: string): boolean => {
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

  // Helper: verifica se uma linha está geometricamente alinhada com um bloco de tabela.
  // Usa os tokens da linha e compara com os tokens das linhas de tabela vizinhas.
  const isGeometricallyAlignedWithTable = (
    lineIdx: number,
    tableLineIndices: number[]
  ): boolean => {
    if (tableLineIndices.length === 0) return false;
    const lineTokens = lineTypes[lineIdx].obj.tokens.filter(
      t => Math.abs(t.y - lineTypes[lineIdx].obj.y) <= 6
    );
    if (lineTokens.length === 0) return false;

    // Coleta os X-ranges das colunas das linhas de tabela vizinhas
    const tableXRanges: { xLeft: number; xRight: number }[] = [];
    for (const ti of tableLineIndices.slice(0, 5)) {
      const tTokens = lineTypes[ti].obj.tokens.filter(
        t => Math.abs(t.y - lineTypes[ti].obj.y) <= 6
      );
      for (const tok of tTokens) {
        tableXRanges.push({ xLeft: tok.x, xRight: tok.x + tok.w });
      }
    }
    if (tableXRanges.length === 0) return false;

    // Verifica se pelo menos 1 token da linha atual se sobrepõe com algum range de tabela
    let alignedCount = 0;
    for (const tok of lineTokens) {
      const overlap = tableXRanges.some(r =>
        tok.x < r.xRight + 20 && tok.x + tok.w > r.xLeft - 20
      );
      if (overlap) alignedCount++;
    }
    return alignedCount >= Math.ceil(lineTokens.length * 0.5);
  };

  const orig = lineTypes.map(l => l.isTable);
  for (let i = 0; i < lineTypes.length; i++) {
     if (!orig[i]) {
        const prevObj = i > 0 ? lineTypes[i-1].obj : null;
        const nextObj = i < lineTypes.length - 1 ? lineTypes[i+1].obj : null;
        
        const prevTable = i > 0 ? lineTypes[i-1].isTable : false;
        const nextTable = i < lineTypes.length - 1 ? lineTypes[i+1].isTable : false;

        const prevGap = prevObj ? Math.abs(lineTypes[i].obj.y - prevObj.y) : 0;
        const nextGap = nextObj ? Math.abs(nextObj.y - lineTypes[i].obj.y) : 0;

        const plainText = lineTypes[i].obj.text.trim().replace(/\*\*/g, '');

        // Retificações reais (ONDE SE LÊ / LEIA-SE) SEMPRE quebram tabela
        if (isRectificationMarker(plainText) && 
            (plainText.toUpperCase().includes('ONDE SE LÊ') || plainText.toUpperCase().includes('LEIA-SE'))) {
          continue;
        }

        // Parágrafos legais definitivos nunca são tabela
        if (isHardLegalParagraph(plainText)) continue;

        // Se está entre duas linhas de tabela com gaps pequenos → tabela
        if (prevTable && nextTable && prevGap < 30 && nextGap < 30) {
            lineTypes[i].isTable = true;
            continue;
        }

        // Se está adjacente a tabela com gap pequeno E alinhado geometricamente → tabela
        const adjacentTableIndices: number[] = [];
        if (prevTable) {
          for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
            if (lineTypes[k].isTable) adjacentTableIndices.push(k);
            else break;
          }
        }
        if (nextTable) {
          for (let k = i + 1; k <= Math.min(lineTypes.length - 1, i + 5); k++) {
            if (lineTypes[k].isTable) adjacentTableIndices.push(k);
            else break;
          }
        }

        if (adjacentTableIndices.length > 0) {
          const minGap = Math.min(prevTable ? prevGap : Infinity, nextTable ? nextGap : Infinity);
          if (minGap < 40 && isGeometricallyAlignedWithTable(i, adjacentTableIndices)) {
            lineTypes[i].isTable = true;
            continue;
          }
        }

        // Fallback: linha curta entre tabelas com gap razoável
        if (prevTable && nextTable && prevGap < 50 && nextGap < 50 && lineTypes[i].len < 80) {
            const looksLikeSentence = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ].*[.;:!]$/.test(plainText) && plainText.length > 60;
            if (!looksLikeSentence) {
                lineTypes[i].isTable = true;
            }
        }
     }
  }

  // Pass 3: Bridge table blocks across page breaks or noise
  // Agora também atravessa títulos de sub-seção (ex: "3 MILITARES CAPACITADOS:")
  // quando o bloco seguinte é claramente uma tabela.
  for (let i = 0; i < lineTypes.length; i++) {
    if (lineTypes[i].isTable && !lineTypes[i].isBridge) {
        let j = i + 1;
        while (j < lineTypes.length && lineTypes[j].isTable) j++;
        
        if (j < lineTypes.length) {
            let nextTableIdx = -1;
            let containsHardBreak = false;
            
            for (let k = j; k < Math.min(j + 15, lineTypes.length); k++) {
                if (lineTypes[k].isTable) {
                    nextTableIdx = k;
                    break;
                }
                const text = lineTypes[k].obj.text.trim();
                const plainText = text.replace(/\*\*/g, '');

                // Quebra definitiva: sub-título numerado de seção (ex: "3. MILITARES CAPACITADOS:")
                // Esses títulos separam blocos distintos dentro de uma nota e NÃO devem ser
                // atravessados pelo bridge — cada bloco de tabela é independente.
                if (isSubSectionTitle(plainText)) {
                    containsHardBreak = true;
                    break;
                }

                // Quebra definitiva: retificação real
                if (plainText.toUpperCase().includes('ONDE SE LÊ') || 
                    plainText.toUpperCase().includes('LEIA-SE')) {
                    containsHardBreak = true;
                    break;
                }

                // Quebra definitiva: parágrafo legal longo (>= 80 chars com pontuação)
                if (isHardLegalParagraph(plainText)) {
                    containsHardBreak = true;
                    break;
                }

                // Quebra definitiva: texto longo que claramente não é ruído de tabela
                // (>= 100 chars E não parece ser linha de militar/tabela)
                const isClearParagraph = text.length >= 100 &&
                  !isTableHeader(text) &&
                  !/\bRG\b/i.test(plainText) &&
                  !/\bId\s*Funcional\b/i.test(plainText) &&
                  !/\bOBM\b/i.test(plainText);
                if (isClearParagraph) {
                    containsHardBreak = true;
                    break;
                }
            }
            
            if (nextTableIdx !== -1 && !containsHardBreak) {
                for (let k = j; k < nextTableIdx; k++) {
                    lineTypes[k].isTable = true;
                    lineTypes[k].isBridge = true; 
                }
                i = nextTableIdx - 1;
            } else {
                i = j - 1;
            }
        } else {
            break;
        }
    }
  }

  for (let i = 0; i < lineTypes.length; i++) {
      if (lineTypes[i].isTable) {
        // Uma tabela só pode COMEÇAR com um cabeçalho reconhecido.
        // Se tableLines está vazio (nenhuma tabela em andamento) e esta linha não é
        // um cabeçalho de tabela, não inicia o bloco — trata como parágrafo.
        // Exceção: linhas bridge nunca iniciam tabela sozinhas.
        if (tableLines.length === 0 && !lineTypes[i].isBridge) {
          const lineTokens = lineTypes[i].obj.tokens.filter(
            t => Math.abs(t.y - lineTypes[i].obj.y) <= 4
          );
          const isHeader = isTableHeader(lineTypes[i].obj.text);

          if (!isHeader) {
            // Não é cabeçalho — verifica se as próximas linhas confirmam uma tabela real
            // (ou seja, se há um cabeçalho nas próximas 3 linhas de tabela)
            let hasHeaderAhead = false;
            for (let k = i + 1; k < Math.min(i + 4, lineTypes.length); k++) {
              if (!lineTypes[k].isTable) break;
              if (isTableHeader(lineTypes[k].obj.text)) {
                hasHeaderAhead = true;
                break;
              }
            }

            if (!hasHeaderAhead) {
              // Sem cabeçalho à frente — não inicia tabela, trata como parágrafo
              flushTable();
              processedLines.push(lineTypes[i].obj.text);
              continue;
            }
          }
        }
        tableLines.push({ ...lineTypes[i].obj, isBridge: lineTypes[i].isBridge });
      } else {
        flushTable();
        processedLines.push(lineTypes[i].obj.text);
      }
  }
  flushTable();

  return {
    text: joinWrappedParagraphs(processedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()),
    pages: Array.from(detectedPages).sort((a, b) => a - b),
    tables: foundTables
  };
};

// ──────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ──────────────────────────────────────────────

export const extractBulletinLocalAlgo = async (
  file: File,
  personnel?: MilitaryPerson[],
  keywords?: string[],
  prefs?: SearchPreferences,
  externalPageMap?: { page: number; text: string; tokens: TextToken[]; lines: { text: string; y: number }[] }[]
): Promise<BulletinNota[]> => {
  const { pageMap } = externalPageMap
    ? { pageMap: externalPageMap }
    : await extractTextFromPdf(file);
  
  // Usa a mesma lógica de matching do localSearchService (ID, RG, nome de guerra)
  const checkRelevance = (text: string): { isRelevant: boolean; matches: string[] } => {
    const matches: string[] = [];

    // 1. Busca por Palavras-Chave
    if (keywords && keywords.length > 0) {
      const textNorm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      for (const k of keywords) {
        const kNorm = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (textNorm.includes(kNorm)) matches.push(k);
      }
    }

    // 2. Busca por Militares — reutiliza matchPersonnelInLine linha a linha
    // strictMode=true: evita falsos positivos por nome parcial em tabelas e listas gerais
    if (personnel && personnel.length > 0 && prefs) {
      for (const line of text.split('\n')) {
        const found = matchPersonnelInLine(line, personnel, prefs, true);
        for (const name of found) {
          if (!matches.includes(name)) matches.push(name);
        }
      }
    }

    return { isRelevant: matches.length > 0, matches: Array.from(new Set(matches)) };
  };

  const allLines: { text: string; page: number; globalIndex: number; tokens: TextToken[]; y: number }[] = [];
  let index = 0;
  for (const page of pageMap) {
    for (const line of page.lines) {
       allLines.push({ 
         text: line.text, 
         page: page.page, 
         globalIndex: index++, 
         tokens: page.tokens,
         y: line.y 
       });
    }
  }

  // Requirements 1.1, 4.1: usar extractTocBlock + parseTocLines em vez de extractTocFromText
  const tocRawLines = extractTocBlock(pageMap);
  const summaryItems = parseTocLines(tocRawLines);

  // Determina quais páginas do PDF pertencem ao bloco do sumário (TOC).
  // Essas páginas devem ser excluídas da busca de foundLineIndex para evitar
  // que títulos de notas sejam localizados nas entradas do sumário em vez do corpo.
  // O extractTocBlock usa índices [1, 2, 3] (páginas 2-4 do PDF).
  const TOC_PAGE_INDICES = new Set([1, 2, 3].filter(i => i < pageMap.length).map(i => pageMap[i].page));

  // Índice da primeira linha que NÃO pertence às páginas do TOC.
  // A busca de foundLineIndex começa a partir daqui.
  const firstBodyLineIndex = allLines.findIndex(l => !TOC_PAGE_INDICES.has(l.page));
  const bodySearchStart = firstBodyLineIndex >= 0 ? firstBodyLineIndex : 0;

  // Debug: log TOC items to help diagnose missing notes
  if (process.env.NODE_ENV === 'development') {
    console.group('[TOC] Itens extraídos do sumário');
    summaryItems.forEach((it, idx) => console.log(`${idx}. [p.${it.expectedPage ?? '?'}] ${it.originalRaw.slice(0, 80)}`));
    console.groupEnd();
  }

  // Requirements 4.1, 4.3: filtrar itens válidos
  // Mantém: cabeçalhos (Parte/Eixo/Anexo) sempre, notas com pageNumber sempre,
  // SEM_ALTERACAO sempre. Descarta apenas itens sem pageNumber que não são cabeçalhos.
  const validSummaryItems = summaryItems.filter(item => {
      const isHeader = !!item.originalRaw.match(REGEX_PARTE_PREFIX) ||
                       !!item.originalRaw.match(REGEX_ANEXO_PREFIX) ||
                       !!item.originalRaw.match(REGEX_EIXO_PREFIX);
      const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
      return hasContent && (item.expectedPage !== null || isHeader || item.isSemAlteracao);
  });

  if (validSummaryItems.length === 0) {
     return [
       {
         id: "error-1",
         title: "Aviso do Sistema Local",
         hierarchy: "Erro Local",
         contentMarkdown: "O algoritmo nativo não conseguiu localizar a seção 'SUMÁRIO'."
       }
     ];
  }

  // A busca começa a partir da primeira linha do corpo (após as páginas do TOC)
  let currentSearchLine = bodySearchStart;
  for (let i = 0; i < validSummaryItems.length; i++) {
    const item = validSummaryItems[i];
    const isParte = !!item.originalRaw.match(REGEX_PARTE_PREFIX) || !!item.originalRaw.match(REGEX_ANEXO_PREFIX);

    // Para cabeçalhos de PARTE, NÃO aplicar stripNumericPrefix — o ordinal ("2ª PARTE")
    // é a âncora única. stripNumericPrefix remove "2ª" e deixa só "OPERACOES INSTRUCAO".
    const rawStripped = isParte
      ? item.originalRaw.replace(/[_.]{2,}.*$/, '').trim()
      : stripNumericPrefix(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
    const cleanPrefix = normalizeTitle(rawStripped);
    const searchWords = cleanPrefix.split(/\s+/).filter(w => w.length > 1);
    // Para partes: usar as primeiras 3 palavras (ex: "2 PARTE OPERACOES")
    // Para notas: usar as primeiras 4 palavras
    const searchSpace = isParte
      ? searchWords.slice(0, 3).join(' ')
      : searchWords.slice(0, 4).join(' ');
    // Sufixo curto: últimas 3 palavras significativas (para identificadores únicos como CTRM 005/2026)
    const searchSuffix = searchWords.slice(-3).join(' ');

    // Para notas numeradas (ex: "2. REUNIÃO DE TRABALHO..."), monta um searchSpace
    // ancorado no número para evitar falsos positivos dentro do conteúdo de outra nota.
    // Ex: "2 REUNIAO DE TRABALHO PROPOSICAO" — o número é âncora inequívoca.
    const noteNumMatch = item.originalRaw.match(/^(\d+)[.\s]/);
    const anchoredSpace = noteNumMatch
      ? normalizeTitle(`${noteNumMatch[1]} ${rawStripped}`).split(/\s+/).slice(0, 5).join(' ')
      : null;

    let foundLine = -1;

    // Primeira passagem: busca ancorada no número (mais precisa) a partir de currentSearchLine
    if (anchoredSpace && anchoredSpace.length > 3) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
        const lineText = allLines[j].text.trim();
        if (isTOCLine(lineText)) continue;
        if (isPageHeaderOrFooter(lineText)) continue;
        const lineNorm = normalizeTitle(lineText);
        if (lineNorm.includes(anchoredSpace)) {
          foundLine = j;
          break;
        }
      }
    }

    // Segunda passagem: busca pelo prefixo sem número (4 palavras) a partir de currentSearchLine
    if (foundLine === -1) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
         const lineText = allLines[j].text.trim();
         if (isTOCLine(lineText)) continue;
         if (isPageHeaderOrFooter(lineText)) continue;
         const lineNorm = normalizeTitle(lineText);
         if (searchSpace.length > 3 && lineNorm.includes(searchSpace)) {
            foundLine = j;
            break;
         }
      }
    }

    // Terceira passagem: busca pelo sufixo único (ex: "NOTA CTRM 005 2026") a partir de currentSearchLine
    if (foundLine === -1 && searchSuffix.length > 5 && searchSuffix !== searchSpace) {
        for (let j = currentSearchLine; j < allLines.length; j++) {
            const lineText = allLines[j].text.trim();
            if (isTOCLine(lineText)) continue;
            if (isPageHeaderOrFooter(lineText)) continue;
            const lineNorm = normalizeTitle(lineText);
            if (lineNorm.includes(searchSuffix)) {
               foundLine = j;
               break;
            }
        }
    }

    // Quarta passagem: fallback global (começa do corpo, não do sumário)
    if (foundLine === -1) {
        for (let j = bodySearchStart; j < allLines.length; j++) {
            const lineText = allLines[j].text.trim();
            if (isTOCLine(lineText)) continue;
            const lineNorm = normalizeTitle(lineText);
            if (lineNorm.includes(anchoredSpace || searchSpace) || (searchSuffix.length > 5 && lineNorm.includes(searchSuffix))) {
               foundLine = j;
               break;
            }
        }
    }

    if (foundLine !== -1) {
        item.foundLineIndex = foundLine;
        currentSearchLine = foundLine + 1;

        if (process.env.NODE_ENV === 'development') {
          console.log(`[SEARCH] item="${item.originalRaw.slice(0, 60)}" anchoredSpace="${anchoredSpace}" → line ${foundLine}: "${allLines[foundLine].text.slice(0, 80)}"`);
        }
    } else if (process.env.NODE_ENV === 'development') {
      console.warn(`[SEARCH] NÃO ENCONTRADO: item="${item.originalRaw.slice(0, 60)}" anchoredSpace="${anchoredSpace}" searchSpace="${searchSpace}"`);
    }
  }

  const locatedItems = validSummaryItems.filter(item => item.foundLineIndex !== undefined);
  locatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));

  // Passagem de sanidade: se dois itens consecutivos têm foundLineIndex igual ou muito próximo
  // (< 3 linhas de diferença), o segundo provavelmente está errado — descarta seu foundLineIndex
  // para que não corte o conteúdo do item anterior prematuramente.
  // Exceção: não descarta notas numeradas (ex: "1. SERVIÇO PARA O DIA...") que seguem
  // imediatamente um cabeçalho de parte/eixo — isso é estrutura legítima do boletim.
  for (let i = 1; i < locatedItems.length; i++) {
    const prev = locatedItems[i - 1];
    const curr = locatedItems[i];
    const diff = (curr.foundLineIndex ?? 0) - (prev.foundLineIndex ?? 0);
    if (diff < 3) {
      // Se o item atual é uma nota numerada e o anterior é um cabeçalho estrutural, é legítimo
      const currIsNota = /^\d+[.\s]/.test(curr.originalRaw.trim());
      const prevIsHeader = !!prev.originalRaw.match(REGEX_PARTE_PREFIX) ||
                           !!prev.originalRaw.match(REGEX_EIXO_PREFIX) ||
                           !!prev.originalRaw.match(REGEX_ANEXO_PREFIX) ||
                           !!prev.originalRaw.match(REGEX_LETTER_ITEM_PREFIX);
      if (currIsNota && prevIsHeader) continue;

      if (process.env.NODE_ENV === 'development') {
        console.warn(`[SANITY] foundLineIndex muito próximo: item[${i-1}]="${prev.originalRaw.slice(0,40)}" (line ${prev.foundLineIndex}) vs item[${i}]="${curr.originalRaw.slice(0,40)}" (line ${curr.foundLineIndex}) — descartando item[${i}]`);
      }
      curr.foundLineIndex = undefined;
    }
  }

  // Deduplicação de eixos/partes: o sumário e o corpo do PDF têm as mesmas linhas de cabeçalho
  // (ex: "I - OPERAÇÕES" aparece no sumário E no corpo em negrito). O parser localiza os dois
  // e cria itens duplicados. Para cada cleanTitle de cabeçalho estrutural, mantemos apenas
  // a ocorrência com maior foundLineIndex (a do corpo, que vem depois do sumário).
  const seenHeaderTitles = new Map<string, typeof locatedItems[0]>();
  for (const item of locatedItems) {
    if (item.foundLineIndex === undefined) continue;
    const isStructural =
      !!item.originalRaw.match(REGEX_PARTE_PREFIX) ||
      !!item.originalRaw.match(REGEX_EIXO_PREFIX) ||
      !!item.originalRaw.match(REGEX_ANEXO_PREFIX) ||
      !!item.originalRaw.match(REGEX_LETTER_ITEM_PREFIX);
    if (!isStructural) continue;

    const key = normalizeTitle(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
    const existing = seenHeaderTitles.get(key);
    if (!existing || (item.foundLineIndex ?? 0) > (existing.foundLineIndex ?? 0)) {
      seenHeaderTitles.set(key, item);
    }
  }

  // Marca os duplicados de cabeçalho para remoção (mantém apenas o de maior índice)
  const dedupedLocated = locatedItems.filter(item => {
    if (item.foundLineIndex === undefined) return false;
    const isStructural =
      !!item.originalRaw.match(REGEX_PARTE_PREFIX) ||
      !!item.originalRaw.match(REGEX_EIXO_PREFIX) ||
      !!item.originalRaw.match(REGEX_ANEXO_PREFIX) ||
      !!item.originalRaw.match(REGEX_LETTER_ITEM_PREFIX);
    if (!isStructural) return true; // notas nunca são removidas aqui

    const key = normalizeTitle(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
    return seenHeaderTitles.get(key) === item; // mantém só o de maior índice
  });

  // Sanidade de ordem hierárquica (roda APÓS deduplicação para usar os índices corretos):
  // um eixo canônico NÃO pode aparecer antes da sua parte pai no documento.
  // Se isso acontecer, é um falso positivo (ex: "OPERAÇÕES" encontrado dentro da tabela
  // de serviços diários da 1ª PARTE).
  {
    const parteLineMap = new Map<string, number>();
    for (const item of dedupedLocated) {
      if (item.foundLineIndex === undefined) continue;
      if (item.originalRaw.match(REGEX_PARTE_PREFIX) || item.originalRaw.match(REGEX_ANEXO_PREFIX)) {
        const key = normalizeTitle(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
        parteLineMap.set(key, item.foundLineIndex);
      }
    }

    for (const item of dedupedLocated) {
      if (item.foundLineIndex === undefined) continue;
      if (!item.originalRaw.match(REGEX_EIXO_PREFIX) && !item.originalRaw.match(REGEX_LETTER_ITEM_PREFIX)) continue;
      if (!item.parentCategory) continue;

      const parteLabel = item.parentCategory.split(' > ')[0];
      const parteKey = normalizeTitle(parteLabel);
      const parteLineIdx = parteLineMap.get(parteKey);

      if (parteLineIdx !== undefined && (item.foundLineIndex ?? 0) <= parteLineIdx) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[SANITY-ORDER] Eixo "${item.originalRaw.slice(0,40)}" (line ${item.foundLineIndex}) antes da parte "${parteLabel}" (line ${parteLineIdx}) — descartando`);
        }
        item.foundLineIndex = undefined;
      }
    }
  }

  const cleanLocatedItems = dedupedLocated.filter(item => item.foundLineIndex !== undefined);
  cleanLocatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));

  if (process.env.NODE_ENV === 'development') {
    console.group('[CLEAN-LOCATED] Items após dedup+sanidade');
    cleanLocatedItems.forEach((it, idx) => console.log(`  [${idx}] line=${it.foundLineIndex} "${it.originalRaw.slice(0,70)}"`));
    console.groupEnd();
  }

  const notas: BulletinNota[] = [];
  let sectionStack: SectionStackItem[] = [];

  // Capture everything before the first TOC item (Cover + Sumário pages)
  // Usa apenas linhas do CORPO (após as páginas do TOC) para evitar que o sumário
  // do PDF apareça como conteúdo da "ABERTURA DO BOLETIM".
  const firstFoundIndex = cleanLocatedItems.length > 0 ? (cleanLocatedItems[0].foundLineIndex || 0) : 0;

  if (firstFoundIndex > bodySearchStart) {
    const introSlice = allLines.slice(bodySearchStart, firstFoundIndex).map(l => ({
      text: l.text, page: l.page, tokens: l.tokens, y: l.y
    }));
    const { text: introText, pages, tables } = cleanAndFormatSlice(introSlice);
    const { isRelevant, matches } = checkRelevance(introText);
    if (introText.trim().length > 10) {
      notas.push({
        id: crypto.randomUUID(),
        title: "ABERTURA DO BOLETIM",
        hierarchy: "Abertura do Boletim",
        contentMarkdown: introText,
        tables: tables || [],
        pageNumber: pages.length > 0 ? pages[0] : undefined,
        isRelevant,
        matchedEntities: matches
      });
    }
  }

  for (let i = 0; i < cleanLocatedItems.length; i++) {
    const currentItem = cleanLocatedItems[i];
    const nextItem = cleanLocatedItems[i + 1];

    const startIdx = currentItem.foundLineIndex!;
    const endIdx = nextItem ? nextItem.foundLineIndex! - 1 : allLines.length - 1;

    if (process.env.NODE_ENV === 'development') {
      console.log(`[BOUNDARY] [${i}] "${currentItem.originalRaw.slice(0,50)}" start=${startIdx} end=${endIdx} next="${nextItem?.originalRaw.slice(0,40) ?? 'EOF'}"`);
    }

    // ── TÍTULO: usa o originalRaw do sumário como fonte de verdade ──────────
    // O sumário já concatenou corretamente títulos quebrados em múltiplas linhas.
    // O corpo só serve para determinar quantas linhas físicas pertencem ao título
    // (para não incluí-las no conteúdo da nota).
    const tocTitle = currentItem.originalRaw.replace(/[_.]{2,}.*$/, '').trim();
    const tocTitleNorm = normalizeTitle(tocTitle);

    // Detecta quantas linhas do corpo formam o título, comparando com o título do sumário.
    // Estratégia: acumula linhas do corpo até que o texto acumulado contenha pelo menos
    // 60% das palavras do título do sumário, ou até encontrar uma linha estrutural/nova nota.
    const tocWords = tocTitleNorm.split(/\s+/).filter(w => w.length > 1);
    let titleLinesConsumed = 0;
    let bodyTitleAccum = '';

    const REGEX_NEXT_NOTA = /^\*{0,2}\d+[.\s]/; // "1. " ou "**1. "
    const REGEX_STRUCTURAL = (l: string) =>
      REGEX_PARTE_PREFIX.test(l) || REGEX_EIXO_PREFIX.test(l) ||
      REGEX_LETTER_ITEM_PREFIX.test(l) || REGEX_ANEXO_PREFIX.test(l);

    for (let k = startIdx; k <= Math.min(startIdx + 8, endIdx); k++) {
      const l = allLines[k].text.trim().replace(/\*\*/g, '');
      if (!l) { titleLinesConsumed++; continue; }

      // Para ao encontrar cabeçalho estrutural (exceto na primeira linha)
      if (k > startIdx && REGEX_STRUCTURAL(l)) break;
      // Para ao encontrar início de próxima nota numerada (exceto na primeira linha)
      if (k > startIdx && REGEX_NEXT_NOTA.test(l)) break;

      bodyTitleAccum += ' ' + l;
      titleLinesConsumed++;

      // Verifica cobertura: quantas palavras do sumário já estão no acumulado
      const accumNorm = normalizeTitle(bodyTitleAccum);
      const covered = tocWords.filter(w => accumNorm.includes(w)).length;
      const coverageReached = covered >= Math.ceil(tocWords.length * 0.8);

      // Só para por cobertura se a PRÓXIMA linha não parece ser continuação do título.
      // Títulos longos (ex: 4 linhas em maiúsculo) têm TOC truncado — o 80% é atingido
      // cedo mas o título continua. Continua enquanto a próxima linha é tudo maiúsculo
      // e não começa com número (não é nova nota).
      if (coverageReached) {
        const nextLineIdx = k + 1;
        if (nextLineIdx > endIdx) break;
        const nextL = allLines[nextLineIdx]?.text.trim().replace(/\*\*/g, '') || '';
        const nextIsTitleContinuation = nextL.length > 0 &&
          !REGEX_STRUCTURAL(nextL) &&
          !REGEX_NEXT_NOTA.test(nextL) &&
          /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s\-\/(),.]+$/.test(nextL) && // tudo maiúsculo
          !/^[a-z]/.test(nextL); // não começa com minúscula
        if (!nextIsTitleContinuation) break;
      }
    }

    // Título final = originalRaw do sumário (limpo de artefatos)
    const rawTitle = stripInternalMarkers(tocTitle);

    const { hierarchy, updatedStack } = buildHierarchy(rawTitle, sectionStack);
    sectionStack = updatedStack;

    const slice = allLines.slice(startIdx + titleLinesConsumed, endIdx + 1).map(l => ({
      text: l.text, page: l.page, tokens: l.tokens, y: l.y
    }));

    const { text, pages, tables } = cleanAndFormatSlice(slice);
    const { isRelevant, matches } = checkRelevance(text + " " + rawTitle);

    // Build hierarchy string from parentCategory (Parte > Eixo > Sub-eixo)
    // Regra: tudo que no sumário aparece ANTES da 2ª PARTE vai para "Abertura do Boletim".
    // Isso inclui: notas sem parentCategory, notas da 1ª PARTE (Serviços Diários),
    // e notas de seções raiz (ESTATÍSTICA, TENDÊNCIA, FATOS HISTÓRICOS).
    const isBeforeOperacoes = (() => {
      if (!currentItem.parentCategory) return true;
      const cat = currentItem.parentCategory.toUpperCase();
      // 1ª PARTE e qualquer coisa sem número de parte >= 2 vai para Abertura
      if (/^1[ªa]\s*PARTE/.test(cat)) return true;
      // Sem parte definida (raiz do sumário)
      if (!/\d+[ªa]\s*PARTE/.test(cat)) return true;
      return false;
    })();

    // Detecta se é um ANEXO (ANEXO I, ANEXO II, etc.)
    const isAnexo = !!rawTitle.match(REGEX_ANEXO_PREFIX);

    const displayHierarchy = (() => {
      // Anexos sempre vão para o grupo especial de Anexos
      if (isAnexo || (currentItem.parentCategory && /^ANEXO\s+[IVXLCDM\d]+/i.test(currentItem.parentCategory))) {
        return 'Anexos do Boletim';
      }
      if (isBeforeOperacoes) return 'Abertura do Boletim';
      return currentItem.parentCategory!;
    })();

    const isParte = !!rawTitle.match(REGEX_PARTE_PREFIX) || !!rawTitle.match(REGEX_ANEXO_PREFIX);
    const isEixo = !!rawTitle.match(REGEX_EIXO_PREFIX);
    const isLetterSection = !!rawTitle.match(REGEX_LETTER_ITEM_PREFIX) && !rawTitle.match(REGEX_ITEM_PREFIX);

    // Eixos e letter-sections incluem o próprio título como último nível do hierarchyPath,
    // para que o buildNotaTree saiba que esta nota É o eixo (e possa descartá-la corretamente).
    let hierarchyPath = displayHierarchy.split('>').map(s => s.trim()).filter(Boolean);
    if (isEixo || isLetterSection) {
      hierarchyPath = [...hierarchyPath, rawTitle];
    }

    // Eixos e sub-seções de letra só são pulados se forem realmente cabeçalhos estruturais
    // (sem conteúdo próprio e sem emissor de nota). Notas que casam com o regex por coincidência
    // (ex: "I - NOTA CHEMG/DGEI 241/2026") devem ser mantidas.
    const isStructuralEixo = isEixo && !currentItem.notaEmissor && text.trim().length < 5;
    const isStructuralLetter = isLetterSection && !currentItem.notaEmissor && text.trim().length < 5;
    if (isStructuralEixo || isStructuralLetter) continue;

    // Headers (Parte) → isHeaderOnly when no content
    // Eixos e letra-seções estruturais também são marcados como headerOnly para evitar
    // que apareçam como notas individuais duplicando o dropdown de eixo na UI.
    const isStructuralHeader = isParte ||
      (isEixo && !currentItem.notaEmissor) ||
      (isLetterSection && !currentItem.notaEmissor);

    // Metadados do emissor: prefere o que veio do sumário, senão extrai do título reunido
    let notaEmissor = currentItem.notaEmissor;
    let notaNumero = currentItem.notaNumero;
    if (!notaEmissor) {
      const m = rawTitle.match(/NOTA\s+((?:[A-Z][A-Z0-9/.\-]+)(?:\s+[A-Z][A-Z0-9/.\-]+){0,2})\s+(\d{1,4}\/20\d{2})/i);
      if (m) { notaEmissor = m[1]; notaNumero = m[2]; }
    }

    notas.push({
      id: crypto.randomUUID(),
      title: rawTitle,
      hierarchy: displayHierarchy,
      hierarchyPath,
      contentMarkdown: text,
      tables,
      pageNumber: pages.length > 0 ? pages[0] : undefined,
      isHeaderOnly: isStructuralHeader && text.trim().length < 5,
      isRelevant,
      matchedEntities: matches,
      ...(notaEmissor && { notaEmissor }),
      ...(notaNumero && { notaNumero }),
    });
  }

  // Requirement 5.1: inserir BulletinNota especial "SUMÁRIO" no início da lista
  if (summaryItems.length > 0) {
    const tocContent = formatTocForDisplay(summaryItems);
    const sumarioNota: BulletinNota = {
      id: crypto.randomUUID(),
      title: "SUMÁRIO",
      hierarchy: "Sumário do Boletim",
      contentMarkdown: tocContent,
    };
    return [sumarioNota, ...notas];
  }

  return notas;
};
