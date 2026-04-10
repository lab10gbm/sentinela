/**
 * Polyfill for Promise.withResolvers
 * Required for pdfjs-dist 4.x/5.x in environments that don't support it natively yet.
 */
if (typeof (Promise as any).withResolvers === 'undefined') {
  if (typeof window !== 'undefined') {
    (Promise as any).withResolvers = function() {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
}

import { TextToken } from "../types";
import { calibrationService } from "./calibrationService";

/**
 * Função auxiliar para rodar OCR em uma página específica via Tesseract.js
 * Usada como "Opção Nuclear" quando a camada de texto do PDF está vazia.
 */
async function runOcrOnPage(page: any, providedWorker?: any, scale: number = 2.5): Promise<{ text: string; tokens: TextToken[] }> {
  const { createWorker } = await import('tesseract.js');
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  const imageData = canvas.toDataURL('image/png');
  
  let worker = providedWorker;
  let shouldTerminate = false;
  if (!worker) {
    worker = await createWorker('por');
    shouldTerminate = true;
  }

  try {
    const result = await (worker.recognize(imageData) as Promise<any>);
    const data = result?.data;
    
    if (!data || !data.words) {
      console.warn("[Sentinela] OCR falhou em retornar palavras para a página.");
      return { text: "", tokens: [] };
    }

    const tokens: TextToken[] = data.words.map((w: any) => ({
      text: w.text,
      x: w.bbox.x0 / scale,
      y: w.bbox.y0 / scale,
      w: (w.bbox.x1 - w.bbox.x0) / scale,
      h: (w.bbox.y1 - w.bbox.y0) / scale,
      isBold: w.font_name?.toLowerCase().includes('bold') || w.confidence > 80,
      fontSize: (w.bbox.y1 - w.bbox.y0) / scale
    }));

    return { 
      text: data.text, 
      tokens 
    };
  } finally {
    if (shouldTerminate && worker) {
      await worker.terminate();
    }
  }
}

export const extractTextFromPdf = async (file: File, onOcrProgress?: (page: number, progress: number) => void): Promise<{ 
  text: string; 
  pageMap: { 
    page: number; 
    text: string; 
    tokens: TextToken[];
    lines: { text: string; y: number }[] 
  }[] 
}> => {
  // Use dynamic import to avoid evaluation crashes in Webpack/Next.js setup
  // Using the minified modern build for better stability in Next.js 15
  // @ts-ignore
  const pdfjsLib = await import('pdfjs-dist/build/pdf.min.mjs');

  // Define worker source from the public folder
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = window.location.origin + '/pdf.worker.min.mjs';
  }

  const arrayBuffer = await file.arrayBuffer();
  console.log(`[Sentinela] Iniciando extração de ${file.name} (${arrayBuffer.byteLength} bytes)`);
  
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  console.log(`[Sentinela] PDF carregado: ${pdf.numPages} páginas.`);
  
  // ──────────────────────────────────────────────────────────
  // PASS 1: EXTRAÇÃO COORDENADA (X, Y)
  // ──────────────────────────────────────────────────────────
  let fullText = "";
  const pageMap: any[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const hasTextLayer = textContent.items.length > 5;
    
    let tokens: TextToken[] = [];
    let isOcrDerived = false;

    if (!hasTextLayer) {
      console.log(`[Sentinela] Página ${i} sem camada de texto. Acionando OCR...`);
      const ocrResult = await runOcrOnPage(page);
      tokens = ocrResult.tokens.map(t => ({ ...t, page: i }));
      isOcrDerived = true;
    } else {
      tokens = textContent.items
        .map((item: any) => {
          const transform = item.transform;
          const style = (textContent.styles as any)[item.fontName] || {};
          const fontFamily = (style.fontFamily || "").toLowerCase();
          
          // Detecção Industrial baseada no nome real da fonte mapeado pelo PDF.js
          const isBold = fontFamily.includes('bold') || fontFamily.includes('black') || fontFamily.includes('heavy');
          const isItalic = fontFamily.includes('italic') || fontFamily.includes('oblique');

          return {
            text: item.str,
            x: transform[4],
            y: transform[5],
            w: item.width,
            h: item.height,
            page: i,
            isBold,
            isItalic,
            fontSize: transform[0],
          };
        })
        .filter((t: any) => t.text.trim().length > 0);
    }

    // Agrupamento por Linhas Visuais (Y-tolerance de 4px para maior precisão)
    const linesBuckets = new Map<number, any[]>();
    tokens.forEach((t: any) => {
      // Usamos passo de 4px para evitar que linhas muito próximas se fundam (diagnóstico bulletins 048-056)
      const yKey = Math.round(t.y / 4) * 4;
      if (!linesBuckets.has(yKey)) linesBuckets.set(yKey, []);
      linesBuckets.get(yKey)!.push(t);
    });

    const sortedLines: { text: string; y: number }[] = [];
    Array.from(linesBuckets.keys())
      .sort((a, b) => b - a) // Top to bottom
      .forEach(yKey => {
        const lineTokens = linesBuckets.get(yKey)!.sort((a, b) => a.x - b.x); // Left to right

        // Agrupa tokens em "runs" de mesmo estilo (bold/normal) para evitar
        // fragmentação como **PLANO** **DE** **CAPACITAÇÃO** → **PLANO DE CAPACITAÇÃO**
        type Run = { text: string; isBold: boolean; isItalic: boolean };
        const runs: Run[] = [];
        let lastXEnd = -1;

        lineTokens.forEach((t, idx) => {
          const gap = idx === 0 ? 0 : t.x - lastXEnd;
          const threshold = t.fontSize * 0.25;
          const needsSpace = idx > 0 && gap > threshold;
          const spacer = needsSpace ? " " : "";

          const last = runs[runs.length - 1];
          if (last && last.isBold === t.isBold && last.isItalic === t.isItalic && !needsSpace) {
            last.text += t.text;
          } else if (last && last.isBold === t.isBold && last.isItalic === t.isItalic && needsSpace) {
            last.text += " " + t.text;
          } else {
            runs.push({ text: spacer + t.text, isBold: t.isBold, isItalic: t.isItalic });
          }
          lastXEnd = t.x + (t.w || 0);
        });

        // Renderiza runs com marcadores de formatação
        const lineText = runs.map(r => {
          let s = r.text;
          if (r.isBold && r.isItalic) return `***${s.trim()}***`;
          if (r.isBold) return `**${s.trim()}**`;
          if (r.isItalic) return `*${s.trim()}*`;
          return s;
        }).join("");

        sortedLines.push({ text: lineText, y: yKey });
      });

    const pageText = sortedLines.map(l => l.text).join("\n");
    fullText += `\n--- [INÍCIO DA PÁGINA ${i}${isOcrDerived ? ' (OCR)' : ''}] ---\n` + pageText + `\n--- [FIM DA PÁGINA ${i}] ---\n`;
    
    pageMap.push({
      page: i,
      text: pageText,
      tokens,
      lines: sortedLines,
      isOcr: isOcrDerived
    });
  }
  
  console.log(`[Sentinela] Extração concluída. Total de texto: ${fullText.length} caracteres.`);
  return { text: fullText, pageMap };
};
