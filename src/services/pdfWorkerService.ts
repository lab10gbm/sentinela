/**
 * pdfWorkerService.ts
 * 
 * Extracts text content from a PDF file using PDF.js (via CDN).
 * Produces geometry-aware text with:
 *   - Real line breaks (\n) based on Y-coordinate grouping
 *   - Paragraph breaks (\n\n) based on Y-gap analysis
 *   - Bold markers (**text**) based on font family analysis from textContent.styles
 * 
 * This is strictly isolated to prevent Next.js SSR from bundling pdfjs-dist.
 */
import { TextToken } from "../types";

export const extractTextFromPdf = async (file: File): Promise<{ 
  text: string; 
  pageMap: { 
    page: number; 
    text: string; 
    tokens: TextToken[];
    lines: { text: string; y: number }[] 
  }[] 
}> => {
  // Using native browser dynamic import to completely bypass Webpack 5 / Next.js SSR crashes
  // @ts-ignore - TS doesn't resolve CDN URLs natively
  const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  const pageMap: { 
    page: number; 
    text: string; 
    tokens: TextToken[]; 
    lines: { text: string; y: number }[] 
  }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    
    // textContent.styles maps internal fontName IDs → { fontFamily, ascent, descent, vertical }
    const styles: Record<string, { fontFamily: string }> = textContent.styles || {};
    
    // IMAGE & LINE EXTRACTION SECTION
    const operatorList = await page.getOperatorList();
    const ops = pdfjsLib.OPS || {};
    let transformStack: number[][] = [];
    let currentTransform = [1, 0, 0, 1, 0, 0];
    
    const multiply = (m1: number[], m2: number[]) => {
      return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
      ];
    };

    const extractedImages: { y: number, x: number, w: number, h: number, dataUrl: string }[] = [];
    const horizontalLines: { x1: number, x2: number, y: number }[] = [];
    let lastX = 0, lastY = 0;

    for (let j = 0; j < operatorList.fnArray.length; j++) {
      const fn = operatorList.fnArray[j];
      const args = operatorList.argsArray[j];

      if (fn === ops.save) {
        transformStack.push([...currentTransform]);
      } else if (fn === ops.restore) {
        if (transformStack.length > 0) {
          currentTransform = transformStack.pop() as number[];
        }
      } else if (fn === ops.transform) {
        currentTransform = multiply(currentTransform, args);
      } else if (fn === ops.moveTo) {
        lastX = currentTransform[4] + args[0] * currentTransform[0];
        lastY = currentTransform[5] + args[1] * currentTransform[3];
      } else if (fn === ops.lineTo) {
        const x = currentTransform[4] + args[0] * currentTransform[0];
        const y = currentTransform[5] + args[1] * currentTransform[3];
        // Identify horizontal lines (underlines)
        if (Math.abs(y - lastY) < 1.5 && Math.abs(x - lastX) > 2) {
          horizontalLines.push({ x1: Math.min(x, lastX), x2: Math.max(x, lastX), y });
        }
        lastX = x; lastY = y;
      } else if (fn === ops.paintImageXObject || fn === ops.paintJpegXObject) {
        const imgName = args[0];
        try {
          const y = currentTransform[5];
          const x = currentTransform[4];
          const w = currentTransform[0];
          const h = currentTransform[3];

          // We fetch the image from pdf.js internal object cache
          let imgObj: any = null;
          try {
             imgObj = page.objs.get(imgName);
          } catch(e) {}

          if (imgObj) {
             const canvas = document.createElement('canvas');
             let extracted = false;
             if (imgObj.bitmap) {
                 canvas.width = imgObj.bitmap.width;
                 canvas.height = imgObj.bitmap.height;
                 const ctx = canvas.getContext('2d');
                 if (ctx) {
                     ctx.drawImage(imgObj.bitmap, 0, 0);
                     extracted = true;
                 }
             } else if (imgObj.data) {
                 canvas.width = imgObj.width || w;
                 canvas.height = imgObj.height || h;
                 const ctx = canvas.getContext('2d');
                 if (ctx) {
                    try {
                        const imgData = new ImageData(
                            new Uint8ClampedArray(imgObj.data.buffer || imgObj.data),
                            canvas.width,
                            canvas.height
                        );
                        ctx.putImageData(imgData, 0, 0);
                        extracted = true;
                    } catch(e) { console.warn("Failed ImageData", e); }
                 }
             } else if (imgObj.src) {
                 extractedImages.push({ y: Math.round(y / 4) * 4, x, w, h, dataUrl: imgObj.src });
             }

             if (extracted) {
                 extractedImages.push({
                   y: Math.round(y / 4) * 4,
                   x,
                   w,
                   h,
                   dataUrl: canvas.toDataURL('image/png')
                 });
             }
          }
        } catch (err) {
          console.warn("Could not extract image", imgName, err);
        }
      }
    }

    
    const boldFontCache = new Map<string, boolean>();
    const italicFontCache = new Map<string, boolean>();
    const fontFreq = new Map<string, number>();
    for (const item of textContent.items as any[]) {
      if (item.str?.trim()) {
        const fn = item.fontName || '';
        fontFreq.set(fn, (fontFreq.get(fn) || 0) + item.str.length);
      }
    }
    const sortedFonts = Array.from(fontFreq.entries()).sort((a, b) => b[1] - a[1]);
    const mainBodyFont = sortedFonts[0]?.[0] || '';

    // Resolve internal font IDs (e.g. "g_d0_f1") to real font names via page.commonObjs.
    // pdfjs 4.x uses opaque internal IDs — the real name is in commonObjs under the same key.
    const resolvedFontName = new Map<string, string>();
    for (const [internalId] of fontFreq) {
      try {
        const fontObj = page.commonObjs.get(internalId);
        // fontObj.name contains the real font name (e.g. "SegoeUI-Bold", "SegoeUI-Italic")
        if (fontObj?.name) {
          resolvedFontName.set(internalId, fontObj.name);
        } else if (fontObj?.loadedName) {
          resolvedFontName.set(internalId, fontObj.loadedName);
        }
      } catch (_) { /* font not in commonObjs */ }
    }

    const isFontItalic = (fontName: string): boolean => {
      if (italicFontCache.has(fontName)) return italicFontCache.get(fontName)!;
      const resolved = resolvedFontName.get(fontName) || fontName;
      const style = styles[fontName];
      const fontFamily = (style?.fontFamily || '').toLowerCase();
      const check = (resolved + ' ' + fontFamily).toLowerCase().replace(/^[a-z]+\+/, '');
      const result =
        check.includes('italic') || check.includes('oblique') ||
        check.includes('-it') || check.includes('_it') ||
        check.includes(',it') || check.includes('italicmt');
      italicFontCache.set(fontName, result);
      return result;
    };

    const isFontBold = (fontName: string): boolean => {
      if (boldFontCache.has(fontName)) return boldFontCache.get(fontName)!;
      const resolved = resolvedFontName.get(fontName) || fontName;
      const style = styles[fontName];
      const fontFamily = (style?.fontFamily || '').toLowerCase();
      const check = (resolved + ' ' + fontFamily).toLowerCase().replace(/^[a-z]+\+/, '');

      let isBold =
          check.includes('negrit') || check.includes('bold') ||
          check.includes('-bd') || check.includes('_bd') ||
          check.includes('black') || check.includes('heavy') ||
          check.includes('semibold') || check.includes('demi') ||
          check.includes('boldmt') || check.includes('extrabold') ||
          check.includes('w600') || check.includes('w700') ||
          check.includes('w800') || check.includes('w900');

      // Heurística de contraste — só aplica se a fonte NÃO é itálica e o nome não foi resolvido.
      // Quando o nome real está disponível, confiamos apenas nele.
      const nameWasResolved = resolvedFontName.has(fontName);
      if (!isBold && !nameWasResolved && !isFontItalic(fontName) && fontName && mainBodyFont && fontName !== mainBodyFont) {
         const freq = fontFreq.get(fontName) || 0;
         const totalChars = Array.from(fontFreq.values()).reduce((a, b) => a + b, 0);
         if (freq > 0 && freq < (totalChars * 0.05)) {
            isBold = true;
         }
      }

      boldFontCache.set(fontName, isBold);
      return isBold;
    };
    
    interface PdfItem {
      y: number;
      rawY: number;
      x: number;
      str: string;
      isBold: boolean;
      isItalic: boolean;
      isUnderlined: boolean;
      fontSize: number;
      w: number;
      h: number;
    }
    
    const itemsTemp: PdfItem[] = [];
    const tokens: TextToken[] = [];

    for (const item of textContent.items as any[]) {
       if (!item.str || (!item.str.trim() && item.str !== ' ')) continue;
       
       const isBold = isFontBold(item.fontName || '');
       const isItalic = isFontItalic(item.fontName || '');
       const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
       
       const x = item.transform[4];
       const y = item.transform[5];
       const w = item.width || (item.str.length * fontSize * 0.5);
       const h = item.height || fontSize;

       // Underline matching: search for a geometric line just below the text baseline
       const isUnderlined = horizontalLines.some(line => {
         const yDist = Math.abs(line.y - y);
         const xOverlap = Math.max(0, Math.min(line.x2, x + w) - Math.max(line.x1, x));
         return yDist < 4 && xOverlap > w * 0.7;
       });

       const pdfItem: PdfItem = {
           y: Math.round(y / 4) * 4,
           rawY: y,
           x: x,
           str: item.str,
           isBold,
           isItalic,
           isUnderlined,
           fontSize,
           w,
           h
       };
       
       itemsTemp.push(pdfItem);

       if (item.str.trim()) {
         tokens.push({
           text: item.str,
           x,
           y,
           w,
           h,
           page: i,
           isBold,
           isUnderlined,
           fontSize
         });
       }
    }

    const lineMap = new Map<number, PdfItem[]>();
    for (const item of itemsTemp) {
       if (!item.str.trim()) continue;
       if (!lineMap.has(item.y)) lineMap.set(item.y, []);
       lineMap.get(item.y)!.push(item);
    }
    
    // Inject Images into the lineMap as special objects
    for (const img of extractedImages) {
        const imgItem: PdfItem = {
           y: img.y,
           rawY: img.y,
           x: img.x,
           str: `![Imagem extraída](${img.dataUrl})`,
           isBold: false,
           isItalic: false,
           isUnderlined: false,
           fontSize: 12,
           w: img.w,
           h: img.h
        };
        if (!lineMap.has(img.y)) lineMap.set(img.y, []);
        lineMap.get(img.y)!.push(imgItem);
        // Add to tokens so TableReconstructor can use it
        tokens.push({
           text: `![Img](${img.dataUrl})`,
           x: img.x,
           y: img.y,
           w: img.w,
           h: img.h,
           page: i,
           isBold: false,
           fontSize: 12
        });
    }
    
    const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
    
    const lineGaps: number[] = [];
    for (let j = 1; j < sortedY.length; j++) {
      const gap = sortedY[j - 1] - sortedY[j];
      if (gap > 0 && gap < 100) lineGaps.push(gap);
    }
    lineGaps.sort((a, b) => a - b);
    const medianGap = lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length / 2)] : 12;
    const paragraphThreshold = medianGap * 1.6;
    
    // Identificar margem esquerda (X mínimo) da página para detectar indentação
    let minPageX = 1000;
    for (const item of itemsTemp) {
       if (item.str.trim() && item.x < minPageX && item.x > 20) minPageX = item.x;
    }
    if (minPageX === 1000) minPageX = 50; // Fallback
    
    const pageLines: string[] = [];
    const pageLinesWithY: { text: string; y: number }[] = [];
    
    for (let j = 0; j < sortedY.length; j++) {
      const y = sortedY[j];
      const rowItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const allBold = rowItems.length > 0 && rowItems.every(item => item.isBold);
      const anyBold = rowItems.some(item => item.isBold);
      const allItalic = rowItems.length > 0 && rowItems.every(item => item.isItalic);
      const anyItalic = rowItems.some(item => item.isItalic);
      const allUnderlined = rowItems.length > 0 && rowItems.every(item => item.isUnderlined);
      const anyUnderlined = rowItems.some(item => item.isUnderlined);
      
      let lineText: string;
      
      // Joins items applying per-token underline (when not all underlined)
      const joinRowItems = (items: PdfItem[]) => {
        let text = "";
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          let s = item.str;
          if (item.isUnderlined && !allUnderlined) s = `<u>${s}</u>`;
          text += s;
          const next = items[i + 1];
          if (next) {
            const gap = next.x - (item.x + item.w);
            if (gap > 20) text += "    ";
            else if (gap > 8) text += "  ";
            else if (gap > 2) text += " ";
          }
        }
        return text;
      };

      // Wraps text with bold/italic/underline markers for a run
      const wrapRun = (text: string, bold: boolean, italic: boolean, underlined: boolean, lineAllUnderlined: boolean): string => {
        let s = text;
        if (underlined && !lineAllUnderlined) s = `<u>${s}</u>`;
        if (italic && bold) s = `***${s}***`;
        else if (bold) s = `**${s}**`;
        else if (italic) s = `*${s}*`;
        return s;
      };

      if (!anyBold && !anyItalic && !anyUnderlined) {
        // Fast path: plain line
        const parts: string[] = [];
        let currentRunItems: PdfItem[] = [];
        for (const item of rowItems) {
          if (item.str.startsWith('![')) {
            if (currentRunItems.length > 0) { parts.push(joinRowItems(currentRunItems)); currentRunItems = []; }
            parts.push(item.str);
          } else { currentRunItems.push(item); }
        }
        if (currentRunItems.length > 0) parts.push(joinRowItems(currentRunItems));
        lineText = parts.join(' ');
      } else if (allBold && allItalic) {
        let inner = joinRowItems(rowItems);
        if (allUnderlined) inner = `<u>${inner}</u>`;
        lineText = `***${inner}***`;
      } else if (allBold && !anyItalic) {
        let inner = joinRowItems(rowItems);
        if (allUnderlined) inner = `<u>${inner}</u>`;
        lineText = `**${inner}**`;
      } else if (allItalic && !anyBold) {
        let inner = joinRowItems(rowItems);
        if (allUnderlined) inner = `<u>${inner}</u>`;
        lineText = `*${inner}*`;
      } else if (allUnderlined && !anyBold && !anyItalic) {
        lineText = `<u>${joinRowItems(rowItems)}</u>`;
      } else {
        // Mixed run: split by (bold, italic, underlined) signature
        const parts: string[] = [];
        let currentRunItems: PdfItem[] = [];
        let runBold = rowItems[0]?.isBold || false;
        let runItalic = rowItems[0]?.isItalic || false;
        let runUnderlined = rowItems[0]?.isUnderlined || false;

        for (const item of rowItems) {
          if (item.str.startsWith('![')) {
            if (currentRunItems.length > 0) {
              parts.push(wrapRun(joinRowItems(currentRunItems), runBold, runItalic, runUnderlined, allUnderlined));
              currentRunItems = [];
            }
            parts.push(item.str);
          } else if (item.isBold === runBold && item.isItalic === runItalic && item.isUnderlined === runUnderlined) {
            currentRunItems.push(item);
          } else {
            if (currentRunItems.length > 0) {
              parts.push(wrapRun(joinRowItems(currentRunItems), runBold, runItalic, runUnderlined, allUnderlined));
            }
            currentRunItems = [item];
            runBold = item.isBold;
            runItalic = item.isItalic;
            runUnderlined = item.isUnderlined;
          }
        }
        if (currentRunItems.length > 0) {
          parts.push(wrapRun(joinRowItems(currentRunItems), runBold, runItalic, runUnderlined, allUnderlined));
        }
        lineText = parts.join(' ');
      }
      
      // Detecção de Centralização (Apenas para linhas curtas que parecem títulos)
      const firstItem = rowItems[0];
      const lastItem = rowItems[rowItems.length - 1];
      const lineWidth = (lastItem.x + lastItem.w) - firstItem.x;
      const spaceLeft = firstItem.x;
      const spaceRight = pageWidth - (lastItem.x + lastItem.w);
      const isShortLine = lineWidth < (pageWidth * 0.75);
      const isCentered = isShortLine && Math.abs(spaceLeft - spaceRight) < 30 && spaceLeft > 50;
      
      if (isCentered) {
          lineText = '[CENTER]' + lineText;
      }
      
      if (j > 0) {
        const gap = sortedY[j - 1] - y;
        const isIndented = firstItem.x > (minPageX + 20) && !isCentered;
        
        if (gap > paragraphThreshold || isIndented) {
          pageLines.push('');
          pageLinesWithY.push({ text: '', y: y + (gap / 2) }); // Preserve empty line for paragraph grouping
        }
      }
      
      pageLines.push(lineText);
      pageLinesWithY.push({ text: lineText, y });
    }

    const pageText = pageLines.join('\n');
    const cleanPageText = `\n--- [INÍCIO DA PÁGINA ${i}] ---\n${pageText}\n--- [FIM DA PÁGINA ${i}] ---\n`;
    
    fullText += cleanPageText;
    pageMap.push({ page: i, text: pageText, tokens, lines: pageLinesWithY });
  }

  return { text: fullText, pageMap };
};
