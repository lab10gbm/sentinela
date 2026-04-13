/**
 * TablePatternAnalyzer
 *
 * Analisa o padrão semântico e posicional de linhas de dados militares para:
 *  1. inferColumnBoundaries — aprende os limites reais de cada coluna a partir
 *     das primeiras linhas de dados (não do cabeçalho empilhado).
 *  2. isTableContinuation — pontua 0-1 se uma linha é continuação da tabela,
 *     mesmo quando detectTableStructure() retorna false (ex: linhas 18-28+
 *     após quebra de página sem gaps geométricos suficientes).
 *
 * Stateless: recebe tokens, retorna análise. Sem efeitos colaterais.
 */

import { TextToken } from "../types";
import {
  MILITARY_RANK_RE,
  MILITARY_CADRE_RE,
} from "./tableTypes";

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface ColumnBoundary {
  /** Rótulo semântico da coluna */
  label: "QTD" | "POSTO/GRAD." | "NOME" | "RG" | "ID FUNCIONAL" | "OBM";
  xStart: number;
  xEnd: number;
  centerX: number;
}

export interface PatternAnalysis {
  boundaries: ColumnBoundary[];
  /** Número de linhas de dados usadas para inferir as boundaries */
  sampledLines: number;
  /** Score médio de confiança das boundaries (0-1) */
  confidence: number;
}

// ─── Constantes internas ─────────────────────────────────────────────────────

/** Regex para RG no formato "NN.NNN" ou "N.NNN" */
const RG_RE = /^\d{1,2}\.\d{3}$/;

/** Regex para ID Funcional (7-10 dígitos) */
const ID_RE = /^\d{7,10}$/;

/** Regex para QTD (1-3 dígitos isolados) */
const QTD_RE = /^\d{1,3}$/;

/** Regex para OBM — unidade operacional do CBMERJ */
const OBM_RE = /GBM|GMar|DBM|CER|ABMDP|\d+[º°]\s*G[BM]|BM\/\d+|Bandeirantes|Copacabana|Tijuca|Niter[oó]i|Caxias|Catete|Botafogo/i;

/** Número mínimo de linhas de dados para inferir boundaries com confiança */
const MIN_SAMPLE_LINES = 2;

/** Número máximo de linhas de dados a amostrar */
const MAX_SAMPLE_LINES = 5;

// ─── Classificação semântica de token ────────────────────────────────────────

type ColumnLabel = ColumnBoundary["label"];

/**
 * Tenta classificar o texto de um token em uma das 6 colunas militares.
 * Retorna null se não for possível classificar com confiança.
 */
const classifyToken = (text: string): ColumnLabel | null => {
  const t = text.replace(/\*\*/g, "").trim();
  if (!t) return null;

  if (QTD_RE.test(t)) return "QTD";
  if (RG_RE.test(t)) return "RG";
  if (ID_RE.test(t)) return "ID FUNCIONAL";
  if (MILITARY_RANK_RE.test(t) || MILITARY_CADRE_RE.test(t)) return "POSTO/GRAD.";
  if (OBM_RE.test(t)) return "OBM";

  // NOME: texto alfabético puro, sem dígitos, 3+ chars
  const isAlpha = /^[A-ZÀ-Ú\s.\-'/]+$/i.test(t) && !/\d/.test(t) && t.length >= 3;
  // Exclui postos/graduações já capturados acima
  if (isAlpha && !MILITARY_RANK_RE.test(t)) return "NOME";

  return null;
};

// ─── Agrupamento de tokens por linha Y ───────────────────────────────────────

interface TokenLine {
  y: number;
  page: number;
  tokens: TextToken[];
}

const groupByY = (tokens: TextToken[]): TokenLine[] => {
  const Y_EPSILON = 5;
  const map = new Map<number, TextToken[]>();

  for (const t of tokens) {
    const key = Math.round(t.y / Y_EPSILON) * Y_EPSILON;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b - a) // PDF: Y decresce de cima para baixo
    .map(([y, toks]) => ({
      y,
      page: toks[0].page ?? 0,
      tokens: toks.sort((a, b) => a.x - b.x),
    }));
};

// ─── Inferência de boundaries por histograma ─────────────────────────────────

/**
 * Analisa os tokens das primeiras linhas de dados (não do cabeçalho) para
 * inferir os limites físicos reais de cada coluna.
 *
 * Algoritmo:
 *  1. Para cada token, classifica semanticamente (QTD, POSTO, NOME, RG, ID, OBM)
 *  2. Acumula posições X por label em um histograma
 *  3. Calcula o centerX de cada label como mediana das posições observadas
 *  4. Deriva xStart/xEnd pelos gutters entre colunas adjacentes
 */
export const inferColumnBoundaries = (
  dataTokens: TextToken[]
): PatternAnalysis => {
  const lines = groupByY(dataTokens);

  // Filtra linhas que parecem ser cabeçalho (sem tokens classificáveis como dados)
  const dataLines = lines.filter(line => {
    const classified = line.tokens.filter(t => classifyToken(t.text) !== null);
    return classified.length >= 2; // linha de dados tem pelo menos 2 campos reconhecíveis
  });

  const sample = dataLines.slice(0, MAX_SAMPLE_LINES);
  if (sample.length < MIN_SAMPLE_LINES) {
    console.log(`[PatternAnalyzer] Amostras insuficientes: ${sample.length}/${MIN_SAMPLE_LINES}`);
    return { boundaries: [], sampledLines: sample.length, confidence: 0 };
  }

  // Acumula posições X por label
  const xPositions: Record<ColumnLabel, number[]> = {
    "QTD": [],
    "POSTO/GRAD.": [],
    "NOME": [],
    "RG": [],
    "ID FUNCIONAL": [],
    "OBM": [],
  };

  for (const line of sample) {
    for (const tok of line.tokens) {
      const label = classifyToken(tok.text);
      if (label) {
        xPositions[label].push(tok.x);
      }
    }
  }

  // Calcula mediana de X para cada label com pelo menos 1 observação
  const COLUMN_ORDER: ColumnLabel[] = ["QTD", "POSTO/GRAD.", "NOME", "RG", "ID FUNCIONAL", "OBM"];

  const centers: { label: ColumnLabel; centerX: number; count: number }[] = [];
  for (const label of COLUMN_ORDER) {
    const xs = xPositions[label];
    if (xs.length === 0) continue;
    xs.sort((a, b) => a - b);
    const median = xs[Math.floor(xs.length / 2)];
    centers.push({ label, centerX: median, count: xs.length });
  }

  if (centers.length < 2) {
    console.log(`[PatternAnalyzer] Colunas detectadas insuficientes: ${centers.length}`);
    return { boundaries: [], sampledLines: sample.length, confidence: 0 };
  }

  // Ordena por centerX (esquerda → direita)
  centers.sort((a, b) => a.centerX - b.centerX);

  // Deriva xStart/xEnd pelos gutters entre colunas adjacentes
  const boundaries: ColumnBoundary[] = [];
  for (let i = 0; i < centers.length; i++) {
    const prev = centers[i - 1];
    const next = centers[i + 1];
    const xStart = prev ? (prev.centerX + centers[i].centerX) / 2 : 0;
    const xEnd = next ? (centers[i].centerX + next.centerX) / 2 : 9999;
    boundaries.push({
      label: centers[i].label,
      xStart,
      xEnd,
      centerX: centers[i].centerX,
    });
  }

  // Confiança: proporção de colunas esperadas que foram detectadas
  const confidence = centers.length / COLUMN_ORDER.length;

  console.log(
    `[PatternAnalyzer] inferColumnBoundaries: ${centers.length} colunas detectadas, ` +
    `confiança=${confidence.toFixed(2)}, amostras=${sample.length}\n` +
    boundaries.map(b => `  ${b.label}: x=[${Math.round(b.xStart)}-${Math.round(b.xEnd)}] center=${Math.round(b.centerX)}`).join("\n")
  );

  return { boundaries, sampledLines: sample.length, confidence };
};

// ─── Score de continuação ─────────────────────────────────────────────────────

/**
 * Retorna score 0-1 indicando se a linha é continuação da tabela.
 *
 * Algoritmo:
 *  1. Para cada token da linha, verifica se seu X cai dentro de algum ColumnBoundary
 *  2. Verifica se o conteúdo bate o padrão semântico da coluna
 *  3. Score = (tokens alinhados com padrão) / (total de tokens classificáveis)
 *
 * Um score ≥ 0.7 indica continuação confiável.
 */
export const isTableContinuation = (
  line: { text: string; tokens: TextToken[] },
  boundaries: ColumnBoundary[]
): number => {
  if (boundaries.length === 0) return 0;

  const tokens = line.tokens.filter(t => t.text.trim().length > 0);
  if (tokens.length === 0) return 0;

  let aligned = 0;
  let classifiable = 0;

  for (const tok of tokens) {
    const label = classifyToken(tok.text);
    if (!label) continue; // token não classificável (artigos, preposições, etc.)
    classifiable++;

    // Verifica se o token cai na boundary esperada para seu label
    const expectedBoundary = boundaries.find(b => b.label === label);
    if (!expectedBoundary) continue;

    const tokCenterX = tok.x + (tok.w ?? 0) / 2;
    const inBoundary =
      tokCenterX >= expectedBoundary.xStart && tokCenterX <= expectedBoundary.xEnd;

    if (inBoundary) {
      aligned++;
    } else {
      // Tolerância: até 20px fora da boundary (variação de layout entre páginas)
      const nearBoundary =
        tokCenterX >= expectedBoundary.xStart - 20 &&
        tokCenterX <= expectedBoundary.xEnd + 20;
      if (nearBoundary) aligned += 0.5;
    }
  }

  if (classifiable === 0) {
    // Linha sem tokens classificáveis — verifica se tem padrão de dado militar pelo texto
    const plain = line.text.replace(/\*\*/g, "").trim();
    const hasMilitaryPattern =
      MILITARY_RANK_RE.test(plain) ||
      RG_RE.test(plain) ||
      ID_RE.test(plain) ||
      QTD_RE.test(plain);
    return hasMilitaryPattern ? 0.5 : 0;
  }

  const score = aligned / classifiable;
  return Math.min(1, score);
};

// ─── Análise rápida de linha (sem boundaries) ────────────────────────────────

/**
 * Verifica se uma linha tem padrão de dado militar sem precisar de boundaries.
 * Útil para o bridge scan quando ainda não há boundaries calculadas.
 *
 * Retorna true se a linha contém pelo menos 2 campos militares reconhecíveis.
 */
export const hasMilitaryDataPattern = (
  line: { text: string; tokens: TextToken[] }
): boolean => {
  const tokens = line.tokens.filter(t => t.text.trim().length > 0);
  const classified = tokens.filter(t => classifyToken(t.text) !== null);
  if (classified.length >= 2) return true;

  // Fallback: analisa o texto completo da linha
  const plain = line.text.replace(/\*\*/g, "").trim();

  // Rejeita padrões de rodapé/cabeçalho de página antes de qualquer análise
  if (/^F\s*L\s*[\.\s]*\d+$/i.test(plain)) return false;
  if (/^BOLETIM\s+DA\s+SEDEC/i.test(plain)) return false;
  if (/^\d{1,3}$/.test(plain)) return false; // número de página isolado

  const fields = [
    QTD_RE.test(plain.split(/\s+/)[0] ?? ""),
    MILITARY_RANK_RE.test(plain),
    RG_RE.test(plain),
    ID_RE.test(plain),
    OBM_RE.test(plain),
  ];
  return fields.filter(Boolean).length >= 2;
};
