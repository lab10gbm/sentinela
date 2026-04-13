"use client";

import { useState } from 'react';
import { BulletinNota, StoredBulletin, AnalysisState, TextToken, MilitaryPerson, SearchPreferences } from '../types';
import { extractTextFromPdf } from '../services/pdfWorkerService';
import { extractBulletinLocalAlgo } from '../services/bulletinParserService';
import { saveBulletin, getAllBulletins, deleteBulletinFromDB } from '../services/dbService';

type PageMapEntry = { 
  page: number; 
  text: string; 
  tokens: TextToken[]; 
  lines: { text: string; y: number }[];
  isOcr?: boolean;
};

const STORAGE_KEY_BULLETINS = 'SENTINELA_BULLETIN_HISTORY';

export function useBulletinPipeline() {
  const [extractedNotas, setExtractedNotas] = useState<BulletinNota[]>([]);
  const [bulletinHistory, setBulletinHistory] = useState<StoredBulletin[]>([]);
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(null);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [pageMap, setPageMap] = useState<PageMapEntry[]>([]);
  const [state, setState] = useState<AnalysisState>({ isProcessing: false, stage: 'idle' });

  const loadHistory = async () => {
    // Migração de LocalStorage → IndexedDB
    const legacyData = localStorage.getItem(STORAGE_KEY_BULLETINS);
    if (legacyData) {
      try {
        const bulletins: StoredBulletin[] = JSON.parse(legacyData);
        for (const b of bulletins) await saveBulletin(b);
        localStorage.removeItem(STORAGE_KEY_BULLETINS);
      } catch (e) {
        console.error("Erro na migração do histórico:", e);
      }
    }

    try {
      const all = await getAllBulletins();
      const sorted = all.sort((a, b) => {
        try {
          const parseDate = (d: string) => {
            const [date, time] = d.split(' ');
            const [day, month, year] = date.split('/');
            return new Date(`${year}-${month}-${day}T${time}`).getTime();
          };
          return parseDate(b.dateProcessed) - parseDate(a.dateProcessed);
        } catch { return 0; }
      });
      setBulletinHistory(sorted);
      if (sorted.length > 0) setSelectedBulletinId(null);
      setIsHistoryLoaded(true);
      return sorted;
    } catch (e) {
      console.error("Erro ao carregar histórico do IndexedDB:", e);
      setIsHistoryLoaded(true);
      return [];
    }
  };

  const runBulletinExtraction = async (
    pdfFile: File,
    personnel: MilitaryPerson[],
    keywords: string[],
    searchPrefs: SearchPreferences,
    currentPageMap: PageMapEntry[]
  ) => {
    setState({ isProcessing: true, stage: 'parsing_pdf' });
    try {
      let pm = currentPageMap;
      if (pm.length === 0) {
        const { pageMap: extracted } = await extractTextFromPdf(pdfFile);
        pm = extracted;
        setPageMap(pm);
      }

      const notas = await extractBulletinLocalAlgo(pdfFile, personnel, keywords, searchPrefs, pm);
      setExtractedNotas(notas || []);

      if (notas && notas.length > 0) {
        try {
          const id = crypto.randomUUID();
          const newBulletin: StoredBulletin = {
            id,
            filename: pdfFile.name,
            dateProcessed: new Date().toLocaleString('pt-BR'),
            notas,
          };
          await saveBulletin(newBulletin);
          setBulletinHistory(prev => [newBulletin, ...prev]);
          setSelectedBulletinId(newBulletin.id);
        } catch (e) {
          console.error("Erro ao registrar boletim no histórico:", e);
          alert("O limite de armazenamento do navegador foi excedido. Tente excluir boletins antigos.");
        }
      }

      setState({ isProcessing: false, stage: 'complete' });
    } catch (error: any) {
      console.error('[runBulletinExtraction] Erro:', error);
      console.error('[runBulletinExtraction] Stack:', error?.stack);
      setState({ isProcessing: false, stage: 'error', errorMessage: error.message || 'Erro ao extrair o PDF.' });
    }
  };

  const deleteBulletin = async (id: string) => {
    if (!window.confirm("Tem certeza que deseja apagar este boletim do histórico?")) return;
    try {
      await deleteBulletinFromDB(id);
      setBulletinHistory(prev => prev.filter(b => b.id !== id));
      if (selectedBulletinId === id) setSelectedBulletinId(null);
    } catch (e) {
      console.error("Erro ao deletar boletim:", e);
      alert("Erro ao remover do banco de dados.");
    }
  };

  const resetBulletin = () => {
    setExtractedNotas([]);
  };

  const runBulkExtraction = async (
    personnel: MilitaryPerson[],
    keywords: string[],
    searchPrefs: SearchPreferences
  ) => {
    setState({ isProcessing: true, stage: 'parsing_pdf' });
    try {
      const manifestRes = await fetch('/boletins/manifest.json');
      const files: string[] = await manifestRes.json();
      
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      let count = 0;
      for (const filename of files) {
        count++;
        setState({ isProcessing: true, stage: 'parsing_pdf', errorMessage: `Processando ${count}/${files.length}: ${filename}` });
        
        // Pequena pausa para permitir que o navegador respire e limpe memória
        await delay(500);

        try {
          const res = await fetch(`/boletins/${filename}`);
          const blob = await res.blob();
          const file = new File([blob], filename, { type: 'application/pdf' });
          
          const { pageMap: extracted } = await extractTextFromPdf(file);
          const notas = await extractBulletinLocalAlgo(file, personnel, keywords, searchPrefs, extracted);
          
          if (notas && notas.length > 0) {
            const id = crypto.randomUUID();
            const newBulletin: StoredBulletin = {
              id,
              filename: file.name,
              dateProcessed: new Date().toLocaleString('pt-BR'),
              notas,
            };
            await saveBulletin(newBulletin);
            setBulletinHistory(prev => [newBulletin, ...prev]);
          }
          
          // "Limpeza" manual sugerida para blobs grandes
        } catch (itemError) {
          console.error(`Erro ao processar ${filename}:`, itemError);
          // Continua para o próximo arquivo mesmo se um falhar
        }
      }
      
      setState({ isProcessing: false, stage: 'complete' });
    } catch (error: any) {
      console.error('[runBulkExtraction] Erro:', error);
      setState({ isProcessing: false, stage: 'error', errorMessage: error.message || 'Erro na extração em lote.' });
    }
  };

  return {
    extractedNotas,
    bulletinHistory,
    selectedBulletinId,
    setSelectedBulletinId,
    isHistoryLoaded,
    pageMap,
    setPageMap,
    state,
    setState,
    loadHistory,
    runBulletinExtraction,
    runBulkExtraction,
    deleteBulletin,
    resetBulletin,
  };
}
