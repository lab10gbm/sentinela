"use client";
import { useState, useEffect } from 'react';
import { MilitaryPerson } from '../types';
import { parseExcelRoster } from '../services/fileService';

const STORAGE_KEY = 'SENTINELA_ROSTER_DATA';

export function useRoster() {
  const [personnel, setPersonnel] = useState<MilitaryPerson[]>([]);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [hasMemoryData, setHasMemoryData] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // useEffect só roda no cliente — evita hydration mismatch com SSR
  useEffect(() => {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHasMemoryData(true);
        }
      } catch (e) {
        console.error("Erro ao verificar efetivo na memória:", e);
      }
    }
  }, []);

  const loadFromMemory = (onSuccess?: () => void) => {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPersonnel(parsed);
          setExcelFile(null);
          onSuccess?.();
        }
      } catch (e) {
        console.error("Erro ao carregar da memória", e);
        alert("Erro ao ler dados da memória.");
      }
    }
  };

  const checkMemory = () => {
    setHasMemoryData(!!localStorage.getItem(STORAGE_KEY));
  };

  const clearMemory = () => {
    if (!window.confirm("Tem certeza que deseja apagar o banco de dados salvo?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setHasMemoryData(false);
    setPersonnel([]);
    setExcelFile(null);
  };

  const handleExcelUpload = async (
    file: File,
    onSuccess?: () => void,
    onError?: (msg: string) => void
  ) => {
    setExcelFile(file);
    try {
      const parsedData = await parseExcelRoster(file);
      setPersonnel(parsedData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsedData));
      setHasMemoryData(true);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      setExcelFile(null);
      onError?.('Erro ao ler a planilha Excel. Verifique o formato.');
    }
  };

  const handleGoogleSync = async (
    onSuccess?: () => void,
    onError?: (msg: string) => void
  ) => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/efetivo');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao sincronizar Efetivo');
      setPersonnel(data.personnel);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.personnel));
      setHasMemoryData(true);
      onSuccess?.();
    } catch (error: any) {
      console.error(error);
      onError?.(error.message || 'Erro ao sincronizar planilha Google Sheets.');
    } finally {
      setIsSyncing(false);
    }
  };

  return {
    personnel,
    excelFile,
    hasMemoryData,
    isSyncing,
    checkMemory,
    loadFromMemory,
    clearMemory,
    handleExcelUpload,
    handleGoogleSync,
  };
}
