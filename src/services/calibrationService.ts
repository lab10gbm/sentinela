import { SavedNota, TextToken } from "../types";

export interface EngineCalibration {
  tableGapThreshold: number;      // Padrão: 60
  tableStrictGapThreshold: number; // Padrão: 150
  boldContrastThreshold: number;   // Padrão: 0.4
  yTolerance: number;              // Padrão: 4
}

const DEFAULT_CALIBRATION: EngineCalibration = {
  tableGapThreshold: 60,
  tableStrictGapThreshold: 150,
  boldContrastThreshold: 0.4,
  yTolerance: 4
};

const STORAGE_KEY = 'SENTINELA_ENGINE_CALIBRATION';

class CalibrationService {
  private current: EngineCalibration = { ...DEFAULT_CALIBRATION };

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          this.current = { ...DEFAULT_CALIBRATION, ...JSON.parse(saved) };
        } catch (e) {
          console.error("Erro ao carregar calibração:", e);
        }
      }
    }
  }

  get settings() {
    return this.current;
  }

  /**
   * Analisa um conjunto de notas salvas (erros) e sugere/aplica uma calibração.
   */
  async calibrateFromDiagnostics(diagnosticBundle: SavedNota[]): Promise<EngineCalibration> {
    const errorNotas = diagnosticBundle.filter(n => n.category === 'error' && n.diagnosticData);
    
    if (errorNotas.length === 0) return this.current;

    const newSettings = { ...this.current };
    
    // Heurística 1: Se temos erros de tabela onde o texto nativo falhou, 
    // mas o OCR funcionou (ou vice-versa), podemos ajustar a sensibilidade do gap.
    
    let totalAdjustments = 0;
    
    errorNotas.forEach(nota => {
      const { rawSourceTokens, isOcrDerived } = nota.diagnosticData!;
      if (!rawSourceTokens || rawSourceTokens.length < 5) return;

      // Análise de gaps na nota que deu erro
      const gaps = this.calculateGaps(rawSourceTokens);
      if (gaps.length > 0) {
        const maxGap = Math.max(...gaps);
        // Se o usuário marcou erro em algo que tem gaps grandes mas não foi detectado como tabela
        if (maxGap > newSettings.tableGapThreshold * 0.8 && maxGap < newSettings.tableGapThreshold) {
            newSettings.tableGapThreshold = Math.max(30, Math.floor(maxGap * 0.9));
            totalAdjustments++;
        }
      }
      // Heurística 2: Ajuste de Negrito (Bold-Tuning)
      // Se a nota é pequena e não foi detectada como negrito nativamente
      const hasBold = rawSourceTokens.some(t => t.isBold);
      if (!hasBold && rawSourceTokens.length < 20) {
          // Aumenta ligeiramente a sensibilidade do negrito
          newSettings.boldContrastThreshold = Math.min(0.8, newSettings.boldContrastThreshold + 0.05);
          totalAdjustments++;
      }

      // Heurística 3: Ajuste de yTolerance (Alinhamento Vertical)
      // Se os tokens estão muito "espalhados" no eixo Y mas deveriam ser uma linha
      if (rawSourceTokens.length > 5) {
          const yDiffs = this.calculateYDiffs(rawSourceTokens);
          const maxLineYDiff = Math.max(...yDiffs);
          if (maxLineYDiff > newSettings.yTolerance && maxLineYDiff < newSettings.yTolerance * 2) {
              newSettings.yTolerance = Math.min(10, Math.ceil(maxLineYDiff + 1));
              totalAdjustments++;
          }
      }

      // Heurística 4: Detecção de tabelas ignoradas (Missed Tables)
      // Se o conteúdo da nota de erro tem múltiplos espaços largos mas não foi marcado como isTableRow
      const text = nota.notaContent || "";
      const wideSpaceCount = (text.match(/\s{3,}/g) || []).length;
      if (wideSpaceCount >= 3 && !nota.isTableRow) {
          // Reduz o threshold de gap para capturar essas tabelas na próxima vez
          newSettings.tableGapThreshold = Math.max(30, newSettings.tableGapThreshold - 5);
          totalAdjustments++;
      }
    });

    if (totalAdjustments > 0) {
      this.current = newSettings;
      this.save();
    }

    return this.current;
  }

  private calculateGaps(tokens: TextToken[]): number[] {
    const sorted = [...tokens].sort((a, b) => a.x - b.x);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].x - (sorted[i-1].x + sorted[i-1].w);
        if (gap > 0) gaps.push(gap);
    }
    return gaps;
  }

  private calculateYDiffs(tokens: TextToken[]): number[] {
    // Agrupa por "linhas" aproximadas e vê o desvio
    const sorted = [...tokens].sort((a, b) => a.y - b.y);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const diff = Math.abs(sorted[i].y - sorted[i-1].y);
        if (diff > 0 && diff < 15) diffs.push(diff);
    }
    return diffs;
  }

  private save() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    }
  }

  reset() {
    this.current = { ...DEFAULT_CALIBRATION };
    this.save();
  }
}

export const calibrationService = new CalibrationService();
