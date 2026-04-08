
import { GoogleGenAI } from "@google/genai";
import { ExtractionResult, MilitaryPerson } from "../types";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable is missing.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Função de Auditoria:
 * Analisa o RESULTADO da busca local + GABARITO (Correções do usuário) + TEXTO ORIGINAL.
 * Utiliza o modelo Gemini 3 Pro para raciocínio complexo sobre padrões de texto.
 */
export const auditLocalAnalysis = async (
  fullText: string,
  localResults: ExtractionResult[],
  personnel: MilitaryPerson[],
  customPrompt: string = ""
): Promise<string> => {
  const ai = getAiClient();

  const sectionCorrectionsMap: Record<string, string> = {};
  const itemCorrectionsMap: Record<string, string> = {};

  localResults.forEach(r => {
    if (r.section && r.userSectionBodyCorrection) {
      sectionCorrectionsMap[r.section] = r.userSectionBodyCorrection;
    }
    if (r.userCorrection) {
      itemCorrectionsMap[r.matchedText] = r.userCorrection;
    }
  });

  const resultsSummary = localResults.map(r => ({
    militar_alvo: r.matchedText,
    trecho_capturado_pelo_regex: r.relatedContent?.slice(0, 150),
    secao_detectada: r.section,
    score_confianca_local: r.relevanceScore,
    CORRECAO_HUMANA_ITEM: itemCorrectionsMap[r.matchedText] ? `O HUMANO CORRIGIU PARA: "${itemCorrectionsMap[r.matchedText]}"` : "Sem correção",
    CORRECAO_HUMANA_SECAO: r.section && sectionCorrectionsMap[r.section] ? "O HUMANO CORRIGIU O CABEÇALHO DA SEÇÃO" : "Sem correção"
  }));

  const textSample = fullText.slice(0, 50000); 

  const prompt = `
    ATUE COMO UM ENGENHEIRO DE SOFTWARE SÊNIOR ESPECIALISTA EM REGEX E PARSER DE DOCUMENTOS.
    
    DADOS TÉCNICOS:
    1. INSTRUÇÃO EXTRA DO USUÁRIO: "${customPrompt || "Foque em falsos negativos, erros de formatação e hierarquia de seções."}"
    
    2. GABARITOS DE SEÇÃO:
    ${JSON.stringify(sectionCorrectionsMap, null, 2)}
    
    3. GABARITOS DE ITENS:
    ${JSON.stringify(itemCorrectionsMap, null, 2)}
    
    4. RESULTADOS DO ALGORITMO:
    ${JSON.stringify(resultsSummary, null, 2)}

    TEXTO ORIGINAL (FONTE):
    ${textSample}

    GERE UM RELATÓRIO TÉCNICO EM MARKDOWN:
    ## 1. Análise de Discrepâncias
    ## 2. Diagnóstico de Seção/Contexto
    ## 3. Sugestões de Código (Regex)
    ## 4. Conclusão da Auditoria
    ## 5. RESUMO DE OTIMIZAÇÃO (PARA COPIAR E COLAR)
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Modelo de alta qualidade para tarefas complexas
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingBudget: 4000 } // Habilita raciocínio detalhado para análise de código
      }
    });

    return response.text || "Não foi possível gerar o relatório de auditoria.";
  } catch (error) {
    console.error("Erro na auditoria:", error);
    return "Erro ao conectar com a IA para auditoria. Verifique sua API Key.";
  }
};
