# 🔬 Investigação Profunda - Fluxo Completo do Texto

## 📍 Objetivo
Rastrear EXATAMENTE onde o texto "Data:... Horário:... Local:..." está sendo processado e por que não está sendo quebrado.

---

## 🔄 Fluxo Completo do Texto

### 1. PDF → PDF.js (pdfWorkerService.ts)
```
PDF Original (linhas separadas visualmente)
    ↓
page.getTextContent() → textContent.items[]
    ↓
tokens[] com coordenadas X, Y
    ↓
linesBuckets (agrupa por Y com tolerance 4px)
    ↓
sortedLines[] (uma linha por Y-bucket)
    ↓
processedLines[] (pós-processamento #2C)
    ↓
pageText = processedLines.join("\n")
    ↓
pageMap[].text
```

**PERGUNTA CRÍTICA**: As linhas estão separadas em `sortedLines` ou já estão unidas?

### 2. bulletinParserService.ts
```
pageMap[].text
    ↓
allLines[] (todas as linhas de todas as páginas)
    ↓
cleanAndFormatSlice(slice)
    ↓
  - Filtra headers/footers
  - Detecta tableLines vs paragraphLines
  - flushParagraph() ou flushTable()
    ↓
joinWrappedParagraphs(text) ← SUSPEITO #1
    ↓
nota.contentMarkdown
```

**PERGUNTA CRÍTICA**: O `joinWrappedParagraphs` está UNINDO linhas que deveriam ficar separadas?

### 3. NotasView.tsx
```
nota.contentMarkdown
    ↓
renderParagraphs(text)
    ↓
  - Pré-processamento #2D (nossa correção)
  - Split por "\n"
  - Renderiza cada linha
    ↓
React elements
```

**PERGUNTA CRÍTICA**: O texto já chega unido aqui?

---

## 🎯 Hipóteses Prioritárias

### Hipótese A: PDF.js agrupa linhas com Y similar
**Probabilidade**: ALTA (80%)

**Evidência**:
- Log mostra "OBM: DATA: *HORÁRIO:..." em uma única linha
- Y-tolerance de 4px pode estar agrupando linhas que estão próximas

**Teste**:
```typescript
// Em pdfWorkerService.ts, linha ~250
console.log(`[DEBUG] Y-bucket ${yKey}: ${lineTokens.length} tokens`);
lineTokens.forEach(t => console.log(`  - "${t.text}" (Y=${t.y})`));
```

**Se confirmado**: Reduzir Y-tolerance de 4px para 2px

### Hipótese B: joinWrappedParagraphs une linhas
**Probabilidade**: MÉDIA (60%)

**Evidência**:
- Função tem lógica complexa de união de linhas
- Pode estar unindo "Data:" com "Horário:" porque não termina com pontuação forte

**Teste**:
```typescript
// Em textUtils.ts, início de joinWrappedParagraphs
console.log(`[DEBUG] joinWrappedParagraphs INPUT:\n${text.split('\n').map((l, i) => `${i}: ${l}`).join('\n')}`);
// No final
console.log(`[DEBUG] joinWrappedParagraphs OUTPUT:\n${result.join('\n')}`);
```

**Se confirmado**: Adicionar exceção para linhas que começam com campos de formulário

### Hipótese C: flushParagraph une linhas
**Probabilidade**: BAIXA (30%)

**Evidência**:
- `paragraphBuffer.join(' ')` une com espaço
- Pode estar adicionando múltiplas linhas ao buffer

**Teste**:
```typescript
// Em bulletinParserService.ts, dentro de flushParagraph
console.log(`[DEBUG] flushParagraph buffer (${paragraphBuffer.length} linhas):`);
paragraphBuffer.forEach((l, i) => console.log(`  ${i}: ${l}`));
```

**Se confirmado**: Não adicionar linhas de formulário ao paragraphBuffer

---

## 🧪 Plano de Teste Sistemático

### Teste 1: Verificar sortedLines
**Onde**: `pdfWorkerService.ts`, após construir `sortedLines`

**Código**:
```typescript
// Após sortedLines.push({ text: lineText, y: yKey });
if (i === 36) { // Página da nota (ajustar se necessário)
  sortedLines.forEach((line, idx) => {
    if (line.text.includes('Data:') || line.text.includes('Horário:')) {
      console.log(`[DEBUG][P${i}][L${idx}] Y=${line.y}: "${line.text.substring(0, 100)}"`);
    }
  });
}
```

**Resultado Esperado**:
- Se aparecer 1 linha com "Data:... Horário:..." → Problema no PDF.js
- Se aparecer 4 linhas separadas → Problema está depois

### Teste 2: Verificar processedLines
**Onde**: `pdfWorkerService.ts`, após pós-processamento #2C

**Código**:
```typescript
// Após const processedLines = sortedLines.flatMap(...)
if (i === 36) {
  processedLines.forEach((line, idx) => {
    if (line.text.includes('Data:') || line.text.includes('Horário:')) {
      console.log(`[DEBUG][P${i}][PROCESSED][L${idx}] Y=${line.y}: "${line.text.substring(0, 100)}"`);
    }
  });
}
```

**Resultado Esperado**:
- Se aparecer 4 linhas separadas → Correção #2C funcionou
- Se aparecer 1 linha → Correção #2C não está funcionando

### Teste 3: Verificar allLines
**Onde**: `bulletinParserService.ts`, após construir `allLines`

**Código**:
```typescript
// Após allLines.push({ text: cleanedText, page: p.page, tokens: p.tokens, y: l.y });
if (allLines.length > 0 && allLines.length % 100 === 0) {
  const sample = allLines.slice(-10);
  sample.forEach(l => {
    if (l.text.includes('Data:') || l.text.includes('Horário:')) {
      console.log(`[DEBUG][allLines][${allLines.length}] P${l.page}: "${l.text.substring(0, 100)}"`);
    }
  });
}
```

**Resultado Esperado**:
- Se aparecer 4 linhas separadas → Problema está no cleanAndFormatSlice
- Se aparecer 1 linha → Problema está antes

### Teste 4: Verificar joinWrappedParagraphs
**Onde**: `textUtils.ts`, início e fim da função

**Código**:
```typescript
export const joinWrappedParagraphs = (text: string): string => {
  if (!text) return "";
  
  // LOG INPUT
  if (text.includes('Data:') && text.includes('Horário:')) {
    console.log(`[DEBUG][joinWrappedParagraphs] INPUT (${text.split('\n').length} linhas):`);
    text.split('\n').slice(0, 20).forEach((l, i) => {
      if (l.includes('Data:') || l.includes('Horário:')) {
        console.log(`  ${i}: "${l}"`);
      }
    });
  }
  
  // ... código existente ...
  
  // LOG OUTPUT
  const output = result.join('\n').replace(/\n{3,}/g, '\n\n');
  if (output.includes('Data:') && output.includes('Horário:')) {
    console.log(`[DEBUG][joinWrappedParagraphs] OUTPUT (${output.split('\n').length} linhas):`);
    output.split('\n').slice(0, 20).forEach((l, i) => {
      if (l.includes('Data:') || l.includes('Horário:')) {
        console.log(`  ${i}: "${l}"`);
      }
    });
  }
  
  return output;
};
```

**Resultado Esperado**:
- Se INPUT tem 4 linhas e OUTPUT tem 1 → CULPADO ENCONTRADO
- Se INPUT já tem 1 linha → Problema está antes

### Teste 5: Verificar renderParagraphs
**Onde**: `NotasView.tsx`, início da função

**Código**:
```typescript
const renderParagraphs = (...) => {
  // LOG INPUT
  if (text.includes('Data:') && text.includes('Horário:')) {
    console.log(`[DEBUG][renderParagraphs] INPUT (${text.split('\n').length} linhas):`);
    text.split('\n').slice(0, 20).forEach((l, i) => {
      if (l.includes('Data:') || l.includes('Horário:')) {
        console.log(`  ${i}: "${l}"`);
      }
    });
  }
  
  // ... resto do código ...
};
```

**Resultado Esperado**:
- Se INPUT já tem 1 linha → Problema está no bulletinParserService
- Se INPUT tem 4 linhas → Correção #2D deve funcionar

---

## 🎬 Ação Imediata

Vou implementar TODOS os 5 testes de uma vez para rastrear o fluxo completo.

Depois de processar o boletim 037, você verá logs como:
```
[DEBUG][P36][L123] Y=450: "Data:16/03/2026..."
[DEBUG][P36][PROCESSED][L123] Y=450: "    Data:16/03/2026;"
[DEBUG][allLines][1234] P36: "    Data:16/03/2026;"
[DEBUG][joinWrappedParagraphs] INPUT (4 linhas):
  0: "    Data:16/03/2026;"
  1: "    Horário: 10h;"
[DEBUG][joinWrappedParagraphs] OUTPUT (1 linha):
  0: "Data:16/03/2026; Horário: 10h;"  ← CULPADO!
```

Isso nos dirá EXATAMENTE onde o problema está.

---

## 📝 Próximos Passos

1. Implementar os 5 testes
2. Processar boletim 037
3. Analisar logs
4. Identificar o culpado
5. Aplicar correção no lugar certo
6. Testar novamente

---

**Status**: Pronto para implementar testes
