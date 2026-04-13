# Plano de Refatoração e Modularização — Projeto Sentinela

## Diagnóstico Atual

### Problemas Identificados

**1. Lógica duplicada em 4 lugares diferentes**
A lista `formFields` e a lógica de detecção/quebra de campos de formulário existe em:
- `pdfWorkerService.ts` (extração)
- `textUtils.ts` (joinWrappedParagraphs)
- `NotasView.tsx` (renderParagraphs)
- `NotasView.tsx` (handleCopy)

Isso causou o bug que levamos horas para resolver: a correção aplicada em um lugar era desfeita em outro.

**2. Responsabilidades misturadas**
- `NotasView.tsx` (1227 linhas) faz: renderização, lógica de negócio, formatação de texto, geração de HTML para clipboard, detecção de campos de formulário, pré-processamento de markdown.
- `bulletinParserService.ts` (783 linhas) faz: parsing, montagem de notas, formatação de texto, detecção de tabelas, limpeza de linhas.
- `textUtils.ts` (1008 linhas) acumula funções sem coesão clara.

**3. Pipeline de processamento sem contrato definido**
O texto passa por múltiplas transformações sem uma sequência clara e documentada:
```
PDF → pdfWorkerService → bulletinParserService → joinWrappedParagraphs → renderParagraphs → handleCopy
```
Cada etapa pode modificar o mesmo aspecto do texto, criando conflitos invisíveis.

**4. Ausência de testes unitários significativos**
`textUtils.test.ts` existe mas cobre apenas casos básicos. Nenhuma das correções recentes tem cobertura de teste.

---

## Arquitetura Proposta

### Princípio Central
**Single Responsibility + Single Source of Truth**

Cada transformação de texto deve acontecer em **um único lugar**, em **uma única etapa** do pipeline, com **contrato claro de entrada e saída**.

### Nova Estrutura de Diretórios

```
src/
├── core/                          ← NOVO: lógica de domínio pura
│   ├── constants/
│   │   └── formFields.ts          ← lista única de campos de formulário
│   ├── pdf/
│   │   ├── tokenExtractor.ts      ← extração de tokens do PDF.js
│   │   ├── boldDetector.ts        ← detecção de negrito (híbrida)
│   │   └── lineGrouper.ts         ← agrupamento de tokens em linhas
│   ├── text/
│   │   ├── lineClassifier.ts      ← classifica cada linha (header, form, list, etc.)
│   │   ├── paragraphJoiner.ts     ← une linhas em parágrafos (sem duplicação)
│   │   ├── formFieldSplitter.ts   ← quebra campos de formulário (único lugar)
│   │   └── markdownCleaner.ts     ← remove/normaliza marcadores **
│   ├── bulletin/
│   │   ├── tocExtractor.ts        ← extração do sumário
│   │   ├── tocParser.ts           ← parsing das linhas do sumário
│   │   ├── bodyLocator.ts         ← localiza notas no corpo
│   │   └── notaBuilder.ts         ← monta objetos BulletinNota
│   └── export/
│       ├── htmlRenderer.ts        ← converte markdown → HTML (Word/clipboard)
│       └── plainTextRenderer.ts   ← converte markdown → texto plano
│
├── services/                      ← MANTIDO: orquestração e I/O
│   ├── pdfWorkerService.ts        ← orquestra core/pdf/* (muito mais simples)
│   ├── bulletinParserService.ts   ← orquestra core/bulletin/* (muito mais simples)
│   ├── calibrationService.ts      ← sem mudança
│   ├── dbService.ts               ← sem mudança
│   ├── geminiService.ts           ← sem mudança
│   └── TableReconstructor.ts      ← sem mudança (já bem isolado)
│
├── components/                    ← REFATORADO: apenas UI
│   ├── NotasView.tsx              ← apenas renderização, sem lógica de texto
│   ├── NotaCard.tsx               ← NOVO: card individual extraído de NotasView
│   ├── ResultsView.tsx            ← sem mudança estrutural
│   └── ...
│
└── hooks/
    ├── useBulletinPipeline.ts     ← sem mudança estrutural
    └── ...
```

---

## Fases de Execução

### FASE 1 — Fundação: Constants e Contratos
**Objetivo:** Eliminar duplicação de dados e definir tipos claros.
**Risco:** Baixo. Sem mudança de comportamento.

#### 1.1 Criar `src/core/constants/formFields.ts`
```typescript
// Fonte única de verdade para campos de formulário
export const FORM_FIELD_NAMES = [
  'Data', 'Horário', 'Horario', 'Local',
  'Endereço', 'Endereco', 'Palestrante',
  'Tema', 'Período', 'Periodo',
  'Uniforme', 'Traje', 'Local de Apresentação'
] as const;

export type FormFieldName = typeof FORM_FIELD_NAMES[number];
export const FORM_FIELD_PATTERN = new RegExp(`(${FORM_FIELD_NAMES.join('|')}):`, 'gi');
export const FORM_FIELD_START_PATTERN = new RegExp(`^(${FORM_FIELD_NAMES.join('|')}):`, 'i');
```

#### 1.2 Revisar e consolidar `src/types.ts`
- Adicionar tipos para `ProcessedLine`, `ParsedParagraph`, `RenderToken`
- Documentar o contrato de cada etapa do pipeline

**Arquivos afetados:** `types.ts` (novo conteúdo), novo arquivo `formFields.ts`
**Testes:** Nenhum necessário (apenas constantes)

---

### FASE 2 — Core Text: Módulo de Processamento de Texto
**Objetivo:** Centralizar toda lógica de texto em `src/core/text/`.
**Risco:** Médio. Requer testes antes de substituir.

#### 2.1 Criar `src/core/text/formFieldSplitter.ts`
Extrai a lógica de quebra de campos de formulário de todos os 4 lugares onde existe hoje.

```typescript
import { FORM_FIELD_NAMES } from '../constants/formFields';

/**
 * Quebra uma linha com múltiplos campos de formulário em linhas separadas.
 * Ex: "Data: 16/03; Horário: 10h; Local: Auditório" → 3 linhas
 * 
 * Esta é a ÚNICA implementação desta lógica no projeto.
 */
export function splitFormFieldLine(line: string): string[] { ... }

/**
 * Aplica splitFormFieldLine a um array de linhas.
 */
export function splitFormFieldLines(lines: string[]): string[] { ... }

/**
 * Detecta se uma linha contém múltiplos campos de formulário.
 */
export function hasMultipleFormFields(line: string): boolean { ... }

/**
 * Detecta se uma linha É um campo de formulário (começa com "Campo:").
 */
export function isFormFieldLine(line: string): boolean { ... }
```

#### 2.2 Criar `src/core/text/lineClassifier.ts`
Centraliza todas as funções de classificação de linha que hoje estão espalhadas.

```typescript
export type LineType =
  | 'header'        // CAIXA ALTA, título de seção
  | 'form-field'    // "Data: ...", "Horário: ..."
  | 'list-item'     // "1.", "a)", "-"
  | 'table-row'     // contém "|" ou é cabeçalho de tabela
  | 'military-data' // contém "RG \d", "Id Funcional"
  | 'page-marker'   // "FL. 1", "--- [INÍCIO DA PÁGINA"
  | 'toc-line'      // linha do sumário com "___N"
  | 'paragraph'     // texto normal de parágrafo

export function classifyLine(line: string, tokens?: TextToken[]): LineType { ... }
```

#### 2.3 Refatorar `src/core/text/paragraphJoiner.ts`
Substitui `joinWrappedParagraphs` com implementação limpa baseada em `lineClassifier`.

```typescript
/**
 * Une linhas quebradas de PDF em parágrafos coerentes.
 * Usa lineClassifier para decidir quando unir ou preservar quebras.
 * NÃO faz quebra de campos de formulário (responsabilidade do formFieldSplitter).
 */
export function joinWrappedParagraphs(lines: string[]): string[] { ... }
```

**Testes obrigatórios antes de substituir:**
- Campos de formulário nunca são unidos
- Títulos em CAIXA ALTA nunca são unidos com linha seguinte
- Parágrafos normais são unidos corretamente
- Linhas com militares (RG) nunca são unidas

---

### FASE 3 — Core PDF: Módulo de Extração
**Objetivo:** Separar as responsabilidades dentro do `pdfWorkerService.ts`.
**Risco:** Médio-alto. Núcleo da extração.

#### 3.1 Criar `src/core/pdf/boldDetector.ts`
Extrai a lógica de detecção de negrito (hoje ~80 linhas no meio do pdfWorkerService).

```typescript
export interface FontAnalysis {
  fontName: string;
  isBold: boolean;
  isItalic: boolean;
}

export function detectBoldByFontName(fontName: string, fontFamily: string): boolean { ... }
export function detectBoldByDensityAnalysis(tokens: RawToken[]): Set<string> { ... }
```

#### 3.2 Criar `src/core/pdf/lineGrouper.ts`
Extrai o agrupamento de tokens em linhas visuais.

```typescript
/**
 * Agrupa tokens por coordenada Y (tolerância configurável).
 * Retorna linhas ordenadas de cima para baixo, tokens da esquerda para direita.
 */
export function groupTokensIntoLines(
  tokens: RawToken[],
  yTolerance: number = 4
): LineGroup[] { ... }

/**
 * Renderiza um grupo de tokens em texto com marcadores de formatação (**bold**).
 */
export function renderLineGroup(group: LineGroup): string { ... }
```

#### 3.3 Simplificar `pdfWorkerService.ts`
Após extrair os módulos acima, o serviço vira um orquestrador simples:

```typescript
// Antes: 415 linhas com lógica misturada
// Depois: ~100 linhas de orquestração clara

export const extractTextFromPdf = async (file: File) => {
  const pdf = await loadPdf(file);
  
  for (const page of pages) {
    const rawTokens = await extractRawTokens(page);
    const boldFonts = detectBoldByDensityAnalysis(rawTokens);
    const tokens = applyBoldDetection(rawTokens, boldFonts);
    const lineGroups = groupTokensIntoLines(tokens);
    const lines = lineGroups.map(renderLineGroup);
    const processedLines = splitFormFieldLines(lines); // ← único lugar
    pageMap.push({ page: i, lines: processedLines, tokens });
  }
};
```

---

### FASE 4 — Core Bulletin: Módulo de Parsing
**Objetivo:** Separar as responsabilidades dentro do `bulletinParserService.ts`.
**Risco:** Alto. Lógica complexa de negócio.

#### 4.1 Isolar `src/core/bulletin/bodyLocator.ts`
A lógica de localização de notas no corpo (hoje ~150 linhas no bulletinParserService).

#### 4.2 Isolar `src/core/bulletin/notaBuilder.ts`
A lógica de montagem de `BulletinNota` a partir de slices de linhas.

#### 4.3 Simplificar `bulletinParserService.ts`
```typescript
// Antes: 783 linhas
// Depois: ~200 linhas de orquestração

export const extractBulletinLocalAlgo = async (file, personnel, keywords, prefs) => {
  const { pageMap } = await extractTextFromPdf(file);
  const allLines = flattenPageMap(pageMap);
  
  const tocLines = extractTocBlock(pageMap);
  const summaryItems = parseTocLines(tocLines);
  const locatedItems = locateItemsInBody(summaryItems, allLines);
  const notas = buildNotas(locatedItems, allLines);
  
  return notas;
};
```

---

### FASE 5 — Core Export: Módulo de Renderização
**Objetivo:** Remover lógica de texto do `NotasView.tsx`.
**Risco:** Baixo-médio. Apenas mover código existente.

#### 5.1 Criar `src/core/export/htmlRenderer.ts`
```typescript
/**
 * Converte contentMarkdown de uma BulletinNota em HTML formatado
 * para cópia no Word/LibreOffice.
 * 
 * Aplica formFieldSplitter antes de processar.
 */
export function renderNotaToHtml(nota: BulletinNota, filteredRows?: Map<...>): string { ... }
```

#### 5.2 Criar `src/core/export/plainTextRenderer.ts`
```typescript
export function renderNotaToPlainText(nota: BulletinNota): string { ... }
```

#### 5.3 Refatorar `NotasView.tsx`
- Remove `handleCopy` inline → usa `renderNotaToHtml` + `renderNotaToPlainText`
- Remove `renderParagraphs` inline → move para `src/core/export/reactRenderer.tsx`
- Remove pré-processamento de campos → já feito no pipeline
- Resultado: componente de ~400 linhas focado apenas em UI

---

### FASE 6 — Testes e Validação
**Objetivo:** Garantir que a refatoração não quebrou nada.

#### 6.1 Testes unitários para cada módulo core
```
src/core/text/formFieldSplitter.test.ts
src/core/text/lineClassifier.test.ts
src/core/text/paragraphJoiner.test.ts
src/core/pdf/boldDetector.test.ts
src/core/export/htmlRenderer.test.ts
```

#### 6.2 Testes de integração
- Processar boletim 037 e verificar nota "PALESTRAS SOBRE SAÚDE DO SONO"
- Processar boletins 054, 058 e verificar formatação geral
- Verificar que o botão copiar produz HTML correto

#### 6.3 Snapshot tests para regressão
Salvar o output atual de notas conhecidas como "golden files" e comparar após refatoração.

---

## Ordem de Execução Recomendada

| Fase | Prioridade | Risco | Impacto | Duração Estimada |
|------|-----------|-------|---------|-----------------|
| 1 — Constants | Alta | Baixo | Elimina duplicação de dados | 1 sessão |
| 2 — Core Text | Alta | Médio | Resolve a classe de bugs que tivemos | 2 sessões |
| 5 — Core Export | Média | Baixo | Limpa NotasView | 1 sessão |
| 3 — Core PDF | Média | Médio-Alto | Melhora manutenibilidade da extração | 2 sessões |
| 4 — Core Bulletin | Baixa | Alto | Maior ganho de longo prazo | 3 sessões |
| 6 — Testes | Alta | Baixo | Garante qualidade | 1 sessão por fase |

**Regra de ouro:** Cada fase deve ser completada com testes passando antes de iniciar a próxima.

---

## Princípios de Qualidade a Seguir

1. **Sem lógica de texto em componentes React** — componentes apenas recebem dados prontos
2. **Sem lógica de negócio em serviços de I/O** — serviços apenas orquestram
3. **Uma constante, um lugar** — `FORM_FIELD_NAMES` definido uma vez, importado em todos
4. **Pipeline explícito** — cada etapa recebe e retorna tipos bem definidos
5. **Testes antes de refatorar** — nunca mover código sem ter testes que provem que funciona
6. **Commits atômicos** — cada módulo extraído em commit separado com mensagem clara

---

## Contexto para Próxima Conversa

Para iniciar a refatoração, compartilhe este arquivo e diga qual fase deseja começar.
Recomendo começar pela **Fase 1** (constants) e **Fase 2.1** (formFieldSplitter) pois:
- Eliminam imediatamente a classe de bugs que tivemos hoje
- Risco baixo
- Resultado visível rapidamente
