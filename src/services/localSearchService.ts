
import { ExtractionResult, MatchType, MilitaryPerson, SearchPreferences, TextToken } from "../types";
import {
  normalizeSpaces,
  isVisualHeader,
  isTOCLine,
  isPageHeaderOrFooter,
  formatOfficialDocumentText,
  cleanHeaderTitle,
  REGEX_PARTE_PREFIX,
  REGEX_EIXO_PREFIX,
  REGEX_ITEM_PREFIX,
  detectTableStructure,
  isTableHeader,
} from "./textUtils";
import { isAllowedEixoForParte, SectionStackItem } from "./hierarchyService";

/**
 * Escapa caracteres especiais para Regex.
 */
const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Normaliza texto simples (Remove acentos, lower case).
 */
const normalizeSimple = (text: string): string => {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "") 
    .trim();
};

/**
 * Normaliza texto para BUSCA ROBUSTA (Remove acentos, lower case E ESPAÇOS).
 */
const normalizeForSearch = (text: string): string => {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, ""); 
};

/**
 * Verifica se a keyword é do tipo numérico "X/Y" (ex: "2/10", "4/10").
 */
const isNumericUnitKeyword = (keyword: string): boolean => {
    return /^\d{1,2}\s*\/\s*\d{1,2}$/.test(keyword.trim());
};

/**
 * Cria um Regex "Fuzzy" para números (RG/ID).
 */
const createFuzzyNumberRegex = (cleanNumber: string): RegExp => {
  const pattern = cleanNumber.split('').join('[\\.\\.\\-\\\\s]*'); 
  return new RegExp(`(?:^|[^0-9])0*${pattern}(?![\\\\d])`, 'gi');
};

/**
 * Cria um Regex "Fuzzy" para nomes.
 */
const createFuzzyNameRegex = (name: string): RegExp => {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const parts = cleanName.split(' ');
  const fuzzyParts = parts.map(part => {
    return part.split('').map(char => escapeRegExp(char)).join('\\s*');
  });
  return new RegExp(`\\b${fuzzyParts.join('\\s+')}\\b`, 'gi');
};

const RANK_VARIATIONS: Record<string, string[]> = {
  'SD': ['sd', 'soldado', 'sc'],
  'CB': ['cb', 'cabo'],
  'SGT': ['sgt', 'sargento', '1 sgt', '2 sgt', '3 sgt', '1º sgt', '2º sgt', '3º sgt'],
  'SUBTEN': ['subten', 'subtenente', 'sub ten', 'sub-ten'],
  'ASP': ['asp', 'aspirante'],
  'TEN': ['ten', 'tenente', '1 ten', '2 ten', '1º ten', '2º ten'],
  'CAP': ['cap', 'capitao'],
  'MAJ': ['maj', 'major'],
  'CEL': ['cel', 'coronel', 'ten cel', 'ten-cel', 'tencel'],
};

const extractRankFromText = (text: string): string | null => {
  const normalized = normalizeSimple(text);
  for (const [rank, variations] of Object.entries(RANK_VARIATIONS)) {
    for (const v of variations) {
      if (new RegExp(`\\b${v}\\b`).test(normalized)) return rank;
    }
  }
  return null;
};

const isNoiseLine = (text: string): boolean => {
  if (!text) return true;
  const hasWideSpaces = /\s{2,}/.test(text);
  const looksLikeTableRow = detectTableStructure(text);
  const looksLikeMilitaryItem = /^\s*(?:(?:\d+|[a-z])[\s.-]*)?(?:Sd|Cb|1º\s*Sgt|2º\s*Sgt|3º\s*Sgt|Subten|Asp|Ten|Cap|Maj|Cel|Ex-?Subten|Gen)\.?\s+BM/i.test(text);
  const looksLikeIdStart = /^\s*\d{3}[\.\\s]?\d{3}-\d\s+/i.test(text);
  return (hasWideSpaces && looksLikeTableRow) || looksLikeMilitaryItem || looksLikeIdStart;
};

// Removido isTableHeader local — agora em textUtils.ts

/**
 * REGEX PARA LINHA DE MILITAR
 */
const MILITAR_RECORD_PATTERN = /(?:Subten|1º\s+Sgt|2º\s+Sgt|3º\s+Sgt|Cb|Sd|Maj|Cap|Ten\s+Cel|Cel)\s+BM(?:\s+Q(?:[A-Z0-9]{2}\/?\d{2})?)?\s+([A-ZÀ-Ü\s\-—.,'´`´´\(\)]+?)(?:\s*,\s*RG\s*\d+\.\d{3})?(?:\s*,\s*Id\s+Funcional\s*\d+)?(?:\s+(\d{5,}))?(?:\s+[A-Z0-9À-Ü\s\/]+)?(?:[\s\S]*?(?:Revalidado|Convocado))?(?:[\s\S]*?(?:Apto|Inapto))?(?:[\s\S]*?(?:com\s+Diagnóstico|por\s+Pendência\s+de\s+Exames))?\b/i;

const isMilitaryRowStrict = (text: string): boolean => {
    return MILITAR_RECORD_PATTERN.test(text);
};

// --- PALAVRAS-CHAVE DE SUB-ITENS (BLACKLIST) ---
// Estes termos, se encontrados no início de um suposto "Item Nível 3", 
// indicam que NÃO é um novo item, mas sim parte do conteúdo interno da matéria.
const SUB_ITEM_KEYWORDS = [
  'FINALIDADE', 'OBJETIVO', 'OBJETIVOS', 'EXECUÇÃO', 'COORDENAÇÃO', 
  'UNIFORME', 'PRESCRIÇÕES', 'ANEXO', 'DISTRIBUIÇÃO', 'ÓRGÃOS ENVOLVIDOS',
  'LOCAL', 'DATA', 'HORÁRIO', 'PARTICIPANTES', 'UNIFORMES', 'MATERIAL',
  'REFERÊNCIA', 'PROGRAMAÇÃO'
];

/**
 * NOMES COMUNS (Industrial Rigor)
 * Nomes que ocorrem com alta frequência e exigem evidência adicional (Patente + Partes do Nome).
 */
const COMMON_NAMES = new Set([
  'silva', 'santos', 'oliveira', 'souza', 'rodrigues', 'ferreira', 'alves', 
  'pereira', 'lima', 'gomes', 'costa', 'ribeiro', 'martins', 'carvalho', 
  'almeida', 'lopes', 'soares', 'fernandes', 'vieira', 'barbosa'
]);

// --- INTEGRAÇÃO E ANÁLISE ---

/**
 * Motor Único de Avaliação de Match (Cérebro Industrial)
 * Aplica a "Lei do Combo" e a prioridade absoluta de RG/ID.
 */
export const evaluatePersonnelMatch = (
  lineText: string,
  person: MilitaryPerson,
  prefs: SearchPreferences,
  processedP?: any // Opcional: dados pré-processados (rank, cleanId, etc)
) => {
  const lineTextNorm = normalizeSimple(lineText);
  const lineTextClean = lineText.replace(/[^0-9a-zA-Z]/g, '');
  const isMilitary = isMilitaryRowStrict(lineText);

  // Dados do militar
  const p = processedP || {
    cleanId: person.idFuncional ? person.idFuncional.replace(/[^0-9]/g, '').replace(/^0+/, '') : null,
    cleanRg: person.rg ? person.rg.replace(/[^0-9]/g, '').replace(/^0+/, '') : null,
    rank: person.postoGraduacao ? extractRankFromText(person.postoGraduacao) : null,
    warNameParts: person.nomeGuerra ? normalizeSimple(person.nomeGuerra).split(' ').filter(x => x.length > 2) : []
  };

  let score = 0;
  let reasons: string[] = [];

  // Prio 1: ID MATCH (Certeza Absoluta — exige contexto "Id Funcional" ou "Id." próximo)
  if (prefs.useIdFuncional && p.cleanId && p.cleanId.length > 4) {
    if (lineTextClean.includes(p.cleanId)) {
      const regex = createFuzzyNumberRegex(p.cleanId);
      if (regex.test(lineText)) {
        // Verifica contexto: o número deve estar precedido de "Id" ou "Funcional" na linha
        const hasIdContext = /\bId(?:entifica[çc][aã]o)?\s*(?:Funcional)?\s*[:\s]/i.test(lineText) ||
                             /\bId\s*\.\s*Func/i.test(lineText);
        score = 100;
        reasons.push("ID Funcional");
        if (!hasIdContext) reasons.push("(sem contexto 'Id Funcional' — verificar)");
        return { score, reasons, confidence: "High" as const };
      }
    }
  }

  // Prio 2: RG MATCH (Certeza Absoluta — exige contexto "RG" próximo ao número)
  if (prefs.useRg && p.cleanRg && p.cleanRg.length > 4) {
    if (lineTextClean.includes(p.cleanRg)) {
      const regex = createFuzzyNumberRegex(p.cleanRg);
      if (regex.test(lineText)) {
        // Verifica contexto: o número deve estar precedido de "RG" na linha
        // Isso evita falsos positivos com números de processo, portaria, etc.
        const rgContextRegex = new RegExp(`\\bRG\\s*[:\\s]?\\s*[0-9.\\-\\s]*${p.cleanRg.split('').join('[.\\-\\s]*')}`, 'i');
        const hasRgContext = rgContextRegex.test(lineText);
        if (!hasRgContext) {
          // Sem contexto "RG", não é certeza — cai para avaliação por nome
        } else {
          score = 100;
          reasons.push("RG");
          return { score, reasons, confidence: "High" as const };
        }
      }
    }
  }

  // Prio 3: NOME — no extrator de boletim, nome isolado NUNCA é suficiente para confirmar
  // pertencimento ao efetivo. Apenas RG ou ID Funcional têm essa certeza.
  // O match por nome fica reservado para a varredura local (analyzeDocumentLocal),
  // que tem contexto hierárquico mais rico para reduzir falsos positivos.
  return { score: 0, reasons: [], confidence: "Low" as "High" | "Medium" | "Low" };
};

/**
 * Verifica se uma linha contém o RG ou ID Funcional de um militar.
 * Usado para confirmação no pipeline de dois estágios.
 */
const hasConfirmingNumber = (lineText: string, cleanRg: string | null, cleanId: string | null): boolean => {
  const lineClean = lineText.replace(/[^0-9a-zA-Z]/g, '');
  if (cleanId && cleanId.length > 4 && lineClean.includes(cleanId)) {
    const idRegex = createFuzzyNumberRegex(cleanId);
    if (idRegex.test(lineText)) return true;
  }
  if (cleanRg && cleanRg.length > 4 && lineClean.includes(cleanRg)) {
    const rgRegex = createFuzzyNumberRegex(cleanRg);
    if (rgRegex.test(lineText)) return true;
  }
  return false;
};

/**
 * Verifica se uma linha contém o nome de guerra de um militar.
 */
const hasNameMatch = (lineTextNorm: string, warNameParts: string[], nomeGuerra: string, lineText: string): boolean => {
  if (warNameParts.length === 0) return false;
  const hasNamePart = warNameParts.some(part => lineTextNorm.includes(part));
  if (!hasNamePart) return false;
  const regex = createFuzzyNameRegex(nomeGuerra);
  return regex.test(lineText);
};

/**
 * Pipeline de dois estágios para o extrator de boletim.
 *
 * Estágio 1 — Candidato: nome de guerra encontrado em alguma linha do bloco.
 * Estágio 2 — Confirmação: RG ou ID Funcional encontrado no mesmo bloco.
 *
 * Só retorna match quando ambos os estágios passam.
 * RG/ID sem nome também confirma (certeza absoluta).
 */
export const matchPersonnelInBlock = (
  lines: string[],
  personnel: MilitaryPerson[],
  prefs: SearchPreferences
): { name: string, confidence: 'High' | 'Medium' | 'Low' }[] => {
  const found: { name: string, confidence: 'High' | 'Medium' | 'Low' }[] = [];

  for (const person of personnel) {
    const cleanId = person.idFuncional ? person.idFuncional.replace(/[^0-9]/g, '').replace(/^0+/, '') : null;
    const cleanRg = person.rg ? person.rg.replace(/[^0-9]/g, '').replace(/^0+/, '') : null;
    const warNameParts = person.nomeGuerra
      ? normalizeSimple(person.nomeGuerra).split(' ').filter(x => x.length > 2)
      : [];

    let hasName = false;
    let hasNumber = false;

    for (const line of lines) {
      const lineNorm = normalizeSimple(line);

      // Estágio 1: nome de guerra
      if (!hasName && prefs.useNomeGuerra && person.nomeGuerra) {
        if (hasNameMatch(lineNorm, warNameParts, person.nomeGuerra, line)) {
          hasName = true;
        }
      }

      // Estágio 2: RG ou ID Funcional
      if (!hasNumber) {
        if (
          (prefs.useRg && hasConfirmingNumber(line, cleanRg, null)) ||
          (prefs.useIdFuncional && hasConfirmingNumber(line, null, cleanId))
        ) {
          hasNumber = true;
        }
      }

      if (hasName && hasNumber) break;
    }

    // Só confirma se tiver número (RG ou ID). Nome sozinho não é suficiente.
    if (hasNumber) {
      const confidence = hasName ? 'High' : 'Medium'; // com nome = High, só número = Medium
      found.push({ name: person.nomeCompleto, confidence });
    }
  }

  return found;
};

/**
 * Versão simplificada para o Parser de Boletim (linha única — mantida para compatibilidade).
 * Para blocos de texto use matchPersonnelInBlock.
 */
export const matchPersonnelInLine = (
  lineText: string,
  personnel: MilitaryPerson[],
  prefs: SearchPreferences,
  strictMode = false
): { name: string, confidence: 'High' | 'Medium' | 'Low' }[] => {
  return matchPersonnelInBlock([lineText], personnel, prefs);
};

export const analyzeDocumentLocal = async (
  pageMap: { 
    page: number; 
    text: string; 
    tokens: TextToken[];
    lines: { text: string; y: number }[] 
  }[],
  personnel: MilitaryPerson[],
  keywords: string[],
  targetContexts: string[],
  prefs: SearchPreferences
): Promise<ExtractionResult[]> => {
  
  const results: ExtractionResult[] = [];
  
  const allLines: { text: string, page: number, originalIndex: number }[] = [];
  pageMap.forEach(p => {
    const lines = p.text.split('\n');
    lines.forEach(line => {
      const cleanLine = line.trim();
      if (cleanLine && !isPageHeaderOrFooter(cleanLine)) { 
        allLines.push({ text: line, page: p.page, originalIndex: allLines.length });
      }
    });
  });

  // --- ESTADO HIERÁRQUICO (Pilha) ---
  let sectionStack: SectionStackItem[] = [];
  let currentSectionAccumulator = "";
  
  // Controle de Títulos Multilinha
  let collectingTitleLevel: number | null = null; 

  const processedPersonnel = personnel.map(p => ({
    original: p,
    cleanId: p.idFuncional ? p.idFuncional.replace(/[^0-9]/g, '').replace(/^0+/, '') : null,
    cleanRg: p.rg ? p.rg.replace(/[^0-9]/g, '').replace(/^0+/, '') : null,
    rank: p.postoGraduacao ? extractRankFromText(p.postoGraduacao) : null,
    warNameParts: p.nomeGuerra ? normalizeSimple(p.nomeGuerra).split(' ').filter(x => x.length > 2) : []
  }));

  for (let i = 0; i < allLines.length; i++) {
    const lineObj = allLines[i];
    const lineText = normalizeSpaces(lineObj.text);
    const lineTextNorm = normalizeSimple(lineText);
    const lineTextSearch = normalizeForSearch(lineText); 
    const lineTextClean = lineText.replace(/[^0-9a-zA-Z]/g, ''); 

    // Pula linhas de SUMÁRIO (que têm pontinhos e número de página)
    if (isTOCLine(lineText)) {
        continue;
    }

    let isTitleLine = false;
    let match: RegExpMatchArray | null;

    // Só analisamos hierarquia se NÃO for uma linha de militar
    const isMilitary = isMilitaryRowStrict(lineText);
    
    if (!isMilitary) {
        
        // --- 1. DETECÇÃO DE NOVOS TÍTULOS (INÍCIO) ---

        // 1.1. PARTE (Ex: "2ª PARTE - ASSUNTOS GERAIS")
        if ((match = lineText.match(REGEX_PARTE_PREFIX))) {
            const prefix = match[1];
            const content = match[2];
            // Validação visual + ignorar tabelas
            if (isVisualHeader(content)) {
                const title = cleanHeaderTitle(`${prefix} - ${content}`);
                sectionStack = [{ level: 1, title }];
                isTitleLine = true;
                collectingTitleLevel = 1; // Ativa modo de coleta multilinha
            }
        }
        
        // 1.2. EIXO (Ex: "I - ASSUNTOS GERAIS")
        else if ((match = lineText.match(REGEX_EIXO_PREFIX))) {
            const prefix = match[1];
            const content = match[2];
            if (isVisualHeader(content)) {
                const title = cleanHeaderTitle(`${prefix} - ${content}`);
                // Remove qualquer eixo ou item anterior (Nível 2 ou 3), mantém a Parte (Nível 1)
                sectionStack = sectionStack.filter(s => s.level < 2);
                sectionStack.push({ level: 2, title });
                isTitleLine = true;
                collectingTitleLevel = 2;
            }
        }

        // 1.3. ITEM (Ex: "16 . RELATÓRIO...")
        else if ((match = lineText.match(REGEX_ITEM_PREFIX))) {
            const prefix = match[1];
            const content = match[2];
            
            // VERIFICAÇÃO DE SUB-ITENS (LÓGICA CRÍTICA)
            // Se tiver " - NOTA", é definitivamente um título principal.
            const hasNotaSuffix = /\s-\s*NOTA\s+/i.test(lineText);
            
            // Se começar com palavra reservada (FINALIDADE, etc), pode ser falso positivo.
            const contentUpper = content.toUpperCase().trim();
            const isSubItemKeyword = SUB_ITEM_KEYWORDS.some(k => contentUpper.startsWith(k));

            if (isVisualHeader(content) && !detectTableStructure(content)) {
                
                // DECISÃO: Só criamos nova seção se:
                // 1. Tiver sulfixo "NOTA" (Garantia absoluta)
                // 2. OU NÃO for uma palavra reservada de subitem (Garantia heurística)
                if (hasNotaSuffix || !isSubItemKeyword) {
                    const title = cleanHeaderTitle(`${prefix}. ${content}`);
                    
                    // Remove item anterior (Nível 3), mantém Parte e Eixo.
                    // Isso garante INDEPENDÊNCIA: Item 2 fecha Item 1.
                    sectionStack = sectionStack.filter(s => s.level < 3);
                    sectionStack.push({ level: 3, title });
                    isTitleLine = true;
                    collectingTitleLevel = 3;
                }
                // Se for isSubItemKeyword E não tiver NOTA, cai aqui e é tratado como corpo de texto.
            }
        }

        // --- 2. DETECÇÃO DE CONTINUAÇÃO DE TÍTULO (MULTILINHA) ---
        // Se estamos coletando um título (acabamos de achar um header na linha anterior) 
        // e a linha atual TAMBÉM é CAIXA ALTA e NÃO é um novo prefixo (verificado acima)
        else if (collectingTitleLevel !== null && isVisualHeader(lineText) && !detectTableStructure(lineText)) {
             // Encontra o item atual na stack para modificar
             const currentItem = sectionStack.find(s => s.level === collectingTitleLevel);
             if (currentItem) {
                 // Concatena a linha atual ao título existente
                 currentItem.title = `${currentItem.title} ${lineText.trim()}`;
                 isTitleLine = true;
             }
        } else {
             // Se a linha não é header ou é outro tipo de coisa (texto corrido), paramos de coletar título
             collectingTitleLevel = null;
        }
    } else {
        // Se é linha militar, com certeza não é título
        collectingTitleLevel = null;
    }

    if (isTitleLine) {
        currentSectionAccumulator = "";
        continue; 
    }

    // Constrói o caminho final concatenando os títulos da pilha
    const fullSectionPath = sectionStack.map(s => s.title).join(' > ');

    // Acumula texto para contexto se não for ruído
    if (!isNoiseLine(lineText) && !isTableHeader(lineText)) {
        currentSectionAccumulator += lineText + "\n";
    }

    // --- LOOP DE MILITARES (OTIMIZADO COM O MOTOR ÚNICO) ---
    for (const p of processedPersonnel) {
      const person = p.original;
      const matchResult = evaluatePersonnelMatch(lineText, person, prefs, p);

      if (matchResult.score > 0) {
        const confidenceLevel = matchResult.confidence as 'High' | 'Medium' | 'Low';
        const validationMsg = `${confidenceLevel} (${matchResult.score}%): ${matchResult.reasons.join(', ')}.`;

        const formattedBody = currentSectionAccumulator.trim() 
            ? formatOfficialDocumentText(currentSectionAccumulator) 
            : formatOfficialDocumentText(lineText);

        results.push({
          id: crypto.randomUUID(),
          type: MatchType.PERSONNEL,
          matchedText: `${person.nomeCompleto}`,
          relevanceScore: matchResult.score,
          relatedContent: lineText, 
          section: fullSectionPath || "Seção não identificada",
          sectionBody: formattedBody,
          sectionFooter: "",
          context: validationMsg,
          confidenceLevel: confidenceLevel,
          pageNumber: lineObj.page,
          person: person,
          isTableRow: detectTableStructure(lineText)
        });
      }
    }

    // --- LÓGICA DE PALAVRA-CHAVE (UNIDADE/LOCAL) ---
    if (keywords.length > 0) {
        for (const keyword of keywords) {
            let matched = false;
            if (isNumericUnitKeyword(keyword)) {
                const parts = keyword.split('/');
                const n1 = parts[0].trim();
                const n2 = parts[1].trim();
                const strictRegex = new RegExp(`(?<![\\d\\/.])\\b${n1}\\s*\\/\\s*${n2}\\b(?![\\d\\/.])`,'i');
                if (strictRegex.test(lineText)) matched = true;
            } else {
                const keySearch = normalizeForSearch(keyword);
                if (lineTextSearch.includes(keySearch)) matched = true;
            }
            
            if (matched) {
                results.push({
                    id: crypto.randomUUID(),
                    type: MatchType.UNIT_KEYWORD,
                    matchedText: keyword, 
                    relevanceScore: 100,
                    relatedContent: lineText,
                    section: fullSectionPath || "Seção não identificada",
                    sectionBody: formatOfficialDocumentText(currentSectionAccumulator),
                    context: "Filtro de Unidade / Local encontrado.",
                    confidenceLevel: "High",
                    pageNumber: lineObj.page,
                    isTableRow: detectTableStructure(lineText)
                });
            }
        }
    }

    // --- LÓGICA DE CONTEXTOS DE INTERESSE ---
    if (targetContexts.length > 0) {
        for (const contextTerm of targetContexts) {
            const contextSearch = normalizeForSearch(contextTerm);
            if (lineTextSearch.includes(contextSearch)) {
                results.push({
                    id: crypto.randomUUID(),
                    type: MatchType.UNIT_KEYWORD, 
                    matchedText: contextTerm,
                    relevanceScore: 100,
                    relatedContent: lineText,
                    section: fullSectionPath || "Seção não identificada",
                    sectionBody: formatOfficialDocumentText(currentSectionAccumulator),
                    context: "Contexto de Interesse detectado.", 
                    confidenceLevel: "High",
                    pageNumber: lineObj.page,
                    isTableRow: detectTableStructure(lineText)
                });
            }
        }
    }
  }

  return results;
};
