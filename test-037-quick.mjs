#!/usr/bin/env node

/**
 * Script de teste rápido para verificar a Correção #2F
 * Processa apenas o boletim 037 e mostra os logs relevantes
 */

import { readFileSync } from 'fs';
import { extractTextFromPdf } from './src/services/pdfWorkerService.ts';

console.log('🧪 Teste Rápido - Correção #2F\n');

// Simula o processamento do PDF
const pdfPath = './boletins/BOLETIM DA SEDEC N 037 DE 02-03-2026.pdf';

console.log(`📄 Processando: ${pdfPath}\n`);
console.log('⏳ Aguarde a extração...\n');
console.log('─'.repeat(80));

// Nota: Este script precisa ser executado em um ambiente com DOM (browser ou jsdom)
// Para teste real, use o navegador com Ctrl+Shift+R
console.log('\n⚠️  ATENÇÃO: Este script precisa rodar no navegador!');
console.log('📋 Para testar:');
console.log('   1. Abra o aplicativo no navegador');
console.log('   2. Pressione Ctrl+Shift+R para limpar cache');
console.log('   3. Processe o boletim 037');
console.log('   4. Abra o Console (F12) e procure por "[Correção #2F]"');
console.log('\n🔍 Logs esperados:');
console.log('   [Sentinela][Correção #2F] 🔍 Detectados 4 campos: Data:, Horário:, Local:, Endereço:');
console.log('   [Sentinela][Correção #2F] 🔪 Split em 4 segmentos');
console.log('   [Sentinela][Correção #2F] ✅ Quebrado em 4 linhas');
