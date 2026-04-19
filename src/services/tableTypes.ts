/**
 * tableTypes.ts — Fonte única de verdade para tipos, padrões e constantes de tabela.
 *
 * Importado por: TableReconstructor, TableValidator, textUtils, bulletinParserService.
 * Nenhum desses arquivos deve redefinir o que está aqui.
 */

import { TextToken } from "../types";

// ─── Lista taxativa de postos e graduações do CBMERJ ────────────────────────
// Ordem hierárquica crescente. FONTE ÚNICA — usar MILITARY_RANK_RE em todo o projeto.
//
// Praças:    Sd → Cb → 3º Sgt → 2º Sgt → 1º Sgt → Subten
// Oficiais:  2º Ten → 1º Ten → Cap → Maj → Ten Cel → Cel → Gen
// Especiais: Al Sd (aluno soldado)
//
// Variações cobertas:
//   - Com/sem "BM" após o posto:  "Maj BM", "Maj"
//   - Ordinal com/sem acento:     "1º Sgt", "1o Sgt", "1° Sgt"
//   - Ten Cel abreviado:          "TC BM", "Ten Cel"
//   - Subten abreviado:           "ST BM", "Subten"
//   - Aluno soldado:              "Al Sd", "AL SD"

export const MILITARY_RANKS = [
  // Praças
  "Sd",
  "Cb",
  "3º Sgt", "3o Sgt", "3° Sgt",
  "2º Sgt", "2o Sgt", "2° Sgt",
  "1º Sgt", "1o Sgt", "1° Sgt",
  "Subten", "ST",
  // Oficiais intermediários
  "2º Ten", "2o Ten", "2° Ten",
  "1º Ten", "1o Ten", "1° Ten",
  "Cap",
  // Oficiais superiores
  "Maj",
  "Ten Cel", "TC",
  "Cel",
  // Generais
  "Gen",
  // Aluno
  "Al Sd", "AL SD",
] as const;

/**
 * Regex que casa qualquer posto/graduação do CBMERJ no início de uma string.
 * Cobre todas as variações da lista acima, com ou sem "BM" após o posto.
 *
 * Exemplos que casam:
 *   "Maj BM QOC/09"  →  "Maj"
 *   "1º Sgt BM"      →  "1º Sgt"
 *   "Ten Cel BM"     →  "Ten Cel"
 *   "Subten BM"      →  "Subten"
 *   "Sd BM"          →  "Sd"
 *   "Al Sd BM"       →  "Al Sd"
 */
export const MILITARY_RANK_RE =
  /^(?:Al\s+Sd|AL\s+SD|Ten\s+Cel|TC|Subten|ST|[123]º\s*Sgt|[123]o\s*Sgt|[123]°\s*Sgt|[12]º\s*Ten|[12]o\s*Ten|[12]°\s*Ten|Gen|Cel|Maj|Cap|Sgt|Cb|Sd)\b/i;

/**
 * Regex para o quadro/ano que segue o posto na coluna POSTO/GRAD.
 * Exemplos: QOC/09, Q08/97, Q10/02, Q00/00, QBMP/15, QOS/03
 */
export const MILITARY_CADRE_RE = /^Q[A-Z0-9]{2,}\/\d{2,}\b/i;

// ─── Tipo de tabela ──────────────────────────────────────────────────────────

export type TableType =
  | "MILITARY_PERSONNEL" // QTD | POSTO/GRAD. | NOME | RG | ID FUNCIONAL | OBM
  | "INSPECTION"         // GRAD/QBMP/ANO | NOME | RG | OBM | INSP
  | "FISCAL"             // GRAD/QBMP/ANO | RG | FISCAL | UNIDADE
  | "SINGLE_COL_LIST"    // MILITAR / DEMAIS FORÇAS / CIVIS — lista de pessoal coluna única
  | "GENERIC";

// ─── Regex de cabeçalho de lista de pessoal (coluna única) ──────────────────
// FONTE ÚNICA — não redefinir em textUtils, bulletinParserService ou TableValidator.

export const SINGLE_COL_LIST_RE =
  /^(MILITAR|MILITARES|DEMAIS\s+FOR[ÇC]AS?|CIVIS?|NOME|POLICIAIS?\s+MILITARES?|BOMBEIROS?\s+MILITARES?|AGRACIADOS?|PARTICIPANTES?|RELACIONADOS?|INSCRITOS|CANDIDATOS)$/i;

// ─── Classificação de tipo pelo texto dos tokens ─────────────────────────────

const MILITARY_PERSONNEL_RE = /QTD.*POSTO|POSTO.*NOME|NOME.*RG|RG.*ID\s*FUNC/i;
const INSPECTION_RE          = /GRAD.*QBMP|INSP[EÇ]/i;
const FISCAL_RE              = /FISCAL.*UNIDADE|UNIDADE.*FISCAL/i;

export const classifyTableType = (tokens: TextToken[]): TableType => {
  const allText = tokens.map(t => t.text).join(" ");
  if (SINGLE_COL_LIST_RE.test(allText.trim()))    return "SINGLE_COL_LIST";
  if (MILITARY_PERSONNEL_RE.test(allText))         return "MILITARY_PERSONNEL";
  if (INSPECTION_RE.test(allText))                 return "INSPECTION";
  if (FISCAL_RE.test(allText))                     return "FISCAL";
  return "GENERIC";
};

// ─── Padrões de validação por coluna ────────────────────────────────────────
// Chave = substring do cabeçalho (uppercase). Valor = regex que a célula deve bater.

export const COLUMN_VALIDATION_PATTERNS: Record<string, RegExp> = {
  "QTD":          /^\d{1,3}$/,
  // POSTO/GRAD.: aceita posto isolado ou posto + quadro/ano (ex: "Maj BM QOC/09")
  "POSTO/GRAD":   MILITARY_RANK_RE,
  "NOME":         /^[A-ZÀ-Ú\s.\-'/]+$/i,
  // RG: formato NN.NNN — aceita mesmo com bold markers ou sobrenome colado
  "RG":           /\d{1,2}\.\d{3}/,
  "ID FUNCIONAL": /\d{7,10}/,
  "FUNCIONAL":    /\d{7,10}/,
  // OBM/UNIDADE: qualquer texto não-vazio — unidades do CBMERJ têm nomes variados
  "OBM":          /\S/,
  "UNIDADE":      /\S/,
  // MILITAR: posto+nome completo (pode conter RG, Id Funcional embutidos)
  "MILITAR":      /\S/,
  "GRAD/QBMP":    MILITARY_RANK_RE,
  "INSP":         /^(Apto|Inapto|Dispensado|Apto\s+com)/i,
  "FISCAL":       /^[A-ZÀ-Ú\s]+$/i,
};

// ─── Score semântico por tipo de coluna ─────────────────────────────────────
// Usado pelo TableReconstructor (motor de atribuição de célula a coluna).
// FONTE ÚNICA — remove a versão privada de TableReconstructor.ts.

export const getSemanticScore = (text: string, columnType: string): number => {
  const up = text.replace(/\*\*/g, "").toUpperCase().trim();
  if (!up) return 0;

  const type = columnType.toUpperCase();

  if (type.includes("QTD") || type.includes("ORDEM"))
    return /^\d{1,3}$/.test(up) ? 1 : 0;

  if (type.includes("POSTO") || type.includes("GRAD")) {
    const hasRank  = MILITARY_RANK_RE.test(up);
    const hasCadre = MILITARY_CADRE_RE.test(up);
    if (hasRank && hasCadre) return 1;
    if (hasRank || hasCadre) return 0.8;
    return 0;
  }

  if (type.includes("RG")) {
    if (/^\d{1,2}\.\d{3}$/.test(up)) return 1;
    if (/^\d{5,7}$/.test(up))        return 0.9;
    return 0;
  }

  if (type.includes("ID") || type.includes("FUNCIONAL"))
    return /^\d{7,10}$/.test(up) ? 1 : 0;

  if (type.includes("OBM") || type.includes("DBM") || type.includes("GBM")) {
    if (/\d+[º°]\s*G[BM]|DBM\s*\d+\/\d+|\d+\s*G[BM]/.test(up)) return 1;
    if (/GBM|GMAR|DBM|CER|ABMDP|CATETE|COPACABANA|BOTAFOGO|TIJUCA|CAXIAS|NITER[ÓO]I/i.test(up)) return 0.9;
    return 0;
  }

  if (type.includes("NOME")) {
    const nameOnly = /^[A-ZÀ-Ú\s.\-'/]+$/i.test(up) && !/\d/.test(up);
    if (nameOnly && up.length > 3) return 1;
    if (nameOnly) return 0.8;
    return 0;
  }

  if (type.includes("INSP"))
    return /^(APTO|INAPTO|DISPENSADO)/i.test(up) ? 1 : 0;

  return 0; // tipo desconhecido → neutro
};
