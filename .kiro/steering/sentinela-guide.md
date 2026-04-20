# Sentinela — Guia Permanente do Projeto

## O que é o Sentinela
App Next.js que extrai e formata notas de boletins militares (PDF) da SEDEC/CBMERJ.
Usado internamente pelo 10º GBM para acompanhar publicações que afetam o efetivo.

## Pipeline de Extração
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
                 ├─ PARABREAK: yGap>18 ou indentação>20
                 ├─ detectTableStructure() / isTableHeader()
                 ├─ reconstructTable() [3 estratégias]
                 └─ joinWrappedParagraphs()
```

## Arquivos Principais
| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/services/pdfWorkerService.ts` | Extração de tokens do PDF, detecção de bold |
| `src/services/bulletinParserService.ts` | Parsing do TOC, localização de notas, montagem de slices |
| `src/services/textUtils.ts` | `joinWrappedParagraphs`, `isHardLegalParagraph`, `isPageHeaderOrFooter` |
| `src/services/TableReconstructor.ts` | Reconstrução de tabelas (3 estratégias) |
| `src/services/TablePatternAnalyzer.ts` | Inferência de boundaries por dados; score de continuação de tabela |
| `src/services/TableValidator.ts` | Validação e retry por score semântico |
| `src/services/hierarchyService.ts` | Estrutura canônica do boletim SEDEC |
| `src/core/constants/formFields.ts` | Fonte única de campos de formulário |
| `src/core/text/formFieldSplitter.ts` | Quebra de linhas com múltiplos campos |
| `src/components/NotasView.tsx` | Renderização, handleCopy, badges de efetivo |
| `src/components/SumarioView.tsx` | Sumário navegável com destaque de efetivo |

## Estrutura Canônica do Boletim SEDEC
```
ABERTURA DO BOLETIM
  FATOS HISTÓRICOS
  ESTATÍSTICA DE SOCORROS PRESTADOS
  TENDÊNCIA METEOROLÓGICA

1ª PARTE - SERVIÇOS DIÁRIOS
2ª PARTE - OPERAÇÕES E INSTRUÇÃO
  I - OPERAÇÕES
  II - INSTRUÇÃO
3ª PARTE - ASSUNTOS GERAIS E ADMINISTRATIVOS
  I - ASSUNTOS GERAIS
  II - ASSUNTOS ADMINISTRATIVOS
    A - ALTERAÇÕES DE OFICIAIS
    A1 - ALTERAÇÕES DE PRAÇAS ESPECIAIS
    B - ALTERAÇÕES DE PRAÇAS
    C - ALTERAÇÕES DE CIVIS
4ª PARTE - JUSTIÇA E DISCIPLINA
5ª PARTE - COMUNICAÇÃO SOCIAL
ANEXOS
```

## Padrões de Erro Conhecidos e Correções

### Título vazando para o conteúdo do card
**Causa:** `titleLinesConsumed` para antes de consumir todas as linhas do título quando o título quebra em múltiplas linhas no PDF.
**Correção:** `nextIsContinuation` em `bulletinParserService.ts` — reconhece fragmentos como `"CHEMG 215/2026"`, `"14.133/2021"`, `"EMISSOR NNN/20XX"` como continuação de título.
**Arquivo:** `bulletinParserService.ts` → loop `titleLinesConsumed`

### Itens de lista com "- " fundidos em parágrafo
**Causa:** `isListItem` não reconhecia `"- texto"` como marcador de lista.
**Correção:** Regex expandido para `-\s+\S`; `isDashContinuation` une continuações do mesmo item.
**Arquivo:** `textUtils.ts` → `joinWrappedParagraphs`

### Parágrafo partido por preposição no fim da linha
**Causa:** `PARABREAK` inserido por Y-gap mesmo quando linha termina com `"do"`, `"de"`, `"com"` etc.
**Correção:** `prevEndsWithPreposition` bloqueia `PARABREAK`.
**Arquivo:** `bulletinParserService.ts` → `cleanAndFormatSlice`

### Parágrafo partido quando linha termina com "RG" (quebra de página)
**Causa:** `PARABREAK` inserido entre `"PINHEIRO, RG"` e `"31.365;"`.
**Correção:** `prevEndsWithIncompleteRef` bloqueia `PARABREAK` para siglas incompletas; `joinWrappedParagraphs` une diretamente se última linha do result termina com `RG`/`Id`/`nº`.
**Arquivo:** `bulletinParserService.ts` + `textUtils.ts`

### Tokens bold e não-bold colados sem espaço
**Causa:** Espaço líder embutido no run seguinte era descartado pelo `s.trim()` dentro de `**...**`.
**Correção:** Espaço líder extraído e colocado fora dos marcadores de formatação.
**Arquivo:** `pdfWorkerService.ts` → renderização de runs

### Subtítulo interno tratado como nota
**Causa:** `"4. DATA, HORÁRIO E LOCAL"`, `"1. FINALIDADE"`, `"8. PRESCRIÇÕES DIVERSAS"` etc. casavam o detector de órfãos, fallback posicional e `parseTocLines`.
**Correção:** Filtros `INTERNAL_TOC`, `INTERNAL_SECTION_HEADERS`, `INTERNAL_SECTION_FB` em 3 pontos. Atenção: `normalizeTitle` remove pontuação — usar `DATA\b` não `DATA[,\s]`.
**Arquivo:** `bulletinParserService.ts` (3 locais)

### Subtópicos internos de documento com numeração própria (ex: diretrizes de solenidade)
**Causa:** Notas de diretrizes (ex: "MEDALHA MÉRITO MARÍTIMO") contêm subtópicos numerados a partir de "1." (1. DATA, HORA E LOCAL / 2. REFERÊNCIAS / 3. UNIFORME / 4. PRESCRIÇÕES...). O detector de órfãos aceitava candidatos com número > currNoteNum sem perceber que toda a numeração do gap era interna.
**Correção:** Pré-varredura do gap (`gapHasInternalSection1`): se existe uma linha bold com "1." no gap, toda a numeração daquele gap é tratada como subtítulo interno e nenhum candidato é promovido a nota órfã. Regra: **numeração reiniciada em 1 dentro de uma nota é sempre subtítulo interno** — o código agora verifica isso ativamente.
**Arquivo:** `bulletinParserService.ts` → detector de órfãos (bloco `gapHasInternalSection1`)

### Tabelas de lista de pessoal (coluna única) não reconhecidas
**Causa:** `isTableHeader` não reconhecia `"MILITAR"`, `"DEMAIS FORÇAS"`, `"CIVIS"` como cabeçalhos. E mesmo após reconhecer, `reconstructTable` fragmentava cada linha em múltiplas colunas pelos gaps internos (posto | nome | RG | Id Funcional).
**Correção:** `isTableHeader` ganhou bloco `singleColListHeaders` para esses cabeçalhos. Em `flushTable`, quando detectado cabeçalho de lista de pessoal, **bypassa o `reconstructTable`** e monta diretamente uma `TableData` de 1 coluna com o texto completo de cada linha.
**Arquivo:** `textUtils.ts` → `isTableHeader` + `bulletinParserService.ts` → `flushTable`

### Verbos de ato administrativo tratados como nota
**Causa:** `"2. TRANSFERIR, com fulcro..."` casava o detector de órfãos.
**Correção:** Filtro `ADMIN_ACT_VERBS` rejeita verbos no infinitivo em CAIXA ALTA.
**Arquivo:** `bulletinParserService.ts` → detector de órfãos + fallback posicional

### Texto narrativo absorvido pela tabela
**Causa:** Bridge scan conectava blocos de tabela separados por `"Em consequência..."`.
**Correção:** `isHardLegalParagraph` expandido com fórmulas de encerramento de documento.
**Arquivo:** `textUtils.ts` → `isHardLegalParagraph`

### Células multilinhas em linhas separadas da tabela
**Causa:** `"Apto com"` + `"diagnostico"` em Y diferentes ficavam em rows separados.
**Correção:** Merge de linhas de continuação: detecta rows com ≤ 2 colunas preenchidas e merge com threshold 22px.
**Arquivo:** `TableReconstructor.ts` → `reconstructTableByBorders`

### Numeração duplicada no boletim oficial
**Causa:** O PDF oficial às vezes repete o número de nota (ex: duas notas "5.").
**Comportamento correto:** Ambas devem ser preservadas. O código de sanidade compara títulos — se distintos, mantém as duas.
**Arquivo:** `bulletinParserService.ts` → bloco de sanidade

### Artefatos de kerning de rodapé contaminando tabelas
**Causa:** PDFs com fontes TrueType corrompidas geram tokens de 1 caractere bold repetidos (`**F**`, `**F**`, `**L**`, `**L**`, `**.**`, `**.**`) que representam texto de rodapé/cabeçalho de página (ex: "FFLL..22" = "FL.22"). Esses tokens têm Y dentro do range de linhas de dados da tabela e são absorvidos pelo `flushTable`.
**Sintoma no log:** `[TableValidator] Issues: '"**F** **F** **L** **L** **.** **.** **2** **2**" ≠ padrão RG'`
**Correção:** Filtro `isKerningArtifact` em `flushTable` — rejeita tokens com texto de 1 char que seja letra maiúscula ou ponto antes de montar `allTableTokens`.
**Arquivo:** `bulletinParserService.ts` → `flushTable` → montagem de `allTableTokens`

### Cabeçalho empilhado não separado em tabelas militares de 6 colunas
**Causa:** O cabeçalho `QTD | POSTO/GRAD. | NOME | RG | ID FUNCIONAL | OBM` ocupa 3 linhas físicas no PDF com tokens de `QTD` e `POSTO/GRAD.` no mesmo X. O `templateLine` resulta em 3 frases em vez de 6.
**Correção:** `TablePatternAnalyzer.inferColumnBoundaries` aprende as 6 colunas a partir das primeiras linhas de dados. Modo autoritativo no `TableReconstructor` seção 4: quando `confidence ≥ 0.8` e `boundaries.length > templateLine.length`, reconstrói o `templateLine` com os labels corretos.
**Arquivo:** `TableReconstructor.ts` → seção 4 + `TablePatternAnalyzer.ts`

### Linhas de dados militares saindo da tabela após quebra de página
**Causa:** `detectTableStructure` retorna false para linhas de dados sem gaps geométricos suficientes (ex: linhas 18-28 de tabela COESCI). O bridge scan geométrico não as captura.
**Correção:** Pass 3 em `cleanAndFormatSlice`: após o bridge scan geométrico, itera por todos os blocos de tabela, calcula `inferColumnBoundaries` dos tokens do bloco, e marca como `isTable/isBridge` linhas com `isTableContinuation score ≥ 0.7`. Guarda: `isPageHeaderOrFooter` + regex de artefato (`/^[A-Z]{2,}[.\s]*\d+$/i && /([A-Z])\1/i`) rejeitam falsos positivos.
**Arquivo:** `bulletinParserService.ts` → Pass 3 + `TablePatternAnalyzer.ts`

## Metodologia de Comparação Nota a Nota

1. Processar o boletim no app (botão EXTRATOR)
2. Abrir o PDF lado a lado com o app
3. Para cada nota, verificar:
   - Título correto e completo?
   - Conteúdo sem fragmentos do título?
   - Parágrafos separados corretamente?
   - Itens de lista preservados?
   - Tabelas estruturadas?
   - Militares do efetivo destacados?
4. Catalogar erros por categoria (A=texto, B=localização, C=tabela, D=bold)
5. Corrigir um padrão de cada vez, verificar com `getDiagnostics`
6. Atualizar este guia com o novo padrão aprendido

## Categorias de Erro

| Categoria | Descrição |
|-----------|-----------|
| A | Erros de texto: parágrafos fundidos/partidos, campos mal formatados |
| B | Erros de localização: nota não encontrada, hierarquia errada, offset |
| C | Erros de tabela: tabela como texto, colunas erradas, linhas fundidas |
| D | Erros de bold/visual: tokens colados, negrito ausente/excessivo |

## Histórico de Boletins Processados

| Boletim | Data | Status | Problemas Resolvidos |
|---------|------|--------|----------------------|
| BOL037 | 02/03/2026 | ✅ Concluído | Título multilinha, bold sem nome de fonte, tabelas de pessoal |
| BOL039 | 04/03/2026 | ✅ Concluído | Subtítulos internos como notas órfãs, tabelas coluna única (MILITAR/DEMAIS FORÇAS/CIVIS), numeração `1)` em diretrizes, cabeçalho empilhado COESCI, RG partido, OBM multiline |

## Dicas para Novos Boletins

- **Sempre verificar o console** após processar — logs `[LOC] FAIL` indicam notas não localizadas
- **Títulos longos** (leis federais, cursos) tendem a quebrar em 3+ linhas no PDF
- **Documentos anexados** (CHOAE, CBSOC) têm sumário interno que pode contaminar o TOC
- **Tabelas de 3+ páginas** têm cabeçalhos repetidos — o bridge precisa conectá-las mas não absorver o texto final
- **Atos administrativos** (TRANSFERIR, EXONERAR...) são itens internos, nunca notas independentes
- **Numeração reiniciada em 1** dentro de uma nota é sempre subtítulo interno
- **`normalizeTitle` remove toda pontuação** — regex de filtro deve usar `\b` não `[,\s]`
- **Numeração com parêntese `1)`** é comum em diretrizes e deve ser tratada como subseção/parágrafo, não como início de tabela. Regexes de detecção de sub-tópicos devem usar `[\s.)]+` para cobrir esse padrão.
- **`WORD_SPACE_THRESHOLD` de 6px** é o padrão base para separação de colunas.
- **Header Forçado (`textUtils.ts`)**: Se contiver `QTD` e `NOME`, a linha é marcada como cabeçalho ignorando qualquer outra regra de rejeição.
- **Limites Enviesados (`TableReconstructor.ts`)**: Colunas de texto largo (NOME) expandem seus limites até 90% do gap em direção à próxima coluna de dados (RG), protegendo nomes longos.
- **Sticky Data Splitting (`TableReconstructor.ts`)**: Tokens colados em PDF (gap < 6px) como `14 2º Sgt` ou `Sgt DIEGO` são forçados a se separarem por regex semântico, garantindo que cada dado caia na coluna correta do template militar de 6 colunas.
