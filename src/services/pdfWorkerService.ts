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
      // Primeiro, tenta extrair metadados de fonte via commonObjs (mais confiável que styles)
      const fontMap = new Map<string, { isBold: boolean; isItalic: boolean }>();
      
      // Itera sobre commonObjs para mapear fontName → características reais
      await Promise.all(
        Object.keys(textContent.styles).map(async (fontId) => {
          try {
            const fontObj = await page.commonObjs.get(fontId);
            if (fontObj && fontObj.name) {
              const name = fontObj.name.toLowerCase();
              const isBold = name.includes('bold') || name.includes('black') || name.includes('heavy');
              const isItalic = name.includes('italic') || name.includes('oblique');
              fontMap.set(fontId, { isBold, isItalic });
            }
          } catch {
            // commonObjs.get pode falhar para alguns IDs — ignora
          }
        })
      );

      tokens = textContent.items
        .map((item: any) => {
          const transform = item.transform;
          const style = (textContent.styles as any)[item.fontName] || {};
          const fontFamily = (style.fontFamily || "").toLowerCase();
          
          // Detecção pelo nome real da fonte via textContent.styles (pdfjs 4.x/5.x)
          const isBoldByFamily = fontFamily.includes('bold') || fontFamily.includes('black') || fontFamily.includes('heavy');
          const isItalicByFamily = fontFamily.includes('italic') || fontFamily.includes('oblique');

          // Fallback 1: o ID interno do pdfjs (ex: "BCDHEE+SegoeUI-Bold")
          const internalId = (item.fontName || "").toLowerCase();
          const fontNameAfterPlus = internalId.includes('+') ? internalId.split('+')[1] : internalId;
          const isBoldByName = fontNameAfterPlus.includes('bold') || fontNameAfterPlus.includes('black') || fontNameAfterPlus.includes('heavy') || internalId.includes(',bold');
          const isItalicByName = fontNameAfterPlus.includes('italic') || fontNameAfterPlus.includes('oblique');

          // Fallback 2: commonObjs
          const fromCommon = fontMap.get(item.fontName);
          const isBoldByCommon = fromCommon?.isBold ?? false;
          const isItalicByCommon = fromCommon?.isItalic ?? false;

          return {
            text: item.str,
            x: transform[4],
            y: transform[5],
            w: item.width,
            h: item.height,
            page: i,
            isBold: isBoldByFamily || isBoldByName || isBoldByCommon,
            isItalic: isItalicByFamily || isItalicByName || isItalicByCommon,
            fontSize: transform[0],
            fontName: item.fontName, // Preserva para análise estatística
          };
        })
        .filter((t: any) => t.text.trim().length > 0);

      // Fallback 3: Análise estatística de peso visual (quando todos os métodos acima falharam)
      // Calcula a densidade média (width/fontSize) por fonte e classifica as mais densas como bold
      const fontDensities = new Map<string, { sum: number; count: number }>();
      tokens.forEach((t: any) => {
        if (!t.isBold && t.text.trim().length > 0 && t.fontSize > 0) {
          const density = t.w / (t.text.length * t.fontSize);
          if (!fontDensities.has(t.fontName)) fontDensities.set(t.fontName, { sum: 0, count: 0 });
          const stats = fontDensities.get(t.fontName)!;
          stats.sum += density;
          stats.count++;
        }
      });

      if (fontDensities.size >= 2) {
        const avgDensities = Array.from(fontDensities.entries()).map(([fontName, stats]) => ({
          fontName,
          avgDensity: stats.sum / stats.count,
        }));
        avgDensities.sort((a, b) => a.avgDensity - b.avgDensity);
        
        // Threshold: se a densidade de uma fonte é > 1.15x a densidade da fonte mais leve, é bold
        const lightestDensity = avgDensities[0].avgDensity;
        const boldThreshold = lightestDensity * 1.15;
        const boldFonts = new Set(avgDensities.filter(f => f.avgDensity > boldThreshold).map(f => f.fontName));

        if (boldFonts.size > 0) {
          tokens.forEach((t: any) => {
            if (!t.isBold && boldFonts.has(t.fontName)) t.isBold = true;
          });
          console.log(`[Sentinela] Detecção de bold via análise estatística: ${boldFonts.size} fontes classificadas como bold (threshold=${boldThreshold.toFixed(3)})`);
        }
      }

      // Log diagnóstico após análise estatística
      if (i === 1) {
        const uniqueFonts = new Set(tokens.map(t => t.fontName));
        uniqueFonts.forEach(fontName => {
          const sample = tokens.find(t => t.fontName === fontName);
          if (sample) {
            const fromCommon = fontMap.get(fontName);
            const commonName = fromCommon ? `common="${JSON.stringify(fromCommon)}"` : 'common=null';
            console.log(`[Sentinela][Font] id="${fontName}" family="${(textContent.styles as any)[fontName]?.fontFamily || 'sans-serif'}" ${commonName} isBold=${sample.isBold} isItalic=${sample.isItalic} sample="${sample.text.substring(0,20)}"`);
          }
        });
      }
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
