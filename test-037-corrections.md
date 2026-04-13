# Checklist de Validação - Boletim 037

## 🎯 Objetivo
Validar as 4 correções implementadas no processamento do Boletim SEDEC Nº 037.

---

## ✅ Teste 1: Títulos de Formulário Separados

### Localização
- **Boletim**: 037
- **Seção**: ANEXO II - FICHA DE AVALIAÇÃO
- **Página**: ~40-43

### O que verificar
- [ ] Título "CHOAE/2025 - FICHA DE AVALIAÇÃO" aparece FORA da tabela
- [ ] Título está centralizado
- [ ] Tabela começa com cabeçalho correto (Nome, Posto, etc.)
- [ ] Não há linhas vazias extras entre título e tabela

### Como testar
1. Processar boletim 037
2. Navegar até ANEXO II
3. Expandir a nota da ficha de avaliação
4. Verificar visualmente a separação

### Resultado Esperado
```
        CHOAE/2025 - FICHA DE AVALIAÇÃO
              (centralizado, negrito)

┌─────────────────────────────────────────┐
│ Nome          │ Posto │ OBM             │
├─────────────────────────────────────────┤
│ João Silva    │ Cap   │ 1º GBM          │
└─────────────────────────────────────────┘
```

---

## ✅ Teste 2: Linhas de Dados como Lista

### Localização
- **Boletim**: 037
- **Seção**: Qualquer nota com formulário (ex: escalas, eventos)
- **Padrão**: Linhas com "Data:", "Horário:", "Local:"

### O que verificar
- [ ] Cada campo está em linha separada
- [ ] Não há recuo (indent) nas linhas
- [ ] Alinhamento à esquerda
- [ ] Valores aparecem na mesma linha que o campo

### Como testar
1. Buscar por "Data:" no boletim processado
2. Verificar formatação das linhas adjacentes
3. Comparar com PDF original

### Resultado Esperado
```
Data: 02/03/2026
Horário: 08h às 17h
Local: Quartel do Comando Geral
Tema: Capacitação de Motoristas
```

**NÃO deve aparecer**:
```
    Data: 02/03/2026 Horário: 08h às 17h Local: Quartel do Comando Geral Tema: Capacitação de Motoristas
```

---

## ✅ Teste 3: Negrito Consistente

### Localização
- **Boletim**: 037
- **Seção**: Todas as notas
- **Foco**: Títulos de notas e sub-seções

### O que verificar
- [ ] Títulos de notas aparecem com `**texto**` (negrito)
- [ ] Sub-títulos internos também têm negrito quando apropriado
- [ ] Corpo de texto NÃO tem negrito indevido
- [ ] Comparar com PDF original para confirmar

### Como testar
1. Abrir PDF original lado a lado com sistema
2. Selecionar 10 notas aleatórias
3. Verificar se títulos em negrito no PDF aparecem com `**` no sistema
4. Verificar console do navegador para logs de detecção de bold

### Resultado Esperado (console)
```
[Sentinela] Detecção de bold via análise híbrida: 1-2 fontes (freq<0.30, density>X.XXX)
```

### Notas para Comparação
- [ ] Nota 1: PLANO DE CAPACITAÇÃO → `**PLANO DE CAPACITAÇÃO**`
- [ ] Nota 2: ESCALA DE SERVIÇO → `**ESCALA DE SERVIÇO**`
- [ ] Nota 3: ALTERAÇÕES DE OFICIAIS → `**ALTERAÇÕES DE OFICIAIS**`

---

## ✅ Teste 4: Quebras de Parágrafo Corretas

### Localização
- **Boletim**: 037
- **Seção**: Notas com múltiplos parágrafos (ex: portarias, designações)
- **Foco**: Parágrafos com recuo ou espaçamento

### O que verificar
- [ ] Parágrafos com recuo estão separados
- [ ] Parágrafos com espaçamento maior estão separados
- [ ] Parágrafos normais (sem recuo/espaçamento) estão unidos corretamente
- [ ] Não há quebras indevidas no meio de frases

### Como testar
1. Procurar notas longas (> 200 palavras)
2. Verificar se parágrafos estão separados corretamente
3. Comparar com PDF original

### Resultado Esperado
```
Considerando a necessidade de designar militares para a função de instrutor.

Resolve:

Art. 1º - Designar os seguintes militares:
I - Cap BM João Silva
II - Ten BM Maria Santos
```

**NÃO deve aparecer**:
```
Considerando a necessidade de designar militares para a função de instrutor. Resolve: Art. 1º - Designar os seguintes militares: I - Cap BM João Silva II - Ten BM Maria Santos
```

---

## 📊 Resumo de Validação

### Critérios de Sucesso
- ✅ **Teste 1**: 100% dos títulos de formulário separados
- ✅ **Teste 2**: 90%+ das linhas de dados como lista
- ✅ **Teste 3**: 90%+ dos títulos com negrito correto
- ✅ **Teste 4**: 95%+ das quebras de parágrafo corretas

### Checklist Final
- [ ] Todos os 4 testes passaram
- [ ] Nenhuma regressão detectada (funcionalidades antigas ainda funcionam)
- [ ] Performance aceitável (< 5s para processar boletim 037)
- [ ] Console sem erros críticos

---

## 🐛 Registro de Problemas Encontrados

### Problema 1
**Descrição**: 
**Localização**: 
**Severidade**: [ ] Crítico [ ] Alto [ ] Médio [ ] Baixo
**Solução proposta**: 

### Problema 2
**Descrição**: 
**Localização**: 
**Severidade**: [ ] Crítico [ ] Alto [ ] Médio [ ] Baixo
**Solução proposta**: 

---

## 📝 Notas de Teste

### Ambiente
- **Navegador**: 
- **Sistema Operacional**: 
- **Data do Teste**: 
- **Versão do Código**: 

### Observações Gerais


### Casos Edge Identificados


---

## ✅ Aprovação

- [ ] Testes concluídos
- [ ] Problemas documentados
- [ ] Correções validadas
- [ ] Pronto para produção

**Testador**: _______________  
**Data**: _______________  
**Assinatura**: _______________
