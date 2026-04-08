/**
 * Tests for classifyTocLine in textUtils.ts
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { classifyTocLine, TocLineType } from './textUtils';
import { parseTocLines } from './bulletinParserService';

// ──────────────────────────────────────────────
// Unit tests — concrete examples
// ──────────────────────────────────────────────

describe('classifyTocLine — unit tests', () => {
  it('classifies PARTE lines', () => {
    expect(classifyTocLine('1ª PARTE - ADMINISTRATIVA E PRELIMINARES___3').type).toBe(TocLineType.PARTE);
    expect(classifyTocLine('2ª PARTE - OPERAÇÕES').type).toBe(TocLineType.PARTE);
  });

  it('classifies SECAO lines', () => {
    expect(classifyTocLine('I - OPERAÇÕES___5').type).toBe(TocLineType.SECAO);
    expect(classifyTocLine('IV – ASSUNTOS GERAIS').type).toBe(TocLineType.SECAO);
  });

  it('classifies NOTA lines', () => {
    expect(classifyTocLine('1. APOIO TÉCNICO OPERACIONAL___10').type).toBe(TocLineType.NOTA);
    expect(classifyTocLine('12. ESCALA DE SERVIÇO').type).toBe(TocLineType.NOTA);
  });

  it('classifies SEPARATOR lines', () => {
    expect(classifyTocLine('___________').type).toBe(TocLineType.SEPARATOR);
    expect(classifyTocLine('   ').type).toBe(TocLineType.SEPARATOR);
    expect(classifyTocLine('').type).toBe(TocLineType.SEPARATOR);
    expect(classifyTocLine('...........').type).toBe(TocLineType.SEPARATOR);
  });

  it('classifies CONTINUATION lines', () => {
    expect(classifyTocLine('CONTINUAÇÃO DO TÍTULO ANTERIOR').type).toBe(TocLineType.CONTINUATION);
  });

  it('extracts page number from ___ pattern', () => {
    const result = classifyTocLine('1. APOIO TÉCNICO___10');
    expect(result.pageNumber).toBe(10);
  });

  it('extracts page number from ... pattern', () => {
    const result = classifyTocLine('1. APOIO TÉCNICO...10');
    expect(result.pageNumber).toBe(10);
  });

  it('returns null pageNumber when no page suffix', () => {
    const result = classifyTocLine('1ª PARTE - ADMINISTRATIVA');
    expect(result.pageNumber).toBeNull();
  });

  it('titleFragment excludes the page suffix', () => {
    const result = classifyTocLine('1. APOIO TÉCNICO___10');
    expect(result.titleFragment).not.toMatch(/\d+\s*$/);
    expect(result.titleFragment).toContain('APOIO TÉCNICO');
  });
});

// ──────────────────────────────────────────────
// Property-Based Tests
// ──────────────────────────────────────────────

// Arbitrary for a valid page suffix (___N or ...N)
const pageSuffix = fc.integer({ min: 1, max: 999 }).chain(n =>
  fc.constantFrom('___', '...', '____', '.....').map(sep => `${sep}${n}`)
);

// Arbitrary for a non-empty word (uppercase letters only, to match military style)
const upperWord = fc.stringMatching(/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{2,10}$/);

describe('classifyTocLine — property tests', () => {
  /**
   * **Feature: bulletin-toc-extraction, Property 1: Classificação de tipo de linha do Sumário**
   * **Validates: Requirements 1.2, 2.1, 2.2, 2.3**
   *
   * For any string with prefix `Nª PARTE`, `NUMERAL_ROMANO -`, or `N.`,
   * classifyTocLine must return the correct type (PARTE, SECAO, or NOTA respectively).
   */
  it('Property 1 — PARTE prefix always yields TocLineType.PARTE', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.string({ minLength: 3, maxLength: 30 }).filter(s => s.trim().length > 0),
        fc.option(pageSuffix, { nil: undefined }),
        (n, title, suffix) => {
          const line = `${n}ª PARTE - ${title}${suffix ?? ''}`;
          const result = classifyTocLine(line);
          return result.type === TocLineType.PARTE;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1 — Roman numeral prefix always yields TocLineType.SECAO', () => {
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
                           'XI', 'XII', 'XIV', 'XV', 'XX', 'XXI', 'L', 'C'];
    fc.assert(
      fc.property(
        fc.constantFrom(...romanNumerals),
        fc.string({ minLength: 3, maxLength: 30 }).filter(s => /\S/.test(s)),
        fc.option(pageSuffix, { nil: undefined }),
        (roman, title, suffix) => {
          const line = `${roman} - ${title}${suffix ?? ''}`;
          const result = classifyTocLine(line);
          return result.type === TocLineType.SECAO;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1 — N. prefix always yields TocLineType.NOTA', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.string({ minLength: 3, maxLength: 30 }).filter(s => /\S/.test(s)),
        fc.option(pageSuffix, { nil: undefined }),
        (n, title, suffix) => {
          const line = `${n}. ${title}${suffix ?? ''}`;
          const result = classifyTocLine(line);
          return result.type === TocLineType.NOTA;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1 — separator lines (only underscores/dots/spaces) always yield TocLineType.SEPARATOR', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[_.\s]{1,20}$/),
        (line) => {
          const result = classifyTocLine(line);
          return result.type === TocLineType.SEPARATOR;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2 — page number is always extracted when ___ or ... suffix is present', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 30 }).filter(s => /\S/.test(s) && !/[_.]/.test(s)),
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom('___', '...', '____', '.....'),
        (prefix, page, sep) => {
          const line = `${prefix}${sep}${page}`;
          const result = classifyTocLine(line);
          return result.pageNumber === page;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2 — pageNumber is null when no ___ or ... suffix', () => {
    fc.assert(
      fc.property(
        // Lines that don't end with the page pattern (neither ___N, ...N, nor spaces+N)
        fc.string({ minLength: 3, maxLength: 30 }).filter(s =>
          /\S/.test(s) &&
          !/[_.]{3,}\s*\d+\s*$/.test(s) &&
          !/[ \t]+\d{1,4}\s*$/.test(s)
        ),
        (line) => {
          const result = classifyTocLine(line);
          return result.pageNumber === null;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ──────────────────────────────────────────────
// Property Tests for parseTocLines (Properties 5 & 6)
// ──────────────────────────────────────────────

// Arbitrary for a valid page suffix
const tocPageSuffix = (n: number) => `___${n}`;

// Arbitrary for a PARTE line
const arb_parte = (n: number) => `${n}ª PARTE - TITULO DA PARTE`;

// Arbitrary for a SECAO line
const arb_secao = (roman: string) => `${roman} - TITULO DA SECAO`;

// Arbitrary for a NOTA line with a page number
const arb_nota = (n: number, page: number) => `${n}. TITULO DA NOTA${tocPageSuffix(page)}`;

describe('parseTocLines — property tests', () => {
  /**
   * **Feature: bulletin-toc-extraction, Property 5: Toda BulletinNota tem hierarquia não vazia**
   * **Validates: Requirements 4.3**
   *
   * For any list of BulletinNotas produced by parseTocLines, each NOTA item
   * must have a non-empty parentCategory containing at least the name of a Parte.
   */
  it('Property 5 — every NOTA SummaryItem has a non-empty parentCategory with a Parte', () => {
    // **Feature: bulletin-toc-extraction, Property 5: Toda BulletinNota tem hierarquia não vazia**
    // **Validates: Requirements 4.3**
    const romans = ['I', 'II', 'III', 'IV', 'V'];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),   // parte number
        fc.constantFrom(...romans),        // secao roman numeral
        fc.array(
          fc.record({
            notaNum: fc.integer({ min: 1, max: 99 }),
            page: fc.integer({ min: 1, max: 999 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (parteNum, roman, notas) => {
          const lines = [
            arb_parte(parteNum),
            arb_secao(roman),
            ...notas.map(n => arb_nota(n.notaNum, n.page)),
          ];
          const items = parseTocLines(lines);
          // Filter only NOTA items (those with parentCategory containing " > ")
          const notaItems = items.filter(item => item.parentCategory && item.parentCategory.includes(' > '));
          // Every nota item must have a non-empty parentCategory
          return notaItems.every(item => {
            const cat = item.parentCategory ?? '';
            return cat.length > 0 && cat.toUpperCase().includes('PARTE');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: bulletin-toc-extraction, Property 6: Notas ordenadas por ordem de aparição**
   * **Validates: Requirements 4.5**
   *
   * For any list of SummaryItems produced by parseTocLines, the expectedPage values
   * of NOTA items (those with a parentCategory containing ">") must be in
   * non-decreasing order, reflecting their order of appearance in the TOC.
   */
  it('Property 6 — NOTA items preserve order of appearance (non-decreasing page numbers)', () => {
    // **Feature: bulletin-toc-extraction, Property 6: Notas ordenadas por ordem de aparição**
    // **Validates: Requirements 4.5**
    const romans = ['I', 'II', 'III', 'IV', 'V'];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(...romans),
        // Generate notas with strictly increasing page numbers to guarantee the property
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 2, maxLength: 10 }),
        (parteNum, roman, pageDeltas) => {
          // Build strictly increasing page sequence from deltas
          const pages: number[] = [];
          let current = 1;
          for (const delta of pageDeltas) {
            current += Math.abs(delta) + 1; // always positive increment
            pages.push(current);
          }

          const lines = [
            arb_parte(parteNum),
            arb_secao(roman),
            ...pages.map((page, idx) => arb_nota(idx + 1, page)),
          ];

          const items = parseTocLines(lines);
          const notaItems = items.filter(item => item.parentCategory && item.parentCategory.includes(' > '));
          const notePages = notaItems
            .map(item => item.expectedPage)
            .filter((p): p is number => p !== null);

          // Pages should be in non-decreasing order (same order as input)
          for (let i = 1; i < notePages.length; i++) {
            if (notePages[i] < notePages[i - 1]) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
