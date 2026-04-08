# Implementation Plan

- [x] 1. Implementar `cleanNoteTitle` em `textUtils.ts`
  - Criar a função `cleanNoteTitle(text: string): string` que remove `_`, `*`, número isolado no final e normaliza espaços
  - Exportar a função para uso em `bulletinParserService.ts`
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ]* 1.1 Escrever property tests para `cleanNoteTitle`
  - **Property 1: `cleanNoteTitle` remove todos os artefatos**
  - **Property 2: `cleanNoteTitle` é idempotente**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 2. Atualizar `parseTocLines` em `bulletinParserService.ts`
  - [x] 2.1 Aplicar `cleanNoteTitle` ao criar SummaryItems de Nota
    - Importar `cleanNoteTitle` de `textUtils`
    - Substituir `normalizeTitle(titleNorm)` por `normalizeTitle(cleanNoteTitle(titleNorm))` nos itens de Nota
    - _Requirements: 1.1, 1.2_
  - [x] 2.2 Reforçar o filtro de saída para rejeitar itens com artefatos residuais
    - Adicionar condições ao `.filter()` final: rejeitar se `cleanTitle` contém `___` ou `**`, ou se é só número
    - _Requirements: 1.3, 1.4_

- [ ]* 2.3 Escrever property test para `parseTocLines`
  - **Property 3: `parseTocLines` produz notas sem artefatos e com página**
  - **Validates: Requirements 1.1, 1.2, 1.4**

- [x] 3. Atualizar `formatTocForDisplay` em `bulletinParserService.ts`
  - Garantir que itens de Nota usam `item.cleanTitle` como `displayText` (nunca `item.originalRaw`)
  - Garantir que `pageStr` usa `item.expectedPage !== null` para evitar `[p. null]`
  - Remover qualquer caminho de código que passe `originalRaw` para notas
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ]* 3.1 Escrever property test para `formatTocForDisplay`
  - **Property 4: `formatTocForDisplay` produz saída livre de artefatos**
  - **Validates: Requirements 2.3, 2.4**

- [x] 4. Checkpoint — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Atualizar `parseSumarioLines` em `SumarioView.tsx`
  - Adicionar limpeza defensiva no campo `text` de cada `SumarioEntry`: remover `___`, `**`, número isolado no final, normalizar espaços
  - _Requirements: 3.1, 3.2_

- [ ]* 5.1 Escrever property test para `parseSumarioLines`
  - **Property 5: `parseSumarioLines` produz entradas com `text` limpo**
  - **Validates: Requirements 3.1, 3.2**

- [x] 6. Checkpoint Final — Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.
