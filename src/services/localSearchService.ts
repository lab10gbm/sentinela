
import { ExtractionResult, MatchType, MilitaryPerson, SearchPreferences, TextToken } from "../types";
import {
  cleanHeaderArtifacts,
  normalizeTextForOcr,
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

const extractRankFromText = (text: string): string | null => {
  const normalized = normalizeSimple(text);
  if (/\b(sd|soldado)\b/.test(normalized)) return 'SD';
  if (/\b(cb|cabo)\b/.test(normalized)) return 'CB';
  if (/\b(sgt|sargento|1\s*sgt|2\s*sgt|3\s*sgt)\b/.test(normalized)) return 'SGT';
  if (/\b(subten|subtenente|sub\s*ten)\b/.test(normalized)) return 'SUBTEN';
  if (/\b(ten|tenente|1\s*ten|2\s*ten)\b/.test(normalized)) return 'TEN';
  if (/\b(cap|capitao)\b/.test(normalized)) return 'CAP';
  if (/\b(maj|major)\b/.test(normalized)) return 'MAJ';
  if (/\b(cel|coronel|ten\s*cel)\b/.test(normalized)) return 'CEL';
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

// --- INTEGRAÇÃO E ANÁLISE ---

/**
 * Verifica se um militar do banco de dados está presente em uma linha de texto.
 * Retorna o nome completo do militar se encontrado, null caso contrário.
 *
 * @param strictMode - Se true, desabilita match por nome de guerra (apenas ID/RG).
 *   Use true para linhas de tabela onde nomes parciais causam falsos positivos.
 */
export const matchPersonnelInLine = (
  lineText: string,
  personnel: MilitaryPerson[],
  prefs: SearchPreferences,
  strictMode = false
): string[] => {
  const lineTextNorm = normalizeSimple(lineText);
  const lineTextClean = lineText.replace(/[^0-9a-zA-Z]/g, '');
  const isMilitary = isMilitaryRowStrict(lineText);
  const found: string[] = [];

  for (const p of personnel) {
    const cleanId = p.idFuncional ? p.idFuncional.replace(/[^0-9]/g, '').replace(/^0+/, '') : null;
    const cleanRg = p.rg ? p.rg.replace(/[^0-9]/g, '').replace(/^0+/, '') : null;
    const warNameParts = p.nomeGuerra ? normalizeSimple(p.nomeGuerra).split(' ').filter(x => x.length > 2) : [];
    let matched = false;

    if (prefs.useIdFuncional && cleanId && cleanId.length > 4 && lineTextClean.includes(cleanId)) {
      const regex = createFuzzyNumberRegex(cleanId);
      if (regex.test(lineText)) matched = true;
    }

    if (!matched && prefs.useRg && cleanRg && cleanRg.length > 4 && lineTextClean.includes(cleanRg)) {
      const regex = createFuzzyNumberRegex(cleanRg);
      if (regex.test(lineText)) matched = true;
    }

    // Em strictMode (tabelas), não usa nome de guerra para evitar falsos positivos
    if (!matched && !strictMode && prefs.useNomeGuerra && p.nomeGuerra && warNameParts.length > 0 && isMilitary) {
      // Exige que TODAS as partes do nome de guerra estejam presentes (não apenas uma)
      const allPartsPresent = warNameParts.every(part => lineTextNorm.includes(part));
      if (allPartsPresent) {
        const regex = createFuzzyNameRegex(p.nomeGuerra);
        if (regex.test(lineText)) matched = true;
      }
    }

    if (matched) found.push(p.nomeCompleto);
  }

  return found;
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
    const lineText = normalizeSpaces(lineObj.text); // Normaliza espaços para análise
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

    // --- LOOP DE MILITARES (OTIMIZADO COM VALIDAÇÃO DE LINHA) ---
    for (const p of processedPersonnel) {
      let bestMatchScore = 0;
      let foundItems: string[] = [];
      const person = p.original;

      // 1. ID MATCH (Alta Confiança - Independente de ser linha militar estrita)
      if (prefs.useIdFuncional && p.cleanId && p.cleanId.length > 4) {
        if (lineTextClean.includes(p.cleanId)) {
            const regex = createFuzzyNumberRegex(p.cleanId);
            if (regex.test(lineText)) {
                bestMatchScore = 100;
                foundItems.push("ID Funcional");
            }
        }
      }

      // 2. RG MATCH (Alta Confiança)
      if (bestMatchScore < 100 && prefs.useRg && p.cleanRg && p.cleanRg.length > 4) {
        if (lineTextClean.includes(p.cleanRg)) {
            const regex = createFuzzyNumberRegex(p.cleanRg);
            if (regex.test(lineText)) {
                bestMatchScore = 100;
                foundItems.push("RG");
            }
        }
      }

      // 3. NOME MATCH (Condicional: Só se for linha militar ou tiver pontuação alta)
      if (bestMatchScore < 100 && prefs.useNomeGuerra && person.nomeGuerra && p.warNameParts.length > 0) {
        
        // SÓ ENTRA AQUI SE: Já achou ID/RG OU Se a linha parece militar (Sd BM...)
        if (isMilitary || bestMatchScore > 0) {
            
            const hasNamePart = p.warNameParts.some(part => lineTextNorm.includes(part));
            if (hasNamePart) {
                const regex = createFuzzyNameRegex(person.nomeGuerra);
                if (regex.test(lineText)) {
                    let currentScore = 30; 
                    const reasons = ["Nome de Guerra"];
                    const lineRank = extractRankFromText(lineText);
                    const hasBM = /\bBM\b/i.test(lineText);

                    if (p.rank && lineRank) {
                        if (p.rank === lineRank) {
                            currentScore += 45; 
                            reasons.push(`Patente correta (${p.rank})`);
                        }
                    } else if (lineRank) {
                         currentScore += 10;
                         reasons.push(`Patente encontrada (${lineRank})`);
                    }
                    if (hasBM) currentScore += 10;
                    
                    const fullNameParts = normalizeSimple(person.nomeCompleto).split(' ').filter(x => x.length > 3);
                    let nameMatches = 0;
                    fullNameParts.forEach(part => {
                        if (!p.warNameParts.includes(part) && lineTextNorm.includes(part)) nameMatches++;
                    });

                    if (nameMatches > 0) {
                        currentScore += 25; 
                        reasons.push(`+${nameMatches} partes do nome completo`);
                    }

                    bestMatchScore = Math.max(bestMatchScore, Math.min(85, currentScore)); 
                    if (currentScore >= 30) foundItems.push(...reasons);
                }
            }
        }
      }

      if (bestMatchScore > 0) {
        // Validação Final de Segurança
        // Se só achou nome de guerra (sem ID/RG) e score é baixo, descarta se não parecer militar
        if (!foundItems.includes("ID Funcional") && !foundItems.includes("RG")) {
             const nameToCheck = person.nomeGuerra || person.nomeCompleto.split(' ')[0];
             const looseNameCheck = createFuzzyNameRegex(nameToCheck);
             if (!looseNameCheck.test(lineText)) {
                  bestMatchScore = 0; 
             }
             // Se score for baixo (<50) e não for linha militar explicita, descarta para evitar ruído
             if (bestMatchScore < 50 && !isMilitary) {
                 bestMatchScore = 0;
             }
        }
      }

      if (bestMatchScore > 0) {
        let confidenceLevel: 'High' | 'Medium' | 'Low' = "Low";
        if (bestMatchScore >= 90) confidenceLevel = "High";
        else if (bestMatchScore >= 50) confidenceLevel = "Medium";
        
        const validationMsg = `${confidenceLevel} (${bestMatchScore}%): ${foundItems.join(', ')}.`;

        const formattedBody = currentSectionAccumulator.trim() 
            ? formatOfficialDocumentText(currentSectionAccumulator) 
            : formatOfficialDocumentText(lineText);

        results.push({
          id: crypto.randomUUID(),
          type: MatchType.PERSONNEL,
          matchedText: `${person.nomeCompleto}`,
          relevanceScore: bestMatchScore,
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
