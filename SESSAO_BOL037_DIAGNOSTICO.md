# Sessão: Diagnóstico e Correção do Boletim 037

## Objetivo da Sessão
Comparar o PDF original do Boletim 037 com as notas extraídas pelo Sentinela,
catalogar TODOS os erros de formatação e parsing, e corrigi-los com base em evidências reais.

---

## Estado Atual do Projeto

### O que já foi feito (sessões anteriores)
- Fases 1 e 2.1 do REFACTORING_PLAN.md concluídas
- Dead code removido, bug de `escapeRegExp` corrigido, logs de produção removidos

### Correções aplicadas nesta sessão

| # | Arquivo | Problema | Correção |
|---|---------|----------|----------|
| 1 | `bulletinParserService.ts` | Última linha do título (`"CHEMG 215/2026"`) vazava para o conteúdo do card | `nextIsContinuation` expandido para reconhecer `"EMISSOR NNN/20XX"` como continuação de título |
| 2 | `textUtils.ts` | Itens de lista com `"- "` (militares convocados) fundidos em parágrafo único | `isListItem` e `nextIsListItem` expandidos para reconhecer `"-\s+\S"` como marcador de lista; `isDashContinuation` para unir continuações |
| 3 | `bulletinParserService.ts` | `"1. CONVOCADOS E CONVIDADOS:"` tratado como nota órfã | Detector de órfãos: `candidateNum === 1` sempre descartado (subtítulo interno) |
| 4 | `bulletinParserService.ts` | `"2. TRANSFERIR, com fulcro..."` tratado como nota órfã | Filtro `ADMIN_ACT_VERBS`: verbos no infinitivo em CAIXA ALTA rejeitados como órfãos |
| 5 | `bulletinParserService.ts` | Parágrafo partido no meio por preposição no fim da linha (`"com ônus para o Erário do"`) | `prevEndsWithPreposition` bloqueia `PARABREAK` quando linha termina com preposição/conjunção |
| 6 | `bulletinParserService.ts` | Parágrafo partido quando linha termina com `"RG"` (quebra de página) | `prevEndsWithIncompleteRef` bloqueia `PARABREAK` para siglas incompletas (`RG`, `Id`, `nº`, postos militares) |
| 7 | `pdfWorkerService.ts` | Tokens bold e não-bold colados sem espaço (`"SrMARCO"`, `"AURELIODIB"`) | Espaço líder extraído do run e colocado **fora** dos marcadores `**...**` |
| 8 | `TableReconstructor.ts` | Células multilinhas (`"Apto com"` + `"diagnostico"`) em linhas separadas da tabela | Merge de linhas de continuação: detecta linhas com ≤ 2 colunas preenchidas e merge com threshold 22px |
| 9 | `textUtils.ts` | `"Em consequência, os órgãos..."` absorvido dentro da tabela | `isHardLegalParagraph` expandido: `"Em consequência"`, `"Registre-se"`, `"Publique-se"`, `"Cumpra-se"` etc. |
| 10 | `NotasView.tsx` | Militares do efetivo mencionados na nota sem indicação visual | Banner âmbar com nomes dos militares no topo do conteúdo expandido (não aparece no texto copiado) |
| 11 | `textUtils.ts` | `"31.365;"` (continuação de RG) separado em parágrafo próprio | `joinWrappedParagraphs`: se última linha do result termina com `RG`/`Id`/`nº` e atual começa com dígito, une diretamente |
| 12 | `bulletinParserService.ts` | `"14.133/2021 - NOTA SUSAU 025/2026"` (lei federal) vazava para conteúdo | `isTitleContinuationFragment` e `nextIsContinuation` expandidos para cobrir `NN.NNN/AAAA` e 5 dígitos |
| 13 | `bulletinParserService.ts` | `nextIsContinuation` bloqueava fragmentos que casavam `REGEX_NEXT_NOTA` | Condição corrigida: `(!REGEX_NEXT_NOTA.test(nextL) \|\| isTitleContinuationFragment(nextL))` |
| 14 | `bulletinParserService.ts` | `"4. DATA, HORÁRIO E LOCAL"` e `"8. PRESCRIÇÕES DIVERSAS"` tratados como notas | Filtro `INTERNAL_TOC`/`INTERNAL_SECTION_HEADERS`/`INTERNAL_SECTION_FB` em 3 pontos: `parseTocLines`, fallback posicional e detector de órfãos. Bug: `normalizeTitle` remove pontuação, regex usava `DATA[,\s]` → corrigido para `DATA\b` |
| 15 | `bulletinParserService.ts` | `"4. DATA, HORÁRIO E LOCAL"` ainda aparecia (vinha do TOC) | `parseTocLines` agora filtra `INTERNAL_TOC` antes de adicionar ao `pending` |
| 16 | `NotasView.tsx` | Partes, eixos e sub-eixos não indicavam presença de militares do efetivo | Badge âmbar com estrela e contagem de notas relevantes em cada nível hierárquico; border âmbar quando colapsado |
| 17 | `SumarioView.tsx` | Títulos no sumário não indicavam presença de militares do efetivo | Linhas de nota com militares recebem fundo âmbar, texto âmbar em negrito e `★` |
| 18 | `app/page.tsx` | Banner de rodapé (`© 2026 Sentinela`) sobrepondo conteúdo | `z-index: -1` no footer |

---

## Problemas ainda abertos (Categoria B — não localizados)

| Nota | Status |
|------|--------|
| 1ª PARTE - SERVIÇOS DIÁRIOS | ❌ Não localizada |
| 2ª PARTE - OPERAÇÕES E INSTRUÇÃO | ❌ Não localizada |
| 3ª PARTE - ASSUNTOS GERAIS | ❌ Não localizada |
| 5ª PARTE - COMUNICAÇÃO SOCIAL | ❌ Não localizada |
| PLANO DE CAPACITAÇÃO 1 e 2 | ❌ Não localizados |
| INSPEÇÃO DE SAÚDE PERIÓDICA | ❌ Não localizada |
| CURSO CHOAE (nota 5) | ❌ Não localizado |
| CURSO CBSOC (nota 6) | ❌ Não localizado |
| SECRETARIA DAS COMISSÕES (nota 7) | ❌ Não localizada |
| ATA DA REUNIÃO (nota 8) | ❌ Não localizada |
| II - ASSUNTOS ADMINISTRATIVOS | ❌ Não localizado |
| ANEXO II - NOTA GOCG 222/2026 | ❌ Localiza errado (confunde com DGEI/CFAP) |

---

## Estrutura atual relevante
```
src/
├── core/
│   ├── constants/formFields.ts
│   └── text/formFieldSplitter.ts
├── services/
│   ├── pdfWorkerService.ts           ← fix #7 (tokens colados)
│   ├── bulletinParserService.ts      ← fixes #1,3,4,5,6,12,13,14,15
│   ├── textUtils.ts                  ← fixes #2,9,11
│   ├── TableReconstructor.ts         ← fix #8
│   └── hierarchyService.ts
└── components/
    ├── NotasView.tsx                 ← fixes #10,16,17
    └── SumarioView.tsx               ← fix #17
```

---

## Como Iniciar a Próxima Sessão

1. Compartilhe este arquivo (`SESSAO_BOL037_DIAGNOSTICO.md`) no chat
2. Compartilhe também `SESSAO_BOL037_COMPARACAO.md` para o catálogo completo
3. Prioridade sugerida:
   - **Categoria B**: Por que 1ª, 2ª, 3ª PARTE não são localizadas?
   - Notas da 2ª PARTE não localizadas
   - ANEXO II confundido
   - Erros de texto restantes (bold fragmentado, tabelas)

---

## Contexto Técnico

### Pipeline atual
```
PDF
 └─ pdfWorkerService.extractTextFromPdf()
     ├─ tokens (x, y, text, fontName, isBold)
     ├─ bold: análise híbrida de densidade (BOL037: 4 fontes sem nome reconhecível)
     ├─ agrupamento por Y → sortedLines
     └─ splitFormFieldLines() → processedLines
         └─ bulletinParserService.extractBulletinLocalAlgo()
             ├─ extractTocBlock() → linhas do sumário (páginas 1-3)
             ├─ parseTocLines() → SummaryItem[] (com filtro INTERNAL_TOC)
             ├─ allLines (filtrado: sem headers/rodapés)
             ├─ busca: anchoredSpace → searchSpace → searchSuffix → bold → numPattern → posicional
             └─ cleanAndFormatSlice() → BulletinNota[]
                 ├─ PARABREAK: yGap>18 ou indentação>20 (exceto preposição/sigla incompleta no fim)
                 ├─ detectTableStructure() / isTableHeader()
                 ├─ reconstructTable() [3 estratégias + merge de células multilinhas]
                 └─ joinWrappedParagraphs()
                     ├─ isListItem: inclui "- texto" como marcador
                     ├─ isDashContinuation: une continuações de item "- "
                     └─ prevEndsWithIncompleteRef: une RG + número mesmo após PARABREAK
```

### Fontes do BOL037
Todas as 4 fontes retornam `family="sans-serif" common=null` — bold detectado 100% por análise híbrida de densidade.
