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
  isHardLegalParagraph,
  isGeometricallyAlignedWithTable
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

type PageMapEntry = { page: number; text: string; tokens: TextToken[]; lines: { text: string; y: number }[] };

// ──────────────────────────────────────────────
// EXTRAÇÃO DO BLOCO DO SUMÁRIO (Page-aware)
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// PADRÕES ESTRUTURAIS FIXOS DO BOLETIM SEDEC
// ──────────────────────────────────────────────

/**
 * Seções e eixos que se repetem em todo boletim SEDEC/CBMERJ.
 */
const KNOWN_TOC_ANCHORS = [
  /^\d+ª\s*PARTE\b/i,
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

const isTocAnchorLine = (line: string): boolean => {
  const t = line.trim();
  return KNOWN_TOC_ANCHORS.some(re => re.test(t));
};

export const extractTocBlock = (pageMap: PageMapEntry[]): string[] => {
  const TOC_PAGE_INDICES = [1, 2, 3].filter(i => i < pageMap.length);
  const TOC_LINE_PATTERN = /(?:[_.]{3,}|[ \t]{2,})\s*\d{1,4}\s*$/;
  const MIN_TOC_LINES_PER_PAGE = 3;

  const allTocLines: string[] = [];

  for (const pageIdx of TOC_PAGE_INDICES) {
    const lines = pageMap[pageIdx].lines.map(l => l.text);
    const tocCount = lines.filter(l => TOC_LINE_PATTERN.test(l) || isTocAnchorLine(l)).length;
    if (allTocLines.length > 0 && tocCount < MIN_TOC_LINES_PER_PAGE) break;

    if (tocCount >= MIN_TOC_LINES_PER_PAGE || (allTocLines.length === 0 && tocCount > 0)) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^---\s*\[INÍCIO DA PÁGINA/i.test(trimmed)) continue;
        if (/^BOLETIM\s+DA\s+SEDEC/i.test(trimmed)) continue;
        if (/^FL\.\s*\d+$/i.test(trimmed)) continue;
        if (/^!\[.*?\]\(data:image\//i.test(trimmed)) continue;
        allTocLines.push(line);
      }
    }
  }

  if (allTocLines.length > 0) {
    console.log(`[Sentinela] Bloco do Sumário extraído via âncoras: ${allTocLines.length} linhas.`);
    return allTocLines;
  }

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
    console.log(`[Sentinela] Bloco do Sumário extraído via densidade na página ${bestPageIdx}.`);
    return pageMap[bestPageIdx].lines.map(l => l.text);
  }

  console.warn(`[Sentinela] Sumário NÃO identificado em nenhuma página.`);
  return [];
};

export const parseTocLines = (rawLines: string[]): SummaryItem[] => {
  const pending: Array<SummaryItem & { _isHeader: boolean; isSemAlteracao?: boolean }> = [];
  let currentParte = "";
  let currentSecao = "";
  let currentLetraSecao = "";
  let foundFirstParte = false;

  const extractPage = (text: string): { page: number | null; title: string } => {
    const explicit = /(?:[_.]{2,}|[ \t]{2,})\s*(\d{1,4})\s*$/.exec(text);
    if (explicit) {
      return {
        page: parseInt(explicit[1], 10),
        title: text.slice(0, explicit.index).replace(/[_.]+\s*$/, '').trim(),
      };
    }
    const yearGlued = /^(.*\/20\d{2})(\d{1,3})\s*$/.exec(text);
    if (yearGlued) {
      const pageCandidate = parseInt(yearGlued[2], 10);
      if (pageCandidate >= 1 && pageCandidate <= 999) {
        return { page: pageCandidate, title: yearGlued[1].trim() };
      }
    }
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

  const lines = [...rawLines];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const trimmed = lines[lineIdx].trim().replace(/\*\*/g, '');
    if (!trimmed || /^[_.\s*]+$/.test(trimmed)) continue;

    const semAlteracaoMatch = trimmed.match(/^(SEM\s+ALTERA[ÇC][ÃA]O\.?)\s+(\d+)\s+(.+)$/i);
    if (semAlteracaoMatch) {
      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      pending.push({ originalRaw: semAlteracaoMatch[1], cleanTitle: normalizeTitle(semAlteracaoMatch[1]), expectedPage: null, parentCategory: parent || undefined, _isHeader: false, isSemAlteracao: true });
      lines.splice(lineIdx + 1, 0, `${semAlteracaoMatch[3]}  ${semAlteracaoMatch[2]}`);
      continue;
    }

    const { page, title } = extractPage(trimmed);
    if (!title) continue;

    const titleNorm = title.replace(/\s{2,}/g, ' ').trim();
    const lineKey = fuzzyKey(titleNorm);
    const canonical = matchCanonical(lineKey);

    if (canonical) {
      if (canonical.level === 'parte') {
        currentParte = canonical.label; currentSecao = ''; currentLetraSecao = ''; foundFirstParte = true;
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: undefined, _isHeader: true });
      } else if (canonical.level === 'secao') {
        currentSecao = canonical.label; currentLetraSecao = '';
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: currentParte || undefined, _isHeader: true });
      } else if (canonical.level === 'letra') {
        currentLetraSecao = canonical.label;
        if (!currentSecao && canonical.parent) {
          const parentNode = CANONICAL_STRUCTURE.find(n => n.key === canonical.parent);
          if (parentNode) currentSecao = parentNode.label;
        }
        const parent = [currentParte, currentSecao].filter(Boolean).join(' > ');
        pending.push({ originalRaw: canonical.label, cleanTitle: normalizeTitle(canonical.label), expectedPage: page, parentCategory: parent || undefined, _isHeader: true });
      }
      continue;
    }

    if (/^ANEXO\s+[IVXLCDM\d]+/i.test(titleNorm)) {
      currentParte = titleNorm; currentSecao = ''; currentLetraSecao = ''; foundFirstParte = true;
      pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: undefined, _isHeader: true });
      continue;
    }

    if (/SEM\s*ALTERA/i.test(lineKey)) {
      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      pending.push({ originalRaw: titleNorm, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: parent || undefined, _isHeader: false, isSemAlteracao: true });
      continue;
    }

    if (/^\d+[.\s]/.test(titleNorm)) {
      let lastNonHeader: any = null;
      for (let k = pending.length - 1; k >= 0; k--) { if (!pending[k]._isHeader) { lastNonHeader = pending[k]; break; } }
      if (lastNonHeader && lastNonHeader.expectedPage === null) { appendToLast(trimmed, titleNorm, page); continue; }

      const parent = [currentParte, currentSecao, currentLetraSecao].filter(Boolean).join(' > ');
      const notaMatch = titleNorm.match(/NOTA\s+((?:[A-Z][A-Z0-9/.\-]+)(?:\s+[A-Z][A-Z0-9/.\-]+){0,2})\s+(\d+\/20\d{2})/i);
      pending.push({
        originalRaw: trimmed, cleanTitle: normalizeTitle(cleanNoteTitle(titleNorm)), expectedPage: page,
        parentCategory: parent || undefined, _isHeader: false,
        notaEmissor: notaMatch?.[1], notaNumero: notaMatch?.[2],
      });
      continue;
    }

    if (!foundFirstParte && page !== null) {
      pending.push({ originalRaw: trimmed, cleanTitle: normalizeTitle(titleNorm), expectedPage: page, parentCategory: undefined, _isHeader: false });
      continue;
    }

    if (/^([A-Z][A-Z0-9/.\- ]*\s+)?\d{1,4}\/20\d{2}\s*$/.test(titleNorm)) {
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
      if (/_{2,}/.test(item.cleanTitle) || /\*{2,}/.test(item.cleanTitle)) return false;
      if (/^\d+$/.test(item.cleanTitle.trim())) return false;
      const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
      return hasContent && (item._isHeader || item.isSemAlteracao || item.expectedPage !== null || /^\d+[.\s]/.test(item.originalRaw.trim()));
    })
    .map(({ _isHeader, ...rest }) => ({ ...rest }));
};

export const formatTocForDisplay = (items: SummaryItem[]): string => {
  const lines: string[] = [];
  for (const item of items) {
    const pageStr = item.expectedPage !== null ? `  [p. ${item.expectedPage}]` : '';
    let prefix: string;
    let displayText: string;

    if (!item.parentCategory) {
      prefix = 'PARTE:'; displayText = item.originalRaw.trim();
    } else if (item.parentCategory.includes(' > ')) {
      const isLetraSecao = /^[A-Z]\s*[-–]\s*\S/.test(item.originalRaw.trim()) || /^[A-Z] ALTERACOES DE (OFICIAIS|PRACAS|CIVIS)/.test(item.cleanTitle);
      prefix = isLetraSecao ? 'LETRA_SECAO:' : 'NOTA:';
      displayText = isLetraSecao ? item.originalRaw.trim() : item.cleanTitle;
    } else {
      prefix = 'SECAO:'; displayText = item.originalRaw.trim();
    }
    lines.push(`${prefix}${displayText}${pageStr}`.replace(/_{2,}/g, '').replace(/\*{2,}/g, ''));
  }
  return lines.join('\n');
};

const cleanAndFormatSlice = (
  lines: { text: string; page: number; tokens: TextToken[]; y: number }[]
): { text: string; pages: number[]; tables: TableData[] } => {
  const detectedPages = new Set<number>();
  lines.forEach(l => detectedPages.add(l.page));

  const filtered = lines.filter(l => {
    const plain = l.text.trim().replace(/\*\*/g, '');
    if (!plain || /^F\s*L\s*\.\s*\d+$/i.test(plain) || plain.toLowerCase().includes('voltar_ao_sumário') || isPageHeaderOrFooter(plain) || /^\d{1,3}$/.test(plain) || isTOCLine(plain)) return false;
    return true;
  });

  const processedBlocks: string[] = [];
  const paragraphLines: string[] = [];
  let tableLines: { text: string; tokens: TextToken[]; y: number; isBridge?: boolean }[] = [];
  const foundTables: TableData[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    
    // Melhoria de Segmentação: O joinWrappedParagraphs original é agressivo.
    // Analisamos o texto acumulado para ver se há quebras de parágrafo "fortes" 
    // que devem ser preservadas como \n\n antes de enviar para o joiner.
    const rawContent = paragraphLines.join("\n");
    processedBlocks.push(joinWrappedParagraphs(rawContent));
    paragraphLines.length = 0;
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    
    // Separa apenas o título principal (primeira linha em CAIXA ALTA sem gaps)
    let titleLine: typeof tableLines[0] | null = null;
    let startIdx = 0;
    
    if (tableLines.length > 0 && !tableLines[0].isBridge) {
      const firstLine = tableLines[0];
      const plain = firstLine.text.replace(/\*\*/g, '').trim();
      const isAllCaps = plain === plain.toUpperCase() && plain.length > 15;
      const hasNoWideGaps = (plain.match(/\s{3,}/g) || []).length === 0;
      
      if (isAllCaps && hasNoWideGaps) {
        titleLine = firstLine;
        startIdx = 1;
      }
    }
    
    const actualTableLines = tableLines.slice(startIdx);
    
    // Flush título como parágrafo
    if (titleLine) {
      flushParagraph();
      paragraphLines.push(titleLine.text);
      flushParagraph();
    }
    
    const hasRealHeader = actualTableLines.some(l => !l.isBridge && isTableHeader(l.text));
    const realLines = actualTableLines.filter(l => !l.isBridge && l.text.trim().length > 0);
    
    if (!hasRealHeader || realLines.length < 2) {
      actualTableLines.filter(l => !l.isBridge).forEach(l => paragraphLines.push(l.text));
      tableLines = []; return;
    }
    
    const allTableTokens: TextToken[] = [];
    actualTableLines.forEach(line => {
      if (line.isBridge) return;
      allTableTokens.push(...line.tokens.filter(t => Math.abs(t.y - line.y) <= 4));
    });

    if (allTableTokens.length > 0) {
      const uniqueTokens = Array.from(new Map(allTableTokens.map(t => [`${t.page || 0}-${t.x}-${t.y}-${t.text}`, t])).values());
      const data = reconstructTable(uniqueTokens);
      if (data.columnCount > 1) {
        const tableIdx = foundTables.length;
        foundTables.push(data);
        const gridLines = data.rows.map(row => row.map(cell => cell.text).join(" | "));
        processedBlocks.push(`\`\`\`grid-tab-${tableIdx}\n` + gridLines.join("\n") + "\n```");
      } else {
        paragraphLines.push(...actualTableLines.filter(l => !l.isBridge).map(l => l.text));
      }
    }
    tableLines = [];
  };

  const lineTypes = filtered.map(l => {
     const lineTokens = l.tokens.filter(t => Math.abs(t.y - l.y) <= 4);
     return {
       obj: l,
       isTable: !isPageHeaderOrFooter(l.text) && !/^\[CENTER\]!\[|^!\[/.test(l.text.trim()) && !isRectificationMarker(l.text) && (detectTableStructure(l.text, lineTokens) || isTableHeader(l.text)),
       isBridge: false
     };
  });

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

        if (isRectificationMarker(plainText) || isHardLegalParagraph(plainText)) continue;
        if (prevTable && nextTable && prevGap < 30 && nextGap < 30) { lineTypes[i].isTable = true; continue; }

        const adjacentTableIndices: number[] = [];
        if (prevTable) { for (let k = i - 1; k >= Math.max(0, i - 5); k--) { if (lineTypes[k].isTable) adjacentTableIndices.push(k); else break; } }
        if (nextTable) { for (let k = i + 1; k <= Math.min(lineTypes.length - 1, i + 5); k++) { if (lineTypes[k].isTable) adjacentTableIndices.push(k); else break; } }

        if (adjacentTableIndices.length > 0) {
          const minGap = Math.min(prevTable ? prevGap : Infinity, nextTable ? nextGap : Infinity);
          const lineTokens = lineTypes[i].obj.tokens.filter(t => Math.abs(t.y - lineTypes[i].obj.y) <= 6);
          const neighboringTokens: TextToken[] = [];
          adjacentTableIndices.forEach(idx => neighboringTokens.push(...lineTypes[idx].obj.tokens.filter(t => Math.abs(t.y - lineTypes[idx].obj.y) <= 6)));
          if (minGap < 40 && isGeometricallyAlignedWithTable(lineTokens, neighboringTokens)) { lineTypes[i].isTable = true; continue; }
        }
     }
  }

  for (let i = 0; i < lineTypes.length; i++) {
    if (lineTypes[i].isTable && !lineTypes[i].isBridge) {
        let j = i + 1; while (j < lineTypes.length && lineTypes[j].isTable) j++;
        if (j < lineTypes.length) {
            let nextTableIdx = -1; let containsHardBreak = false;
            for (let k = j; k < Math.min(j + 15, lineTypes.length); k++) {
                if (lineTypes[k].isTable) { nextTableIdx = k; break; }
                const plainText = lineTypes[k].obj.text.trim().replace(/\*\*/g, '');
                if (isSubSectionTitle(plainText) || isRectificationMarker(plainText) || isHardLegalParagraph(plainText)) { containsHardBreak = true; break; }
            }
            if (nextTableIdx !== -1 && !containsHardBreak) {
                for (let k = j; k < nextTableIdx; k++) { lineTypes[k].isTable = true; lineTypes[k].isBridge = true; }
                i = nextTableIdx - 1;
            } else { i = j - 1; }
        }
    }
  }

  for (let i = 0; i < lineTypes.length; i++) {
      if (lineTypes[i].isTable) {
        if (tableLines.length === 0 && !lineTypes[i].isBridge && !isTableHeader(lineTypes[i].obj.text)) {
           let hasHeaderAhead = false;
           for (let k = i + 1; k < Math.min(i + 4, lineTypes.length); k++) {
             if (!lineTypes[k].isTable) break;
             if (isTableHeader(lineTypes[k].obj.text)) { hasHeaderAhead = true; break; }
           }
           if (!hasHeaderAhead) { 
             flushTable(); 
             paragraphLines.push(lineTypes[i].obj.text); 
             continue; 
           }
        }
        flushParagraph(); 
        tableLines.push({ ...lineTypes[i].obj, isBridge: lineTypes[i].isBridge });
      } else {
        flushTable(); 
        
        // Detecção de novo parágrafo via Y-gap ou Indentação
        if (paragraphLines.length > 0) {
          const prev = lineTypes[i-1].obj;
          const curr = lineTypes[i].obj;
          const yGap = Math.abs(curr.y - prev.y);
          
          const currTokens = curr.tokens.slice().sort((a, b) => a.x - b.x);
          const prevTokens = prev.tokens.slice().sort((a, b) => a.x - b.x);
          
          // Espaçamento normal de linha em PDFs Segoe UI 10pt ≈ 12-16px.
          // Só considera quebra de parágrafo real se o gap for > 22px (≈ 1.5x linha normal)
          // OU se houver indentação significativa (> 30px) — parágrafo com recuo.
          const isParaBreak = yGap > 22 || (currTokens[0]?.x > (prevTokens[0]?.x ?? 0) + 30);
          if (isParaBreak) {
            paragraphLines.push(""); // Insere linha vazia para forçar separação no joiner
          }
        }
        
        paragraphLines.push(lineTypes[i].obj.text);
      }
  }
  flushTable(); flushParagraph();

  return { text: processedBlocks.join("\n\n").trim(), pages: Array.from(detectedPages).sort((a, b) => a - b), tables: foundTables };
};

export const extractBulletinLocalAlgo = async (
  file: File,
  personnelInput: MilitaryPerson[],
  keywords: string[],
  preferences: SearchPreferences,
  pageMapInput?: PageMapEntry[],
  onProgress?: (progress: number) => void
): Promise<BulletinNota[]> => {
  let pm = pageMapInput;
  if (!pm) {
      const { pageMap } = await extractTextFromPdf(file);
      pm = pageMap;
  }
  
  if (onProgress) onProgress(30);

  const allLines: { text: string; page: number; tokens: TextToken[]; y: number }[] = [];
  pm.forEach(p => p.lines.forEach(l => {
      let cleanedText = l.text;
      
      // HEURÍSTICA DE RECUPERAÇÃO: Se a linha parece estar "espalhada" (muitas letras isoladas)
      const words = cleanedText.trim().split(/\s+/);
      if (words.length > 4) {
          const singleCharWords = words.filter(w => w.length === 1).length;
          if (singleCharWords / words.length > 0.7) {
              // É um texto com letras separadas. Vamos unir mantendo espaços duplos como separadores de palavras reais se existirem
              // Mas no PDF.js geralmente é espaço simples. Vamos unir tudo e depois tentar re-separar ou apenas unir.
              // Para fins de busca de títulos, unir tudo é o mais seguro.
              cleanedText = words.join('');
          }
      }
      
      allLines.push({ text: cleanedText, page: p.page, tokens: p.tokens, y: l.y });
  }));

  const tocRawLines = extractTocBlock(pm);
  const summaryItems = parseTocLines(tocRawLines);
  if (onProgress) onProgress(50);

  const validSummaryItems = summaryItems.filter(item => {
    const isHeader = !!item.originalRaw.match(REGEX_PARTE_PREFIX) ||
                     !!item.originalRaw.match(REGEX_ANEXO_PREFIX) ||
                     !!item.originalRaw.match(REGEX_EIXO_PREFIX);
    const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
    return hasContent && (item.expectedPage !== null || isHeader || item.isSemAlteracao);
  });

  // Determina quais páginas do PDF pertencem ao bloco do sumário (TOC).
  const TOC_PAGE_INDICES = new Set([1, 2, 3].filter(i => i < pm!.length).map(i => pm![i].page));
  const firstBodyLineIndex = allLines.findIndex(l => !TOC_PAGE_INDICES.has(l.page));
  const bodySearchStart = firstBodyLineIndex >= 0 ? firstBodyLineIndex : 0;

  const checkRelevance = (content: string) => {
    const matchedEntities: string[] = [];
    let isRelevant = false;
    let hasFuzzyMatch = false;

    const matchedPersonnel = matchPersonnelInLine(content, personnelInput, preferences);
    if (matchedPersonnel.length > 0) {
      matchedPersonnel.forEach(p => { 
        if (!matchedEntities.includes(p.name)) matchedEntities.push(p.name);
        if (p.confidence !== 'High') hasFuzzyMatch = true;
      });
      isRelevant = true;
    }

    return { 
        isRelevant, 
        matchedEntities: Array.from(new Set(matchedEntities)),
        hasFuzzyMatch
    };
  };

  let currentSearchLine = bodySearchStart;
  for (let i = 0; i < validSummaryItems.length; i++) {
    const item = validSummaryItems[i];
    const isParte = !!item.originalRaw.match(REGEX_PARTE_PREFIX) || !!item.originalRaw.match(REGEX_ANEXO_PREFIX);
    const rawStripped = item.originalRaw.replace(/[_.]{2,}.*$/, '').trim();
    const cleanPrefix = normalizeTitle(isParte ? rawStripped : stripNumericPrefix(rawStripped));
    const searchWords = cleanPrefix.split(/\s+/).filter(w => w.length > 0); // Mantém conectivos como "O", "E", "A"
    const searchSpace = searchWords.slice(0, isParte ? 3 : 5).join(' '); // Aumenta para 5 palavras para ser mais específico
    const searchSuffix = searchWords.slice(-3).join(' ');
    const noteNumMatch = item.originalRaw.match(/^(\d+)[.\s]/);
    const anchoredSpace = noteNumMatch ? normalizeTitle(`${noteNumMatch[1]} ${rawStripped}`).split(/\s+/).slice(0, 5).join(' ') : null;

    let foundLine = -1;
    if (anchoredSpace && anchoredSpace.length > 3) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
        if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && normalizeTitle(allLines[j].text).includes(anchoredSpace)) { foundLine = j; break; }
      }
    }
    if (foundLine === -1) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
         if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && searchSpace.length > 3 && normalizeTitle(allLines[j].text).includes(searchSpace)) { foundLine = j; break; }
      }
    }
    if (foundLine === -1 && searchSuffix.length > 5 && searchSuffix !== searchSpace) {
        for (let j = currentSearchLine; j < allLines.length; j++) {
            if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && normalizeTitle(allLines[j].text).includes(searchSuffix)) { foundLine = j; break; }
        }
    }
    if (foundLine === -1) {
        for (let j = bodySearchStart; j < allLines.length; j++) {
            if (!isTOCLine(allLines[j].text) && normalizeTitle(allLines[j].text).includes(anchoredSpace || searchSpace || searchSuffix)) { foundLine = j; break; }
        }
    }
    if (foundLine === -1) {
        for (let j = currentSearchLine; j < allLines.length; j++) {
            const line = allLines[j];
            const tokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 6);
            if (tokens.length === 0) continue;
            if (tokens.filter(t => t.isBold).length / tokens.length > 0.6 && searchWords.length >= 2) {
               if (searchWords.slice(0, 3).filter(w => normalizeTitle(line.text).includes(w)).length >= 2) { foundLine = j; break; }
            }
        }
    }
    if (foundLine !== -1) { 
        item.foundLineIndex = foundLine; 
        currentSearchLine = foundLine + 1; 
    } else {
        const sampleText = allLines.slice(currentSearchLine, currentSearchLine + 5).map(l => l.text).join(' | ').substring(0, 100);
        console.log(`[Sentinela] Falha ao localizar nota: "${searchSpace}" (TOC: "${item.cleanTitle}"). Contexto busca: ${sampleText}...`);
    }
  }

  const locatedItems = validSummaryItems.filter(item => item.foundLineIndex !== undefined);
  locatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));

  // Sanidade: dois itens com foundLineIndex muito próximo (< 3 linhas) — descarta o segundo,
  // exceto quando é uma nota numerada logo após cabeçalho de parte/eixo (estrutura legítima).
  for (let i = 1; i < locatedItems.length; i++) {
    const prev = locatedItems[i - 1], curr = locatedItems[i];
    if (((curr.foundLineIndex ?? 0) - (prev.foundLineIndex ?? 0)) < 3) {
      const currIsNota = /^\d+[.\s]/.test(curr.originalRaw.trim());
      const prevIsHeader = !!(prev.originalRaw.match(REGEX_PARTE_PREFIX) || prev.originalRaw.match(REGEX_EIXO_PREFIX) || prev.originalRaw.match(REGEX_ANEXO_PREFIX) || prev.originalRaw.match(REGEX_LETTER_ITEM_PREFIX));
      if (!(currIsNota && prevIsHeader)) curr.foundLineIndex = undefined;
    }
  }

  // Deduplicação de eixos/partes: o mesmo cabeçalho aparece no sumário E no corpo.
  // Mantém apenas a ocorrência com maior foundLineIndex (a do corpo).
  const seenHeaderTitles = new Map<string, typeof locatedItems[0]>();
  for (const item of locatedItems) {
    if (item.foundLineIndex === undefined) continue;
    const isStructural = !!(item.originalRaw.match(REGEX_PARTE_PREFIX) || item.originalRaw.match(REGEX_EIXO_PREFIX) || item.originalRaw.match(REGEX_ANEXO_PREFIX) || item.originalRaw.match(REGEX_LETTER_ITEM_PREFIX));
    if (!isStructural) continue;
    const key = normalizeTitle(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
    const existing = seenHeaderTitles.get(key);
    if (!existing || (item.foundLineIndex ?? 0) > (existing.foundLineIndex ?? 0)) {
      seenHeaderTitles.set(key, item);
    }
  }
  const dedupedLocated = locatedItems.filter(item => {
    if (item.foundLineIndex === undefined) return false;
    const isStructural = !!(item.originalRaw.match(REGEX_PARTE_PREFIX) || item.originalRaw.match(REGEX_EIXO_PREFIX) || item.originalRaw.match(REGEX_ANEXO_PREFIX) || item.originalRaw.match(REGEX_LETTER_ITEM_PREFIX));
    if (!isStructural) return true;
    const key = normalizeTitle(item.originalRaw.replace(/[_.]{2,}.*$/, '').trim());
    return seenHeaderTitles.get(key) === item;
  });

  // Sanidade de ordem hierárquica: eixo não pode aparecer antes da sua parte pai.
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
        item.foundLineIndex = undefined;
      }
    }
  }

  const cleanLocatedItems = dedupedLocated.filter(item => item.foundLineIndex !== undefined);
  cleanLocatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));

  const notas: BulletinNota[] = [];
  let sectionStack: SectionStackItem[] = [];
  const firstFoundIndex = cleanLocatedItems.length > 0 ? (cleanLocatedItems[0].foundLineIndex || 0) : 0;

  if (firstFoundIndex > bodySearchStart) {
    const slice = allLines.slice(bodySearchStart, firstFoundIndex);
    const { text, pages, tables } = cleanAndFormatSlice(slice);
    const { isRelevant, matchedEntities, hasFuzzyMatch } = checkRelevance(text);
    if (text.trim().length > 10) notas.push({ id: crypto.randomUUID(), title: "ABERTURA DO BOLETIM", hierarchy: "Abertura do Boletim", contentMarkdown: text, tables, pageNumber: pages[0], isRelevant, matchedEntities, hasFuzzyMatch });
  }

  const REGEX_NEXT_NOTA = /^\*{0,2}\d+[.\s]/;
  const isStructuralLine = (l: string) =>
    REGEX_PARTE_PREFIX.test(l) || REGEX_EIXO_PREFIX.test(l) ||
    REGEX_LETTER_ITEM_PREFIX.test(l) || REGEX_ANEXO_PREFIX.test(l);

  for (let i = 0; i < cleanLocatedItems.length; i++) {
    const item = cleanLocatedItems[i];
    const next = cleanLocatedItems[i + 1];
    const start = item.foundLineIndex!;
    const end = next ? next.foundLineIndex! - 1 : allLines.length - 1;

    const tocTitle = item.originalRaw.replace(/[_.]{2,}.*$/, '').trim();
    const rawTitle = stripInternalMarkers(tocTitle);
    const tocTitleNorm = normalizeTitle(tocTitle);
    const tocWords = tocTitleNorm.split(/\s+/).filter(w => w.length > 1);

    const { updatedStack } = buildHierarchy(rawTitle, sectionStack);
    sectionStack = updatedStack;

    // Calcula quantas linhas do corpo formam o título (titleLinesConsumed)
    let titleLinesConsumed = 0;
    let bodyTitleAccum = '';
    for (let k = start; k <= Math.min(start + 8, end); k++) {
      const l = allLines[k].text.trim().replace(/\*\*/g, '');
      if (!l) { titleLinesConsumed++; continue; }
      if (k > start && isStructuralLine(l)) break;
      if (k > start && REGEX_NEXT_NOTA.test(l)) break;
      bodyTitleAccum += ' ' + l;
      titleLinesConsumed++;
      const accumNorm = normalizeTitle(bodyTitleAccum);
      const covered = tocWords.filter(w => accumNorm.includes(w)).length;
      if (covered >= Math.ceil(tocWords.length * 0.8)) {
        const nextL = allLines[k + 1]?.text.trim().replace(/\*\*/g, '') || '';
        const nextIsContinuation = nextL.length > 0 && !isStructuralLine(nextL) && !REGEX_NEXT_NOTA.test(nextL) &&
          /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s\-\/(),.]+$/.test(nextL) && !/^[a-z]/.test(nextL);
        if (!nextIsContinuation) break;
      }
    }

    const slice = allLines.slice(start + titleLinesConsumed, end + 1).map(l => ({
      text: l.text, page: l.page, tokens: l.tokens, y: l.y
    }));
    const { text, pages, tables } = cleanAndFormatSlice(slice);
    const { isRelevant, matchedEntities, hasFuzzyMatch } = checkRelevance(text + " " + rawTitle);

    // displayHierarchy
    const isBeforeOperacoes = !item.parentCategory ||
      /^1[ªa]\s*PARTE/.test(item.parentCategory.toUpperCase()) ||
      !/\d+[ªa]\s*PARTE/.test(item.parentCategory.toUpperCase());
    const isAnexo = !!rawTitle.match(REGEX_ANEXO_PREFIX) ||
      !!(item.parentCategory && /^ANEXO\s+[IVXLCDM\d]+/i.test(item.parentCategory));
    const displayHierarchy = isAnexo ? 'Anexos do Boletim'
      : isBeforeOperacoes ? 'Abertura do Boletim'
      : item.parentCategory!;

    // hierarchyPath
    const isParte = !!rawTitle.match(REGEX_PARTE_PREFIX) || !!rawTitle.match(REGEX_ANEXO_PREFIX);
    const isEixo = !!rawTitle.match(REGEX_EIXO_PREFIX);
    const isLetterSection = !!rawTitle.match(REGEX_LETTER_ITEM_PREFIX) && !rawTitle.match(REGEX_ITEM_PREFIX);
    let hierarchyPath = displayHierarchy.split('>').map(s => s.trim()).filter(Boolean);
    if (isEixo || isLetterSection) hierarchyPath = [...hierarchyPath, rawTitle];

    // Descarta eixos/letra-seções estruturais sem conteúdo próprio
    const isStructuralEixo = isEixo && !item.notaEmissor && text.trim().length < 5;
    const isStructuralLetter = isLetterSection && !item.notaEmissor && text.trim().length < 5;
    if (isStructuralEixo || isStructuralLetter) continue;

    const isStructuralHeader = isParte || (isEixo && !item.notaEmissor) || (isLetterSection && !item.notaEmissor);

    // Emissor/número da nota
    let notaEmissor = item.notaEmissor;
    let notaNumero = item.notaNumero;
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
      matchedEntities,
      hasFuzzyMatch,
      ...(notaEmissor && { notaEmissor }),
      ...(notaNumero && { notaNumero }),
    });
  }

  if (summaryItems.length > 0) notas.unshift({ id: crypto.randomUUID(), title: "SUMÁRIO", hierarchy: "Sumário do Boletim", contentMarkdown: formatTocForDisplay(summaryItems) });
  return notas;
};
