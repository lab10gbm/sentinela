# Sessão: Comparação BOL037 × App — Catálogo de Erros de Formatação

## Prompt de Início de Sessão

Estamos desenvolvendo o **Sentinela**, um app Next.js que extrai e formata notas de boletins militares (PDF) da SEDEC/CBMERJ. O pipeline é:

```
PDF → pdfWorkerService.ts → bulletinParserService.ts → joinWrappedParagraphs() → NotasView.tsx
```

Nesta sessão vamos **comparar o BOL037 (02/03/2026) nota por nota com o app** e catalogar todos os erros de formatação. O objetivo é entender os padrões de erro para corrigi-los de forma sistemática.

**Arquivos principais:**
- `src/services/textUtils.ts` — `joinWrappedParagraphs`, `isPageHeaderOrFooter`, `detectTableStructure`
- `src/services/bulletinParserService.ts` — localização de notas, `cleanAndFormatSlice`
- `src/services/pdfWorkerService.ts` — extração de tokens, detecção de bold

---

## Estado Atual (o que já foi corrigido nesta sessão)

### Correções aplicadas
1. **`isPageHeaderOrFooter`** — detecta `BBOOLLEETTIIMM DDAA SSEEDDEECC` (letras duplicadas por kerning). Regra: ≥ 4 pares de **letras** duplicadas consecutivas (não números/símbolos).
2. **`allLines` no bulletinParserService** — linhas com letras separadas (artefato de kerning) são filtradas antes de entrar no array de busca.
3. **Bold híbrido** — threshold usa a fonte mais leve com ≥ 5 amostras (ignora fontes de símbolo com poucas amostras).
4. **`\x00PARABREAK\x00`** — marcador inviolável de quebra de parágrafo inserido pelo `cleanAndFormatSlice` quando Y-gap > 18px. O joiner nunca descarta.
5. **Separação de parágrafos por pontuação** — quando linha termina com `.` e próxima começa com maiúscula (não é continuação), insere linha vazia.
6. **`isMilitaryDataLine`** — só se aplica a linhas curtas (< 80 chars). Linhas longas com RG no meio são parágrafos narrativos.
7. **`isListItem` e `nextIsListItem`** — regex mais preciso: só casa com `"1. "`, `"1) "`, `"a) "`, não com `"03 (três)"` ou `"de "`.
8. **`endsWithPreposition`** — linha terminando com preposição/artigo sempre une com a próxima (ex: `"no prazo de"` + `"03 (três) dias"`).
9. **`isTitleContinuationFragment`** — fragmentos `NNN/20XX` são reconhecidos como continuação de título (ex: `"017/2026"` após título de nota).
10. **Fallback posicional** — nota não localizada pelo título tenta busca por número (`"4."`) e depois por posição sequencial (página esperada ± 3).
11. **UI** — botão "EXTRATOR" é o principal (vermelho). "INICIAR VARREDURA LOCAL" está desabilitado com nota "em pausa".

### Problemas conhecidos ainda abertos
- **1ª PARTE e 2ª PARTE não localizadas** — o corpo do PDF não tem a linha `"1ª PARTE - SERVIÇOS DIÁRIOS"` no formato esperado.
- **3ª PARTE não localizada** — mesmo problema.
- **5ª PARTE (COMUNICAÇÃO SOCIAL) não localizada**.
- **ANEXO II (NOTA GOCG 222/2026) não localizado** — o localizador encontra o ANEXO II da NOTA DGEI/CFAP 054/2026 em vez do correto.
- **Várias notas da 2ª PARTE não localizadas** — PLANO DE CAPACITAÇÃO (1 e 2), INSPEÇÃO DE SAÚDE PERIÓDICA, CURSO CHOAE, CURSO CBSOC.
- **Nota 4 da 4ª PARTE (SINDICÂNCIA - PRORROGAÇÃO)** — título perdido na extração. Fallback posicional melhorado (exige letra maiúscula após número para evitar falsos positivos).
- **Duas notas 5 na 4ª PARTE** — erro do documento oficial (numeração duplicada). Ambas devem ser preservadas com títulos distintos.

---

## Estrutura do BOL037

### Sumário (referência)
```
ABERTURA DO BOLETIM
  FATOS HISTÓRICOS
  ESTATÍSTICA DE SOCORROS PRESTADOS
  TENDÊNCIA METEOROLÓGICA

1ª PARTE - SERVIÇOS DIÁRIOS
  1. SERVIÇO PARA O DIA: 03 DE MARÇO DE 2026
  2. ESCALA DE SERVIÇO - OFICIAL DE LIGAÇÃO DO CBMERJ AO COR
  3. ESCALA DE SERVIÇO - COMANDANTE DO 1º SOCORRO E DE BUSCA E SALVAMENTO
  ANEXO I - NOTA CHEMG 212/2026
  ANEXO II - NOTA GOCG 222/2026

2ª PARTE - OPERAÇÕES E INSTRUÇÃO
  I - OPERAÇÕES (SEM ALTERAÇÃO)
  II - INSTRUÇÃO
    1. PLANO DE CAPACITAÇÃO DE PESSOAS - NOTA SUSAU 025/2026
    2. PLANO DE CAPACITAÇÃO DE PESSOAS - NOTA SUSAU 026/2026
    3. INSPEÇÃO DE SAÚDE PERIÓDICA ISP/2026 - NOTA DGO 045/2026
    4. CURSO DE HABILITAÇÃO AO OFICIALATO (CHOAE/2025) - NOTA DGEI/CFAP 054/2026
    5. CURSO DE HABILITAÇÃO AO OFICIALATO (CHOAE/2025) - NOTA DGEI/CFAP 033/2026
    6. CURSO BÁSICO DE SOCORRISTA (CBSOC/2026) - NOTA DI/DIV INST/CBSOC 006/2026
    ANEXO II - NOTA DGEI/CFAP 054/2026

3ª PARTE - ASSUNTOS GERAIS E ADMINISTRATIVOS
  I - ASSUNTOS GERAIS
    1-8. REUNIÕES E CONVOCAÇÕES
    7. SECRETARIA DAS COMISSÕES DE PROMOÇÕES - NOTA SCP 027/2026
    8. ATA DA REUNIÃO DA COMISSÃO DE PROMOÇÃO DE PRAÇAS - NOTA SCP 028/2026
  II - ASSUNTOS ADMINISTRATIVOS (não localizado)
  A - ALTERAÇÕES DE OFICIAIS
    1-9. (várias notas)
  A1 - ALTERAÇÕES DE PRAÇAS ESPECIAIS
  B - ALTERAÇÕES DE PRAÇAS
    1-10. (várias notas)
  C - ALTERAÇÕES DE CIVIS (SEM ALTERAÇÃO)
  1. DOERJ DO PODER EXECUTIVO Nº 037
  2-5. (várias notas administrativas)

4ª PARTE - JUSTIÇA E DISCIPLINA
  1. OFÍCIO RECEBIDO - NOTA CGS/SRD 008/2026
  2. INQUÉRITO SANITÁRIO DE ORIGEM (ISO) - NOTA DGP/GAB.DIR. 017/2026
  3. IPM - INSTAURAÇÃO E DESIGNAÇÃO - NOTA CI/JD 135/2026
  4. SINDICÂNCIA - PRORROGAÇÃO - NOTA CGS/SRD 004/2026  ← título perdido na extração
  5. SINDICÂNCIA - SUBSTITUIÇÃO DE ENCARREGADO - NOTA CI/JD 141/2026
  5. PROCESSO ADMINISTRATIVO DISCIPLINAR - NOTA CHEMG 211/2026  ← numeração duplicada no PDF
  6. PROCEDIMENTO ADMINISTRATIVO DISCIPLINAR - NOTA DGP/4 016/2025

5ª PARTE - COMUNICAÇÃO SOCIAL (não localizada)
  1. PALESTRAS SOBRE SAÚDE DO SONO - NOTA CHEMG 216/2026

ANEXO I - NOTA CHEMG 212/2026
ANEXO II - NOTA GOCG 222/2026 (não localizado — confunde com ANEXO II DGEI/CFAP)
```

---

## Catálogo de Erros a Verificar

Para cada nota abaixo, comparar o PDF com o app e registrar:

### Categoria A — Erros de Texto / Parágrafos

| Nota | Erro Observado | Status |
|------|---------------|--------|
| 2. ISO - NOTA DGP/GAB.DIR. 017/2026 | 4 parágrafos "Considerando" fundidos | ✅ Corrigido |
| 2. ISO | "017/2026" aparecia no início do conteúdo | ✅ Corrigido |
| 2. ISO | "exarada pela / Junta Ordinária" quebrado | ✅ Corrigido |
| 3. IPM - NOTA CI/JD 135/2026 | "no prazo de / 03 (três) dias" quebrado | ✅ Corrigido |
| 3. IPM | "ANDRÉLUIZ" sem espaço (bold fragmentado) | ⚠️ A verificar |
| 4. SINDICÂNCIA - PRORROGAÇÃO | Sem título (perdido na extração) | ⚠️ Fallback melhorado (exige maiúscula após número) |
| Nota 5 duplicada (erro do PDF) | Nota 5 engolida dentro da nota 4 | ✅ Corrigido — parseTocLines não funde notas com números diferentes; sanidade preserva ambas as notas 5 quando títulos distintos |
| Todas as notas com "Considerando" | Parágrafos fundidos | ✅ Corrigido |
| Notas com itens numerados | Quebra no meio da frase | ✅ Corrigido |

### Categoria B — Erros de Localização / Hierarquia

| Nota | Erro Observado | Status |
|------|---------------|--------|
| 1ª PARTE - SERVIÇOS DIÁRIOS | Não localizada | ❌ Aberto |
| 2ª PARTE - OPERAÇÕES E INSTRUÇÃO | Não localizada | ❌ Aberto |
| 3ª PARTE - ASSUNTOS GERAIS | Não localizada | ❌ Aberto |
| 5ª PARTE - COMUNICAÇÃO SOCIAL | Não localizada | ❌ Aberto |
| PLANO DE CAPACITAÇÃO 1 e 2 | Não localizados | ❌ Aberto |
| INSPEÇÃO DE SAÚDE PERIÓDICA | Não localizada | ❌ Aberto |
| CURSO CHOAE (nota 5) | Não localizado | ❌ Aberto |
| CURSO CBSOC (nota 6) | Não localizado | ❌ Aberto |
| SECRETARIA DAS COMISSÕES (nota 7) | Não localizada | ❌ Aberto |
| ATA DA REUNIÃO (nota 8) | Não localizada | ❌ Aberto |
| II - ASSUNTOS ADMINISTRATIVOS | Não localizado | ❌ Aberto |
| ANEXO II - NOTA GOCG 222/2026 | Localiza errado (DGEI/CFAP) | ❌ Aberto |
| Notas 1-4 da 3ª PARTE (REUNIÕES) | Localizadas em notas erradas (+1 offset) | ⚠️ A verificar |

### Categoria C — Erros de Tabela

| Nota | Erro Observado | Status |
|------|---------------|--------|
| TENDÊNCIA METEOROLÓGICA | Tabela correta? | ⚠️ A verificar |
| ESTATÍSTICA DE SOCORROS | Tabela correta? | ⚠️ A verificar |
| ESCALA DE SERVIÇO | Tabela ou texto corrido? | ⚠️ A verificar |
| EFETIVO (3ª PARTE) | Tabelas densas — OK pelo log | ✅ Provável OK |
| Formulários esparsos | `Found 0 peaks` → LAYOUT PRESERVATION | ⚠️ A verificar |

### Categoria D — Erros de Bold / Formatação Visual

| Nota | Erro Observado | Status |
|------|---------------|--------|
| Títulos das notas | Sublinhado + negrito corretos | ✅ OK |
| "ANDRÉLUIZ" sem espaço | Bold fragmentado une tokens sem espaço | ⚠️ A verificar |
| Nomes em bold no corpo | Ex: "ROBERTO CARLOS CAMPOS SEQUEIRA" | ⚠️ A verificar |

---

## Como Iniciar a Próxima Sessão

1. Compartilhe este arquivo (`SESSAO_BOL037_COMPARACAO.md`) no chat
2. Abra o PDF `boletins/BOLETIM DA SEDEC N 037 DE 02-03-2026.pdf` lado a lado com o app
3. Processe o BOL037 no app (botão EXTRATOR)
4. Comece pela **Categoria B** (notas não localizadas) — são os erros de maior impacto
5. Para cada nota, descreva o que vê no PDF vs. o que aparece no app

**Ordem de prioridade sugerida:**
1. Por que 1ª, 2ª, 3ª PARTE não são localizadas? (afeta hierarquia de todas as notas)
2. Notas da 2ª PARTE não localizadas (PLANO DE CAPACITAÇÃO, etc.)
3. Offset nas notas de REUNIÃO da 3ª PARTE
4. ANEXO II confundido
5. Erros de texto restantes (bold fragmentado, etc.)
6. Tabelas

---

## Contexto Técnico Rápido

### Pipeline resumido
```
PDF
 └─ pdfWorkerService.extractTextFromPdf()
     ├─ tokens (x, y, text, fontName, isBold)
     ├─ bold: fontName → fallback híbrido (densidade, por página)
     ├─ agrupamento por Y → sortedLines
     └─ splitFormFieldLines() → processedLines
         └─ bulletinParserService.extractBulletinLocalAlgo()
             ├─ extractTocBlock() → linhas do sumário (páginas 1-3)
             ├─ parseTocLines() → SummaryItem[]
             ├─ allLines (filtrado: sem headers/rodapés)
             ├─ busca por anchoredSpace/searchSpace/searchSuffix/bold/posição
             └─ cleanAndFormatSlice() → BulletinNota[]
                 ├─ Y-gap > 18px → \x00PARABREAK\x00
                 ├─ detectTableStructure() / isTableHeader()
                 ├─ reconstructTable() [3 estratégias]
                 └─ joinWrappedParagraphs()
```

### Fontes do BOL037
Todas as 4 fontes retornam `family="sans-serif" common=null` — bold detectado 100% por análise híbrida de densidade. Threshold: fonte mais leve com ≥ 5 amostras × 1.15.

### Busca de notas (ordem de tentativas)
1. `anchoredSpace`: `"4 SINDICANCIA PRORROGACAO NOTA CGS"` (número + 4 palavras)
2. `searchSpace`: 5 primeiras palavras sem número
3. `searchSuffix`: 3 últimas palavras
4. Busca global (sem `currentSearchLine`)
5. Bold: linha com > 60% tokens bold e 2+ palavras do título
6. **NOVO** Por número: `"4."` no início da linha
7. **NOVO** Por posição: `currentSearchLine` se página esperada ± 3
