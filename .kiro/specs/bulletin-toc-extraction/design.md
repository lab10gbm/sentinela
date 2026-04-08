# Design Document — Reconstrução Limpa do Sumário

## Overview

Esta iteração resolve o problema de artefatos do PDF (underscores `___`, asteriscos `**`, números soltos) que aparecem nos títulos de notas do Sumário exibido na interface. A causa raiz é que o pipeline atual passa `originalRaw` do PDF diretamente para a exibição em vez de usar o título já normalizado.

A solução é uma **separação limpa em dois estágios**:

1. **Estágio 1 — Extração de dados** (`parseTocLines` + nova `cleanNoteTitle`): produz `SummaryItem`s com `cleanTitle` livre de artefatos.
2. **Estágio 2 — Reconstrução** (`formatTocForDisplay` + `SumarioView`): usa sempre o label canônico para cabeçalhos e `cleanTitle` para notas; nunca toca em `originalRaw` para exibição.

O que **não muda**: estrutura hierárquica, estilo visual do `SumarioView`, navegação por clique, `extractTocBlock`, `buildHierarchy`, `extractBulletinLocalAlgo`.

## Architecture

```
PDF bruto
    │
    ▼
pdfWorkerService.ts  →  pageMap
    │
    ▼
bulletinParserService.ts
    ├── extractTocBlock()          ← sem mudança
    ├── parseTocLines()            ← ATUALIZADO: aplica cleanNoteTitle(), filtro agressivo
    │       └── cleanNoteTitle()  ← NOVO (em textUtils.ts): remove ___, **, números soltos
    └── formatTocForDisplay()     ← ATUALIZADO: usa cleanTitle para notas, label canônico para cabeçalhos

src/components/
    └── SumarioView.tsx            ← ATUALIZADO: parseSumarioLines com limpeza defensiva
```

## Components and Interfaces

### `cleanNoteTitle(text: string): string` — NOVO em `textUtils.ts`

Função auxiliar que normaliza títulos de notas extraídos do PDF:

```typescript
export const cleanNoteTitle = (text: string): string => {
  return text
    .replace(/[_*]+/g, '')           // remove underscores e asteriscos
    .replace(/\s+\d+\s*$/, '')       // remove número isolado no final
    .replace(/\s{2,}/g, ' ')         // colapsa espaços múltiplos
    .trim();
};
```

**Regras:**
- Remove todas as ocorrências de `_` e `*`
- Remove número isolado no final (ex: `"TÍTULO DA NOTA 42"` → `"TÍTULO DA NOTA"`) — apenas quando precedido de espaço, para não remover números que fazem parte do título semântico
- Colapsa espaços múltiplos em espaço simples
- Retorna string sem modificação além de trim se já estiver limpa

### `parseTocLines` — mudanças em `bulletinParserService.ts`

**Filtro de saída mais agressivo** no `.filter()` final:

```typescript
.filter(item => {
  // Rejeita itens cujo cleanTitle ainda contém artefatos
  if (/_{2,}/.test(item.cleanTitle)) return false;
  if (/\*{2,}/.test(item.cleanTitle)) return false;
  // Rejeita itens que são só número
  if (/^\d+$/.test(item.cleanTitle.trim())) return false;
  // Lógica existente: tem conteúdo e (é cabeçalho OU tem página)
  const hasContent = item.originalRaw.replace(/[^a-zA-ZáéíóúâêîôûãõçÁÉÍÓÚÂÊÎÔÛÃÕÇ]/g, '').length > 3;
  return hasContent && (item._isHeader || item.isSemAlteracao || item.expectedPage !== null);
})
```

**Aplicação de `cleanNoteTitle`** ao criar SummaryItems de Nota:

```typescript
// Antes (linha de Nota):
pending.push({ ..., cleanTitle: normalizeTitle(titleNorm), ... });

// Depois:
pending.push({ ..., cleanTitle: normalizeTitle(cleanNoteTitle(titleNorm)), ... });
```

### `formatTocForDisplay` — mudanças em `bulletinParserService.ts`

**Para Notas**: usa `item.cleanTitle` em vez de `item.originalRaw`.

**Para cabeçalhos** (Parte/Seção/Letra): usa `item.originalRaw` que já é o label canônico (preenchido pelo `parseTocLines` com `canonical.label`).

**Garantia de saída limpa**: nenhuma linha de saída pode conter `___`, `**`, ou `[p. null]`.

```typescript
// Antes (Nota):
displayText = item.cleanTitle;  // já era cleanTitle, mas originalRaw era usado em alguns casos

// Depois (Nota — explícito):
displayText = item.cleanTitle;  // sempre cleanTitle, nunca originalRaw

// Garantia adicional:
const safePage = item.expectedPage !== null ? `  [p. ${item.expectedPage}]` : '';
```

### `parseSumarioLines` — mudanças em `SumarioView.tsx`

**Limpeza defensiva** no campo `text` de cada `SumarioEntry`:

```typescript
// Após extrair o texto da linha:
text = text
  .replace(/_{2,}/g, '')          // remove sequências de underscores
  .replace(/\*{2,}/g, '')         // remove sequências de asteriscos
  .replace(/\s+\d+\s*$/, '')      // remove número isolado no final
  .replace(/\s{2,}/g, ' ')        // normaliza espaços
  .trim();
```

Esta limpeza é defensiva — não deve ser necessária se os estágios anteriores funcionarem corretamente, mas garante que artefatos que escapem não apareçam na interface.

## Data Models

### `SummaryItem` — sem mudança de interface

```typescript
export interface SummaryItem {
  cleanTitle: string;      // título normalizado e limpo de artefatos
  originalRaw: string;     // para cabeçalhos: label canônico; para notas: texto bruto (não usado na exibição)
  expectedPage: number | null;
  foundLineIndex?: number;
  hierarchy?: string;
  parentCategory?: string;
  isSemAlteracao?: boolean;
}
```

A semântica de `originalRaw` muda sutilmente: para itens canônicos (Parte/Seção/Letra), já é preenchido com `canonical.label` pelo `parseTocLines` atual. Para Notas, continua sendo o texto bruto — mas `formatTocForDisplay` passa a ignorá-lo para notas.

### `SumarioEntry` — sem mudança de interface

```typescript
interface SumarioEntry {
  text: string;    // texto limpo, pronto para renderização
  page: string | null;
  level: Level;
}
```

O campo `text` agora é garantidamente livre de artefatos após a limpeza defensiva em `parseSumarioLines`.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

**Property 1: `cleanNoteTitle` remove todos os artefatos**

*Para qualquer* string de título de nota (incluindo strings com underscores, asteriscos, espaços múltiplos e números isolados no final), a função `cleanNoteTitle` deve retornar uma string que: (a) não contém `_` nem `*`; (b) não termina com um número isolado precedido de espaço; (c) não contém sequências de dois ou mais espaços consecutivos.

**Validates: Requirements 4.1, 4.2, 4.3**

---

**Property 2: `cleanNoteTitle` é idempotente**

*Para qualquer* string de entrada, aplicar `cleanNoteTitle` duas vezes deve produzir o mesmo resultado que aplicar uma vez: `cleanNoteTitle(cleanNoteTitle(x)) === cleanNoteTitle(x)`.

**Validates: Requirements 4.4**

---

**Property 3: `parseTocLines` produz notas sem artefatos e com página**

*Para qualquer* bloco de linhas de sumário, todos os `SummaryItem`s de tipo Nota produzidos por `parseTocLines` devem satisfazer simultaneamente: (a) `cleanTitle` não contém `___` nem `**`; (b) `expectedPage` não é `null`.

**Validates: Requirements 1.1, 1.2, 1.4**

---

**Property 4: `formatTocForDisplay` produz saída livre de artefatos**

*Para qualquer* lista de `SummaryItem`s, cada linha produzida por `formatTocForDisplay` deve: (a) não conter as sequências `___` nem `**`; (b) não conter `[p. null]`; (c) não conter `[p. X]` mais de uma vez na mesma linha.

**Validates: Requirements 2.3, 2.4**

---

**Property 5: `parseSumarioLines` produz entradas com `text` limpo**

*Para qualquer* string de markdown de sumário (incluindo strings com `___`, `**` e números isolados no final), cada `SumarioEntry` produzida por `parseSumarioLines` deve ter o campo `text` sem as sequências `___`, `**`, sem número isolado no final, e sem espaços múltiplos consecutivos.

**Validates: Requirements 3.1, 3.2**

## Error Handling

- Se `cleanNoteTitle` receber string vazia ou só espaços, retorna string vazia após trim — sem erro.
- Se `formatTocForDisplay` receber lista vazia, retorna string vazia — sem erro.
- Se `parseSumarioLines` receber string vazia, retorna array vazio — sem erro.
- Artefatos que passarem pelo filtro de `parseTocLines` são capturados pela limpeza defensiva em `parseSumarioLines` — dupla proteção.

## Testing Strategy

### Property-Based Testing

Biblioteca: **fast-check** (já presente no projeto, usada em `textUtils.test.ts`).

Cada propriedade acima deve ser implementada como um teste `fc.property` com mínimo de 100 iterações.

Formato obrigatório de anotação em cada teste:
```
// **Feature: bulletin-toc-extraction, Property N: <texto da propriedade>**
// **Validates: Requirements X.Y**
```

**Geradores sugeridos:**

- Para Property 1 e 2: `fc.string()` com injeção de `_`, `*` e números no final via `fc.oneof`.
- Para Property 3: gerar arrays de strings que misturam linhas canônicas (Parte/Seção) com linhas de nota no formato `"N. TÍTULO___ARTEFATO"` seguidas de número de página.
- Para Property 4: gerar `SummaryItem[]` com `cleanTitle` limpo mas `originalRaw` contendo artefatos, verificar que a saída de `formatTocForDisplay` não os repassa.
- Para Property 5: gerar strings de markdown com prefixos `NOTA:`, `PARTE:`, `SECAO:` e texto contendo artefatos.

### Unit Tests

- `cleanNoteTitle`: exemplos concretos — string com `___`, string com `**`, string terminando em ` 42`, string já limpa.
- `parseTocLines`: exemplo com bloco real de sumário contendo artefatos, verificar que `cleanTitle` das notas está limpo.
- `formatTocForDisplay`: exemplo com SummaryItem de nota onde `originalRaw` tem artefatos mas `cleanTitle` está limpo — verificar que a saída usa `cleanTitle`.
- `parseSumarioLines`: exemplo com linha `NOTA:TÍTULO DA NOTA___42  [p. 15]` — verificar que `text` é `"TÍTULO DA NOTA"`.

### Dual Approach

Unit tests cobrem casos concretos e edge cases (string só com underscores, string vazia, nota sem número de página). Property tests verificam que as propriedades valem para entradas geradas aleatoriamente com fast-check.
