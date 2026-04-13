#!/usr/bin/env node
/**
 * Script de análise do Boletim 037
 * Processa o PDF e identifica problemas de formatação
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Analisando Boletim 037...\n');

// Simula a extração (em produção, usaria pdfjs-dist)
// Por ora, vamos analisar o código e estrutura

const issues = {
  negritoInconsistente: [],
  tabelasFormulario: [],
  titulosDentroTabelas: [],
  quebrasLinhaIncorretas: [],
  linhasDadosComoParag: []
};

console.log('📊 ANÁLISE DO CÓDIGO DE EXTRAÇÃO\n');
console.log('=' .repeat(60));

// Análise 1: Detecção de Negrito
console.log('\n1️⃣  DETECÇÃO DE NEGRITO');
console.log('-'.repeat(60));
console.log('✅ Implementação atual (pdfWorkerService.ts):');
console.log('   • Análise híbrida: fontFamily + fontName + commonObjs');
console.log('   • Análise estatística: frequência < 40% + densidade > 1.2x');
console.log('   • Máximo 2 fontes bold detectadas');
console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
console.log('   • Threshold de frequência (40%) pode ser muito alto');
console.log('   • Títulos curtos podem não atingir 10 amostras mínimas');
console.log('   • Densidade 1.2x pode ser insuficiente para Segoe UI');

// Análise 2: Reconstrução de Tabelas
console.log('\n\n2️⃣  RECONSTRUÇÃO DE TABELAS');
console.log('-'.repeat(60));
console.log('✅ Três estratégias implementadas:');
console.log('   • Template-based: > 5 tokens/linha (tabelas de dados)');
console.log('   • Border-based: 1-5 tokens/linha (formulários com bordas)');
console.log('   • Layout preservation: < 1 token/linha (formulários complexos)');
console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
console.log('   • Border-based usa histogram de picos X');
console.log('   • Pode falhar em formulários com células mescladas');
console.log('   • Títulos de formulário não são separados antes da tabela');

// Análise 3: Detecção de Estrutura de Tabela
console.log('\n\n3️⃣  DETECÇÃO DE ESTRUTURA DE TABELA');
console.log('-'.repeat(60));
console.log('✅ Sinais negativos fortes (textUtils.ts):');
console.log('   • Título CAIXA ALTA sem gaps → nunca é tabela');
console.log('   • Parágrafo legal (1.1., SEI, "por necessidade")');
console.log('   • RG + número, Id Funcional + número');
console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
console.log('   • Títulos de formulário em CAIXA ALTA são rejeitados');
console.log('   • Mas deveriam ser separados ANTES da tabela, não rejeitados');
console.log('   • Linhas "Data:", "Horário:" são detectadas como tabela');

// Análise 4: Junção de Parágrafos
console.log('\n\n4️⃣  JUNÇÃO DE PARÁGRAFOS');
console.log('-'.repeat(60));
console.log('✅ Heurísticas implementadas (textUtils.ts):');
console.log('   • Une linhas sem pontuação forte');
console.log('   • Preserva headers (CAIXA ALTA)');
console.log('   • Detecta Y-gap > 22px como quebra de parágrafo');
console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
console.log('   • Threshold de 22px pode ser muito alto');
console.log('   • Indentação > 30px pode não capturar todos os casos');
console.log('   • Fragmentos curtos (< 25 chars) são unidos agressivamente');

// Análise 5: Limpeza de Slice
console.log('\n\n5️⃣  LIMPEZA E FORMATAÇÃO DE SLICE');
console.log('-'.repeat(60));
console.log('✅ Fluxo implementado (bulletinParserService.ts):');
console.log('   • Filtra headers/footers/TOC');
console.log('   • Detecta tableLines vs paragraphLines');
console.log('   • Bridge entre blocos de tabela (< 15 linhas)');
console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
console.log('   • Títulos de tabela são incluídos no bloco de tabela');
console.log('   • Deveriam ser extraídos e renderizados como parágrafo');
console.log('   • Bridge atravessa sub-títulos (ex: "3 MILITARES CAPACITADOS:")');

console.log('\n\n' + '='.repeat(60));
console.log('📋 RESUMO DOS 5 PROBLEMAS MAIS CRÍTICOS');
console.log('='.repeat(60));

const problems = [
  {
    id: 1,
    title: 'Títulos de Formulário Dentro de Tabelas',
    impact: 'ALTO',
    frequency: 'Comum em anexos (fichas de avaliação)',
    example: '"CHOAE/2025 - FICHA DE AVALIAÇÃO" aparece como primeira linha da tabela',
    solution: 'Separar primeira linha CAIXA ALTA sem gaps ANTES de passar para TableReconstructor'
  },
  {
    id: 2,
    title: 'Linhas de Dados como Lista (não parágrafo)',
    impact: 'MÉDIO',
    frequency: 'Comum em formulários',
    example: '"Data:", "Horário:", "Local:" aparecem como parágrafo corrido',
    solution: 'Detectar padrão "Palavra:" isolada e renderizar como lista'
  },
  {
    id: 3,
    title: 'Negrito Inconsistente em Títulos',
    impact: 'MÉDIO',
    frequency: 'Ocasional (depende da fonte do PDF)',
    example: 'Alguns títulos aparecem sem ** mesmo sendo bold no PDF',
    solution: 'Reduzir threshold de frequência para 30% e densidade para 1.15x'
  },
  {
    id: 4,
    title: 'Quebras de Linha Incorretas',
    impact: 'BAIXO',
    frequency: 'Raro (apenas em parágrafos longos)',
    example: 'Parágrafos sendo unidos quando deveriam estar separados',
    solution: 'Reduzir threshold de Y-gap para 18px e indentação para 20px'
  },
  {
    id: 5,
    title: 'Tabelas de Formulário Complexas',
    impact: 'BAIXO',
    frequency: 'Raro (apenas em anexos específicos)',
    example: 'Células mescladas não reconstroem perfeitamente',
    solution: 'Aceitar limitação — layout preservation já preserva conteúdo legível'
  }
];

problems.forEach((p, i) => {
  console.log(`\n${i + 1}. ${p.title}`);
  console.log(`   Impacto: ${p.impact} | Frequência: ${p.frequency}`);
  console.log(`   Exemplo: ${p.example}`);
  console.log(`   Solução: ${p.solution}`);
});

console.log('\n\n' + '='.repeat(60));
console.log('🎯 ORDEM DE CORREÇÃO SUGERIDA (por impacto × frequência)');
console.log('='.repeat(60));

const priority = [
  { rank: 1, problem: 'Títulos de Formulário Dentro de Tabelas', reason: 'Alto impacto + comum' },
  { rank: 2, problem: 'Linhas de Dados como Lista', reason: 'Médio impacto + comum' },
  { rank: 3, problem: 'Negrito Inconsistente', reason: 'Médio impacto + ocasional' },
  { rank: 4, problem: 'Quebras de Linha', reason: 'Baixo impacto + raro' },
  { rank: 5, problem: 'Tabelas Complexas', reason: 'Baixo impacto + raro (aceitar limitação)' }
];

priority.forEach(p => {
  console.log(`\n${p.rank}º - ${p.problem}`);
  console.log(`     Razão: ${p.reason}`);
});

console.log('\n\n' + '='.repeat(60));
console.log('✅ ANÁLISE CONCLUÍDA');
console.log('='.repeat(60));
console.log('\nPróximos passos:');
console.log('1. Implementar correção #1 (títulos de formulário)');
console.log('2. Implementar correção #2 (linhas de dados como lista)');
console.log('3. Ajustar calibração de negrito (#3)');
console.log('4. Validar com boletim 037 completo');
console.log('5. Iterar nas correções #4 e #5 se necessário\n');
