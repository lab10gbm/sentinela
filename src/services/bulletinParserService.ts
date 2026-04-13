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
import { validateAndReconstruct } from "./TableValidator";
import { SINGLE_COL_LIST_RE } from "./tableTypes";
import {
  inferColumnBoundaries,
  isTableContinuation,
  hasMilitaryDataPattern,
} from "./TablePatternAnalyzer";
import {
  CANONICAL_STRUCTURE,
  fuzzyKey,
  matchCanonical,
  buildHierarchy,
  SectionStackItem,
} from "./hierarchyService";
import { matchPersonnelInBlock } from "./localSearchService";

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
      // Notas numeradas NUNCA são fundidas com o item anterior via appendToLast —
      // cada "N. TÍTULO" é sempre uma nota independente, mesmo que o item anterior
      // não tenha número de página (o número de página pode estar na linha seguinte).
      // EXCEÇÃO: subtítulos internos de seção (ex: "4. DATA, HORÁRIO E LOCAL",
      // "1. FINALIDADE") — são seções internas de documentos anexados, não notas do boletim.
      const INTERNAL_TOC = /^\d+\s+(FINALIDADE|OBJETIVOS?|DURACAO|DATA\b|HORARIO\b|LOCAL\b|ESCOPO|METODOLOGIA|CRONOGRAMA|RECURSOS|AVALIACAO|RESULTADOS?\b|CONCLUSAO|CONSIDERACOES|DISPOSICOES|RESPONSABILIDADES?|PRAZOS?|PROCEDIMENTOS?|INSTRUCOES|ORIENTACOES|OBSERVACOES|UNIDADES\s+ENVOLVIDAS|DESENVOLVIMENTO|AVALIACAO\s+DO\s+ESTAGIO|PRESCRICOES\s+DIVERSAS|PRESCRICOES\b)\b/i;
      if (INTERNAL_TOC.test(titleNorm)) {
        if (!appendToLast(trimmed, titleNorm, page)) { /* descarta silenciosamente */ }
        continue;
      }
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
    // Exclui cabeçalhos de PARTE/EIXO estruturais que aparecem no corpo mas têm card próprio
    // (ex: "5ª PARTE - COMUNICAÇÃO SOCIAL" que vaza para o slice da nota anterior)
    // EXCEÇÃO: "C Alte MB ...", "CC MB ..." — C e CC são numerais romanos mas aqui são postos
    // militares da Marinha. Só descarta EIXO se o texto for APENAS o eixo (sem conteúdo após)
    // ou se o conteúdo após o separador não parecer dado de militar/civil.
    if (REGEX_PARTE_PREFIX.test(plain)) return false;
    if (REGEX_EIXO_PREFIX.test(plain)) {
      // Verifica se é realmente um eixo estrutural ou um posto militar mal interpretado
      const eixoMatch = plain.match(REGEX_EIXO_PREFIX);
      const afterHyphen = eixoMatch?.[2]?.trim() ?? '';
      // Eixo real: sem conteúdo após o separador, ou conteúdo é título em CAIXA ALTA curto
      // Posto militar: conteúdo após o separador contém nome próprio (mix de maiúsculas/minúsculas
      // ou múltiplas palavras que parecem nome)
      const looksLikeMilitaryData = afterHyphen.length > 0 && (
        /[a-záéíóúâêîôûãõç]/.test(afterHyphen) ||  // tem minúsculas = nome próprio
        afterHyphen.split(/\s+/).length >= 3          // 3+ palavras = nome completo
      );
      if (looksLikeMilitaryData) return true; // mantém a linha
      return false; // descarta eixo estrutural
    }
    return true;
  });

  const processedBlocks: string[] = [];
  const paragraphLines: string[] = [];
  let tableLines: { text: string; tokens: TextToken[]; y: number; isBridge?: boolean }[] = [];
  const foundTables: TableData[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    
    const rawContent = paragraphLines.join("\n");
    processedBlocks.push(joinWrappedParagraphs(rawContent));
    paragraphLines.length = 0;
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    
    // CORREÇÃO #1: Separa títulos de formulário e frases introdutórias ANTES da tabela
    const titlesToExtract: typeof tableLines = [];
    let startIdx = 0;
    
    // Extrai todas as linhas iniciais que são títulos ou introduções (não apenas a primeira)
    while (startIdx < tableLines.length && !tableLines[startIdx].isBridge) {
      const line = tableLines[startIdx];
      const plain = line.text.replace(/\*\*/g, '').trim();
      
      const isAllCaps = plain === plain.toUpperCase() && plain.length > 15;
      const hasNoWideGaps = (plain.match(/\s{3,}/g) || []).length === 0;
      const isIntro = /^(Considerando|O\s+Cel\s+BM|O\s+Diretor|O\s+Comandante|Torna\s+Públ|processo\s+seletivo|à\s+saber:)/i.test(plain) || 
                      plain.endsWith(':') || 
                      isHardLegalParagraph(plain);
      
      const isHeader = isTableHeader(plain);
      
      // Título ou intro: CAIXA ALTA sem gaps OU frase introdutória identificada
      // Mas se a linha parecer MUITO um cabeçalho (QTD, NOME, RG), nunca extraímos como título
      if (!isHeader && ( (isAllCaps && hasNoWideGaps) || isIntro )) {
        titlesToExtract.push(line);
        startIdx++;
      } else {
        break;
      }
    }
    
    const actualTableLines = tableLines.slice(startIdx);
    
    // Flush títulos como parágrafos centralizados
    if (titlesToExtract.length > 0) {
      flushParagraph();
      titlesToExtract.forEach(titleLine => {
        // Marca como centralizado para renderização
        paragraphLines.push(`[CENTER]${titleLine.text}`);
      });
      flushParagraph();
    }
    
    const hasRealHeader = actualTableLines.some(l => !l.isBridge && isTableHeader(l.text));
    const realLines = actualTableLines.filter(l => !l.isBridge && l.text.trim().length > 0);
    
    if (!hasRealHeader || realLines.length < 2) {
      actualTableLines.filter(l => !l.isBridge).forEach(l => paragraphLines.push(l.text));
      tableLines = []; return;
    }
    
    const allTableTokens: TextToken[] = [];
    // Filtra tokens que são artefatos de kerning/rodapé (caracteres únicos repetidos)
    // Ex: **F** **F** **L** **L** **.** **.** **2** **2** = "FFLL..22" de rodapé
    const isKerningArtifact = (tok: { text: string }) =>
      tok.text.trim().length <= 1 && /^[A-Z0-9.º°,;:\-/]$/i.test(tok.text.trim());

    // Detecta linha inteira de kerning: maioria dos tokens tem 1 char
    const isKerningLine = (tokens: { text: string }[]) => {
      if (tokens.length < 4) return false;
      const singleChar = tokens.filter(t => isKerningArtifact(t)).length;
      return singleChar / tokens.length >= 0.6;
    };

    actualTableLines.forEach(line => {
      if (line.isBridge) {
        const plain = line.text.replace(/\*\*/g, '').trim();
        const isCellContinuation = plain.length < 80 && !isHardLegalParagraph(plain);
        if (!isCellContinuation) return;
        const lineTokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 10);
        if (isKerningLine(lineTokens)) return; // descarta linha inteira de kerning
        allTableTokens.push(...lineTokens.filter(t => !isKerningArtifact(t)));
        return;
      }
      const lineTokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 4);
      if (isKerningLine(lineTokens)) return; // descarta linha inteira de kerning
      allTableTokens.push(...lineTokens.filter(t => !isKerningArtifact(t)));
    });

    if (allTableTokens.length > 0) {
      const uniqueTokens = Array.from(new Map(allTableTokens.map(t => [`${t.page || 0}-${t.x}-${t.y}-${t.text}`, t])).values());

      // Detecta lista de pessoal de coluna única (MILITAR / DEMAIS FORÇAS / CIVIS / NOME).
      // Nesses blocos cada linha é um militar/civil completo — NÃO passar pelo reconstructTable
      // pois os gaps internos (posto | nome | RG) seriam interpretados como colunas.
      // Monta diretamente uma TableData de 1 coluna preservando o texto de cada linha.
      const isSingleColPersonnelList = actualTableLines.some(
        l => SINGLE_COL_LIST_RE.test(l.text.replace(/\*\*/g, '').trim())
      );

      let data: import("../types").TableData;
      if (isSingleColPersonnelList) {
        const rows = actualTableLines
          .filter(l => !l.isBridge && l.text.trim().length > 0)
          .map((l, idx) => [{
            text: l.text.trim(),
            tokens: l.tokens,
            row: idx, col: 0, rowSpan: 1, colSpan: 1, align: 'left' as const,
          }]);
        data = { rows, columnCount: 1, rowCount: rows.length };
      } else {
        const validated = validateAndReconstruct(uniqueTokens, actualTableLines);
        data = validated.data;
        if (validated.report.needsManualReview) {
          console.warn(`[TableValidator] Tabela requer revisão manual — score=${validated.report.overallScore.toFixed(2)}, tipo=${validated.report.tableType}`);
        }
      }

      if (data.columnCount >= 1 && data.rowCount > 0) {
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
       isTable: !isPageHeaderOrFooter(l.text) && !/^\[CENTER\]!\[|^!\[/.test(l.text.trim()) && !isRectificationMarker(l.text) && !isHardLegalParagraph(l.text) && (detectTableStructure(l.text, lineTokens) || isTableHeader(l.text)),
       isBridge: false
     };
  });

  const orig = lineTypes.map(l => l.isTable);
  // Pass 1b: propaga isTable para linhas de dados logo após cabeçalho de lista de pessoal.
  // Ex: após "MILITAR" (isTable=true), as linhas "CMG MB LEONARDO..." também devem ser isTable.
  // Critério: linha imediatamente após cabeçalho de lista, sem gaps largos, sem hard break.
  // Pass 1b: propaga isTable para linhas de dados logo após cabeçalho de lista de pessoal.
  for (let i = 0; i < lineTypes.length - 1; i++) {
    if (!lineTypes[i].isTable) continue;
    const headerPlain = lineTypes[i].obj.text.replace(/\*\*/g, '').trim();
    if (!SINGLE_COL_LIST_RE.test(headerPlain)) continue;
    // Propaga para as linhas seguintes até encontrar hard break, linha vazia ou nova seção
    for (let k = i + 1; k < lineTypes.length; k++) {
      const kPlain = lineTypes[k].obj.text.replace(/\*\*/g, '').trim();
      if (!kPlain) break;
      if (isHardLegalParagraph(kPlain) || isRectificationMarker(kPlain)) break;
      if (REGEX_PARTE_PREFIX.test(kPlain) || REGEX_EIXO_PREFIX.test(kPlain)) break;
      // Nova seção de lista (outro cabeçalho) — para aqui, o próximo bloco cuidará
      if (SINGLE_COL_LIST_RE.test(kPlain)) break;
      lineTypes[k].isTable = true;
    }
  }
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
            let nextTableIdx = -1;
            let containsHardBreak = false;
            let hardBreakIsClosingFormula = false; // "Em consequência..." entre páginas de tabela
            for (let k = j; k < Math.min(j + 15, lineTypes.length); k++) {
                if (lineTypes[k].isTable) { nextTableIdx = k; break; }
                const plainText = lineTypes[k].obj.text.trim().replace(/\*\*/g, '');
                if (isSubSectionTitle(plainText) || isRectificationMarker(plainText)) {
                    containsHardBreak = true; break;
                }
                if (isHardLegalParagraph(plainText)) {
                    // Fórmula de encerramento (ex: "Em consequência...") pode aparecer
                    // entre páginas de uma tabela multi-página — não quebra se o próximo
                    // bloco de tabela tiver o mesmo cabeçalho (tabela continua na pág seguinte).
                    hardBreakIsClosingFormula = true;
                    // Continua procurando o próximo bloco de tabela
                }
            }

            // Se o hard break é só fórmula de encerramento E o próximo bloco tem mesmo cabeçalho,
            // trata como tabela multi-página e faz bridge atravessando a fórmula.
            if (hardBreakIsClosingFormula && !containsHardBreak && nextTableIdx !== -1) {
                const currentHeaderText = normalizeTitle(
                    lineTypes.slice(i, j).find(l => isTableHeader(l.obj.text))?.obj.text ?? ''
                );
                const nextHeaderText = normalizeTitle(
                    lineTypes.slice(nextTableIdx, Math.min(nextTableIdx + 5, lineTypes.length))
                        .find(l => isTableHeader(l.obj.text))?.obj.text ?? ''
                );
                const sameTable = currentHeaderText.length > 0 && nextHeaderText.length > 0 &&
                    currentHeaderText === nextHeaderText;
                if (!sameTable) {
                    containsHardBreak = true; // cabeçalhos diferentes → tabelas distintas
                }
            }

            if (nextTableIdx !== -1 && !containsHardBreak) {
                // Bridge protection: if the gap contains many lines and they look like 
                // actual text paragraphs (many words, normal casing), don't bridge.
                let bridgeLinesCount = nextTableIdx - j;
                let looksLikeParagraph = 0;
                for (let k = j; k < nextTableIdx; k++) {
                    const line = lineTypes[k].obj.text.trim();
                    if (line.length > 50 && (line.match(/\s/g) || []).length > 8) looksLikeParagraph++;
                }

                if (bridgeLinesCount < 8 || looksLikeParagraph < 3) {
                    for (let k = j; k < nextTableIdx; k++) {
                        lineTypes[k].isTable = true;
                        lineTypes[k].isBridge = true;
                    }
                    i = nextTableIdx - 1;
                } else {
                    i = j - 1;
                }
            } else {
                i = j - 1;
            }
        }
    }
  }

  // ── Pass 3: TablePatternAnalyzer — estende bridge para linhas de dados militares ──
  // Após o bridge scan geométrico, verifica se linhas não marcadas como isTable
  // têm padrão de dado militar e estão alinhadas com as boundaries da tabela anterior.
  // Isso captura linhas 18-28+ que saem da tabela após quebra de página.
  {
    // Itera por TODOS os blocos de tabela (não só o último) e tenta estender cada um
    let i = 0;
    while (i < lineTypes.length) {
      if (!lineTypes[i].isTable) { i++; continue; }

      // Delimita o bloco de tabela atual
      let blockEnd = i;
      while (blockEnd < lineTypes.length && lineTypes[blockEnd].isTable) blockEnd++;
      // blockEnd agora aponta para a primeira linha NÃO-tabela após o bloco

      // Calcula boundaries a partir dos tokens do bloco
      const blockTokens = lineTypes.slice(i, blockEnd).flatMap(lt =>
        lt.obj.tokens.filter(t => Math.abs(t.y - lt.obj.y) <= 5)
      );

      if (blockTokens.length > 0) {
        const analysis = inferColumnBoundaries(blockTokens);
        if (analysis.confidence >= 0.4 && analysis.boundaries.length >= 3) {
          // Varre as linhas imediatamente após o bloco
          for (let k = blockEnd; k < lineTypes.length; k++) {
            if (lineTypes[k].isTable) break; // encontrou outro bloco, para
            const lt = lineTypes[k];
            const plain = lt.obj.text.replace(/\*\*/g, "").trim();
            if (!plain) continue;
            // Rejeita cabeçalhos/rodapés de página (inclui artefatos tipo "FFLL..11")
            if (isPageHeaderOrFooter(plain)) continue;
            // Rejeita artefatos de paginação com letras duplicadas + número (ex: "FFLL..11", "PPGG.5")
            if (/^[A-Z]{2,}[.\s]*\d+$/i.test(plain) && /([A-Z])\1/i.test(plain)) continue;
            if (isHardLegalParagraph(plain) || isRectificationMarker(plain)) break;
            if (REGEX_PARTE_PREFIX.test(plain) || REGEX_EIXO_PREFIX.test(plain)) break;

            const lineTokens = lt.obj.tokens.filter(t => Math.abs(t.y - lt.obj.y) <= 5);
            const hasMilitary = hasMilitaryDataPattern({ text: lt.obj.text, tokens: lineTokens });
            if (!hasMilitary) continue;

            const score = isTableContinuation(
              { text: lt.obj.text, tokens: lineTokens },
              analysis.boundaries
            );
            if (score >= 0.7) {
              console.log(`[PatternAnalyzer] Bridge estendido: score=${score.toFixed(2)} linha ${k} "${plain.substring(0, 60)}"`);
              lineTypes[k].isTable = true;
              lineTypes[k].isBridge = true;
            }
          }
        }
      }

      i = blockEnd;
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
        // CORREÇÃO #4: Thresholds mais sensíveis para capturar quebras reais
        if (paragraphLines.length > 0) {
          const prev = lineTypes[i-1].obj;
          const curr = lineTypes[i].obj;
          const yGap = Math.abs(curr.y - prev.y);
          
          const currTokens = curr.tokens.slice().sort((a, b) => a.x - b.x);
          const prevTokens = prev.tokens.slice().sort((a, b) => a.x - b.x);
          
          // Espaçamento normal de linha em PDFs Segoe UI 10pt ≈ 12-16px.
          // AJUSTADO: considera quebra de parágrafo real se o gap for > 18px (reduzido de 22px)
          // OU se houver indentação significativa (> 20px, reduzido de 30px) — parágrafo com recuo.
          // EXCEÇÃO: linha anterior termina com preposição/artigo → é continuação de frase,
          // nunca pode ser início de novo parágrafo (ex: "com ônus para o Erário do" + "Relações...").
          // EXCEÇÃO 2: linha termina com sigla/abreviação incompleta que exige continuação
          // (ex: "RG" sem número, "nº", "Art.", "Id", "§" — quebra de página no meio de dado).
          const prevPlain = prev.text.replace(/\*\*/g, '').trim();
          const prevEndsWithPreposition = /\b(pela|pelo|pelos|pelas|da|do|das|dos|de|a|o|e|em|no|na|nos|nas|com|para|ao|aos|às|por|sob|sobre|entre|até|após|ante|perante|mediante|conforme|segundo|durante|exceto|salvo|inclusive|exclusive|via|que|se|ou|nem)\s*$/i.test(prevPlain);
          const prevEndsWithIncompleteRef = /\b(RG|Id|nº|n°|n\.|Art\.|§|Cel|Ten|Cap|Maj|Sgt|Cb|Sd|BM|QOC|QOS|CBMERJ|SEDEC)\s*$/i.test(prevPlain) ||
            // Linha termina com número decimal incompleto (ex: "RG" seguido de quebra de página)
            /,\s*RG\s*$/i.test(prevPlain);
          const isParaBreak = !prevEndsWithPreposition && !prevEndsWithIncompleteRef && (yGap > 18 || (currTokens[0]?.x > (prevTokens[0]?.x ?? 0) + 20));
          if (isParaBreak) {
            paragraphLines.push("\x00PARABREAK\x00");
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
  _keywords: string[],
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
              // É um texto com letras separadas — artefato de kerning do PDF.
              // Une as letras para fins de busca, mas marca como header para filtrar do conteúdo.
              cleanedText = words.join('');
          }
      }

      // Filtra linhas que são cabeçalho/rodapé (inclui letras duplicadas e texto espalhado)
      if (isPageHeaderOrFooter(cleanedText)) return;
      
      allLines.push({ text: cleanedText, page: p.page, tokens: p.tokens, y: l.y });
  }));

  const tocRawLines = extractTocBlock(pm);
  const summaryItems = parseTocLines(tocRawLines);
  if (onProgress) onProgress(50);

  const validSummaryItems = summaryItems.filter(item => {
    const isHeader = !!item.originalRaw.match(REGEX_PARTE_PREFIX) ||
                     !!item.originalRaw.match(REGEX_ANEXO_PREFIX) ||
                     !!item.originalRaw.match(REGEX_EIXO_PREFIX);
    // Notas numeradas (ex: "5. SINDICÂNCIA...") nunca são descartadas por falta de página —
    // o PDF pode ter o número de página na linha seguinte (título quebrado no sumário).
    const isNumberedNota = /^\d+[.\s]/.test(item.originalRaw.trim());
    const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
    return hasContent && (item.expectedPage !== null || isHeader || item.isSemAlteracao || isNumberedNota);
  });

  // Determina quais páginas do PDF pertencem ao bloco do sumário (TOC).
  const TOC_PAGE_INDICES = new Set([1, 2, 3].filter(i => i < pm!.length).map(i => pm![i].page));
  const firstBodyLineIndex = allLines.findIndex(l => !TOC_PAGE_INDICES.has(l.page));
  const bodySearchStart = firstBodyLineIndex >= 0 ? firstBodyLineIndex : 0;

  const checkRelevance = (content: string) => {
    const matchedEntities: string[] = [];
    let isRelevant = false;
    let hasFuzzyMatch = false;

    // Pipeline de dois estágios: nome encontrado no bloco + RG/ID confirmando no mesmo bloco.
    // matchPersonnelInBlock recebe todas as linhas e só confirma quando há número (RG/ID).
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const matchedPersonnel = matchPersonnelInBlock(lines, personnelInput, preferences);
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
    // anchoredSpace: "4 SINDICANCIA PRORROGACAO NOTA CGS" — número + palavras sem prefixo numérico duplicado
    const anchoredSpace = noteNumMatch
      ? normalizeTitle(`${noteNumMatch[1]} ${stripNumericPrefix(rawStripped)}`).split(/\s+/).slice(0, 5).join(' ')
      : null;

    let foundLine = -1;
    if (anchoredSpace && anchoredSpace.length > 3) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
        if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && normalizeTitle(allLines[j].text).includes(anchoredSpace)) { foundLine = j; break; }
      }
    }
    if (foundLine === -1) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
        if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && searchSpace.length > 3 && normalizeTitle(allLines[j].text).includes(searchSpace)) {
          foundLine = j;
          break;
        }
      }
    }
    if (foundLine === -1 && searchSuffix.length > 5 && searchSuffix !== searchSpace) {
        for (let j = currentSearchLine; j < allLines.length; j++) {
            if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && normalizeTitle(allLines[j].text).includes(searchSuffix)) { foundLine = j; break; }
        }
    }
    if (foundLine === -1 && anchoredSpace) {
      const shortAnchor = anchoredSpace.split(/\s+/).slice(0, 3).join(' ');
      if (shortAnchor.length > 5) {
        for (let j = currentSearchLine; j < allLines.length; j++) {
          if (!isTOCLine(allLines[j].text) && !isPageHeaderOrFooter(allLines[j].text) && normalizeTitle(allLines[j].text).includes(shortAnchor)) {
            foundLine = j;
            break;
          }
        }
      }
    }
    if (foundLine === -1) {
      for (let j = bodySearchStart; j < allLines.length; j++) {
        if (!isTOCLine(allLines[j].text) && normalizeTitle(allLines[j].text).includes(anchoredSpace || searchSpace || searchSuffix)) {
          foundLine = j;
          break;
        }
      }
    }
    if (foundLine === -1) {
      for (let j = currentSearchLine; j < allLines.length; j++) {
        const line = allLines[j];
        const tokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 6);
        if (tokens.length === 0) continue;
        if (tokens.filter(t => t.isBold).length / tokens.length > 0.6 && searchWords.length >= 2) {
          if (searchWords.slice(0, 3).filter(w => normalizeTitle(line.text).includes(w)).length >= 2) {
            foundLine = j;
            break;
          }
        }
      }
    }
    if (foundLine !== -1) {
      // Se a linha encontrada não é o início do título (não começa com número de nota),
      // recua para encontrar a linha que inicia o bloco bold contíguo com número de nota.
      if (noteNumMatch) {
        const noteNum = noteNumMatch[1];
        const startsWithNum = new RegExp(`^\\*{0,2}${noteNum}[.\\s]`);
        if (!startsWithNum.test(allLines[foundLine].text.trim())) {
          // Recua até encontrar a linha que começa com o número da nota
          for (let back = foundLine - 1; back >= Math.max(0, foundLine - 10); back--) {
            const backPlain = allLines[back].text.replace(/\*\*/g, '').trim();
            if (startsWithNum.test(backPlain)) {
              foundLine = back;
              break;
            }
            // Para se encontrar uma linha que claramente não é parte do título
            if (!backPlain || /^[a-z]/.test(backPlain)) break;
          }
        }
      }
      item.foundLineIndex = foundLine;
      currentSearchLine = foundLine + 1;
      console.log(`[Sentinela][LOC] OK  "${searchSpace}" → linha ${foundLine} p.${allLines[foundLine]?.page} | "${allLines[foundLine]?.text.substring(0, 60)}"`);
    } else {
      // Fallback posicional: procura linha que começa com o número da nota
      // seguido de letra maiúscula (evita falsos positivos como "4. a contar do dia").
      if (noteNumMatch) {
        const noteNum = noteNumMatch[1];
        const numPattern = new RegExp(`^\\*{0,2}${noteNum}[.\\s]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]`);
        const ADMIN_ACT_VERBS_FB = /^(\d+)[.\s]+(TRANSFERIR|EXONERAR|NOMEAR|DESIGNAR|PROMOVER|INCLUIR|EXCLUIR|RETIFICAR|PRORROGAR|REVOGAR|AUTORIZAR|CONCEDER|DETERMINAR|DISPENSAR|AFASTAR|REDISTRIBUIR|REMOVER|LOTAR|REINTEGRAR|READMITIR|APOSENTAR|REFORMAR|AGREGAR|COLOCAR|DECLARAR|TORNAR|PUBLICAR|INSTAURAR|SUBSTITUIR|ENCARREGAR|CONSTITUIR|ALTERAR|SUSPENDER|CANCELAR|HOMOLOGAR|RATIFICAR|DELEGAR|ATRIBUIR|FIXAR|ESTABELECER|CRIAR|EXTINGUIR)\b/i;
        const INTERNAL_SECTION_FB = /^(\d+)[.\s)]+(FINALIDADE|OBJETIVOS?|DURA[ÇC][ÃA]O|DATA\b|HOR[ÁA]RIO\b|LOCAL\b|ESCOPO|METODOLOGIA|CRONOGRAMA|RECURSOS|AVALIA[ÇC][ÃA]O|RESULTADOS?\b|CONCLUS[ÃA]O|CONSIDERA[ÇC][ÕO]ES|DISPOSI[ÇC][ÕO]ES|RESPONSABILIDADES?|PRAZOS?|PROCEDIMENTOS?|INSTRU[ÇC][ÕO]ES|ORIENTA[ÇC][ÕO]ES|OBSERVA[ÇC][ÕO]ES|UNIDADES\s+ENVOLVIDAS|DESENVOLVIMENTO|PRESCRI[ÇC][ÕO]ES|REFER[ÊE]NCIAS?|UNIFORME\b|TRAJE\b|CONDECORA[ÇC][ÕO]ES?|CERIMONIAL\b|SOLENIDADE\b|CONVIDADOS?\b|CREDENCIAMENTO\b|PROGRAMA[ÇC][ÃA]O\b)\b/i;
        for (let j = currentSearchLine; j < allLines.length; j++) {
          const plain = allLines[j].text.replace(/\*\*/g, '').trim();
          if (numPattern.test(plain) && !isTOCLine(allLines[j].text) &&
            !ADMIN_ACT_VERBS_FB.test(plain) && !INTERNAL_SECTION_FB.test(plain)) {
            foundLine = j;
            break;
          }
        }
      }
      if (foundLine !== -1) {
        item.foundLineIndex = foundLine;
        currentSearchLine = foundLine + 1;
      } else {
        const currentPage = allLines[currentSearchLine]?.page ?? 0;
        const expectedPage = item.expectedPage ?? 0;
        const pageDistance = Math.abs(currentPage - expectedPage);
        if (noteNumMatch && expectedPage > 0 && pageDistance <= 3) {
          item.foundLineIndex = currentSearchLine;
          currentSearchLine = currentSearchLine + 1;
          console.log(`[Sentinela][LOC] POS "${searchSpace}" → linha ${item.foundLineIndex} p.${allLines[item.foundLineIndex]?.page} | "${allLines[item.foundLineIndex]?.text.substring(0, 60)}"`);
        } else {
          const sampleText = allLines.slice(currentSearchLine, currentSearchLine + 5).map(l => l.text).join(' | ').substring(0, 100);
          console.log(`[Sentinela][LOC] FAIL "${searchSpace}" (TOC: "${item.cleanTitle}"). Contexto: ${sampleText}...`);
        }
      }
    }
  }

  const locatedItems = validSummaryItems.filter(item => item.foundLineIndex !== undefined);
  locatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));

  // ── DETECÇÃO DE NOTAS ÓRFÃS ──────────────────────────────────────────────
  // Varre os gaps entre notas localizadas e detecta títulos de notas no corpo
  // que não foram capturados pelo TOC (ex: nota 5 SUBSTITUIÇÃO omitida no sumário oficial).
  // Um título de nota órfã é uma linha bold que começa com "N." e não está coberta.
  {
    const NOTA_TITLE_RE = /^\*{0,2}(\d+)[.\s]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/;
    const orphans: SummaryItem[] = [];
    for (let i = 0; i < locatedItems.length - 1; i++) {
      const gapStart = (locatedItems[i].foundLineIndex ?? 0) + 1;
      const gapEnd = (locatedItems[i + 1].foundLineIndex ?? 0) - 1;
      if (gapEnd - gapStart < 2) continue;
      // Só procura em gaps onde o item atual é uma nota numerada (não um cabeçalho de parte)
      const currIsNota = /^\d+[.\s]/.test(locatedItems[i].originalRaw.trim());
      if (!currIsNota) continue;
      // Número da nota atual — órfã só é válida se tiver número MAIOR (mesmo nível hierárquico)
      const currNoteNum = parseInt(locatedItems[i].originalRaw.match(/^(\d+)[.\s]/)?.[1] ?? '0', 10);
      // Se o gap contém um "1." bold, o gap inteiro é de subtítulos internos de documento.
      // Pré-varre o gap para detectar isso antes de avaliar candidatos.
      let gapHasInternalSection1 = false;
      for (let j = gapStart; j <= gapEnd; j++) {
        const plain = allLines[j].text.replace(/\*\*/g, '').trim();
        if (!/^\*{0,2}1[.\s]+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(plain)) continue;
        if (isTOCLine(allLines[j].text) || isPageHeaderOrFooter(allLines[j].text)) continue;
        const lineTokens = allLines[j].tokens.filter(t => Math.abs(t.y - allLines[j].y) <= 6);
        const boldRatio = lineTokens.length > 0 ? lineTokens.filter(t => t.isBold).length / lineTokens.length : 0;
        if (boldRatio >= 0.5) { gapHasInternalSection1 = true; break; }
      }
      for (let j = gapStart; j <= gapEnd; j++) {
        const line = allLines[j];
        const plain = line.text.replace(/\*\*/g, '').trim();
        if (!NOTA_TITLE_RE.test(plain)) continue;
        if (isTOCLine(line.text) || isPageHeaderOrFooter(line.text)) continue;
        // Número da candidata a órfã:
        // - candidateNum == 1: reinício de numeração → subtítulo interno → descarta
        // - candidateNum < currNoteNum: subtítulo interno → descarta
        // - candidateNum == currNoteNum: possível erro de numeração do boletim oficial (ex: duas notas "5") → aceita
        // - candidateNum > currNoteNum: nota genuinamente omitida do sumário → aceita
        const candidateNum = parseInt(plain.match(/^(\d+)[.\s]/)?.[1] ?? '0', 10);
        if (candidateNum === 1 || candidateNum < currNoteNum) continue;
        // Se o gap tem um "1." interno bold, toda a numeração do gap é subtítulo interno
        if (gapHasInternalSection1) continue;
        // Verifica se é bold (título de nota)
        const lineTokens = line.tokens.filter(t => Math.abs(t.y - line.y) <= 6);
        const boldRatio = lineTokens.length > 0 ? lineTokens.filter(t => t.isBold).length / lineTokens.length : 0;
        if (boldRatio < 0.5) continue;
        // Rejeita itens internos de ato administrativo: verbos no infinitivo em CAIXA ALTA
        // seguidos de vírgula ou texto em minúsculas (ex: "2. TRANSFERIR, com fulcro...")
        // Esses são cláusulas de resolução/portaria, não títulos de nota independente.
        const ADMIN_ACT_VERBS = /^(\d+)[.\s]+(TRANSFERIR|EXONERAR|NOMEAR|DESIGNAR|PROMOVER|INCLUIR|EXCLUIR|RETIFICAR|PRORROGAR|REVOGAR|AUTORIZAR|CONCEDER|DETERMINAR|DISPENSAR|AFASTAR|REDISTRIBUIR|REMOVER|LOTAR|REINTEGRAR|READMITIR|APOSENTAR|REFORMAR|AGREGAR|COLOCAR|DECLARAR|TORNAR|PUBLICAR|INSTAURAR|SUBSTITUIR|ENCARREGAR|CONSTITUIR|ALTERAR|SUSPENDER|CANCELAR|HOMOLOGAR|RATIFICAR|DELEGAR|ATRIBUIR|FIXAR|ESTABELECER|CRIAR|EXTINGUIR)\b/i;
        if (ADMIN_ACT_VERBS.test(plain)) continue;
        // Rejeita subtítulos internos de seção de documento (ex: "4. DATA, HORÁRIO E LOCAL",
        // "1. FINALIDADE", "2. OBJETIVOS") — são seções internas, não notas independentes.
        const INTERNAL_SECTION_HEADERS = /^(\d+)[.\s]+(FINALIDADE|OBJETIVOS?|DURA[ÇC][ÃA]O|DATA\b|HOR[ÁA]RIO\b|LOCAL\b|ESCOPO|METODOLOGIA|CRONOGRAMA|RECURSOS|AVALIA[ÇC][ÃA]O|RESULTADOS?\b|CONCLUS[ÃA]O|CONSIDERA[ÇC][ÕO]ES|DISPOSI[ÇC][ÕO]ES|RESPONSABILIDADES?|PRAZOS?|PROCEDIMENTOS?|INSTRU[ÇC][ÕO]ES|ORIENTA[ÇC][ÕO]ES|OBSERVA[ÇC][ÕO]ES|UNIDADES\s+ENVOLVIDAS|DESENVOLVIMENTO|PRESCRI[ÇC][ÕO]ES|REFER[ÊE]NCIAS?|UNIFORME\b|TRAJE\b|CONDECORA[ÇC][ÕO]ES?|CERIMONIAL\b|SOLENIDADE\b|CONVIDADOS?\b|CREDENCIAMENTO\b|PROGRAMA[ÇC][ÃA]O\b)\b/i;
        if (INTERNAL_SECTION_HEADERS.test(plain)) continue;
        // Verifica que não está já coberta por um item localizado
        const alreadyCovered = locatedItems.some(it => Math.abs((it.foundLineIndex ?? -999) - j) <= 2);
        if (alreadyCovered) continue;
        // Cria item sintético com o parentCategory do item anterior
        const parentCat = locatedItems[i].parentCategory;
        const notaMatch = plain.match(/NOTA\s+((?:[A-Z][A-Z0-9/.\-]+)(?:\s+[A-Z][A-Z0-9/.\-]+){0,2})\s+(\d{1,4}\/20\d{2})/i);
        const orphan: SummaryItem = {
          cleanTitle: normalizeTitle(cleanNoteTitle(plain)),
          originalRaw: plain,
          expectedPage: line.page,
          foundLineIndex: j,
          parentCategory: parentCat,
          ...(notaMatch && { notaEmissor: notaMatch[1], notaNumero: notaMatch[2] }),
        };
        orphans.push(orphan);
        console.log(`[Sentinela][ORPHAN] Nota órfã detectada: "${plain.substring(0,60)}" linha ${j} p.${line.page}`);
        break; // um órfão por gap
      }
    }
    if (orphans.length > 0) {
      locatedItems.push(...orphans);
      locatedItems.sort((a, b) => (a.foundLineIndex || 0) - (b.foundLineIndex || 0));
    }
  }

  // Sanidade: dois itens com foundLineIndex muito próximo (< 3 linhas) — descarta o segundo,
  // exceto quando:
  //   (a) nota numerada logo após cabeçalho de parte/eixo (estrutura legítima), ou
  //   (b) ambas são notas numeradas com números diferentes (notas consecutivas no PDF — ex: nota 4 e nota 5 na mesma página).
  for (let i = 1; i < locatedItems.length; i++) {
    const prev = locatedItems[i - 1], curr = locatedItems[i];
    if (((curr.foundLineIndex ?? 0) - (prev.foundLineIndex ?? 0)) < 3) {
      const currIsNota = /^\d+[.\s]/.test(curr.originalRaw.trim());
      const prevIsNota = /^\d+[.\s]/.test(prev.originalRaw.trim());
      const prevIsHeader = !!(prev.originalRaw.match(REGEX_PARTE_PREFIX) || prev.originalRaw.match(REGEX_EIXO_PREFIX) || prev.originalRaw.match(REGEX_ANEXO_PREFIX) || prev.originalRaw.match(REGEX_LETTER_ITEM_PREFIX));
      // Extrai números das notas para comparar
      const currNum = curr.originalRaw.match(/^(\d+)[.\s]/)?.[1];
      const prevNum = prev.originalRaw.match(/^(\d+)[.\s]/)?.[1];
      const areDifferentNotes = currIsNota && prevIsNota && (
        currNum !== prevNum ||
        // Mesmo número mas títulos distintos (erro de numeração no PDF oficial — ex: duas notas "5.")
        normalizeTitle(curr.originalRaw.replace(/^(\d+)[.\s]+/, '').substring(0, 20)) !==
        normalizeTitle(prev.originalRaw.replace(/^(\d+)[.\s]+/, '').substring(0, 20))
      );
      if (!(currIsNota && prevIsHeader) && !areDifferentNotes) {
        console.log(`[Sentinela][SAN] Descartando "${curr.originalRaw.substring(0,50)}" (linha ${curr.foundLineIndex}) — muito próximo de "${prev.originalRaw.substring(0,50)}" (linha ${prev.foundLineIndex})`);
        curr.foundLineIndex = undefined;
      }
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
  // Fragmentos que parecem número de nota mas são continuação de título
  // Cobre: "017/2026", "14133/2021-", "14.133/2021 -" (lei federal com 5+ dígitos)
  const isTitleContinuationFragment = (l: string) => {
    const t = l.trim();
    return /^\d{1,4}\/20\d{2}/.test(t) ||           // "NNN/20XX"
      /^\d{4,5}\/20\d{2}/.test(t) ||                // "14133/2021"
      /^\d{1,2}\.\d{3}\/20\d{2}/.test(t);           // "14.133/2021"
  };
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
      if (k > start && REGEX_NEXT_NOTA.test(l) && !isTitleContinuationFragment(l)) break;
      bodyTitleAccum += ' ' + l;
      titleLinesConsumed++;
      const accumNorm = normalizeTitle(bodyTitleAccum);
      const covered = tocWords.filter(w => accumNorm.includes(w)).length;
      if (covered >= Math.ceil(tocWords.length * 0.8)) {
        const nextL = allLines[k + 1]?.text.trim().replace(/\*\*/g, '') || '';
        const nextIsContinuation = nextL.length > 0 && !isStructuralLine(nextL) &&
          (!REGEX_NEXT_NOTA.test(nextL) || isTitleContinuationFragment(nextL)) &&
          (
            /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s\-\/(),.]+$/.test(nextL) ||  // só letras/símbolos (ex: "INTERESSE DA CORPORAÇÃO")
            /^\d{1,5}\/20\d{2}/.test(nextL) ||                 // fragmento "NNN/20XX" ou "NNNNN/20XX" (ex: "017/2026", "14133/2021")
            /^\d{1,2}\.\d{3}\/20\d{2}/.test(nextL) ||          // "14.133/2021" (lei federal formatada)
            /^[A-Z][A-Z0-9/.\-]+(?:\s+[A-Z0-9/.\-]+)*\s+\d{1,4}\/20\d{2}$/.test(nextL) || // emissor + número (ex: "CHEMG 215/2026")
            /^-\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]/.test(nextL) ||           // fragmento "- RELAÇÃO DE INSCRITOS - NOTA"
            /^[A-Z]{2,}\/[A-Z.]{2,}/.test(nextL)               // emissor com barra (ex: "DI/DIV.INST/COESCI 2 002/2026")
          ) && !/^[a-z]/.test(nextL);
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
