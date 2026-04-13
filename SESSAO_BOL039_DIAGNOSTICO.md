# SESSÃO DIAGNÓSTICO BOL039 - 04/03/2026

**Problemas Identificados:**
- [X] **Nota 1. DIRETRIZES PARA O RECEBIMENTO DA “MEDALHA MÉRITO MARÍTIMO BOMBEIRO MILITAR”** (GAB/CMDO-GERAL 065/2026): O item "2. Referencias" está sendo reconhecido como título de nota, partindo a nota 1 em duas.

**Análise:**
A nota 1 do BOL039 contém um item interno "2. Referencias". O extrator, ao encontrar uma linha que começa com número e letra maiúscula, e que é bold, a identifica como uma nota órfã (nota que não está no sumário mas existe no corpo). Como "Referencias" começa com "R" (maiúscula) e o número "2" é maior que o número da nota atual (1), o sistema erroneamente a promoveu a nota independente.

**Correções:**
- [X] Adicionado `REFERÊNCIAS` aos filtros `INTERNAL_SECTION_FB` e `INTERNAL_SECTION_HEADERS` em `bulletinParserService.ts`. Isso impede que subseções internas com este nome sejam tratadas como notas independentes.

---

**Problema 2 — "3. UNIFORME" tratado como nota independente**

- [X] **Nota 1. DIRETRIZES PARA O RECEBIMENTO DA "MEDALHA MÉRITO MARÍTIMO BOMBEIRO MILITAR"**: O item "3. UNIFORME" (antes era "2. REFERENCIAS") está sendo reconhecido como nota órfã, partindo a nota 1 em duas.

**Análise:**
O detector de órfãos encontrava "3. UNIFORME" bold dentro do gap da nota 1, com `candidateNum=3 > currNoteNum=1`, passando todos os filtros existentes. A causa raiz: a nota contém subtópicos internos numerados a partir de "1." (1. DATA, HORA E LOCAL / 2. REFERÊNCIAS / 3. UNIFORME / ...). O guia já documenta que "numeração reiniciada em 1 dentro de uma nota é sempre subtítulo interno", mas o código não verificava isso.

**Correções aplicadas em `bulletinParserService.ts`:**
1. **Pré-varredura do gap** (`gapHasInternalSection1`): antes de avaliar candidatos a órfão, o código agora varre o gap inteiro procurando uma linha bold com número "1.". Se encontrar, seta um flag e rejeita todos os candidatos daquele gap — pois a presença de um "1." bold indica que o gap contém numeração interna de documento, não notas independentes.
2. **Palavras de seção interna expandidas**: adicionado `UNIFORME`, `TRAJE`, `CONDECORAÇÕES`, `CERIMONIAL`, `SOLENIDADE`, `CONVIDADOS`, `CREDENCIAMENTO`, `PROGRAMAÇÃO` aos três filtros (`INTERNAL_SECTION_HEADERS`, `INTERNAL_SECTION_FB`, `INTERNAL_TOC`) como segunda linha de defesa para termos típicos de diretrizes de solenidade.

---

**Problema 3 — Tabelas de lista de pessoal (coluna única) não reconhecidas**

- [ ] **Nota 1. DIRETRIZES...**: seção "5. AGRACIADOS" contém 3 tabelas de coluna única com cabeçalhos "MILITAR", "DEMAIS FORÇAS" e "CIVIS". O app exibia o conteúdo como texto corrido.

**Análise:**
Duas barreiras impediam o reconhecimento:
1. `isTableHeader("MILITAR")` retornava `false` — a palavra não estava nas listas de palavras-chave.
2. `cleanAndFormatSlice` descartava tabelas com `columnCount === 1` incondicionalmente, jogando as linhas de volta como parágrafo.

**Correções:**
- `textUtils.ts` → `isTableHeader`: adicionado bloco `singleColListHeaders` que reconhece `MILITAR`, `MILITARES`, `DEMAIS FORÇAS`, `CIVIS`, `POLICIAIS MILITARES`, `AGRACIADOS`, `PARTICIPANTES`, `RELACIONADOS` como cabeçalhos de lista de pessoal.
- `bulletinParserService.ts` → `flushTable`: quando o bloco tem cabeçalho de lista de pessoal (`SINGLE_COL_HEADER_RE`), **não passa pelo `reconstructTable`** — monta diretamente uma `TableData` de 1 coluna com o texto completo de cada linha. Isso evita que os gaps internos de cada linha (posto | nome | RG | Id Funcional) sejam interpretados como separadores de coluna, gerando tabela fragmentada.
- `bulletinParserService.ts` → Pass 1b: propaga `isTable=true` para linhas de dados imediatamente após cabeçalho de lista de pessoal, garantindo que todas as linhas da lista entrem no buffer da tabela (sem isso, linhas sem gaps largos ficavam de fora).
- `textUtils.ts` → `isTableHeader`: adicionado `NOME` ao `singleColListHeaders` para cobrir tabelas de autoridades civis (cabeçalho `NOME`).

---

**Problema 4 — Tabelas "alucinadas" em diretrizes com numeração "1)"**

- [X] **Nota 2. EVENTO COMEMORATIVO AO DIA INTERNACIONAL DA MULHER**: o item "1) DATA, HORA E LOCAL:" era identificado como cabeçalho de tabela, transformando a lista de dados em uma tabela mal formatada.

**Análise:**
As regexes que identificam subseções internas (que devem ser parágrafos, não tabelas) esperavam um ponto `.` ou espaço após o número. Em diretrizes, é comum usar parêntese `)`. Ao não reconhecer "1)" como subseção, o extrator via as palavras "DATA" e "LOCAL" e disparava o detector de tabelas.

**Correções:**
- `textUtils.ts` → `isSubSectionTitle`, `isTableHeader`, `detectTableStructure`: Expandidas regexes para aceitar `)` como delimitador de numeração (ex: `/^\d+[\s.)]+/`).
- `bulletinParserService.ts` → `INTERNAL_TOC`, `INTERNAL_SECTION_FB`: Sincronizados com o novo padrão de numeração para evitar que essas linhas sejam promovidas a notas ou tratadas como tabelas.

---

**Problema 5 — Tabela "destruída" por fusão de colunas e fragmentação multi-linha (COESCI 2/2026)**

- [X] **Nota 1. CURSO DE OPERAÇÕES... (COESCI 2/2026)**: A tabela apresentava falha onde o cabeçalho era ignorado por estar picado em várias linhas ou fundido em apenas um bloco. Além disso, os dados das linhas ("QTD POSTO NOME") estavam colados em uma única célula.

**Análise:**
1. O PDF gerava o cabeçalho em alturas ligeiramente diferentes, fazendo o sistema ver várias "meias-linhas" em vez de um cabeçalho fixo.
2. A falta de um template de 6 colunas fazia o sistema usar uma linha de dados de 5 colunas como modelo, quebrando todo o alinhamento.
3. Tokens de QTD, Posto e Nome estavam chegando com gaps < 6px, ficando fundidos em um único `PhraseBlock`.

**Correção Final (Intervenção Total):**
- `TableReconstructor.ts` → **Agregação de Super-Headers**: O sistema agora "cola" linhas de cabeçalho adjacentes (< 15px).
- `TableReconstructor.ts` → **Explosão Militar Forçada**: Se o sistema detectar `QTD` no cabeçalho e tiver menos de 6 colunas, ele força uma redivisão semântica robusta.
- `TableReconstructor.ts` → **Sticky Data Splitting (V4)**: Implementada divisão semântica em tempo real para dados de linha, separando padrões como `[Número] [Posto]` e `[Posto] [Nome]` mesmo com zero gap.
- `TableReconstructor.ts` → **Biased Boundaries (90/10)**: Limites de coluna favorecem a coluna NOME.


---

**Problema 6 — Cabeçalho fatiado: QTD+POSTO/GRAD. fundidos, RG/ID Funcional partidos**

- [ ] **Tabela de inscritos (COESCI 2/2026, pág. 10)**: O app exibia `QTD POSTO/GRAD.` como uma única célula de cabeçalho, e os números RG/ID Funcional apareciam partidos (ex: `45.32 0` em vez de `45.320`).

**Análise:**
Dois problemas distintos:

1. **Cabeçalho fundido**: A explosão multidirecional de cabeçalhos (`reconstructTableByTemplate`) usava distribuição proporcional por largura relativa (`width: 0.05`, `0.15`, etc.) para posicionar cada âncora. Quando `QTD` e `POSTO/GRAD.` chegavam num único `PhraseBlock`, os `centerX` calculados ficavam errados, fazendo os dados de `POSTO` caírem na coluna `QTD`. O mesmo problema existia no bloco `FORCE MILITARY STRUCTURE`.

2. **RG partido**: O PDF gerava o número `45.320` como três tokens separados: `45.` + `32` + `0`. O `normalizeCellText` só cobria o padrão `número.número espaço número`, não o caso de ponto solto (`45.` + `32`).

**Correções:**

- `TableReconstructor.ts` → **Explosão por posição física**: Tanto na explosão multidirecional quanto no `FORCE MILITARY STRUCTURE`, o código agora localiza o token físico de cada âncora dentro do `PhraseBlock` e usa seu `x` real para definir `xLeft`/`xRight`. Distribuição proporcional mantida apenas como fallback quando tokens físicos não são encontrados.

- `textUtils.ts` → `normalizeCellText`: Adicionado passo 2a (`45. 32` → `45.32`) antes do passo existente, cobrindo o caso de ponto solto seguido de dígitos. Adicionado passo 2c para aplicar a união novamente após o passo 2b, cobrindo casos encadeados (`45. 32 0` → `45.32 0` → `45.320`).

---

**Problema 7 — Tabela fatiada por célula OBM multiline**

- [ ] **Tabela de inscritos (COESCI 2/2026, pág. 10)**: O valor OBM `"DBM 5/21 - Bom Jesus de"` (nome longo que quebra em 2 linhas no PDF) vazava para fora da tabela como texto solto, fatiando a tabela em dois blocos separados.

**Análise:**
O bridge scan marcava a linha `"DBM 5/21 - Bom Jesus de"` como `isBridge=true` (linha entre dois blocos de tabela). Porém o `flushTable` descartava completamente os tokens de linhas bridge (`if (line.isBridge) return`). Resultado: a linha não entrava no `reconstructTable`, não era absorvida pelo merge multirow, e aparecia solta como texto entre as duas metades da tabela.

**Correção:**
- `bulletinParserService.ts` → `flushTable`: Linhas bridge com texto curto (< 80 chars) e sem estrutura de parágrafo legal (`!isHardLegalParagraph`) agora têm seus tokens incluídos no `allTableTokens` com tolerância Y maior (10px). O `reconstructTable` já tem lógica de merge multirow (Caso 2: texto curto em coluna OBM/NOME) que absorve esses tokens na célula correta.

---

**Problema 7 — Tabela fatiada por "Em consequência..." entre páginas**

- [ ] **Tabela de inscritos (COESCI 2/2026, pág. 10-11)**: A tabela era fatiada em dois blocos. O segundo bloco (dados da pág. 11) chegava ao `reconstructTable` sem cabeçalho e caía no BORDER-BASED (4 colunas erradas).

**Causa raiz:**
`"Em consequência, os órgãos..."` casa com `/^Em\s+conseq/i` em `isHardLegalParagraph` → bridge scan setava `containsHardBreak=true` → não fazia bridge → dois `flushTable` separados.

**Correção:**
- `bulletinParserService.ts` → bridge scan: Quando o hard break é apenas `isHardLegalParagraph` (fórmula de encerramento), compara o cabeçalho do bloco atual com o do próximo. Se idênticos (mesma tabela multi-página), atravessa a fórmula como bridge. Se diferentes, mantém o break.
