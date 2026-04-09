
export interface MilitaryPerson {
  nomeCompleto: string;
  nomeGuerra?: string; 
  rg?: string;         
  idFuncional?: string;
  postoGraduacao?: string;
  obmDbm?: string;
  regiao?: string;
}

export interface TextToken {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page?: number;
  isBold?: boolean;
  isUnderlined?: boolean;
  fontSize?: number;
}

export interface TableCell {
  text: string;
  tokens: TextToken[];
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableData {
  rows: TableCell[][];
  headers?: string[];
  columnCount: number;
  rowCount: number;
}

export interface SearchPreferences {
  useIdFuncional: boolean;
  useRg: boolean;
  useNomeGuerra: boolean;
  rgFormat5Digit: boolean;
  rgFormat7Digit: boolean;
}

export enum MatchType {
  UNIT_KEYWORD = 'PALAVRA_CHAVE_UNIDADE',
  PERSONNEL = 'MILITAR_ENCONTRADO',
  UNKNOWN = 'OUTRO'
}

export interface ExtractionResult {
  id: string;
  type: MatchType;
  matchedText: string;
  section?: string;
  sectionBody?: string;
  sectionFooter?: string;
  relatedContent?: string;
  context: string;
  pageNumber?: number;
  relevanceScore: number;
  confidenceLevel?: 'High' | 'Medium' | 'Low';
  person?: MilitaryPerson;
  isTableRow?: boolean;
  userCorrection?: string;
  userSectionBodyCorrection?: string;
  userSectionTitleCorrection?: string;
}

export interface BulletinNota {
  id: string;
  title: string;
  hierarchy: string;
  /** Caminho hierárquico como array (ex: ["3ª PARTE", "II - ASSUNTOS ADMINISTRATIVOS", "B - ALTERAÇÕES DE PRAÇAS"]).
   *  Preferir este campo em vez de fazer split('>') em `hierarchy`. */
  hierarchyPath?: string[];
  contentMarkdown: string;
  tables?: TableData[];
  pageNumber?: number;
  isHeaderOnly?: boolean;
  isRelevant?: boolean;
  matchedEntities?: string[];
  /** Emissor da nota (ex: "CI/JD", "DGP/GAB.DIR.", "DI/DIV.INST/CSMONT") */
  notaEmissor?: string;
  /** Número/ano da nota (ex: "123/2026") */
  notaNumero?: string;
}

export interface AnalysisState {
  isProcessing: boolean;
  stage: 'idle' | 'parsing_excel' | 'parsing_pdf' | 'analyzing_ai' | 'complete' | 'error';
  errorMessage?: string;
}

export interface StoredBulletin {
  id: string;
  filename: string;
  dateProcessed: string;
  notas: BulletinNota[];
}

/** Nota salva manualmente pelo usuário para análise de qualidade */
export interface SavedNota {
  id: string;
  notaId: string;
  notaTitle: string;
  notaContent: string;
  bulletinFilename: string;
  savedAt: string;
  observation?: string;
}
