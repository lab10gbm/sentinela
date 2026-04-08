# Requirements Document

## Introduction

O sistema extrai boletins oficiais do CBMERJ/SEDEC em formato PDF e os apresenta de forma estruturada. A extração do Sumário foi implementada em iterações anteriores, mas o pipeline atual ainda produz um sumário "sujo": títulos de notas chegam ao `SumarioView` com underscores (`___`), asteriscos (`**`), números soltos e outros artefatos do PDF. O problema raiz é que `parseTocLines` tenta limpar linha por linha de forma insuficiente, e `formatTocForDisplay` repassa o `originalRaw` do PDF para as notas em vez de usar o título já normalizado.

Esta iteração implementa uma **reconstrução limpa em dois estágios separados**:

- **Estágio 1 — Extração de dados** (`parseTocLines`): extrai apenas título limpo + número de página + nível hierárquico. Descarta qualquer linha que não seja nota numerada, cabeçalho canônico ou "SEM ALTERAÇÃO". Títulos de notas passam por `cleanNoteTitle()`.
- **Estágio 2 — Reconstrução** (`formatTocForDisplay` + `SumarioView`): a plataforma monta o sumário a partir dos dados limpos, usando labels canônicos para partes/seções/letras e `cleanTitle` normalizado para notas. O `SumarioView` aplica limpeza defensiva adicional antes de renderizar.

O que **não muda**: estrutura hierárquica, estilo visual do `SumarioView`, navegação por clique.

## Glossary

- **Boletim**: Documento oficial em PDF emitido pela SEDEC/CBMERJ, numerado e datado.
- **Sumário**: Índice localizado na página 2 ou 3 do PDF, listando todas as Partes, Seções e Notas com seus números de página.
- **Parte**: Divisão de nível 1 do boletim. Formato canônico: `Nª PARTE` (ex: `1ª PARTE`).
- **Seção**: Divisão de nível 2 dentro de uma Parte. Formato canônico: `NUMERAL_ROMANO - TÍTULO` (ex: `I - OPERAÇÕES`).
- **Letra-Seção**: Subdivisão de nível 3 dentro de uma Seção. Formato canônico: `LETRA - TÍTULO` (ex: `A - ALTERAÇÕES DE OFICIAIS`).
- **Nota**: Item numerado dentro de uma Seção ou Letra-Seção. Formato: `N. TÍTULO DA NOTA`.
- **Raiz**: Entradas do Sumário que aparecem antes da 1ª Parte (ex: `FATOS HISTÓRICOS`).
- **Anexo**: Seção especial no final do boletim. Formato: `ANEXO I - TÍTULO`.
- **SEM ALTERAÇÃO**: Texto que indica ausência de notas em uma Parte ou Seção.
- **Artefato de PDF**: Caractere ou sequência introduzida pelo processo de extração do PDF que não faz parte do conteúdo real — underscores (`___`), asteriscos (`**`), números soltos no final de título, espaços múltiplos.
- **cleanTitle**: Campo `cleanTitle` do `SummaryItem`, resultado de `normalizeTitle()` aplicado ao título limpo.
- **originalRaw**: Campo `originalRaw` do `SummaryItem`, texto bruto da linha do PDF antes de qualquer limpeza.
- **Label canônico**: Texto de exibição fixo definido no `CANONICAL_STRUCTURE` (ex: `2ª PARTE`, `I - OPERAÇÕES`), independente de como o PDF fragmentou o texto.
- **cleanNoteTitle()**: Função auxiliar que remove underscores, asteriscos, números soltos no final e normaliza espaços em títulos de notas.
- **TOC Line**: Linha do Sumário que contém underscores (`___`) ou espaços múltiplos seguidos de número de página.
- **Densidade TOC**: Proporção de linhas em uma página que seguem o padrão TOC (título + separador + número).
- **Hierarquia**: Caminho completo de uma Nota no formato `Parte > Seção > Nota`.
- **Parser Service**: Módulo `bulletinParserService.ts` responsável pela extração local (sem IA).
- **textUtils**: Módulo `textUtils.ts` com funções auxiliares de normalização e detecção de padrões.
- **SummaryItem**: Estrutura de dados que representa um item do Sumário com título, página esperada e hierarquia.
- **BulletinNota**: Estrutura de dados final que representa uma nota extraída com título, hierarquia e conteúdo.
- **SumarioView**: Componente React que renderiza o Sumário formatado.
- **NotasView**: Componente React que renderiza a lista de notas extraídas.
- **Título Normalizado**: Título convertido para maiúsculas sem acentos e sem caracteres especiais, usado para matching.

## Requirements

### Requirement 1

**User Story:** Como desenvolvedor do sistema, quero que `parseTocLines` produza títulos de notas completamente limpos de artefatos do PDF, para que o sumário exibido não contenha underscores, asteriscos ou números soltos.

#### Acceptance Criteria

1. WHEN `parseTocLines` processa uma linha de Nota do Sumário, THE Parser Service SHALL aplicar `cleanNoteTitle()` ao título extraído antes de armazená-lo em `cleanTitle`, removendo underscores, asteriscos, números soltos no final e normalizando espaços múltiplos.
2. WHEN `parseTocLines` produz um `SummaryItem` do tipo Nota, THE Parser Service SHALL garantir que o campo `cleanTitle` não contenha as sequências `___`, `**`, nem termine com um número isolado separado por espaço.
3. WHEN `parseTocLines` encontra uma linha que não é nota numerada, cabeçalho canônico (Parte/Seção/Letra-Seção/Anexo) nem "SEM ALTERAÇÃO", THE Parser Service SHALL descartar essa linha sem criar um `SummaryItem`.
4. WHEN `parseTocLines` retorna a lista final de `SummaryItem`s, THE Parser Service SHALL garantir que nenhum item do tipo Nota tenha `expectedPage === null`.

---

### Requirement 2

**User Story:** Como desenvolvedor do sistema, quero que `formatTocForDisplay` use sempre o label canônico para Partes/Seções/Letras e o `cleanTitle` para Notas, para que o texto formatado nunca dependa do `originalRaw` do PDF.

#### Acceptance Criteria

1. WHEN `formatTocForDisplay` formata um item do tipo Parte, Seção ou Letra-Seção, THE Parser Service SHALL usar o label canônico do `CANONICAL_STRUCTURE` (campo `originalRaw` já preenchido com o label canônico pelo `parseTocLines`) como texto de exibição, nunca o texto bruto do PDF.
2. WHEN `formatTocForDisplay` formata um item do tipo Nota, THE Parser Service SHALL usar o campo `cleanTitle` como texto de exibição, nunca o campo `originalRaw`.
3. WHEN `formatTocForDisplay` produz uma linha de saída, THE Parser Service SHALL garantir que a linha não contenha `[p. X]` duplicado nem `[p. null]`.
4. WHEN `formatTocForDisplay` produz uma linha de saída para qualquer tipo de item, THE Parser Service SHALL garantir que a linha não contenha as sequências `___` nem `**`.

---

### Requirement 3

**User Story:** Como desenvolvedor do sistema, quero que `SumarioView.parseSumarioLines` aplique limpeza defensiva em cada entrada antes de renderizar, para que artefatos que escaparam dos estágios anteriores não apareçam na interface.

#### Acceptance Criteria

1. WHEN `parseSumarioLines` processa o texto de uma entrada do Sumário, THE SumarioView SHALL remover as sequências `___`, `**` e números isolados que apareçam no final do texto antes de armazená-lo no campo `text` da `SumarioEntry`.
2. WHEN `parseSumarioLines` processa uma linha, THE SumarioView SHALL normalizar espaços múltiplos para espaço simples no campo `text` da `SumarioEntry`.
3. WHEN `SumarioView` renderiza uma entrada do tipo Nota, THE SumarioView SHALL exibir o `text` da `SumarioEntry` já limpo, sem nenhum processamento adicional de texto no JSX.

---

### Requirement 4

**User Story:** Como desenvolvedor do sistema, quero uma função `cleanNoteTitle` em `textUtils.ts` que normalize títulos de notas extraídos do PDF, para que a limpeza seja reutilizável e testável de forma isolada.

#### Acceptance Criteria

1. WHEN `cleanNoteTitle` recebe uma string, THE textUtils SHALL remover todas as ocorrências de underscores (`_`) e asteriscos (`*`) da string.
2. WHEN `cleanNoteTitle` recebe uma string que termina com um número isolado precedido de espaço (ex: `"TÍTULO DA NOTA 42"`), THE textUtils SHALL remover esse número final se ele não fizer parte do título semântico da nota (ou seja, se não houver contexto numérico antes dele).
3. WHEN `cleanNoteTitle` recebe uma string com espaços múltiplos consecutivos, THE textUtils SHALL colapsá-los em espaço simples.
4. WHEN `cleanNoteTitle` recebe uma string já limpa (sem artefatos), THE textUtils SHALL retornar a string sem modificação além de trim.

---

### Requirement 5

**User Story:** Como desenvolvedor do sistema, quero que a estrutura hierárquica, o estilo visual do `SumarioView` e a navegação por clique permaneçam inalterados após a refatoração, para que nenhuma funcionalidade existente seja quebrada.

#### Acceptance Criteria

1. WHEN o sistema exibe o Sumário após a refatoração, THE SumarioView SHALL manter a mesma estrutura hierárquica (Parte → Seção → Letra-Seção → Nota) que existia antes da refatoração.
2. WHEN o usuário clica em uma entrada do Sumário após a refatoração, THE SumarioView SHALL disparar o callback `onNavigate` com o título normalizado, com o mesmo comportamento de antes da refatoração.
3. WHEN o sistema exibe o Sumário após a refatoração, THE SumarioView SHALL manter o mesmo estilo visual (indentação, cores, dot leaders, números de página) que existia antes da refatoração.

---

### Requirement 6 (preservado da iteração anterior)

**User Story:** Como desenvolvedor do sistema, quero que o Sumário do boletim seja lido corretamente mesmo quando a palavra "SUMÁRIO" não aparece como texto extraível pelo PDF.js, para que a extração funcione em todos os boletins independentemente de como o cabeçalho foi gerado.

#### Acceptance Criteria

1. WHEN o Parser Service processa um PDF de boletim, THE Parser Service SHALL localizar o bloco de texto do Sumário iniciando nas páginas 1 a 4 do PDF, antes de qualquer processamento de hierarquia.
2. WHEN o Parser Service não encontra a palavra "SUMÁRIO" ou "SUMARIO" em uma página candidata, THE Parser Service SHALL aplicar heurística de densidade TOC para identificar a página com maior proporção de linhas no padrão `texto + separador + número`.
3. IF nenhuma página candidata contiver pelo menos 5 linhas com número de página no final, THEN THE Parser Service SHALL retornar array vazio e registrar aviso de falha na extração do Sumário.
4. WHEN o Parser Service extrai linhas do Sumário, THE Parser Service SHALL identificar cada linha como sendo do tipo Parte, Seção, Letra-Seção, Nota, Raiz, Anexo, SEM_ALTERACAO ou Separador com base em seu prefixo textual.
5. WHEN uma linha do Sumário contém underscores (`___`), pontos (`...`) ou múltiplos espaços seguidos de número, THE Parser Service SHALL extrair o número de página usando expressão regular compatível com todos os ambientes JavaScript sem uso de lookbehind.

---

### Requirement 7 (preservado da iteração anterior)

**User Story:** Como desenvolvedor do sistema, quero que a hierarquia completa do boletim seja construída corretamente a partir do Sumário, incluindo Letra-Seções, entradas Raiz e Anexos, para que cada nota seja posicionada no lugar certo na interface.

#### Acceptance Criteria

1. WHEN o Parser Service identifica uma linha com padrão `Nª PARTE - TÍTULO`, THE Parser Service SHALL classificar essa linha como nível 1 (Parte) e resetar o contexto de Seção e Letra-Seção correntes.
2. WHEN o Parser Service identifica uma linha com padrão `NUMERAL_ROMANO - TÍTULO` dentro de uma Parte, THE Parser Service SHALL classificar essa linha como nível 2 (Seção) e associá-la à Parte corrente.
3. WHEN o Parser Service identifica uma linha com padrão `LETRA - TÍTULO` dentro de uma Seção, THE Parser Service SHALL classificar essa linha como nível 3 (Letra-Seção) e associá-la à Seção corrente.
4. WHEN o Parser Service identifica uma linha com padrão `ANEXO NUMERAL`, THE Parser Service SHALL classificar essa linha como Anexo e tratá-la como Parte de nível 1.
5. WHEN o Parser Service identifica linhas antes da primeira Parte, THE Parser Service SHALL classificar essas linhas como Raiz sem Parte pai.
6. WHEN o Parser Service constrói a hierarquia de uma Nota, THE Parser Service SHALL produzir o caminho completo incluindo Letra-Seção quando presente, no formato `Parte > Seção > Letra-Seção`.

---

### Requirement 8 (preservado da iteração anterior)

**User Story:** Como usuário da plataforma, quero clicar em uma entrada do Sumário e ser levado diretamente à nota correspondente no corpo do documento, para que eu possa navegar rapidamente pelo boletim.

#### Acceptance Criteria

1. WHEN o usuário clica em uma entrada do Sumário que corresponde a uma Nota, THE SumarioView SHALL disparar um callback `onNavigate(title)` com o título normalizado da nota selecionada.
2. WHEN o NotasView recebe um título via prop `navigateTo`, THE NotasView SHALL localizar a BulletinNota cujo título normalizado corresponde ao título recebido.
3. WHEN o NotasView localiza a nota alvo, THE NotasView SHALL expandir o grupo pai e a nota, e executar `element.scrollIntoView({ behavior: 'smooth', block: 'start' })`.
4. WHEN o NotasView executa o scroll para uma nota, THE NotasView SHALL aplicar um destaque visual na nota por 2 segundos e depois remover o destaque.
5. WHEN o usuário clica em uma entrada do Sumário que é uma Parte ou Seção, THE SumarioView SHALL disparar o callback `onNavigate` com o título da Parte ou Seção.
