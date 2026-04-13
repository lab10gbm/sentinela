/**
 * formFieldSplitter.ts
 *
 * ÚNICA implementação da lógica de quebra de campos de formulário no projeto.
 *
 * Problema resolvido: linhas como
 *   "Data: 16/03; Horário: 10h; Local: Auditório"
 * chegam do PDF como uma única linha e precisam ser quebradas em 3 linhas separadas
 * para renderização e cópia corretas.
 *
 * Regras:
 * - Só quebra se houver 2+ campos de formulário conhecidos E ponto-e-vírgula na linha
 * - Segmentos sem campo de formulário são anexados ao segmento anterior
 * - Cada linha resultante recebe indentação de 4 espaços (padrão do pipeline)
 * - Remove marcadores de negrito (**) antes de analisar, mas preserva o texto original
 */

import { FORM_FIELD_NAMES } from '../constants/formFields';

// Padrão reutilizável (sem flag 'g' para evitar problemas com lastIndex em loops)
const FIELD_PATTERN_SOURCE = `(${FORM_FIELD_NAMES.join('|')}):`;

/**
 * Detecta se uma linha contém 2 ou mais campos de formulário.
 * Requer ponto-e-vírgula para evitar falsos positivos em cabeçalhos vazios
 * como "OBM: DATA: HORÁRIO:".
 */
export function hasMultipleFormFields(line: string): boolean {
  const plain = line.replace(/\*\*/g, '').replace(/\*/g, '').trim();
  if (!plain.includes(';')) return false;
  const matches = plain.match(new RegExp(FIELD_PATTERN_SOURCE, 'gi'));
  return !!(matches && matches.length >= 2);
}

/**
 * Detecta se uma linha É um campo de formulário (começa com "Campo:").
 * Ex: "    Data: 16/03" → true; "Texto normal" → false
 */
export function isFormFieldLine(line: string): boolean {
  const plain = line.replace(/\*\*/g, '').replace(/\*/g, '').trim();
  return new RegExp(`^(${FORM_FIELD_NAMES.join('|')}):`, 'i').test(plain);
}

/**
 * Quebra uma linha com múltiplos campos de formulário em linhas separadas.
 *
 * Ex: "Data: 16/03; Horário: 10h; Local: Auditório"
 * →   ["    Data: 16/03;", "    Horário: 10h;", "    Local: Auditório"]
 *
 * Se a linha não tiver múltiplos campos, retorna array com a linha original.
 */
export function splitFormFieldLine(line: string): string[] {
  if (!hasMultipleFormFields(line)) return [line];

  const segments = line.split(';');
  const parts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i].trim();
    if (!segment) continue;

    const segmentPlain = segment.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    const hasField = FORM_FIELD_NAMES.some(field =>
      new RegExp(`${field}:`, 'i').test(segmentPlain)
    );

    if (hasField) {
      // Adiciona indentação e ponto-e-vírgula (exceto no último segmento real)
      const isLast = i === segments.length - 1 || segments.slice(i + 1).every(s => !s.trim());
      parts.push('    ' + segmentPlain + (isLast ? '' : ';'));
    } else if (parts.length > 0) {
      // Segmento sem campo: anexa ao anterior (ex: continuação de valor)
      parts[parts.length - 1] = parts[parts.length - 1].replace(/;$/, '') + '; ' + segmentPlain;
    }
    // Segmento sem campo e sem partes anteriores: descartado (raro, evita lixo)
  }

  return parts.length >= 2 ? parts : [line];
}

/**
 * Aplica splitFormFieldLine a um array de linhas.
 * Linhas sem múltiplos campos passam inalteradas.
 */
export function splitFormFieldLines(lines: string[]): string[] {
  return lines.flatMap(splitFormFieldLine);
}
