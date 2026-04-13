#!/usr/bin/env node
/**
 * Script de diagnóstico para analisar como o PDF.js extrai as linhas
 * da nota "PALESTRAS SOBRE SAÚDE DO SONO" do Boletim 037
 */

console.log('🔍 DIAGNÓSTICO: Extração de Linhas do PDF\n');
console.log('=' .repeat(80));

console.log('\n📋 ANÁLISE DO PROBLEMA\n');
console.log('Nota: "1. PALESTRAS SOBRE SAÚDE DO SONO - CONVITE - NOTA CHEMG 216/2026"');
console.log('Seção: 5ª PARTE - COMUNICAÇÃO SOCIAL');
console.log('Página: ~35-36 do Boletim 037\n');

console.log('❌ PROBLEMA ATUAL:');
console.log('─'.repeat(80));
console.log('Data:16/03/2026 (segunda-feira); Horário: 10h; Local: Auditório A do');
console.log('Quartel do Comando-Geral; Endereço:Praça da República, 45 - Centro...\n');

console.log('✅ RESULTADO ESPERADO:');
console.log('─'.repeat(80));
console.log('Data: 16/03/2026 (segunda-feira);');
console.log('Horário: 10h;');
console.log('Local: Auditório A do Quartel do Comando-Geral;');
console.log('Endereço: Praça da República, 45 - Centro - Rio de Janeiro/RJ; e\n');

console.log('🔬 HIPÓTESES\n');
console.log('─'.repeat(80));

const hypotheses = [
  {
    id: 1,
    title: 'PDF tem linhas separadas, mas PDF.js une',
    description: 'No PDF original, "Data:", "Horário:", etc. estão em linhas separadas visualmente, mas o PDF.js as agrupa em uma única linha durante a extração de texto.',
    likelihood: 'ALTA',
    solution: 'Usar coordenadas Y dos tokens para detectar quebras de linha reais'
  },
  {
    id: 2,
    title: 'PDF tem linhas unidas, joinWrappedParagraphs não quebra',
    description: 'No PDF original, o texto já está em uma única linha (sem quebras), e o joinWrappedParagraphs não está detectando os múltiplos campos.',
    likelihood: 'MÉDIA',
    solution: 'Melhorar regex de detecção de múltiplos campos'
  },
  {
    id: 3,
    title: 'Linhas são quebradas mas depois reunidas',
    description: 'O PDF.js extrai corretamente, mas alguma etapa posterior (flushParagraph, formatOfficialDocumentText) está unindo as linhas.',
    likelihood: 'BAIXA',
    solution: 'Adicionar flag para preservar quebras de linha em formulários'
  }
];

hypotheses.forEach(h => {
  console.log(`\n${h.id}. ${h.title}`);
  console.log(`   Probabilidade: ${h.likelihood}`);
  console.log(`   Descrição: ${h.description}`);
  console.log(`   Solução: ${h.solution}`);
});

console.log('\n\n🧪 TESTES NECESSÁRIOS\n');
console.log('─'.repeat(80));

const tests = [
  {
    step: 1,
    action: 'Extrair tokens brutos do PDF.js',
    command: 'Processar boletim 037 e inspecionar console.log dos tokens',
    expected: 'Ver se tokens de "Data:", "Horário:", etc. têm Y diferentes'
  },
  {
    step: 2,
    action: 'Verificar agrupamento de linhas',
    command: 'Adicionar log em linesBuckets (pdfWorkerService.ts)',
    expected: 'Ver se "Data:" e "Horário:" estão em buckets Y diferentes'
  },
  {
    step: 3,
    action: 'Verificar joinWrappedParagraphs',
    command: 'Adicionar log antes/depois de joinWrappedParagraphs',
    expected: 'Ver se linhas entram separadas e saem unidas'
  },
  {
    step: 4,
    action: 'Verificar flushParagraph',
    command: 'Adicionar log em flushParagraph (bulletinParserService.ts)',
    expected: 'Ver se paragraphBuffer tem múltiplas linhas ou uma só'
  }
];

tests.forEach(t => {
  console.log(`\n${t.step}. ${t.action}`);
  console.log(`   Comando: ${t.command}`);
  console.log(`   Esperado: ${t.expected}`);
});

console.log('\n\n💡 SOLUÇÃO PROPOSTA (baseada em análise do PDF)\n');
console.log('─'.repeat(80));

console.log(`
CENÁRIO MAIS PROVÁVEL: Hipótese #1

No PDF original, as linhas estão visualmente separadas:
  
  Data: 16/03/2026 (segunda-feira);
  Horário: 10h;
  Local: Auditório A do Quartel do Comando-Geral;

Mas o PDF.js as agrupa em uma única linha porque:
• Todas têm Y similar (diferença < 4px)
• São agrupadas no mesmo linesBucket
• Renderizadas como uma única linha de texto

SOLUÇÃO:
1. Detectar padrão de "múltiplos campos" ANTES de agrupar em linhas
2. OU usar Y-gap mais sensível (< 2px) para essas linhas específicas
3. OU quebrar DEPOIS da extração, mas ANTES de joinWrappedParagraphs

IMPLEMENTAÇÃO RECOMENDADA:
Adicionar pós-processamento em pdfWorkerService.ts após sortedLines:

\`\`\`typescript
// Após construir sortedLines, quebra linhas com múltiplos campos
const processedLines = sortedLines.flatMap(line => {
  const text = line.text.replace(/\\*\\*/g, '').trim();
  const formFieldMatches = text.match(/\\b[A-Z][a-z]{2,15}:/g);
  
  if (formFieldMatches && formFieldMatches.length >= 2) {
    // Quebra por ";" + lookahead de "Palavra:"
    const parts = text.split(/;\\s*(?=[A-Z][a-z]{2,15}:)/);
    return parts.map((part, idx) => ({
      text: part.trim() + (idx < parts.length - 1 ? ';' : ''),
      y: line.y + (idx * 0.1) // Y ligeiramente diferente para cada parte
    }));
  }
  
  return [line];
});
\`\`\`

Isso garante que as linhas já chegam separadas no bulletinParserService.
`);

console.log('\n\n📝 PRÓXIMOS PASSOS\n');
console.log('─'.repeat(80));
console.log('1. Processar boletim 037 e verificar console do navegador');
console.log('2. Procurar logs de "[Sentinela]" para ver extração de tokens');
console.log('3. Identificar qual hipótese está correta');
console.log('4. Implementar solução apropriada');
console.log('5. Testar novamente com boletim 037\n');

console.log('=' .repeat(80));
console.log('✅ DIAGNÓSTICO CONCLUÍDO\n');
