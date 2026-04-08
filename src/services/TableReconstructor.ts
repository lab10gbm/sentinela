import { TextToken, TableData, TableCell } from "../types";
import { isTableHeader, normalizeCellText } from "./textUtils";

/**
 * TableReconstructor v4
 * 
 * Template-Based Structural Extraction:
 *  1. Identifies the "First Line" (Header) that defines the table structure.
 *  2. Uses X-coordinates of header cells as fixed column boundaries.
 *  3. Maps all subsequent phrases to these boundaries, preventing cell merging.
 */
export const reconstructTable = (tokens: TextToken[]): TableData => {
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
