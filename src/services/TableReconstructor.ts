import { TextToken, TableData, TableCell } from "../types";
import { isTableHeader, normalizeCellText } from "./textUtils";

/**
 * TableReconstructor v5
 * 
 * Three-tier approach:
 *  1. Simple data tables → Template-based (header detection)
 *  2. Complex forms → Layout preservation (hierarchical text)
 *  3. Fallback → Border-based (X-gap analysis)
 */
export const reconstructTable = (tokens: TextToken[]): TableData => {
  if (tokens.length === 0) {
    return { rows: [], columnCount: 0, rowCount: 0 };
  }

  // Heuristic 1: Very sparse tokens (< 2 per line) = complex form
  const avgTokensPerLine = tokens.length / new Set(tokens.map(t => Math.round(t.y / 6))).size;
  
  // Heuristic 2: High Y-variance = multi-line cells (forms)
  const yValues = tokens.map(t => t.y);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = yMax - yMin;
  const avgYGap = yRange / new Set(tokens.map(t => Math.round(t.y / 6))).size;
  
  const isComplexForm = avgTokensPerLine < 2 || avgYGap > 20;

  if (isComplexForm) {
    // Use layout preservation (renders as formatted text, not grid)
    return reconstructTableAsLayout(tokens);
  }

  // Medium complexity: try border-based
  if (avgTokensPerLine < 4) {
    const borderResult = reconstructTableByBorders(tokens);
    if (borderResult.rowCount > 0) return borderResult;
  }

  // Simple data table: template-based
  return reconstructTableByTemplate(tokens);
};

/**
 * Layout preservation (for complex forms that don't fit grid structure)
 * Renders as hierarchical text blocks instead of trying to force into grid
 */
const reconstructTableAsLayout = (tokens: TextToken[]): TableData => {
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
const reconstructTableByBorders = (tokens: TextToken[]): TableData => {
  // Step 1: Cluster tokens by Y (rows) with adaptive epsilon
  const Y_EPSILON = 8;
  const rowGroups = new Map<number, TextToken[]>();
  
  for (const tok of tokens) {
    const yKey = Math.round(tok.y / Y_EPSILON) * Y_EPSILON;
    if (!rowGroups.has(yKey)) rowGroups.set(yKey, []);
    rowGroups.get(yKey)!.push(tok);
  }

  const sortedYKeys = Array.from(rowGroups.keys()).sort((a, b) => b - a);
  
  // Step 2: Detect column boundaries via histogram analysis
  // Build X-histogram: count tokens in each X-bucket
  const X_BUCKET_SIZE = 5;
  const xHistogram = new Map<number, number>();
  
  for (const tok of tokens) {
    const xBucket = Math.floor(tok.x / X_BUCKET_SIZE) * X_BUCKET_SIZE;
    xHistogram.set(xBucket, (xHistogram.get(xBucket) || 0) + 1);
  }

  // Find valleys (low-density regions) = column boundaries
  const sortedXBuckets = Array.from(xHistogram.keys()).sort((a, b) => a - b);
  const columnBoundaries: number[] = [0];
  
  for (let i = 1; i < sortedXBuckets.length - 1; i++) {
    const prev = xHistogram.get(sortedXBuckets[i - 1]) || 0;
    const curr = xHistogram.get(sortedXBuckets[i]) || 0;
    const next = xHistogram.get(sortedXBuckets[i + 1]) || 0;
    
    // Valley: current bucket has significantly fewer tokens than neighbors
    if (curr === 0 && (prev > 0 || next > 0)) {
      const xBoundary = sortedXBuckets[i];
      // Avoid duplicate boundaries too close together
      if (columnBoundaries.length === 0 || xBoundary - columnBoundaries[columnBoundaries.length - 1] > 30) {
        columnBoundaries.push(xBoundary);
      }
    }
  }
  
  columnBoundaries.push(Math.max(...tokens.map(t => t.x + t.w)) + 10);
  const columnCount = columnBoundaries.length - 1;

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
  // Colspan: consecutive empty cells in a row with text in first cell
  for (let r = 0; r < finalRows.length; r++) {
    for (let c = 0; c < columnCount; c++) {
      const cell = finalRows[r][c];
      if (cell.text.trim().length > 0 && cell.colSpan === 1) {
        let span = 1;
        while (c + span < columnCount && finalRows[r][c + span].text.trim().length === 0) {
          span++;
        }
        if (span > 1) {
          cell.colSpan = span;
          // Mark spanned cells as merged
          for (let s = 1; s < span; s++) {
            finalRows[r][c + s].text = ""; // Clear to avoid duplication
          }
        }
      }
    }
  }

  // Rowspan: consecutive rows with same text in same column
  for (let c = 0; c < columnCount; c++) {
    for (let r = 0; r < finalRows.length; r++) {
      const cell = finalRows[r][c];
      if (cell.text.trim().length > 0 && cell.rowSpan === 1) {
        let span = 1;
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

  return {
    rows: finalRows,
    columnCount,
    rowCount: finalRows.length,
  };
};

/**
 * Template-based reconstruction (original algorithm for data tables)
 */
const reconstructTableByTemplate = (tokens: TextToken[]): TableData => {
  if (tokens.length === 0) {
    return { rows: [], columnCount: 0, rowCount: 0 };
  }

  // ─── 1. Group tokens into horizontal lines by Page and Y ────────────────
  const Y_EPSILON = 6;
  const rawLines: { y: number; page: number; tokens: TextToken[] }[] = [];

  const sortedByY = [...tokens].sort((a, b) => {
    if (a.page !== b.page) return (a.page || 0) - (b.page || 0);
    return b.y - a.y;
  });
  
  for (const token of sortedByY) {
    const existing = rawLines.find(l => 
      l.page === (token.page || 0) && Math.abs(token.y - l.y) <= Y_EPSILON
    );
    if (existing) {
      existing.tokens.push(token);
    } else {
      rawLines.push({ y: token.y, page: token.page || 0, tokens: [token] });
    }
  }

  // ─── 2. Build Phrase Blocks within each line ──────────────────────────────
  const WORD_SPACE_THRESHOLD = 10; 

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
        if (gap <= WORD_SPACE_THRESHOLD) {
          cur.xRight = tok.x + tok.w;
          cur.text += " " + tokText;
          cur.tokens.push(tok);
        } else {
          linePhrases.push(cur);
          cur = { xLeft: tok.x, xRight: tok.x + tok.w, y: tok.y, page: tok.page || 0, text: tokText, tokens: [tok] };
        }
      }
    }
    if (cur) linePhrases.push(cur);
    allLinesPhrases.push(linePhrases);
  }

  // ─── 3. Template Discovery (The "Header First" Strategy) ─────────────────
  // Find the first line that looks like a structural header
  let templateLine: PhraseBlock[] | null = null;
  for (const phrases of allLinesPhrases) {
    const lineText = phrases.map(p => p.text).join("   ");
    if (isTableHeader(lineText) && phrases.length >= 2) {
      templateLine = phrases;
      break; 
    }
  }

  // Fallback: If no semantic header found, take the first line with many phrases
  if (!templateLine) {
    for (const phrases of allLinesPhrases) {
      if (phrases.length >= 3) {
        templateLine = phrases;
        break; 
      }
    }
  }

  // Second Fallback: Take the line with absolutely maximum phrases
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

  // ─── 4. Define Column Boundaries from Template ──────────────────────────
  const columnCount = templateLine.length;
  // We define columns by their centers and width ranges
  const columnDef = templateLine.map(p => ({
    xStart: p.xLeft,
    xEnd: p.xRight,
    centerX: p.xLeft + (p.xRight - p.xLeft) / 2
  }));

  // ─── 5. Assign phrases to columns via structural mapping ─────────────────
  const finalRows: TableCell[][] = [];

  for (let i = 0; i < allLinesPhrases.length; i++) {
    const linePhrases = allLinesPhrases[i];
    const rowCells: TableCell[] = Array.from({ length: columnCount }, (_, c) => ({
      text: "",
      tokens: [],
      row: finalRows.length,
      col: c,
      rowSpan: 1,
      colSpan: 1,
      align: 'left' // default
    }));

    for (const p of linePhrases) {
      // Find the best matching column for this phrase
      let bestCol = -1;
      let minDistance = 1000;

      for (let c = 0; c < columnCount; c++) {
        const def = columnDef[c];
        // If phrase overlaps the column range significantly, it belongs there
        const overlap = Math.max(0, Math.min(p.xRight, def.xEnd) - Math.max(p.xLeft, def.xStart));
        const phraseWidth = p.xRight - p.xLeft;
        
        if (overlap > phraseWidth * 0.4) {
          bestCol = c;
          break;
        }

        // Distance to center as fallback
        const dist = Math.abs((p.xLeft + phraseWidth / 2) - def.centerX);
        if (dist < minDistance) {
          minDistance = dist;
          bestCol = c;
        }
      }

      if (bestCol !== -1) {
        const cell = rowCells[bestCol];
        const phraseWidth = p.xRight - p.xLeft;
        const phraseCenterX = p.xLeft + phraseWidth / 2;
        const colInfo = columnDef[bestCol];
        const colWidth = colInfo.xEnd - colInfo.xStart;

        // Detect centering: if center of phrase is near center of column (10% tolerance)
        if (Math.abs(phraseCenterX - colInfo.centerX) < colWidth * 0.1) {
          cell.align = 'center';
        }

        cell.text = (cell.text + " " + p.text).trim();
        cell.tokens.push(...p.tokens);
      }
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

    // Conta colunas com texto em cada row
    const lastFilled = lastRow.filter(c => c.text.length > 0).length;
    const currFilled = currentRow.filter(c => c.text.length > 0).length;

    // Verifica colisão: colunas com texto nos dois rows
    let collisionCols = 0;
    for (let c = 0; c < columnCount; c++) {
      if (lastRow[c].text.length > 0 && currentRow[c].text.length > 0) collisionCols++;
    }

    // Sem colisão → merge normal (preenche células vazias)
    if (collisionCols === 0) {
      for (let c = 0; c < columnCount; c++) {
        if (currentRow[c].text.length > 0) {
          lastRow[c].text = currentRow[c].text;
          lastRow[c].tokens.push(...currentRow[c].tokens);
        }
      }
      continue;
    }

    // Com colisão: verifica se o row atual é uma continuação de célula quebrada.
    // Critério: row atual tem poucas colunas preenchidas (≤ metade) E o texto
    // das colunas em colisão parece ser continuação.
    const isContinuation = currFilled <= Math.ceil(columnCount / 2) &&
      currentRow.every((cell, c) => {
        if (cell.text.length === 0) return true;
        if (lastRow[c].text.length === 0) return true; // sem colisão nessa col
        const t = cell.text.trim();
        const prev = lastRow[c].text.trim();

        // Caso 1: só números ou fragmento numérico (ex: RG quebrado "32.6 18", Id Funcional)
        if (/^\d[\d.\s]*$/.test(t)) return true;

        // Caso 2: texto curto sem vírgula (ex: fragmento de horário, OBM)
        if (t.length < 30 && !/,/.test(t)) return true;

        // Caso 3: continuação de texto descritivo — linha atual começa com minúscula
        // ou com preposição/artigo (ex: "e Reciclagem de Motoristas")
        if (/^[a-záéíóúâêîôûãõç]/.test(t)) return true;
        if (/^(e|de|do|da|dos|das|em|no|na|nos|nas|com|para)\s/i.test(t)) return true;

        // Caso 4: fragmento de Id Funcional ou RG (continuação de linha de militar)
        if (/^Id\s*Funcional\s+\d+/i.test(t)) return true;
        if (/^RG\s+\d+/i.test(t)) return true;

        // Caso 5: linha anterior não termina com pontuação forte E linha atual
        // não começa com padrão de nova entrada (posto militar, número de item)
        const prevEndsClean = !/[.;!?]$/.test(prev);
        // Nova entrada: começa com posto/graduação militar OU número de item de lista
        const currIsNewEntry = /^(Cap|Ten|Cel|Maj|Sgt|Cb|Sd|BM)\s/i.test(t) ||
                               /^\d+[.)]\s/.test(t);
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
