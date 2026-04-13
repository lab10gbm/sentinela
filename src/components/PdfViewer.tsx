"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Loader2 } from 'lucide-react';

interface PdfViewerProps {
  file: File | null;
  initialPage?: number;
  tokens?: any[];
  currentIsOcr?: boolean;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ file, initialPage = 1, tokens = [], currentIsOcr = false }) => {
  const [pdf, setPdf] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const [showGeometry, setShowGeometry] = useState(false);
  const [pdfjsLib, setPdfjsLib] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref para cancelar o render em andamento antes de iniciar um novo
  const renderTaskRef = useRef<any>(null);
  // Ref para debounce da troca de página via scroll
  const pageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadPdfjs = async () => {
      try {
        // @ts-ignore
        const pdfjs = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.mjs`;
        setPdfjsLib(pdfjs);
      } catch (err) {
        console.error("Failed to load PDF.js from CDN", err);
      }
    };
    loadPdfjs();
  }, []);

  useEffect(() => {
    if (!file || !pdfjsLib) return;
    const loadPdf = async () => {
      setLoading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
      } catch (error) {
        console.error('Error loading PDF:', error);
      } finally {
        setLoading(false);
      }
    };
    loadPdf();
  }, [file, pdfjsLib]);

  // Função para desenhar a geometria (overlay)
  const drawGeometry = useCallback(async (page: any, viewport: any) => {
    const canvas = overlayRef.current;
    if (!canvas || !tokens.length || !showGeometry) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    context.clearRect(0, 0, canvas.width, canvas.height);

    tokens.forEach(token => {
      // PDF.js coordinates are bottom-up, viewport handles the conversion
      // token.x and token.y are typically in PDF points
      // convertToViewportPoint takes [x, y] and returns [pixelX, pixelY]
      const [px, py] = viewport.convertToViewportPoint(token.x, token.y);
      const [pw, ph] = viewport.convertToViewportPoint(token.x + token.w, token.y + token.h);
      
      const width = Math.abs(pw - px);
      const height = Math.abs(ph - py);
      const top = Math.min(py, ph);

      context.strokeStyle = currentIsOcr ? 'rgba(59, 130, 246, 0.6)' : 'rgba(34, 197, 94, 0.6)'; // Blue for OCR, Green for Native
      context.lineWidth = 1;
      context.strokeRect(px, top, width, height);

      if (width > 20) {
        context.fillStyle = currentIsOcr ? 'rgba(59, 130, 246, 0.1)' : 'rgba(34, 197, 94, 0.1)';
        context.fillRect(px, top, width, height);
      }
    });

    // Legenda no canto
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(10, 10, 160, 45);
    context.font = 'bold 10px sans-serif';
    context.fillStyle = '#4ade80';
    context.fillText('● Texto Nativo (PDF)', 20, 25);
    context.fillStyle = '#60a5fa';
    context.fillText('● Extração via OCR', 20, 42);
  }, [tokens, showGeometry, currentIsOcr]);

  // Render com cancelamento do task anterior
  useEffect(() => {
    if (!pdf) return;

    const renderPage = async () => {
      // Cancela render anterior se ainda estiver rodando
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
        renderTaskRef.current = null;
      }

      try {
        const page = await pdf.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;

        await task.promise;
        renderTaskRef.current = null;

        // Desenha overlay após o render do PDF
        drawGeometry(page, viewport);
      } catch (error: any) {
        // RenderingCancelledException é esperado — ignora silenciosamente
        if (error?.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', error);
        }
        renderTaskRef.current = null;
      }
    };

    renderPage();
  }, [pdf, currentPage, scale, drawGeometry]);

  // Redesenha apenas o overlay se o toggle de geometria mudar
  useEffect(() => {
    if (!pdf || !showGeometry) {
       const canvas = overlayRef.current;
       if (canvas) {
         const ctx = canvas.getContext('2d');
         ctx?.clearRect(0, 0, canvas.width, canvas.height);
       }
       return;
    }
    
    const refreshOverlay = async () => {
      try {
        const page = await pdf.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        drawGeometry(page, viewport);
      } catch (e) {}
    };
    refreshOverlay();
  }, [pdf, currentPage, scale, showGeometry, drawGeometry]);

  // Debounce: só troca de página após 300ms sem novas atualizações (evita spam do scroll)
  useEffect(() => {
    if (!numPages || initialPage < 1 || initialPage > numPages) return;
    if (initialPage === currentPage) return;

    if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
    pageDebounceRef.current = setTimeout(() => {
      setCurrentPage(initialPage);
    }, 300);

    return () => {
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
    };
  }, [initialPage, numPages]);

  const handlePrevPage = () => setCurrentPage(p => Math.max(p - 1, 1));
  const handleNextPage = () => setCurrentPage(p => Math.min(p + 1, numPages));
  const handleZoomIn = () => setScale(p => Math.min(p + 0.25, 3));
  const handleZoomOut = () => setScale(p => Math.max(p - 0.25, 0.5));

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-12 text-gray-400">
        <Maximize className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm font-medium">Nenhum PDF selecionado para visualização.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-inner" ref={containerRef}>
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || loading || !pdfjsLib}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </button>
          <span className="text-xs font-bold text-gray-600 min-w-[80px] text-center">
            Página {currentPage} de {numPages}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= numPages || loading || !pdfjsLib}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-700" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input 
              type="checkbox" 
              checked={showGeometry}
              onChange={(e) => setShowGeometry(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-fire-600 focus:ring-fire-500"
            />
            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-tight">Depurador Visual</span>
          </label>

          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-200">
            <button onClick={handleZoomOut} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all" title="Diminuir Zoom">
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-[10px] font-bold text-gray-500 w-12 text-center uppercase tracking-tighter">
              {Math.round(scale * 100)}%
            </span>
            <button onClick={handleZoomIn} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all" title="Aumentar Zoom">
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-auto p-4 flex justify-center items-start custom-scrollbar bg-gray-200/50">
        {loading || !pdfjsLib ? (
          <div className="flex flex-col items-center justify-center h-64 w-full">
            <Loader2 className="w-8 h-8 text-fire-600 animate-spin mb-2" />
            <p className="text-xs text-gray-500 font-medium">Carregando visualização do PDF...</p>
          </div>
        ) : (
          <div className="shadow-2xl border border-gray-300 bg-white origin-top relative">
            <canvas ref={canvasRef} className="max-w-full h-auto" />
            <canvas 
              ref={overlayRef} 
              className="absolute top-0 left-0 w-full h-full pointer-events-none" 
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewer;
