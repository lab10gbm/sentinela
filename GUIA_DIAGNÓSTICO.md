# 🔍 Guia de Diagnóstico - Problema de Linhas Unidas

## 📋 Objetivo
Identificar exatamente onde as linhas "Data:", "Horário:", "Local:", "Endereço:" estão sendo unidas.

---

## 🧪 Passo a Passo

### 1. Limpar Cache do Navegador
```
1. Abrir DevTools (F12)
2. Ir em "Application" → "Storage" → "Clear site data"
3. Recarregar a página (Ctrl+Shift+R)
```

### 2. Processar o Boletim 037
```
1. Fazer upload do PDF "BOLETIM DA SEDEC N 037 DE 02-03-2026.pdf"
2. Aguardar processamento completo
3. Navegar até: 5ª PARTE → COMUNICAÇÃO SOCIAL → "1. PALESTRAS SOBRE SAÚDE DO SONO"
```

### 3. Verificar Console do Navegador
Abrir DevTools (F12) → Console e procurar por:

#### Log 1: Extração do PDF.js (pdfWorkerService.ts)
```
[Sentinela][Correção #2C] Detectados N campos na linha: "Data:16/03/2026..."
[Sentinela][Correção #2C] Quebrado em N linhas:
  1. "    Data: 16/03/2026 (segunda-feira);"
  2. "    Horário: 10h;"
  3. "    Local: Auditório A do Quartel do Comando-Geral;"
  4. "    Endereço: Praça da República, 45 - Centro..."
```

**O que verificar**:
- [ ] O log aparece? (Se NÃO, a regex não está detectando)
- [ ] Quantos campos foram detectados? (Deve ser 4+)
- [ ] As linhas estão separadas? (Deve ter 4 linhas)
- [ ] Tem indentação (4 espaços)? (Deve ter)

#### Log 2: Processamento de Parágrafos (textUtils.ts)
```
[textUtils][joinWrappedParagraphs] Detectados múltiplos campos: "Data:16/03/2026..."
  Parte 1: "Data: 16/03/2026 (segunda-feira);"
  Parte 2: "Horário: 10h;"
  Parte 3: "Local: Auditório A do Quartel do Comando-Geral;"
  Parte 4: "Endereço: Praça da República, 45 - Centro..."
```

**O que verificar**:
- [ ] O log aparece? (Se SIM, significa que #2C não funcionou)
- [ ] As linhas estão sendo quebradas aqui? (Deve estar)

---

## 🔬 Cenários Possíveis

### Cenário A: Nenhum log aparece
**Significado**: A regex não está detectando os campos

**Causa provável**: 
- Texto não tem 2+ campos com padrão "Palavra:"
- Regex está muito restritiva

**Solução**: Ajustar regex para ser mais permissiva

### Cenário B: Log #1 aparece, mas linhas não são quebradas
**Significado**: A detecção funciona, mas a quebra falha

**Causa provável**:
- Regex `fieldRegex` não está capturando corretamente
- `parts.length < 2` (não atinge o threshold)

**Solução**: Melhorar regex de captura

### Cenário C: Log #1 aparece e quebra, mas depois reúne
**Significado**: As linhas são quebradas, mas depois reunidas

**Causa provável**:
- `joinWrappedParagraphs` está unindo as linhas
- `flushParagraph` está unindo as linhas
- Alguma outra função está processando o texto

**Solução**: Adicionar flag para preservar quebras

### Cenário D: Log #2 aparece
**Significado**: Correção #2C não funcionou, fallback #2B ativado

**Causa provável**:
- Linhas chegam unidas no `textUtils.ts`
- Correção #2C não foi aplicada

**Solução**: Verificar se `processedLines` está sendo usado

---

## 📊 Tabela de Diagnóstico

| Log #1 | Log #2 | Resultado Visual | Diagnóstico |
|--------|--------|------------------|-------------|
| ❌ Não | ❌ Não | Linhas unidas | Regex não detecta |
| ✅ Sim | ❌ Não | Linhas unidas | Quebra falha |
| ✅ Sim | ❌ Não | Linhas separadas | ✅ FUNCIONA |
| ✅ Sim | ✅ Sim | Linhas unidas | Reunidas depois |
| ❌ Não | ✅ Sim | Linhas separadas | Fallback funciona |

---

## 🛠️ Ações Corretivas

### Se Log #1 não aparece
```typescript
// Ajustar regex em pdfWorkerService.ts
const formFieldMatches = text.match(/\b[A-Z][a-z]{1,20}:/g); // Mais permissivo
```

### Se Log #1 aparece mas não quebra
```typescript
// Simplificar regex de captura
const fieldRegex = /([A-Z][a-z\s]{0,30}:[^;]+)/g; // Remove ";?" do final
```

### Se linhas são reunidas depois
```typescript
// Adicionar marcador especial
parts.push('    [PRESERVE_LINE]' + field + ';');

// E detectar em joinWrappedParagraphs
if (current.includes('[PRESERVE_LINE]')) {
  result.push(current.replace('[PRESERVE_LINE]', ''));
  continue;
}
```

---

## 📝 Relatório de Diagnóstico

Preencha após executar os testes:

### Logs Encontrados
- [ ] Log #1 (pdfWorkerService.ts) apareceu
- [ ] Log #2 (textUtils.ts) apareceu
- [ ] Nenhum log apareceu

### Conteúdo dos Logs
```
Cole aqui o conteúdo exato dos logs do console
```

### Resultado Visual
```
Cole aqui como o texto aparece no sistema
```

### Diagnóstico
```
Com base na tabela acima, qual cenário se aplica?
```

---

## 🎯 Próximos Passos

1. Execute os testes acima
2. Preencha o relatório
3. Compartilhe os logs do console
4. Implementaremos a correção apropriada

---

**Data**: 11/04/2026  
**Desenvolvedor**: Kiro AI Assistant
