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
import { splitFormFieldLines } from "../core/text/formFieldSplitter";

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
        .flatMap((item: any) => {
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

          const baseToken = {
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

          // SEPARADOR DE TOKENS FUNDIDOS: 
          // Se a string contém múltiplos espaços (3 ou mais), quebra em tokens separados.
          // Isso resolve PDFs onde QTD e POSTO vêm na mesma string item.str.
          if (item.str.includes("   ")) {
            const parts = item.str.split(/(\s{3,})/g);
            const subTokens: any[] = [];
            let currentX = baseToken.x;
            const charWidth = baseToken.w / item.str.length;

            for (const part of parts) {
              if (part.trim().length > 0) {
                subTokens.push({
                  ...baseToken,
                  text: part.trim(),
                  x: currentX,
                  w: part.length * charWidth
                });
              }
              currentX += part.length * charWidth;
            }
            return subTokens;
          }

          return [baseToken];
        })
        .filter((t: any) => t.text.trim().length > 0);

      // Fallback 3: Análise híbrida (frequência + densidade)
      // Fontes bold aparecem menos vezes (títulos) e têm maior densidade (traços grossos)
      // CORREÇÃO #3: Thresholds mais sensíveis para capturar títulos curtos
      const fontStats = new Map<string, { count: number; densitySum: number; densityCount: number }>();
      tokens.forEach((t: any) => {
        if (!t.isBold && t.text.trim().length > 0 && t.fontSize > 0) {
          if (!fontStats.has(t.fontName)) {
            fontStats.set(t.fontName, { count: 0, densitySum: 0, densityCount: 0 });
          }
          const stats = fontStats.get(t.fontName)!;
          stats.count++;
          const density = t.w / (t.text.length * t.fontSize);
          stats.densitySum += density;
          stats.densityCount++;
        }
      });

      if (fontStats.size >= 2) {
        const totalTokens = Array.from(fontStats.values()).reduce((sum, s) => sum + s.count, 0);
        
        const fontAnalysis = Array.from(fontStats.entries()).map(([fontName, stats]) => ({
          fontName,
          frequency: stats.count / totalTokens,
          avgDensity: stats.densitySum / stats.densityCount,
          count: stats.count,
        }));

        // Ordena por densidade (maior = mais provável de ser bold)
        fontAnalysis.sort((a, b) => b.avgDensity - a.avgDensity);

        // Critério híbrido:
        // 1. Frequência < 30%
        // 2. Densidade > 1.15x a fonte de referência (a mais leve com amostras suficientes)
        //    Usa a fonte mais leve com ≥ 5 amostras como referência, ignorando fontes de símbolo
        //    com poucas amostras que distorcem o mínimo.
        // 3. Pelo menos 5 amostras
        const frequencyThreshold = Math.min(calibrationService.settings.boldContrastThreshold, 0.30);
        const referenceFonts = fontAnalysis.filter(f => f.count >= 5);
        if (referenceFonts.length === 0) {
          // sem fontes com amostras suficientes — não aplica análise híbrida nesta página
        } else {
          const lightestDensity = referenceFonts[referenceFonts.length - 1].avgDensity;
          const densityThreshold = lightestDensity * 1.15;

          const boldFonts = new Set(
            fontAnalysis
              .filter(f => 
                f.frequency < frequencyThreshold && 
                f.avgDensity > densityThreshold && 
                f.count >= 5
              )
              .slice(0, 2) // Máximo 2 fontes bold
              .map(f => f.fontName)
          );

          if (boldFonts.size > 0) {
            tokens.forEach((t: any) => {
              if (!t.isBold && boldFonts.has(t.fontName)) t.isBold = true;
            });
            console.log(`[Sentinela] Detecção de bold via análise híbrida: ${boldFonts.size} fontes (freq<${frequencyThreshold.toFixed(2)}, density>${densityThreshold.toFixed(3)})`);
          }
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
        // CORREÇÃO: garante espaço entre runs de estilos diferentes quando o spacer estava no início do run seguinte
        const lineText = runs.map((r, ri) => {
          // O spacer está embutido no início do texto do run (ex: " AURELIO")
          // Precisamos extraí-lo para colocá-lo FORA dos marcadores de bold/italic
          const leadingSpace = r.text.match(/^(\s+)/)?.[1] ?? "";
          let s = r.text.trimStart();
          if (r.isBold && r.isItalic) return `${leadingSpace}***${s.trim()}***`;
          if (r.isBold) return `${leadingSpace}**${s.trim()}**`;
          if (r.isItalic) return `${leadingSpace}*${s.trim()}*`;
          return r.text; // texto normal: preserva espaço original
        }).join("");

        sortedLines.push({ text: lineText, y: yKey });
      });

    // CORREÇÃO #2F: Quebra de linhas com múltiplos campos de formulário
    // Detecta padrões como "Data:...; Horário:...; Local:..." e quebra em linhas separadas
    // Usa formFieldSplitter — fonte única de verdade para esta lógica
    const rawLineTexts = sortedLines.map(l => l.text);
    const splitTexts = splitFormFieldLines(rawLineTexts);

    // Reconstrói o array de linhas com Y incremental para linhas quebradas
    const processedLines: { text: string; y: number }[] = [];
    let sortedIdx = 0;
    let splitIdx = 0;
    while (splitIdx < splitTexts.length) {
      const originalLine = sortedLines[sortedIdx];
      const splitText = splitTexts[splitIdx];
      processedLines.push({ text: splitText, y: originalLine.y + (splitIdx - sortedIdx) * 0.1 });
      splitIdx++;
      // Avança para a próxima linha original quando o texto não pertence mais à atual
      if (splitIdx < splitTexts.length) {
        const nextOriginal = sortedLines[sortedIdx + 1];
        if (nextOriginal && splitTexts[splitIdx] === nextOriginal.text) {
          sortedIdx++;
        } else if (!splitTexts[splitIdx].startsWith('    ')) {
          sortedIdx++;
        }
      }
    }

    const pageText = processedLines.map(l => l.text).join("\n");
    
    // CORREÇÃO #6: Extração de imagens embutidas - DESABILITADA temporariamente
    // Causa: "Requesting object that isn't resolved yet" - imagens não estão prontas
    // TODO: Implementar com await page.objs.ensure() ou renderização de página completa
    let imageMarkdown = "";
    // Desabilitado até resolver o problema de sincronização
    
    const pageTextWithImages = pageText + imageMarkdown;
    fullText += `\n--- [INÍCIO DA PÁGINA ${i}${isOcrDerived ? ' (OCR)' : ''}] ---\n` + pageTextWithImages + `\n--- [FIM DA PÁGINA ${i}] ---\n`;
    
    pageMap.push({
      page: i,
      text: pageTextWithImages,
      tokens,
      lines: processedLines, // Usa processedLines em vez de sortedLines
      isOcr: isOcrDerived
    });
  }
  
  console.log(`[Sentinela] Extração concluída. Total de texto: ${fullText.length} caracteres.`);
  return { text: fullText, pageMap };
};
