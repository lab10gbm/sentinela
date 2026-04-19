import { TextToken, TableData, TableCell } from "../types";
import { isTableHeader, normalizeCellText, normalizeTitle } from "./textUtils";
import { getSemanticScore, MILITARY_RANK_RE, MILITARY_CADRE_RE } from "./tableTypes";
import { inferColumnBoundaries } from "./TablePatternAnalyzer";
import { tableRegistry } from "./TableRegistry";

/**
 * TableReconstructor v5
 * 
 * Three-tier approach:
 *  1. Simple data tables → Template-based (header detection)
 *  2. Sparse forms → Border-based (histogram analysis)
 *  3. Very complex → Layout preservation (last resort)
 */
export const reconstructTable = (tokens: TextToken[]): TableData => {
  if (tokens.length === 0) {
    return { rows: [], columnCount: 0, rowCount: 0 };
  }

  // PASS 0: EXPLOdir TOKENS GRUDENTOS (ex: "14 2º Sgt")
  const explodedTokens = explodeStickyTokens(tokens);

  // Heuristic 1: If it has a clear header, use template regardless of density
  // Verifica linha a linha (não o texto concatenado) para evitar falsos negativos
  // quando o allText ultrapassa o limite de 80 chars do isTableHeader
  const allText = tokens.map(t => t.text).join(" ");
  const lineTexts = Array.from(
    new Map(tokens.map(t => [Math.round(t.y / 5), t])).values()
  ).map(t => tokens.filter(tok => Math.abs(tok.y - t.y) <= 5).map(tok => tok.text).join(" "));
  const hasHeaderLine = isTableHeader(allText) || lineTexts.some(lt => isTableHeader(lt));
  if (hasHeaderLine) {
    console.log(`[TableReconstructor] Using TEMPLATE (header detected)`);
    return reconstructTableByTemplate(explodedTokens);
  }

  const uniqueYLines = new Set(tokens.map(t => Math.round(t.y / 6))).size;
  const avgTokensPerLine = tokens.length / uniqueYLines;
  
  console.log(`[TableReconstructor] tokens=${tokens.length}, lines=${uniqueYLines}, avg=${avgTokensPerLine.toFixed(2)}`);
  
  // Heuristic 2: Dense tables (> 5 tokens/line) = data table, use template
  if (avgTokensPerLine > 5) {
    console.log(`[TableReconstructor] Using TEMPLATE (dense table)`);
    return reconstructTableByTemplate(explodedTokens);
  }

  // Heuristic 2: Sparse tables (1-5 tokens/line) = form with borders, use histogram
  if (avgTokensPerLine >= 1) {
    console.log(`[TableReconstructor] Using BORDER-BASED (sparse form)`);
    const borderResult = reconstructTableByBorders(explodedTokens);
    console.log(`[TableReconstructor] Border-based result: ${borderResult.columnCount} cols, ${borderResult.rowCount} rows`);
    if (borderResult.columnCount >= 2) return borderResult;
  }

  // Heuristic 3: Very sparse (< 1 token/line) = complex nested form, preserve layout
  console.log(`[TableReconstructor] Using LAYOUT PRESERVATION (very sparse)`);
  return reconstructTableAsLayout(tokens);
};

/**
 * Layout preservation (for complex forms that don't fit grid structure)
 * Renders as hierarchical text blocks instead of trying to force into grid
 */
export const reconstructTableAsLayout = (tokens: TextToken[]): TableData => {
  // Group by Y with larger epsilon to capture multi-line cells
  const Y_EPSILON = 12;
  const rowGroups = new Map<number, TextToken[]>();
  
  for (const tok of tokens) {
    const yKey = Math.round(tok.y / Y_EPSILON) * Y_EPSILON;
    if (!rowGroups.has(yKey)) rowGroups.set(yKey, []);
    rowGroups.get(yKey)!.push(tok);
  }

  const sortedYKeys = Array.from(rowGroups.keys()).sort((a, b) => b - a);
  
  // Create single-column table with each row as a formatted text block
  const finalRows: TableCell[][] = [];

  for (const yKey of sortedYKeys) {
    const rowTokens = rowGroups.get(yKey)!.sort((a, b) => a.x - b.x);
    
    // Build text with preserved spacing
    let text = "";
    let lastXEnd = -1;
    
    for (const tok of rowTokens) {
      let tokText = tok.isBold ? `**${tok.text}**` : tok.text;
      if (tok.isUnderlined) tokText = `<u>${tokText}</u>`;
      
      if (lastXEnd >= 0) {
        const gap = tok.x - lastXEnd;
        if (gap > 40) text += "    "; // Large gap = tab
        else if (gap > 10) text += "  "; // Medium gap = double space
        else if (gap > 2) text += " "; // Small gap = single space
      }
      
      text += tokText;
      lastXEnd = tok.x + tok.w;
    }

    if (text.trim()) {
      finalRows.push([{
        text: normalizeCellText(text),
        tokens: rowTokens,
        row: finalRows.length,
        col: 0,
        rowSpan: 1,
        colSpan: 1,
        align: 'left',
      }]);
    }
  }

  return {
    rows: finalRows,
    columnCount: 1,
    rowCount: finalRows.length,
  };
};

/**
 * Border-based reconstruction (for complex forms with visual borders)
 * Uses clustering analysis to detect cell boundaries from token distribution
 */
export const reconstructTableByBorders = (tokens: TextToken[]): TableData => {
  // Step 1: Cluster tokens by Y (rows) with adaptive epsilon
  const Y_EPSILON = 8;
  const rowGroups = new Map<number, TextToken[]>();
  
  for (const tok of tokens) {
    const yKey = Math.round(tok.y / Y_EPSILON) * Y_EPSILON;
    if (!rowGroups.has(yKey)) rowGroups.set(yKey, []);
    rowGroups.get(yKey)!.push(tok);
  }

  const sortedYKeys = Array.from(rowGroups.keys()).sort((a, b) => b - a);
  
  // Step 2: Detect column boundaries via peak analysis
  // Instead of finding valleys (empty regions), find peaks (dense regions)
  // and use gaps between peaks as column boundaries
  const X_BUCKET_SIZE = 10; // Larger bucket to smooth noise
  const xHistogram = new Map<number, number>();
  
  for (const tok of tokens) {
    const xBucket = Math.floor(tok.x / X_BUCKET_SIZE) * X_BUCKET_SIZE;
    xHistogram.set(xBucket, (xHistogram.get(xBucket) || 0) + 1);
  }

  const sortedXBuckets = Array.from(xHistogram.keys()).sort((a, b) => a - b);
  
  // Find peaks: buckets with significantly more tokens than neighbors
  const peaks: number[] = [];
  for (let i = 1; i < sortedXBuckets.length - 1; i++) {
    const prev = xHistogram.get(sortedXBuckets[i - 1]) || 0;
    const curr = xHistogram.get(sortedXBuckets[i]) || 0;
    const next = xHistogram.get(sortedXBuckets[i + 1]) || 0;
    
    // Peak: current bucket has more tokens than both neighbors
    if (curr > prev && curr > next && curr >= 2) {
      peaks.push(sortedXBuckets[i]);
    }
  }

  console.log(`[Border-based] Found ${peaks.length} peaks at X: [${peaks.map(x => Math.round(x)).join(', ')}]`);

  // Column boundaries are midpoints between consecutive peaks
  const columnBoundaries: number[] = [Math.min(...tokens.map(t => t.x)) - 5];
  
  for (let i = 0; i < peaks.length - 1; i++) {
    const midpoint = (peaks[i] + peaks[i + 1]) / 2;
    columnBoundaries.push(midpoint);
  }
  
  columnBoundaries.push(Math.max(...tokens.map(t => t.x + t.w)) + 5);
  const columnCount = columnBoundaries.length - 1;

  console.log(`[Border-based] Detected ${columnCount} columns at X: [${columnBoundaries.map(x => Math.round(x)).join(', ')}]`);

  if (columnCount < 2) return { rows: [], columnCount: 0, rowCount: 0 };

  // Step 3: Assign tokens to cells
  const finalRows: TableCell[][] = [];

  for (const yKey of sortedYKeys) {
    const rowTokens = rowGroups.get(yKey)!.sort((a, b) => a.x - b.x);
    const rowCells: TableCell[] = [];

    for (let c = 0; c < columnCount; c++) {
      const xStart = columnBoundaries[c];
      const xEnd = columnBoundaries[c + 1];
      
      // Find tokens whose CENTER falls in this column
      const cellTokens = rowTokens.filter(t => {
        const centerX = t.x + t.w / 2;
        return centerX >= xStart && centerX < xEnd;
      });
      
      let text = "";
      for (const tok of cellTokens) {
        let tokText = tok.isBold ? `**${tok.text}**` : tok.text;
        if (tok.isUnderlined) tokText = `<u>${tokText}</u>`;
        text += (text ? " " : "") + tokText;
      }

      rowCells.push({
        text: normalizeCellText(text),
        tokens: cellTokens,
        row: finalRows.length,
        col: c,
        rowSpan: 1,
        colSpan: 1,
        align: 'left',
      });
    }

    finalRows.push(rowCells);
  }

  // Step 4: Detect and merge cells with colspan/rowspan
  
  // 4a. Colspan: cells that span multiple columns
  for (let r = 0; r < finalRows.length; r++) {
    for (let c = 0; c < columnCount; c++) {
      const cell = finalRows[r][c];
      if (cell.text.trim().length > 0 && cell.colSpan === 1) {
        let span = 1;
        // Count consecutive empty cells to the right
        while (c + span < columnCount && finalRows[r][c + span].text.trim().length === 0) {
          span++;
        }
        // Also check if cell text is very long (likely spans multiple columns)
        const cellWidth = cell.tokens.reduce((sum, t) => sum + t.w, 0);
        const avgColWidth = (columnBoundaries[columnCount] - columnBoundaries[0]) / columnCount;
        if (cellWidth > avgColWidth * 1.5) {
          // Text is wider than average column — likely spans multiple columns
          span = Math.max(span, Math.ceil(cellWidth / avgColWidth));
        }
        if (span > 1) {
          cell.colSpan = Math.min(span, columnCount - c);
          // Mark spanned cells as merged
          for (let s = 1; s < cell.colSpan; s++) {
            if (c + s < columnCount) {
              finalRows[r][c + s].text = "";
            }
          }
        }
      }
    }
  }

  // 4b. Rowspan: cells that span multiple rows
  for (let c = 0; c < columnCount; c++) {
    for (let r = 0; r < finalRows.length; r++) {
      const cell = finalRows[r][c];
      if (cell.text.trim().length > 0 && cell.rowSpan === 1) {
        let span = 1;
        // Count consecutive empty cells below
        while (r + span < finalRows.length && 
               finalRows[r + span][c].text.trim().length === 0 &&
               finalRows[r + span][c].tokens.length === 0) {
          span++;
        }
        if (span > 1) {
          cell.rowSpan = span;
        }
      }
    }
  }

  // 4c. Merge multi-line cells (consecutive rows where the next row is a continuation)
  // Uma linha é "continuação" se a maioria das suas colunas está vazia —
  // ou seja, apenas 1-2 colunas têm conteúdo (texto que transbordou da célula acima).
  for (let r = 0; r < finalRows.length - 1; r++) {
    const nextRow = finalRows[r + 1];
    const nonEmptyCols = nextRow.filter(c => c.text.trim().length > 0).length;
    // Linha de continuação: ≤ 2 colunas com conteúdo numa tabela de 3+ colunas
    const isContinuationRow = columnCount >= 3 && nonEmptyCols <= 2;
    if (!isContinuationRow) continue;

    for (let c = 0; c < columnCount; c++) {
      const cell = finalRows[r][c];
      const nextCell = nextRow[c];
      if (nextCell.text.trim().length === 0) continue;

      const cellY = cell.tokens.length > 0 ? Math.max(...cell.tokens.map(t => t.y)) : 0;
      const nextY = nextCell.tokens.length > 0 ? nextCell.tokens[0].y : 0;
      const yGap = Math.abs(cellY - nextY);

      // Merge se o gap for razoável (< 22px — cobre fonte 10pt com espaçamento 1.5)
      if (yGap < 22) {
        cell.text = (cell.text + " " + nextCell.text).trim();
        cell.tokens.push(...nextCell.tokens);
        nextCell.text = "";
        nextCell.tokens = [];
      }
    }
  }

  // Remove linhas que ficaram completamente vazias após o merge
  const mergedRows = finalRows.filter(row => row.some(c => c.text.trim().length > 0 || c.tokens.length > 0));

  return {
    rows: mergedRows,
    columnCount,
    rowCount: mergedRows.length,
  };
};

/**
 * Template-based reconstruction (original algorithm for data tables)
 */
/**
 * Fragmenta fisicamente tokens que contêm dados de múltiplas colunas sem espaço.
 */
const explodeStickyTokens = (tokens: TextToken[]): TextToken[] => {
  const result: TextToken[] = [];

  // Padrões de separação usando a lista taxativa de postos/graduações (MILITARY_RANK_RE).
  // Regra: número isolado antes de posto → QTD | POSTO/GRAD. (colunas distintas).
  const STICKY_PATTERNS = [
    // 1. QTD + Posto: "1 Maj BM" | "14 2º Sgt" | "6 Subten BM"
    { re: new RegExp(`^(\\d+)\\s+(${MILITARY_RANK_RE.source.slice(1)})`, 'i'), splitIndex: 1 },
    // 2. Posto + Quadro/Ano: "Maj BM QOC/09" → "Maj BM" | "QOC/09"
    { re: new RegExp(`^(${MILITARY_RANK_RE.source.slice(1)}(?:\\s+BM)?)\\s+(${MILITARY_CADRE_RE.source.slice(1)})`, 'i'), splitIndex: 1 },
    // 3. Posto + Nome em CAIXA ALTA (sem quadro): "Sgt DIEGO"
    { re: new RegExp(`^(${MILITARY_RANK_RE.source.slice(1)})\\s+([A-ZÀ-Ú]{3,})\\b`, 'i'), splitIndex: 1 },
    // 4. Nome + RG/ID: "NOME 12.345" ou "NOME 43442080"
    { re: /^([A-ZÀ-Ú\s]{5,})\s+(\d{1,2}\.\d{3}|\d{7,10})\b/, splitIndex: 1 },
  ];

  // Explode um único token recursivamente até não haver mais padrões aplicáveis
  const explodeOne = (t: TextToken): TextToken[] => {
    for (const pattern of STICKY_PATTERNS) {
      const match = t.text.match(pattern.re);
      if (match) {
        const pivotStr = match[pattern.splitIndex];
        const pivotPos = t.text.indexOf(pivotStr) + pivotStr.length;
        const text1 = t.text.substring(0, pivotPos).trim();
        const text2 = t.text.substring(pivotPos).trim();
        if (text1 && text2) {
          const w1 = t.w * (text1.length / t.text.length);
          const tok1: TextToken = { ...t, text: text1, w: w1 };
          const tok2: TextToken = { ...t, text: text2, x: t.x + w1 + 2, w: t.w - w1 - 2 };
          return [...explodeOne(tok1), ...explodeOne(tok2)];
        }
      }
    }
    return [t];
  };

  for (const t of tokens) {
    result.push(...explodeOne(t));
  }
  return result;
};

export const reconstructTableByTemplate = (tokens: TextToken[]): TableData => {
  if (tokens.length === 0) {
    return { rows: [], columnCount: 0, rowCount: 0 };
  }

    // ─── 1. Group tokens into horizontal lines by Page and Y ────────────────
    // Usamos uma estratégia de "Visão Estrutural": Primeiro agrupamos por página,
    // e dentro de cada página, usamos um histograma Y para detectar as linhas reais.
    const rawLines: { y: number; page: number; tokens: TextToken[] }[] = [];
    
    const pages = Array.from(new Set(tokens.map(t => t.page || 0))).sort((a, b) => a - b);
    
    for (const pageNum of pages) {
      const pageTokens = tokens.filter(t => (t.page || 0) === pageNum);
      if (pageTokens.length === 0) continue;
      
      // Histograma Y para esta página
      const Y_BUCKET_SIZE = 1; // Resolução máxima para linhas coladas
      const yHisto = new Map<number, number>();
      for (const t of pageTokens) {
        const b = Math.floor(t.y / Y_BUCKET_SIZE) * Y_BUCKET_SIZE;
        yHisto.set(b, (yHisto.get(b) || 0) + 1);
      }
      
      // Encontrar centros de massa para cada linha visual
      const yBuckets = Array.from(yHisto.keys()).sort((a, b) => b - a);
      const visualYLines: number[] = [];
      
      for (const b of yBuckets) {
        // Se a distância for maior que 5px, tratamos como uma nova linha.
        // Reduzido de 7 para 5 para separar militares em linhas adjacentes (ex: COESCI).
        if (visualYLines.length === 0 || Math.abs(b - visualYLines[visualYLines.length-1]) > 5) {
          visualYLines.push(b + Y_BUCKET_SIZE / 2);
        } else {
          visualYLines[visualYLines.length-1] = Math.max(visualYLines[visualYLines.length-1], b + Y_BUCKET_SIZE / 2);
        }
      }
      
      for (const y of visualYLines) {
        // Tolerância de captura reduzida para 3px para evitar "puxar" tokens da linha adjacente
        const lineTokens = pageTokens.filter(t => Math.abs(t.y - y) <= 3);
        if (lineTokens.length > 0) {
          rawLines.push({ y, page: pageNum, tokens: lineTokens });
        }
      }
    }

  // ─── 2. Build Phrase Blocks within each line ──────────────────────────────
  // Threshold adaptativo: calcula o espaçamento mediano entre tokens consecutivos
  // na tabela inteira. Isso evita que PDFs com fontes comprimidas (gap real < 6px)
  // fundam colunas distintas num único PhraseBlock.
  const allGaps: number[] = [];
  for (const line of rawLines) {
    const sorted = [...line.tokens].sort((a, b) => a.x - b.x);
    for (let gi = 1; gi < sorted.length; gi++) {
      const g = sorted[gi].x - (sorted[gi - 1].x + sorted[gi - 1].w);
      if (g > 0 && g < 200) allGaps.push(g); // ignora gaps negativos (sobreposição) e muito grandes
    }
  }
  // Mediana dos gaps: separa ruído de espaçamento real entre palavras
  let WORD_SPACE_THRESHOLD = 6; // fallback padrão
  if (allGaps.length >= 4) {
    allGaps.sort((a, b) => a - b);
    const median = allGaps[Math.floor(allGaps.length / 2)];
    // Threshold = 2× mediana, limitado entre 4px e 20px
    // - 4px mínimo: evita que kerning normal quebre palavras
    // - 20px máximo: evita que tabelas muito esparsas nunca separem colunas
    WORD_SPACE_THRESHOLD = Math.min(20, Math.max(4, median * 2));
    console.log(`[TableReconstructor] Threshold adaptativo: mediana=${median.toFixed(1)}px → threshold=${WORD_SPACE_THRESHOLD.toFixed(1)}px (${allGaps.length} gaps amostrados)`);
  }

  interface PhraseBlock {
    xLeft: number;
    xRight: number;
    y: number;
    page: number;
    text: string;
    tokens: TextToken[];
  }

  const allLinesPhrases: PhraseBlock[][] = [];

  for (const line of rawLines) {
    line.tokens.sort((a, b) => a.x - b.x);
    let cur: PhraseBlock | null = null;
    const linePhrases: PhraseBlock[] = [];

    for (const tok of line.tokens) {
      let tokText = tok.isBold ? `**${tok.text}**` : tok.text;
      if (tok.isUnderlined) tokText = `<u>${tokText}</u>`;

      if (!cur) {
        cur = { xLeft: tok.x, xRight: tok.x + tok.w, y: tok.y, page: tok.page || 0, text: tokText, tokens: [tok] };
      } else {
        const gap = tok.x - cur.xRight;
        
        // DIVISÃO SEMÂNTICA: Se o bloco atual termina com uma "âncora de coluna" 
        // ou padrão de dado militar e o novo token começa com outra, força a separação.
        const cText = cur.text.replace(/\*\*/g, '').toUpperCase().trim();
        const nText = tok.text.replace(/\*\*/g, '').toUpperCase().trim();
        
        // Padrões de CABEÇALHO — separa âncoras de coluna mesmo com gap pequeno
        const isHeaderAnchor    = /^(QTD|N[°º]|RG|POSTO|GRAD|ID|NOME|OBM|DATA|LOCAL|HOR[ÁA]RIO|ID\s*FUNC)/i.test(cText);
        const isHeaderEnd       = /(QTD|RG|POSTO|GRAD\.?|NOME|OBM|FUNCIONAL|INSCRIÇÃO|INSC)$/i.test(cText);
        const isNewHeaderStart  = /^(POSTO|GRAD|NOME|RG|ID|OBM|DATA|LOCAL|HOR[ÁA]RIO|ID\s+FUNCIONAL|ID\s*FUNCIONAL)/i.test(nText);
        
        // Padrões de DADOS — usa MILITARY_RANK_RE (lista taxativa de postos/graduações)
        const isQtyValue         = /^\d+$/.test(cText);
        const isRankValue        = MILITARY_RANK_RE.test(nText);
        const isRankValueCurrent = MILITARY_RANK_RE.test(cText);
        const isNameStart        = /^[A-ZÀ-Ú]{3,}/.test(nText) && !isRankValue;
        const isNameEnd          = /[A-ZÀ-Ú]{3,}\s*$/.test(cText) && !isRankValueCurrent;
        const isRgValueStart     = /^\d{1,2}\.\d{3}/.test(nText);
        const isIdValueStart     = /^\d{7,10}$/.test(nText);
        // Quadro/Ano: "QOC/09", "Q08/97" — sempre separa do que vem antes e depois
        const isQuadroStart      = MILITARY_CADRE_RE.test(nText);
        const isQuadroCurrent    = MILITARY_CADRE_RE.test(cText);

        // Regras de separação semântica (todas forçam split independente do gap físico)
        const isQtyToRank      = isQtyValue && isRankValue;          // "1" | "Maj BM"
        const isRankToName     = isRankValueCurrent && isNameStart;  // "Maj BM" | "THIAGO"
        const isRankToQuadro   = isRankValueCurrent && isQuadroStart;// "Maj BM" | "QOC/09"
        const isQuadroToName   = isQuadroCurrent && isNameStart;     // "QOC/09" | "THIAGO"
        const isNameToRg       = isNameEnd && isRgValueStart;        // "DIAS" | "45.320"
        const isRgToId         = /^\d{1,2}\.\d{3}$/.test(cText) && isIdValueStart; // "45.320" | "43599087"
        // ID Funcional seguido de número de processo SEI
        const isIdToSei        = /^\d{7,10}$/.test(cText) && /^SEI[-\s]/i.test(nText);

        const hasStickySlash = (cText.endsWith('/') || nText.startsWith('/'));
        const semanticSplit  = ((isHeaderAnchor || isHeaderEnd) && isNewHeaderStart) || hasStickySlash
          || isQtyToRank || isRankToName || isRankToQuadro
          || isQuadroToName || isNameToRg || isRgToId || isIdToSei;
        if (gap > WORD_SPACE_THRESHOLD || semanticSplit) {
          linePhrases.push(cur);
          cur = { xLeft: tok.x, xRight: tok.x + tok.w, y: tok.y, page: tok.page || 0, text: tokText, tokens: [tok] };
        } else {
          cur.xRight = tok.x + tok.w;
          cur.text += " " + tokText;
          cur.tokens.push(tok);
        }
      }
    }
    if (cur) linePhrases.push(cur);

    // EXPLOSÃO MULTIDIRECIONAL DE CABEÇALHOS:
    // Se a linha parece ser cabeçalho, quebramos frases que contenham múltiplas âncoras.
    const lineText = linePhrases.map(p => p.text).join(" ");
    if (isTableHeader(lineText)) {
      const exploded: PhraseBlock[] = [];
      const anchors = [
        { regex: /^Or\b|^Or\.|ORDEM|QTD|N[º°]/i, width: 0.05, label: "**QTD**" },
        { regex: /POSTO|GRAD/i, width: 0.15, label: "**POSTO/GRAD.**" },
        { regex: /NOME/i, width: 0.35, label: "**NOME**" },
        { regex: /\bRG\b/i, width: 0.1, label: "**RG**" },
        { regex: /ID\s*FUNCIONAL|ID\s*FUNC|IDENTIDADE\s+FUNC/i, width: 0.1, label: "**ID FUNCIONAL**" },
        { regex: /OBM|DBM|GBM|UNIDADE/i, width: 0.1, label: "**OBM**" },
        { regex: /INSCRIÇÃO|INSC/i, width: 0.1, label: "**INSCRIÇÃO**" },
        // SEI deve vir DEPOIS de ID FUNCIONAL para não ser absorvido por ela
        { regex: /SEI[\s(-]|SOLICITAÇÃO/i, width: 0.15, label: "**SEI (SOLICITAÇÃO)**" },
      ];

      for (const p of linePhrases) {
        const plain = p.text.replace(/\*\*/g, '').toUpperCase();
        const found = anchors.filter(a => a.regex.test(plain));
        
        if (found.length >= 2) {
          // ESTRATÉGIA FÍSICA: tenta localizar cada âncora pela posição real do token no PDF.
          // Se o PhraseBlock tem tokens individuais, usamos o X físico de cada token âncora.
          // Fallback: distribuição proporcional por largura relativa.
          const anchorPositions: { anchor: typeof anchors[0]; xLeft: number; xRight: number }[] = [];

          for (const f of found) {
            // Procura o token dentro do bloco cujo texto casa com a âncora
            const matchingTok = p.tokens.find(t => f.regex.test(t.text.toUpperCase()));
            if (matchingTok) {
              anchorPositions.push({ anchor: f, xLeft: matchingTok.x, xRight: matchingTok.x + matchingTok.w });
            } else {
              anchorPositions.push({ anchor: f, xLeft: -1, xRight: -1 });
            }
          }

          const allPhysical = anchorPositions.every(ap => ap.xLeft >= 0);
          // Verifica se as posições físicas são distintas (não todas no mesmo token)
          const uniqueXPositions = new Set(anchorPositions.filter(ap => ap.xLeft >= 0).map(ap => ap.xLeft));
          const hasDistinctPositions = uniqueXPositions.size >= anchorPositions.length - 1;

          if (allPhysical && hasDistinctPositions) {
            // Usa posições físicas reais — cada âncora ocupa do seu xLeft até o xLeft da próxima
            anchorPositions.sort((a, b) => a.xLeft - b.xLeft);
            for (let fIdx = 0; fIdx < anchorPositions.length; fIdx++) {
              const ap = anchorPositions[fIdx];
              const nextXLeft = fIdx + 1 < anchorPositions.length
                ? anchorPositions[fIdx + 1].xLeft
                : p.xRight;
              exploded.push({
                ...p,
                xLeft: ap.xLeft,
                xRight: nextXLeft,
                text: ap.anchor.label,
                tokens: p.tokens.filter(t => t.x >= ap.xLeft && t.x < nextXLeft),
              });
            }
          } else {
            // Fallback: distribuição proporcional por largura relativa
            let currentX = p.xLeft;
            const totalWidth = p.xRight - p.xLeft;
            const normalizedSum = found.reduce((sum, f) => sum + f.width, 0);
            for (const f of found) {
              const proportionalWidth = (f.width / normalizedSum) * totalWidth;
              exploded.push({
                ...p,
                xLeft: currentX,
                xRight: currentX + proportionalWidth,
                text: f.label,
              });
              currentX += proportionalWidth;
            }
          }
        } else {
          exploded.push(p);
        }
      }
      allLinesPhrases.push(exploded);
    } else {
      allLinesPhrases.push(linePhrases);
    }
  }

  // ─── 2.1 Histogram Analysis (Unified Brain Strategy) ───────────────────
  // Analisamos todos os PhraseBlocks para detectar as "calhas" físicas da tabela.
  const X_BUCKET_SIZE = 2; // Alta resolução para colunas estreitas (QTD/Nº)
  const histo = new Map<number, number>();
  for (const line of allLinesPhrases) {
    for (const p of line) {
      const centerX = (p.xLeft + p.xRight) / 2;
      const b = Math.floor(centerX / X_BUCKET_SIZE) * X_BUCKET_SIZE;
      histo.set(b, (histo.get(b) || 0) + 1);
    }
  }
  const buckets = Array.from(histo.keys()).sort((a, b) => a - b);
  const rawPeaks: number[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const curr = histo.get(buckets[i]) || 0;
    const prev = histo.get(buckets[i-1]) || 0;
    const next = histo.get(buckets[i+1]) || 0;
    if (curr >= 2 && curr >= prev && curr >= next) {
      rawPeaks.push(buckets[i] + X_BUCKET_SIZE / 2);
    }
  }
  // Agrupa picos próximos (Deduplicação agressiva para QTD/POSTO)
  const physicalColumnCenters: number[] = [];
  for (const p of rawPeaks) {
    if (physicalColumnCenters.length === 0 || p - physicalColumnCenters[physicalColumnCenters.length-1] > 10) {
      physicalColumnCenters.push(p);
    }
  }

  // ─── 3. Template Discovery (Super-Header Aggregation Strategy) ───────────
  let templateLine: PhraseBlock[] | null = null;
  // Guarda os Y de TODAS as linhas físicas que compõem o super-header.
  // Usado no passo 5 para pular essas linhas quando o modo autoritativo estiver ativo.
  const superHeaderYValues = new Set<number>();
  // Guarda apenas os Y das linhas SECUNDÁRIAS absorvidas (não a linha principal do template).
  // Essas linhas devem ser puladas no passo 5 mesmo fora do modo autoritativo,
  // pois já foram incorporadas ao templateLine e não devem ser tratadas como dados.
  const absorbedHeaderYValues = new Set<number>();
  
  for (let i = 0; i < allLinesPhrases.length; i++) {
    const currentLinesTokens = allLinesPhrases[i];
    const lineText = currentLinesTokens.map(p => p.text).join(" ").toUpperCase();
    
    if (isTableHeader(lineText)) {
      // GUARDA DE DADOS: se a linha contém dados militares reais além do cabeçalho,
      // não é um cabeçalho puro — é uma linha mista (cabeçalho + dados na mesma linha física).
      // Nesse caso, não registrar como cabeçalho para evitar que dados sejam absorvidos no templateLine.
      const lineRawText = currentLinesTokens.map(p => p.text.replace(/\*\*/g, '')).join(" ");
      const lineHasData =
        /\bRG[\s:]*\d/i.test(lineRawText) ||
        /Id\s*Funcional\s*\d/i.test(lineRawText) ||
        /,\s*RG\b/i.test(lineRawText) ||
        /\b(Ten\s+Cel|Subten|[123][°º]\s*Sgt|[12][°º]\s*Ten|Cel\s+BM|Maj\s+BM|Cap\s+BM|Sgt\s+BM|Cb\s+BM|Sd\s+BM)\b.*[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{3,}/i.test(lineRawText);
      if (lineHasData) {
        // Linha mista: trata como dado normal, não como cabeçalho
        continue;
      }

      // Registra os Y da linha inicial do cabeçalho
      for (const p of currentLinesTokens) {
        superHeaderYValues.add(Math.round(p.y));
      }

      // TENTATIVA DE AGREGAÇÃO: Se a linha de baixo também parece cabeçalho, unimos!
      let superHeader = [...currentLinesTokens];
      // Guarda o Y da última linha absorvida para calcular dist incremental
      let lastAbsorbedY = currentLinesTokens[0].y;
      let nextIdx = i + 1;
      while (nextIdx < allLinesPhrases.length) {
        const nextLine = allLinesPhrases[nextIdx];
        const nextText = nextLine.map(p => p.text).join(" ").toUpperCase();
        // Distância incremental: da última linha absorvida, não da primeira
        const dist = Math.abs(nextLine[0].y - lastAbsorbedY);

        // GUARDA DE DADOS: se a linha contém dados militares reais, nunca absorver no cabeçalho.
        // Verifica o texto de cada PhraseBlock individualmente (não o concatenado do segmento inteiro,
        // que pode ter âncoras de outras linhas e enganar o isTableHeader).
        const nextLineRawText = nextLine.map(p => p.text.replace(/\*\*/g, '')).join(" ");
        const isDataLine =
          /\bRG[\s:]*\d/i.test(nextLineRawText) ||
          /Id\s*Funcional\s*\d/i.test(nextLineRawText) ||
          /,\s*RG\b/i.test(nextLineRawText) ||
          /\bRG\s*\d/i.test(nextLineRawText) ||
          // Posto militar seguido de nome em CAIXA ALTA (ex: "3º Sgt BM Q02/08 ANDRE")
          /\b(Ten\s+Cel|Subten|[123][°º]\s*Sgt|[12][°º]\s*Ten|Cel\s+BM|Maj\s+BM|Cap\s+BM|Sgt\s+BM|Cb\s+BM|Sd\s+BM)\b.*[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{3,}/i.test(nextLineRawText);
        if (isDataLine) break;

        const nextIsHeader = isTableHeader(nextText);
        // Fragmentos de cabeçalho (ex: "NAL", "GRAD", "OBM") que vêm logo abaixo são absorvidos
        const nextIsFragment = nextLine.length <= 2 && nextText.length < 15 && !/\d/.test(nextText);
        
        if ((nextIsHeader || nextIsFragment) && dist < 60) {
          // Registra os Y das linhas absorvidas no super-header (secundárias)
          for (const np of nextLine) {
            superHeaderYValues.add(Math.round(np.y));
            absorbedHeaderYValues.add(Math.round(np.y));
          }
          // Unir frases, evitando duplicatas semânticas
          for (const np of nextLine) {
            if (!superHeader.some(sp => sp.text.toUpperCase() === np.text.toUpperCase())) {
              superHeader.push(np);
            }
          }
          lastAbsorbedY = nextLine[0].y;
          i = nextIdx; // Avança o loop principal
          nextIdx++;
        } else {
          break;
        }
      }
      
      superHeader.sort((a, b) => a.xLeft - b.xLeft);
      templateLine = superHeader;
      break; 
    }
  }

  // Fallback: If no semantic header found, take any line with max phrases
  if (!templateLine) {
    let max = 0;
    for (const phrases of allLinesPhrases) {
      if (phrases.length > max) {
        max = phrases.length;
        templateLine = phrases;
      }
    }
  }

  if (!templateLine || templateLine.length === 0) {
    return { rows: [], columnCount: 0, rowCount: 0 };
  }

  // Preserva o templateLine original (antes de qualquer transformação) para que
  // templateHasNonStandardLabels use o cabeçalho real da tabela — não o reconstruído
  // pelo FORCE MILITARY STRUCTURE ou pelo modo autoritativo.
  const originalTemplateLine = [...templateLine];

  // FORCE MILITARY STRUCTURE: Se temos QTD/NOME mas menos que 6 colas, 
  // tentamos uma última explosão no super-header.
  const fullText = templateLine.map(p => p.text).join(" ").toUpperCase();
  if (fullText.includes("QTD") && templateLine.length < 6) {
    const anchors = [
      { key: "QTD", label: "**QTD**" },
      { key: "POSTO", label: "**POSTO/GRAD.**" },
      { key: "GRAD", label: "**POSTO/GRAD.**" },
      { key: "NOME", label: "**NOME**" },
      { key: "RG", label: "**RG**" },
      { key: "FUNCIONAL", label: "**ID FUNCIONAL**" },
      { key: "SEI", label: "**SEI (SOLICITAÇÃO)**" },
      { key: "OBM", label: "**OBM**" }
    ];
    const recovered: PhraseBlock[] = [];
    for (const p of templateLine) {
      const pText = p.text.toUpperCase();
      const matchedAnchors = anchors.filter(a => pText.includes(a.key));
      const uniqueLabels = Array.from(new Set(matchedAnchors.map(a => a.label)));

      if (uniqueLabels.length >= 2) {
        // Tenta usar posições físicas dos tokens para cada âncora
        const anchorPositions: { label: string; xLeft: number }[] = [];
        for (const label of uniqueLabels) {
          const anchor = anchors.find(a => a.label === label)!;
          const matchingTok = p.tokens.find(t => t.text.toUpperCase().includes(anchor.key));
          anchorPositions.push({
            label,
            xLeft: matchingTok ? matchingTok.x : -1,
          });
        }

        const allPhysical = anchorPositions.every(ap => ap.xLeft >= 0);
        if (allPhysical) {
          anchorPositions.sort((a, b) => a.xLeft - b.xLeft);
          for (let idx = 0; idx < anchorPositions.length; idx++) {
            const ap = anchorPositions[idx];
            const nextX = idx + 1 < anchorPositions.length
              ? anchorPositions[idx + 1].xLeft
              : p.xRight;
            recovered.push({ ...p, xLeft: ap.xLeft, xRight: nextX, text: ap.label });
          }
        } else {
          // Fallback: divisão igual
          const totalW = p.xRight - p.xLeft;
          let curX = p.xLeft;
          for (const label of uniqueLabels) {
            const w = totalW / uniqueLabels.length;
            recovered.push({ ...p, xLeft: curX, xRight: curX + w, text: label });
            curX += w;
          }
        }
      } else {
        recovered.push(p);
      }
    }
    templateLine = recovered.sort((a, b) => a.xLeft - b.xLeft);
  }

  // ─── 4. Define Column Boundaries ────────────────────────────────────────
  // Estratégia preferencial: inferir boundaries a partir das linhas de DADOS
  // (não do cabeçalho), usando o TablePatternAnalyzer. Isso resolve o problema
  // do cabeçalho empilhado onde QTD e POSTO/GRAD. têm X idêntico no PDF.

  // Coleta tokens das linhas de dados (exclui TODAS as linhas do super-header)
  // O super-header pode ocupar 2-3 linhas Y distintas (cabeçalho empilhado no PDF).
  const headerYValues = new Set(
    templateLine.flatMap(p => p.tokens.map(t => Math.round(t.y)))
  );
  const dataOnlyTokens = tokens.filter(t => {
    const roundedY = Math.round(t.y);
    return !Array.from(headerYValues).some(hy => Math.abs(roundedY - hy) <= 8);
  });

  const patternAnalysis = (() => {
    // Consulta o registry antes de inferir — se houver boundaries salvas para páginas
    // próximas (±3), usa diretamente para garantir consistência entre páginas da mesma tabela.
    const refPage = dataOnlyTokens[0]?.page ?? 0;
    const cached = refPage > 0 ? tableRegistry.lookup(refPage, "MILITARY_PERSONNEL") : null;
    if (cached && cached.length >= 3) {
      console.log(`[TableReconstructor] Registry hit: usando ${cached.length} boundaries da página ${refPage}`);
      return { boundaries: cached, sampledLines: 0, confidence: 1.0, fromRegistry: true };
    }
    return { ...inferColumnBoundaries(dataOnlyTokens), fromRegistry: false };
  })();

  // MODO AUTORITATIVO: PatternAnalyzer detectou mais colunas que o templateLine
  // (cabeçalho empilhado mal explodido), OU o super-header foi detectado e o
  // PatternAnalyzer tem confiança alta (cabeçalho físico desfigurado mesmo com
  // contagem de colunas igual — ex: COESCI página 10 onde FORCE MILITARY STRUCTURE
  // já produziu 6 entradas mas os PhraseBlocks originais ainda estão desfigurados).
  const COLUMN_LABEL_MAP: Record<string, string> = {
    "QTD": "**QTD**",
    "POSTO/GRAD.": "**POSTO/GRAD.**",
    "NOME": "**NOME**",
    "RG": "**RG**",
    "ID FUNCIONAL": "**ID FUNCIONAL**",
    "OBM": "**OBM**",
  };
  let authoritativeMode = false;
  // Colunas do vocabulário padrão militar — se o templateLine contém labels FORA
  // deste conjunto, o cabeçalho é específico da tabela e não deve ser substituído.
  const STANDARD_MILITARY_LABELS = new Set(["QTD", "POSTO", "GRAD", "NOME", "RG", "ID", "FUNCIONAL", "OBM", "N", "Nº", "ORDEM"]);
  const templateHasNonStandardLabels = originalTemplateLine.some(p => {
    const words = p.text.replace(/\*\*/g, "").toUpperCase().split(/[\s/.()+]+/).filter(Boolean);
    return words.some(w => w.length >= 3 && !STANDARD_MILITARY_LABELS.has(w));
  });

  const shouldActivateAuthoritative =
    // Nunca ativa modo autoritativo quando as boundaries vieram do Registry —
    // o Registry garante consistência de posicionamento entre páginas, mas o
    // templateLine original (cabeçalho real da tabela) é a fonte de verdade para labels.
    !patternAnalysis.fromRegistry &&
    patternAnalysis.confidence >= 0.8 &&
    patternAnalysis.boundaries.length >= 2 &&
    // Não substitui cabeçalhos que contêm colunas específicas fora do vocabulário
    // militar padrão (ex: SEI, SOLICITAÇÃO, Or., SAI, ENTRA) — esses são cabeçalhos
    // reais da tabela, não artefatos de empilhamento de PDF.
    !templateHasNonStandardLabels &&
    // SÓ ativa quando o super-header físico foi detectado (linhas Y registradas).
    superHeaderYValues.size > 0;
  if (shouldActivateAuthoritative) {
    console.log(
      `[TableReconstructor] PatternAnalyzer autoritativo: ${patternAnalysis.boundaries.length} colunas, templateLine ${templateLine.length}, superHeaderYs=${superHeaderYValues.size} — reconstruindo templateLine`
    );
    // Substitui o templateLine pelas boundaries dos dados
    templateLine = patternAnalysis.boundaries.map(b => ({
      xLeft: b.xStart,
      xRight: b.xEnd,
      y: templateLine[0]?.y ?? 0,
      page: templateLine[0]?.page ?? 0,
      text: COLUMN_LABEL_MAP[b.label] ?? `**${b.label}**`,
      tokens: [],
    }));
    authoritativeMode = true;
  }

  const columnCount = templateLine.length;
  const columnDef: any[] = [];

  const usePatternBoundaries =
    patternAnalysis.confidence >= 0.5 &&
    // Só usa boundaries do PatternAnalyzer quando ele detectou pelo menos tantas
    // colunas quanto o templateLine. Se detectou menos, o fallback geométrico
    // (baseado nas posições físicas do cabeçalho) é mais confiável para as colunas extras.
    patternAnalysis.boundaries.length >= columnCount &&
    // Não usa boundaries do PatternAnalyzer quando o cabeçalho original tem colunas
    // específicas da tabela (ex: SEI, SOLICITAÇÃO, Or.) — o PatternAnalyzer só conhece
    // o vocabulário militar padrão e produziria boundaries erradas para essas colunas.
    !templateHasNonStandardLabels;

  // Modo híbrido: quando há colunas não-padrão, usa PatternAnalyzer para colunas
  // que ele conhece (NOME, RG, ID FUNCIONAL) e fallback geométrico para as demais.
  // Isso resolve o caso onde NOME/RG/ID chegam como token único no cabeçalho empilhado.
  const useHybridBoundaries =
    !usePatternBoundaries &&
    templateHasNonStandardLabels &&
    patternAnalysis.confidence >= 0.5 &&
    patternAnalysis.boundaries.length >= 2;

  if (usePatternBoundaries) {
    console.log(`[TableReconstructor] Usando boundaries do PatternAnalyzer (confiança=${patternAnalysis.confidence.toFixed(2)})`);
    for (let i = 0; i < columnCount; i++) {
      const p = templateLine[i];
      const hText = p.text.replace(/\*\*/g, "").toUpperCase();
      const matchedBoundary = patternAnalysis.boundaries.find(b => {
        const bl = b.label.toUpperCase();
        return hText.includes(bl.split("/")[0]) || hText.includes(bl.split(".")[0]);
      });
      const xStart = i === 0 ? 0 : columnDef[i - 1].xEnd;
      let xEnd = matchedBoundary
        ? matchedBoundary.xEnd
        : (i < columnCount - 1 ? (templateLine[i + 1].xLeft + p.xRight) / 2 : 1500);
      // Garante que xEnd não ultrapassa o xLeft da próxima coluna do templateLine.
      if (i < columnCount - 1) {
        const nextColXLeft = templateLine[i + 1].xLeft;
        if (nextColXLeft > xStart + 5) {
          xEnd = Math.min(xEnd, nextColXLeft);
        }
      }
      const centerX = matchedBoundary ? matchedBoundary.centerX : (p.xLeft + p.xRight) / 2;
      columnDef.push({ xStart, xEnd, centerX, originalHeader: p.text });
    }
  } else if (useHybridBoundaries) {
    console.log(`[TableReconstructor] Modo híbrido: PatternAnalyzer para colunas padrão, fallback geométrico para não-padrão`);
    for (let i = 0; i < columnCount; i++) {
      const p = templateLine[i];
      const hText = p.text.replace(/\*\*/g, "").toUpperCase();
      const matchedBoundary = patternAnalysis.boundaries.find(b => {
        const bl = b.label.toUpperCase();
        // Nº/N° é número de ordem → QTD
        if (/^N[°º.]?$/.test(hText) && bl === "QTD") return true;
        // MILITAR abrange posto+nome — usa boundary de NOME (mais à direita) para xEnd
        if (hText.includes("MILITAR") && bl === "NOME") return true;
        return hText.includes(bl.split("/")[0]) || hText.includes(bl.split(".")[0]);
      });
      const xStart = i === 0 ? 0 : columnDef[i - 1].xEnd;
      let xEnd: number;
      let centerX: number;
      if (matchedBoundary) {
        // Garante que xEnd nunca fique à esquerda de xStart (boundary invertida)
        xEnd = Math.max(matchedBoundary.xEnd, xStart + 10);
        centerX = matchedBoundary.centerX;
      } else {
        xEnd = i < columnCount - 1 ? templateLine[i + 1].xLeft : 1500;
        centerX = (p.xLeft + p.xRight) / 2;
      }
      if (i < columnCount - 1) {
        const nextColXLeft = templateLine[i + 1].xLeft;
        if (nextColXLeft > xStart + 5) {
          xEnd = Math.min(xEnd, nextColXLeft + 15);
        }
      }
      console.log(`[Híbrido] col=${i} "${hText.substring(0,20)}" xStart=${Math.round(xStart)} xEnd=${Math.round(xEnd)} center=${Math.round(centerX)} templateXLeft=${Math.round(p.xLeft)}`);
      columnDef.push({ xStart, xEnd, centerX, originalHeader: p.text });
    }
  } else {
    // Fallback: lógica original com histograma de picos do cabeçalho
    for (let i = 0; i < columnCount; i++) {
      const p = templateLine[i];
      const xStart = i === 0 ? 0 : columnDef[i - 1].xEnd;
      let xEnd = 1500;

      if (i < columnCount - 1) {
        const next = templateLine[i + 1];

        // FORÇA DIVISÃO QTD / POSTO
        if (i === 0 && p.text.toUpperCase().includes("QTD")) {
          const qtdPeak = physicalColumnCenters[0];
          const postoPeak = physicalColumnCenters[1];
          if (qtdPeak !== undefined && postoPeak !== undefined && postoPeak > qtdPeak + 5) {
            xEnd = (qtdPeak + postoPeak) / 2;
          } else {
            xEnd = next.xLeft > p.xRight + 5
              ? p.xRight + (next.xLeft - p.xRight) * 0.3
              : p.xRight + 20;
          }
          console.log(`[TableReconstructor] QTD xEnd=${Math.round(xEnd)} (qtdPeak=${Math.round(qtdPeak ?? 0)}, postoPeak=${Math.round(postoPeak ?? 0)})`);
        } else {
          const pIdx = physicalColumnCenters.findIndex(c => Math.abs(c - (p.xLeft + p.xRight) / 2) < 50);
          if (pIdx !== -1 && physicalColumnCenters[pIdx + 1]) {
            xEnd = (physicalColumnCenters[pIdx] + physicalColumnCenters[pIdx + 1]) / 2;
          } else {
            const gap = next.xLeft - p.xRight;
            const hType = p.text.toUpperCase();
            const nextHType = next.text.toUpperCase();
            let bias = 0.5;
            if (hType.includes("NOME")) bias = 0.8;
            if (hType.includes("OBM")) bias = 0.7;
            if (nextHType.includes("RG") || nextHType.includes("ID")) bias = Math.min(bias, 0.4);
            xEnd = p.xRight + gap * bias;
          }
          // Usa o xLeft da próxima coluna como limite superior sempre que disponível
          // (cobre tanto PhraseBlocks com tokens físicos quanto os criados por fallback proporcional).
          if (next.xLeft > xStart + 5) {
            xEnd = Math.min(xEnd, next.xLeft);
          }
        }
      }

      columnDef.push({ xStart, xEnd, centerX: (p.xLeft + p.xRight) / 2, originalHeader: p.text });
    }
  }

  // ─── 5. Assign phrases to columns via structural mapping ─────────────────
  const finalRows: TableCell[][] = [];
  const normalizedHeaderStrings = templateLine.map(p => normalizeTitle(p.text));

  // MODO AUTORITATIVO: injeta row sintética de cabeçalho com os labels corretos
  // e pula as linhas físicas do super-header original (que têm PhraseBlocks desfigurados).
  if (authoritativeMode) {
    const syntheticHeaderRow: TableCell[] = templateLine.map((p, c) => ({
      text: p.text,
      tokens: [],
      row: 0,
      col: c,
      rowSpan: 1,
      colSpan: 1,
      align: 'center' as const,
    }));
    finalRows.push(syntheticHeaderRow);
    console.log(`[TableReconstructor] Modo autoritativo: injetando cabeçalho sintético com ${templateLine.length} colunas, pulando ${superHeaderYValues.size} Y(s) do super-header original`);
  }

  for (let i = 0; i < allLinesPhrases.length; i++) {
    const linePhrases = allLinesPhrases[i];

    // Pula linhas físicas SECUNDÁRIAS do super-header (absorvidas na agregação).
    // A linha principal do template é processada normalmente como row de cabeçalho.
    // Isso evita que a linha 2 do cabeçalho empilhado seja tratada como dado ou "repeated header".
    if (linePhrases.length > 0 && absorbedHeaderYValues.size > 0) {
      const lineY = Math.round(linePhrases[0].y);
      const isAbsorbedLine = Array.from(absorbedHeaderYValues).some(hy => Math.abs(lineY - hy) <= 5);
      if (isAbsorbedLine) {
        continue;
      }
    }

    // MODO AUTORITATIVO: pula linhas físicas que fazem parte do super-header original
    if (authoritativeMode && linePhrases.length > 0) {
      const lineY = Math.round(linePhrases[0].y);
      const isSuperHeaderLine = Array.from(superHeaderYValues).some(hy => Math.abs(lineY - hy) <= 5);
      if (isSuperHeaderLine) {
        console.log(`[TableReconstructor] Pulando linha do super-header original y=${lineY}`);
        continue;
      }
    }

    // SUBSTITUIÇÃO DO CABEÇALHO: quando a linha física é o cabeçalho principal
    // (Y em superHeaderYValues mas não em absorbedHeaderYValues, e é a primeira row),
    // injeta diretamente o templateLine como row de cabeçalho — sem passar pelo motor
    // de overlap, que pode errar quando os PhraseBlocks têm posições proporcionais.
    let effectivePhrases = linePhrases;
    let useDirectHeaderInjection = false;
    if (linePhrases.length > 0 && superHeaderYValues.size > 0 && finalRows.length === 0) {
      const lineY = Math.round(linePhrases[0].y);
      // Tolerância aumentada para 20px — o Y do PhraseBlock pode diferir do Y da linha física
      // por causa do histograma de agrupamento no rawLines (Y_BUCKET_SIZE=1, centro de massa).
      const isPrimaryHeaderByY = Array.from(superHeaderYValues).some(hy => Math.abs(lineY - hy) <= 20)
        && !Array.from(absorbedHeaderYValues).some(hy => Math.abs(lineY - hy) <= 5);
      // Fallback por texto: se a linha é cabeçalho puro (sem dados militares) e é a primeira row
      const lineRawForHeader = linePhrases.map(p => p.text.replace(/\*\*/g, '')).join(" ");
      const lineIsHeaderText = isTableHeader(linePhrases.map(p => p.text).join(" ").toUpperCase());
      const lineHasDataForHeader =
        /\bRG[\s:]*\d/i.test(lineRawForHeader) ||
        /Id\s*Funcional\s*\d/i.test(lineRawForHeader) ||
        /,\s*RG\b/i.test(lineRawForHeader) ||
        /\b(Ten\s+Cel|Subten|[123][°º]\s*Sgt|[12][°º]\s*Ten|Cel\s+BM|Maj\s+BM|Cap\s+BM|Sgt\s+BM|Cb\s+BM|Sd\s+BM)\b.*[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{3,}/i.test(lineRawForHeader);
      const isPrimaryHeader = isPrimaryHeaderByY || (lineIsHeaderText && !lineHasDataForHeader);
      if (isPrimaryHeader) {
        // Injeta o templateLine diretamente como row de cabeçalho
        const headerRow: TableCell[] = templateLine.map((p, c) => ({
          text: p.text,
          tokens: p.tokens,
          row: 0,
          col: c,
          rowSpan: 1,
          colSpan: 1,
          align: 'center' as const,
        }));
        finalRows.push(headerRow);
        continue;
      }
    }
    
    // SKIP REPEATED HEADERS: Se a linha atual é identica ao template (exceto pela 1ª ocorrência), ignora.
    if (finalRows.length > 0) {
      const lineTextNorm = normalizeTitle(linePhrases.map(p => p.text).join(" "));
      const headerTextNorm = normalizedHeaderStrings.join(" ");
      // Se a linha atual é 80% similar ao cabeçalho, ignora como dado (é repetição de header)
      const words = lineTextNorm.split(" ");
      const headerWords = headerTextNorm.split(" ");
      const matchCount = words.filter(w => headerWords.includes(w)).length;
      if (matchCount >= Math.ceil(headerWords.length * 0.8)) {
        console.log(`[TableReconstructor] Skipping repeated header: "${lineTextNorm}"`);
        continue;
      }
    }

    const rowCells: TableCell[] = Array.from({ length: columnCount }, (_, c) => ({
      text: "",
      tokens: [],
      row: finalRows.length,
      col: c,
      rowSpan: 1,
      colSpan: 1,
      align: 'left' // default
    }));

    for (const p of effectivePhrases) {
      // Find the best matching column for this phrase
      let bestCol = -1;
      let minDistance = 1000;

      // LOG DIAGNÓSTICO para token 043408354
      const _isDiag = /^043408354/.test(p.text.replace(/\*\*/g,''));
      if (_isDiag) console.log(`[DIAG-043] phrase="${p.text.substring(0,40)}" xLeft=${Math.round(p.xLeft)} xRight=${Math.round(p.xRight)}`);

      for (let c = 0; c < columnCount; c++) {
        const def = columnDef[c];
        const overlap = Math.max(0, Math.min(p.xRight, def.xEnd) - Math.max(p.xLeft, def.xStart));
        const phraseWidth = p.xRight - p.xLeft;

        // --- MOTOR SEMÂNTICO (Unified Brain v5) ---
        const hType = def.originalHeader.replace(/\*\*/g, '').toUpperCase();
        const score = getSemanticScore(p.text, hType);
        
        // Afinidade de Nome (Fragmentos alfabéticos "DA SILVA")
        const isNameFragment = /^[A-ZÀ-Ú\s]+$/i.test(p.text.replace(/\*\*/g, '').trim()) && !/\d/.test(p.text);
        const isNomeCol = hType.includes("NOME");
        
        const lineIsSparse = linePhrases.length <= Math.ceil(columnCount / 2);
        
        // O overlapThreshold é reduzido se o score semântico for alto (Atração por Gravidade)
        let threshold = lineIsSparse ? 0.2 : 0.4;
        if (score >= 0.9) threshold = 0.05; // Forte atração se os dados batem com a coluna
        if (isNameFragment && isNomeCol) threshold = 0.05;

        if (overlap > phraseWidth * threshold) {
          // Escolhe a coluna com maior overlap (não apenas a última com overlap suficiente)
          const prevOverlap = bestCol >= 0
            ? Math.max(0, Math.min(p.xRight, columnDef[bestCol].xEnd) - Math.max(p.xLeft, columnDef[bestCol].xStart))
            : -1;
          if (overlap > prevOverlap) {
            bestCol = c;
          }
          // Se o dado encaixa perfeitamente na coluna atual, para aqui
          if (score >= 1 || (isNameFragment && isNomeCol)) break;
        } else if (bestCol === -1) {
          // Distance to center como fallback — só quando nenhum overlap foi encontrado ainda
          const dist = Math.abs((p.xLeft + phraseWidth / 2) - def.centerX);
          if (dist < minDistance) {
            minDistance = dist;
            bestCol = c;
          }
        }
      }

      // Se nenhum overlap encontrou bestCol, usa distância ao centro como último recurso
      if (bestCol === -1) {
        for (let c = 0; c < columnCount; c++) {
          const def = columnDef[c];
          const phraseWidth = p.xRight - p.xLeft;
          const dist = Math.abs((p.xLeft + phraseWidth / 2) - def.centerX);
          if (dist < minDistance) {
            minDistance = dist;
            bestCol = c;
          }
        }
      }

      if (bestCol !== -1) {
        // --- GUARDA SEMÂNTICA (Unified Brain v5) ---
        // Se o dado foi jogado numa coluna técnica (RG, ID, QTD) mas é puramente texto,
        // e existe uma coluna NOME/OBM por perto, prefere a coluna de texto.
        const hType = columnDef[bestCol].originalHeader.replace(/\*\*/g, '').toUpperCase();
        const isTechnicalCol = /RG|ID|QTD|N[°º]/.test(hType);
        const isTextOnly = /^[A-ZÀ-Ú\s]+$/i.test(p.text.replace(/\*\*/g, '').trim()) && !/\d/.test(p.text);
        
        if (isTechnicalCol && isTextOnly) {
          // Procura uma coluna de texto vizinha (NOME, OBM)
          for (let c = 0; c < columnCount; c++) {
            const nearHType = columnDef[c].originalHeader.replace(/\*\*/g, '').toUpperCase();
            if (/NOME|OBM|ASSUNTO/.test(nearHType)) {
              bestCol = c;
              break;
            }
          }
        }

        const cell = rowCells[bestCol];
        const phraseWidth = p.xRight - p.xLeft;
        const phraseCenterX = p.xLeft + phraseWidth / 2;

        if (_isDiag) console.log(`[DIAG-043] → bestCol=${bestCol} header="${columnDef[bestCol]?.originalHeader}" xStart=${Math.round(columnDef[bestCol]?.xStart)} xEnd=${Math.round(columnDef[bestCol]?.xEnd)}`);
        const colInfo = columnDef[bestCol];
        const colWidth = colInfo.xEnd - colInfo.xStart;

        // Detect centering: if center of phrase is near center of column (10% tolerance)
        if (Math.abs(phraseCenterX - colInfo.centerX) < colWidth * 0.1) {
          cell.align = 'center';
        }

        cell.text = (cell.text + " " + p.text).trim();
        cell.tokens.push(...p.tokens);

        // LOG DIAGNÓSTICO: detecta concatenação dupla na coluna NOME
        const _hTypeDiag = columnDef[bestCol].originalHeader.replace(/\*\*/g, '').toUpperCase();
        if (_hTypeDiag.includes('NOME') && /ANTONIO|AMBROSIO|EDISON/i.test(p.text)) {
          console.log(`[Passo5][DIAG2] y=${Math.round(linePhrases[0]?.y ?? 0)} col=${bestCol} phrase="${p.text.substring(0,40)}" cellBefore="${cell.text.replace(p.text,'').trim().substring(0,30)}"`);
        }      }
    }

    finalRows.push(rowCells);
  }

  // ─── 6. No-Collision Row Merging (Consolidate split rows) ────────────────
  // Também concatena continuações de célula: quando uma linha tem apenas texto
  // em colunas que já têm conteúdo na linha anterior (ex: Id Funcional quebrado).
  const mergedRows: TableCell[][] = [];
  for (const currentRow of finalRows) {
    if (mergedRows.length === 0) {
      mergedRows.push(currentRow);
      continue;
    }

    const lastRow = mergedRows[mergedRows.length - 1];

    // Não faz merge entre páginas
    const lastPage = lastRow.find(c => c.tokens.length > 0)?.tokens[0].page;
    const currentPage = currentRow.find(c => c.tokens.length > 0)?.tokens[0].page;
    if (lastPage !== undefined && currentPage !== undefined && lastPage !== currentPage) {
      mergedRows.push(currentRow);
      continue;
    }

    // Conta colunas com texto no row atual
    const currFilled = currentRow.filter(c => c.text.length > 0).length;

    // Verifica colisão: colunas com texto nos dois rows
    let collisionCols = 0;
    for (let c = 0; c < columnCount; c++) {
      if (lastRow[c].text.length > 0 && currentRow[c].text.length > 0) collisionCols++;
    }

    // Sem colisão → merge normal (preenche células vazias)
    // EXCEÇÃO 1: se a linha atual tem apenas NOME preenchido com nome próprio em CAIXA ALTA
    // e a linha anterior já tem NOME preenchido, é um novo militar — não faz merge.
    // EXCEÇÃO 2: se a linha atual E a anterior têm POSTO/GRAD com posto militar válido,
    // é sempre um novo militar — nunca faz merge com a linha anterior.
    // (Se só a linha atual tem POSTO mas a anterior não, é linha B do mesmo militar → merge normal)
    if (collisionCols === 0) {
      const postoColIdx = columnDef.findIndex(d => /POSTO|GRAD/.test(d.originalHeader.replace(/\*\*/g, '').toUpperCase()));
      const nomeColIdx  = columnDef.findIndex(d => d.originalHeader.replace(/\*\*/g, '').toUpperCase().includes('NOME'));
      // Exceção 2: linha atual começa com posto militar → novo militar
      // MAS só se a linha anterior já tem POSTO preenchido (ou seja, é realmente um novo militar).
      // Se a anterior não tem POSTO, a linha atual é a linha B (continuação) do mesmo militar.
      if (postoColIdx >= 0) {
        const currPosto = currentRow[postoColIdx]?.text.replace(/\*\*/g, '').trim() ?? '';
        const lastPosto = lastRow[postoColIdx]?.text.replace(/\*\*/g, '').trim() ?? '';
        const isMilitary = (s: string) => /^(Al\s+Sd|Ten\s+Cel|TC|Subten|ST|[123][º°o]\s*Sgt|[12][º°o]\s*Ten|Gen|Cel|Maj|Cap|Sgt|Cb|Sd)\b/i.test(s);
        if (isMilitary(currPosto) && isMilitary(lastPosto)) {
          mergedRows.push(currentRow);
          continue;
        }
      }

      // Exceção 1: linha atual tem só NOME em CAIXA ALTA e anterior já tem NOME
      if (nomeColIdx >= 0) {
        const currNome = currentRow[nomeColIdx]?.text.trim() ?? '';
        const lastNome = lastRow[nomeColIdx]?.text.trim() ?? '';
        const currNomePlain = currNome.replace(/\*\*/g, '').trim();
        const currOnlyNome = currFilled === 1 && currentRow[nomeColIdx]?.text.length > 0;
        const currIsFullName = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,}(\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,})+$/.test(currNomePlain);
        if (currOnlyNome && currIsFullName && lastNome.length > 0) {
          mergedRows.push(currentRow);
          continue;
        }
      }
      for (let c = 0; c < columnCount; c++) {
        if (currentRow[c].text.length > 0) {
          lastRow[c].text = (lastRow[c].text + " " + currentRow[c].text).trim();
          lastRow[c].tokens.push(...currentRow[c].tokens);
        }
      }
      continue;
    }

    // Com colisão: antes de avaliar continuação, verifica se a linha atual
    // tem posto militar válido na coluna POSTO/GRAD — se sim, é sempre novo militar.
    {
      const postoColIdx = columnDef.findIndex(d => /POSTO|GRAD/.test(d.originalHeader.replace(/\*\*/g, '').toUpperCase()));
      if (postoColIdx >= 0) {
        const currPosto = currentRow[postoColIdx]?.text.replace(/\*\*/g, '').trim() ?? '';
        if (currPosto && /^(Al\s+Sd|Ten\s+Cel|TC|Subten|ST|[123][º°o]\s*Sgt|[12][º°o]\s*Ten|Gen|Cel|Maj|Cap|Sgt|Cb|Sd)\b/i.test(currPosto)) {
          mergedRows.push(currentRow);
          continue;
        }
      }
    }

    // Com colisão: verifica se o row atual é uma continuação de célula quebrada.
    const isContinuation = currFilled <= Math.ceil(columnCount / 2) &&
      currentRow.every((cell, c) => {
        if (cell.text.length === 0) return true;
        if (lastRow[c].text.length === 0) return true; // sem colisão nessa col
        const t = cell.text.trim();
        const prev = lastRow[c].text.trim();

        // Se a coluna é NOME/OBM e o texto atual parece continuação, aceita
        const hType = columnDef[c].originalHeader.replace(/\*\*/g, '').toUpperCase();
        const isNameOrObm = /NOME|OBM|ASSUNTO/.test(hType);
        
        // Caso 1: só números ou fragmento numérico (ex: RG quebrado "32.6 18", Id Funcional)
        if (/^\d[\d.\s]*$/.test(t)) return true;

        // Caso 2: texto curto sem vírgula (ex: fragmento de horário, OBM)
        // Exceção: nome próprio completo em CAIXA ALTA na coluna NOME com 2+ palavras
        // é novo militar, não continuação (ex: "ANTONIO MARCOS AMBROSIO DOS")
        const tPlain = t.replace(/\*\*/g, '').trim(); // remove bold markers para comparação
        const isFullNameInNomeCol = hType.includes("NOME") &&
          /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,}(\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,})+$/.test(tPlain) &&
          tPlain.split(/\s+/).length >= 2;
        if (t.length < 30 && !/,/.test(t) && isNameOrObm && !isFullNameInNomeCol) return true;

        // Caso 3: continuação de texto descritivo — linha atual começa com minúscula
        // ou com preposição/artigo (ex: "e Reciclagem de Motoristas")
        if (/^[a-záéíóúâêîôûãõç]/.test(t)) return true;
        if (/^(e|de|do|da|dos|das|em|no|na|nos|nas|com|para)\s/i.test(t)) return true;

        // Caso 5: fragmento de Id Funcional ou RG (continuação de linha de militar)
        if (/^Id\s*Funcional\s+\d+/i.test(t)) return true;
        if (/^RG\s+\d+/i.test(t)) return true;

        // Caso 6: GRAVIDADE SEMÂNTICA (Unified Brain v5)
        // Se o fragmento combina semânticamente com a coluna (especialmente NOME/OBM)
        // Exceção: nome completo em CAIXA ALTA na coluna NOME é novo militar, não continuação
        const score = getSemanticScore(t, hType);
        if (score >= 0.8 && (hType.includes("NOME") || hType.includes("OBM")) && !isFullNameInNomeCol) return true;

        // Caso 7: linha anterior não termina com pontuação forte...
        const prevEndsClean = !/[.;!?]$/.test(prev);
        // Nova entrada: começa com posto/graduação militar OU número de item de lista
        // OU nome próprio em CAIXA ALTA completo na coluna NOME (novo militar)
        // Usa tPlain (sem bold markers) para o teste de nome completo
        const currIsNewEntry = /^(Cap|Ten|Cel|Maj|Sgt|Cb|Sd|BM)\s/i.test(t) ||
                               /^\d+[.)]\s/.test(t) ||
                               (isNameOrObm && hType.includes("NOME") && isFullNameInNomeCol);
        if (prevEndsClean && !currIsNewEntry && t.length < 80) return true;

        return false;
      });

    if (isContinuation) {
      // Concatena o texto de continuação às células correspondentes
      for (let c = 0; c < columnCount; c++) {
        if (currentRow[c].text.length > 0) {
          lastRow[c].text = (lastRow[c].text + " " + currentRow[c].text).trim();
          lastRow[c].tokens.push(...currentRow[c].tokens);
        }
      }
    } else {
      mergedRows.push(currentRow);
    }
  }

  // ─── 7. Normalize cell text (fix PDF extraction artifacts) ──────────────
  for (const row of mergedRows) {
    for (const cell of row) {
      if (cell.text) cell.text = normalizeCellText(cell.text);
    }
  }

  return {
    rows: mergedRows,
    columnCount,
    rowCount: mergedRows.length,
  };
};
