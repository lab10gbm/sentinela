import { describe, it, expect } from 'vitest';
import { isHardLegalParagraph } from './textUtils';

describe('Table Reconstruction Boundaries', () => {
  it('identifies military introductory phrases as legal paragraphs', () => {
    const intro1 = "Considerando a Nota DI/DIV.INST/COESCI 2 001/2026";
    const intro2 = "O Cel BM Diretor de Instrução, atendendo à solicitação do Ten Cel BM Comandante do";
    const intro3 = "relação de inscritos no processo seletivo do Curso em epígrafe, à saber:";
    const intro4 = "TORNA PÚBLICA a OBM";
    const intro5 = "1. CURSO DE OPERAÇÕES COM EMBARCAÇÕES DE SALVAMENTO E COMBATE A INCÊNDIO/2026";

    expect(isHardLegalParagraph(intro1)).toBe(true);
    expect(isHardLegalParagraph(intro2)).toBe(true);
    expect(isHardLegalParagraph(intro3)).toBe(true);
    expect(isHardLegalParagraph(intro4)).toBe(true);
    expect(isHardLegalParagraph(intro5)).toBe(true);
  });

  it('does NOT identify table headers as legal paragraphs', () => {
    const header1 = "QTD POSTO/GRAD. NOME RG ID FUNCIONAL OBM";
    const header2 = "ORDEM NOME IDENTIDADE OBM";
    
    // isHardLegalParagraph should return false for these so they can be tagged as isTable
    expect(isHardLegalParagraph(header1)).toBe(false);
    expect(isHardLegalParagraph(header2)).toBe(false);
  });
});
