/**
 * TableValidator
 *
 * Camada de validação e correção que envolve o TableReconstructor.
 *
 * Responsabilidades:
 *  1. Classificar o tipo de tabela (delega para tableTypes.classifyTableType)
 *  2. Reconstruir com a estratégia auto do TableReconstructor
 *  3. Validar o resultado por coluna com score 0-1
 *  4. Aplicar correções automáticas (RG partido, ID partido, OBM multiline)
 *  5. Retry com estratégia alternativa se overallScore < RETRY_THRESHOLD
 *
 * NÃO duplica:
 *  - getSemanticScore  → tableTypes.ts
 *  - SINGLE_COL_LIST_RE → tableTypes.ts
 *  - normalizeCellText  → textUtils.ts (já corrige RG/ID no nível de token)
 *  - merge multirow     → TableReconstructor já faz no passo 4c/6
 */

import { TextToken, TableData, TableCell } from "../types";
import {
  reconstructTable,
  reconstructTableByTemplate,
  reconstructTableByBorders,
  reconstructTableAsLayout,
} from "./TableReconstructor";
import { normalizeCellText } from "./textUtils";
import {
  TableType,
  classifyTableType,
  COLUMN_VALIDATION_PATTERNS,
} from "./tableTypes";

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type { TableType };

export interface ColumnValidation {
  colIndex: number;
  header: string;
  /** 0-1: proporção de células que batem o padrão esperado */
  score: number;
  /** Primeiros 3 exemplos de células que não bateram o padrão */
  issues: string[];
}

export interface TableValidationReport {
  tableType: TableType;
  /** Estratégia que produziu o resultado final */
  strategy: "AUTO" | "TEMPLATE" | "BORDER" | "LAYOUT";
  overallScore: number;
  columnValidations: ColumnValidation[];
  /** Descrição das correções aplicadas automaticamente */
  corrections: string[];
  /** true quando overallScore < RETRY_THRESHOLD após todas as tentativas */
  needsManualReview: boolean;
}

export interface ValidatedTable {
  data: TableData;
  report: TableValidationReport;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const RETRY_THRESHOLD = 0.6;

// ─── Validação por coluna ────────────────────────────────────────────────────

const validateColumns = (data: TableData): ColumnValidation[] => {
  if (data.rows.length < 2) return [];

  const dataRows = data.rows.slice(1); // pula cabeçalho

  return data.rows[0].map((headerCell, colIdx) => {
    const header = headerCell.text.replace(/\*\*/g, "").trim().toUpperCase();

    // Encontra o padrão cujo key é substring do cabeçalho
    const pattern = Object.entries(COLUMN_VALIDATION_PATTERNS).find(([key]) =>
      header.includes(key)
    )?.[1];

    const issues: string[] = [];
    let matches = 0;
    let total = 0;

    for (const row of dataRows) {
      const cell = row[colIdx];
      if (!cell || cell.text.trim() === "") continue;
      total++;

      if (pattern) {
        if (pattern.test(cell.text.replace(/\*\*/g, "").trim())) {
          matches++;
        } else if (issues.length < 3) {
          issues.push(`"${cell.text.trim()}" ≠ padrão ${header}`);
        }
      } else {
        matches++; // sem padrão definido → aceita tudo
      }
    }

    return {
      colIndex: colIdx,
      header,
      score: total > 0 ? matches / total : 1,
      issues,
    };
  });
};

const overallScore = (validations: ColumnValidation[]): number =>
  validations.length > 0
    ? validations.reduce((s, v) => s + v.score, 0) / validations.length
    : 1;

// ─── Correções pós-reconstrução ──────────────────────────────────────────────
// normalizeCellText (textUtils) já corrige RG/ID no nível de token durante a
// reconstrução. Aqui fazemos uma segunda passagem focada em artefatos que só
// aparecem depois que as células são montadas (ex: OBM multiline).

/**
 * Merge de OBM multiline: célula OBM vazia + linha seguinte com só OBM → absorve.
 * Não duplica o merge multirow do TableReconstructor (que opera por Y-gap);
 * este opera sobre o resultado final já montado.
 */
const mergeObmMultiline = (data: TableData, corrections: string[]): TableData => {
  if (data.rows.length < 2) return data;

  const headers = data.rows[0].map(c =>
    c.text.replace(/\*\*/g, "").trim().toUpperCase()
  );
  const obmCol = headers.findIndex(
    h => h.includes("OBM") || h.includes("DBM") || h.includes("GBM")
  );
  if (obmCol < 0) return data;

  const newRows: TableCell[][] = [data.rows[0]];
  let i = 1;
  while (i < data.rows.length) {
    const row  = data.rows[i];
    const next = data.rows[i + 1];

    const obmEmpty    = row[obmCol]?.text.trim() === "";
    const nextOnlyObm = next?.every((c, ci) => ci === obmCol || c.text.trim() === "");

    if (obmEmpty && next && nextOnlyObm) {
      const merged = row.map((c, ci) =>
        ci === obmCol ? { ...c, text: next[obmCol].text.trim() } : c
      );
      corrections.push(`OBM multiline (linha ${i}): "${next[obmCol].text.trim()}"`);
      newRows.push(merged);
      i += 2;
    } else {
      newRows.push(row);
      i++;
    }
  }

  return { ...data, rows: newRows, rowCount: newRows.length };
};

/**
 * Normaliza todas as células com normalizeCellText (fonte única de correção de
 * RG partido, ID partido, horários, etc.).
 */
const normalizeCells = (data: TableData): TableData => ({
  ...data,
  rows: data.rows.map(row =>
    row.map(cell =>
      cell.text ? { ...cell, text: normalizeCellText(cell.text) } : cell
    )
  ),
});

// ─── Retry com estratégia alternativa ───────────────────────────────────────

type Strategy = "AUTO" | "TEMPLATE" | "BORDER" | "LAYOUT";

const runStrategy = (strategy: Strategy, tokens: TextToken[]): TableData => {
  switch (strategy) {
    case "TEMPLATE": return reconstructTableByTemplate(tokens);
    case "BORDER":   return reconstructTableByBorders(tokens);
    case "LAYOUT":   return reconstructTableAsLayout(tokens);
    default:         return reconstructTable(tokens);
  }
};

/**
 * Ordem de retry por tipo de tabela.
 * A primeira estratégia é a preferida; as seguintes são tentadas se o score for baixo.
 */
const RETRY_ORDER: Record<TableType, Strategy[]> = {
  MILITARY_PERSONNEL: ["AUTO", "TEMPLATE", "BORDER"],
  INSPECTION:         ["AUTO", "TEMPLATE", "BORDER"],
  FISCAL:             ["AUTO", "BORDER",   "TEMPLATE"],
  SINGLE_COL_LIST:    ["AUTO"],
  GENERIC:            ["AUTO", "BORDER",   "LAYOUT"],
};

// ─── Ponto de entrada principal ──────────────────────────────────────────────

export const validateAndReconstruct = (
  tokens: TextToken[],
  // rawLines mantido na assinatura para compatibilidade futura (bridge multi-página)
  _rawLines?: { text: string; tokens: TextToken[]; y: number; isBridge?: boolean }[]
): ValidatedTable => {
  if (tokens.length === 0) {
    return {
      data: { rows: [], columnCount: 0, rowCount: 0 },
      report: {
        tableType: "GENERIC",
        strategy: "AUTO",
        overallScore: 1,
        columnValidations: [],
        corrections: [],
        needsManualReview: false,
      },
    };
  }

  const corrections: string[] = [];
  const tableType = classifyTableType(tokens);
  const strategies = RETRY_ORDER[tableType];

  let bestData: TableData = { rows: [], columnCount: 0, rowCount: 0 };
  let bestScore = -1;
  let bestStrategy: Strategy = "AUTO";
  let bestValidations: ColumnValidation[] = [];

  for (const strategy of strategies) {
    let data = runStrategy(strategy, tokens);
    data = normalizeCells(data);
    data = mergeObmMultiline(data, corrections);

    const validations = validateColumns(data);
    const score = overallScore(validations);

    console.log(
      `[TableValidator] tipo=${tableType} estratégia=${strategy} score=${score.toFixed(2)} cols=${data.columnCount} rows=${data.rowCount}`
    );

    if (score > bestScore) {
      bestScore      = score;
      bestData       = data;
      bestStrategy   = strategy;
      bestValidations = validations;
    }

    if (score >= RETRY_THRESHOLD) break; // bom o suficiente, para aqui
  }

  // Log de issues
  const allIssues = bestValidations.flatMap(v => v.issues);
  if (allIssues.length > 0) {
    console.warn(
      `[TableValidator] Issues (score=${bestScore.toFixed(2)}, estratégia=${bestStrategy}):`,
      allIssues
    );
  }
  if (corrections.length > 0) {
    console.log(`[TableValidator] Correções:`, corrections);
  }

  return {
    data: bestData,
    report: {
      tableType,
      strategy: bestStrategy,
      overallScore: bestScore,
      columnValidations: bestValidations,
      corrections,
      needsManualReview: bestScore < RETRY_THRESHOLD,
    },
  };
};
