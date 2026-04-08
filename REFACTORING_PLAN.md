# Plano de Refatoração — SENTINELA

## Diagnóstico Geral

O projeto tem dois pipelines paralelos que fazem coisas parecidas sem se falar:

**Pipeline A** — Busca de militares/palavras-chave
```
pdfWorkerService → localSearchService → ResultsView
```

**Pipeline B** — Extração estrutural do boletim
```
pdfWorkerService → bulletinParserService → NotasView
```

O problema: os dois pipelines chamam `extractTextFromPdf` separadamente (dois parsings do mesmo PDF), e ambos reimplementam lógica de hierarquia, normalização e detecção de seções de forma independente. Há também uma API route (`/api/extract-bulletin`) que faz uma terceira versão da mesma coisa via Gemini, mas está desconectada da UI atual.

---

## Problemas Identificados

### 1. PDF parseado duas vezes
`page.tsx` chama `extractTextFromPdf` em `runLocalAnalysis` e depois `extractBulletinLocalAlgo` chama de novo internamente. O `pageMap` extraído em `runLocalAnalysis` é salvo no state mas não é reaproveitado pelo pipeline B.

### 2. Hierarquia implementada em três lugares
- `localSearchService.ts` — pilha `sectionStack` com `REGEX_PARTE_PREFIX`, `REGEX_EIXO_PREFIX`, `REGEX_ITEM_PREFIX`
- `bulletinParserService.ts` — função `buildHierarchy` com a mesma pilha
- `bulletinParserService.ts` — `parseTocLines` com `CANONICAL_STRUCTURE` e `matchCanonical`

Três implementações, três fontes de verdade, três lugares para corrigir bugs.

### 3. Detecção de cabeçalhos duplicada
`isVisualHeader`, `isPageHeaderOrFooter`, `isTOCLine` estão em `textUtils.ts` (correto), mas `localSearchService.ts` tem sua própria lógica de `isNoiseLine` e `isMilitaryRowStrict` que sobrepõe parte dessas funções.

### 4. `SummaryItem` e `BulletinNota` com responsabilidades sobrepostas
`SummaryItem` carrega `foundLineIndex`, `parentCategory`, `notaEmissor`, `notaNumero` — campos que são estado interno do parser mas vazam para o tipo exportado. `BulletinNota` carrega `hierarchy` como string livre, o que força o `NotasView` a fazer parsing de string (`split('>')`) para reconstruir a árvore.

### 5. `NotasView` faz parsing de dados
O componente reconstrói a árvore hierárquica fazendo `split('>')` no campo `hierarchy`. Lógica de negócio dentro de componente de UI.

### 6. `page.tsx` com 1293 linhas
Toda a orquestração, estado, handlers e UI estão num único arquivo. Impossível de manter.

### 7. API route `/api/extract-bulletin` órfã
Existe mas não é chamada pela UI. Código morto que confunde.

### 8. `extractTocFromText` nunca chamada
Função legada no `bulletinParserService.ts` que foi substituída por `parseTocLines` mas não foi removida.

### 9. `TableReconstructor.ts` não estudado como serviço isolado
Está acoplado ao `cleanAndFormatSlice` dentro do parser, dificultando testes independentes.

---

## Plano de Refatoração

### Fase 1 — Tipos e Contratos (sem quebrar nada)

**1.1** Adicionar campo `hierarchyPath: string[]` em `BulletinNota` (array em vez de string com `>`).
Manter `hierarchy: string` por compatibilidade, mas popular os dois.

**1.2** Tornar `SummaryItem` interno ao parser — não exportar mais. Criar tipo `ParsedToc` limpo para o que sai do parser.

**1.3** Remover campos de estado interno de `SummaryItem` (`foundLineIndex`) do tipo exportado.

---

### Fase 2 — Serviços (eliminar duplicação)

**2.1 Criar `src/services/hierarchyService.ts`**
Extrair para cá toda a lógica de hierarquia que hoje está duplicada:
- A pilha `sectionStack` / `buildHierarchy`
- `CANONICAL_STRUCTURE` + `matchCanonical` + `fuzzyKey`
- `STRICT_PART_EIXO_MAP` + `isAllowedEixoForParte`

Tanto `localSearchService` quanto `bulletinParserService` importam daqui.

**2.2 Eliminar `extractTocFromText`**
Função legada, nunca chamada. Remover.

**2.3 Eliminar API route `/api/extract-bulletin`**
Código morto. Remover ou mover para pasta `_archive`.

**2.4 Fazer `extractBulletinLocalAlgo` aceitar `pageMap` como parâmetro opcional**
```ts
extractBulletinLocalAlgo(file: File, pageMap?: PageMap[], ...)
```
Se `pageMap` for passado, não chama `extractTextFromPdf` de novo. Isso elimina o double-parse.

---

### Fase 3 — `page.tsx` (quebrar em partes)

**3.1 Criar `src/hooks/useBulletinPipeline.ts`**
Extrair toda a lógica de estado e handlers relacionados ao boletim:
- `runBulletinExtraction`
- `runLocalAnalysis`
- `bulletinHistory`, `selectedBulletinId`
- `extractedNotas`, `pageMap`

**3.2 Criar `src/hooks/useRoster.ts`**
Extrair lógica do efetivo:
- `handleExcelUpload`
- `handleGoogleSync`
- `loadFromMemory`
- `personnel`, `hasMemoryData`

**3.3 `page.tsx` vira orquestrador**
Só monta os hooks e passa props para os componentes. Meta: < 300 linhas.

---

### Fase 4 — `NotasView` (tirar lógica de negócio)

**4.1 Criar `src/services/notaTreeService.ts`**
Mover `hierarchyTree` useMemo para cá como função pura:
```ts
buildNotaTree(notas: BulletinNota[]): NotaTree
```
Componente só renderiza, não processa.

**4.2 Usar `hierarchyPath: string[]`**
Substituir `split('>')` por acesso direto ao array.

---

### Fase 5 — `bulletinParserService.ts` (clareza interna)

**5.1 Separar em três arquivos menores:**
- `src/services/tocParser.ts` — `extractTocBlock` + `parseTocLines` + `formatTocForDisplay`
- `src/services/bodyParser.ts` — `extractBulletinLocalAlgo` + `cleanAndFormatSlice`
- `bulletinParserService.ts` — só re-exporta os dois acima (compatibilidade)

**5.2 Remover deduplicação de eixos do parser**
Com `hierarchyPath` correto e `notaTreeService` fazendo o agrupamento, o parser não precisa mais se preocupar com duplicação — ele só emite notas, o agrupador cuida da árvore.

---

## Ordem de Execução Recomendada

| # | Tarefa | Risco | Impacto |
|---|--------|-------|---------|
| 1 | Remover `extractTocFromText` e API route órfã | Baixo | Limpeza |
| 2 | Criar `hierarchyService.ts` e migrar duplicações | Médio | Elimina 3 implementações |
| 3 | `extractBulletinLocalAlgo` aceitar `pageMap` externo | Baixo | Elimina double-parse |
| 4 | Criar `notaTreeService.ts` e limpar `NotasView` | Médio | UI mais simples |
| 5 | Adicionar `hierarchyPath: string[]` em `BulletinNota` | Baixo | Contrato mais limpo |
| 6 | Quebrar `page.tsx` em hooks | Alto | Manutenibilidade |
| 7 | Separar `bulletinParserService.ts` em 3 arquivos | Médio | Legibilidade |

---

## O que NÃO mudar

- `pdfWorkerService.ts` — funciona bem, isolado, não tem duplicação
- `TableReconstructor.ts` — isolado, sem sobreposição
- `dbService.ts` — simples e correto
- `fileService.ts` — simples e correto
- `textUtils.ts` — já é o lugar certo para utilitários compartilhados
- Lógica de busca de militares em `localSearchService.ts` — complexa mas funcional
