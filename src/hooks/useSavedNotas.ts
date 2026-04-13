"use client";

import { useState, useEffect } from 'react';
import { SavedNota, BulletinNota } from '../types';

const STORAGE_KEY = 'SENTINELA_SAVED_NOTAS';

export function useSavedNotas() {
  const [savedNotas, setSavedNotas] = useState<SavedNota[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedNota[];
        // Migração: Se a nota não tiver categoria, assume 'error' (conforme uso atual relatado pelo usuário)
        const migrated = parsed.map(n => ({
          ...n,
          category: n.category || 'error'
        }));
        setSavedNotas(migrated);
      }
    } catch { /* ignore */ }
  }, []);

  const persist = (notas: SavedNota[]) => {
    setSavedNotas(notas);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notas));
  };

  const saveNota = (
    nota: BulletinNota, 
    bulletinFilename: string, 
    category: 'error' | 'relevant' = 'relevant',
    diagnosticData?: SavedNota['diagnosticData']
  ) => {
    // Evita duplicatas do mesmo nota+boletim na mesma categoria
    const alreadySaved = savedNotas.some(
      s => s.notaId === nota.id && s.bulletinFilename === bulletinFilename && s.category === category
    );
    if (alreadySaved) return false;

    const entry: SavedNota = {
      id: crypto.randomUUID(),
      notaId: nota.id,
      notaTitle: nota.title,
      notaContent: nota.contentMarkdown,
      bulletinFilename,
      category,
      isTableRow: !!(nota as any).isTableRow,
      savedAt: new Date().toLocaleString('pt-BR'),
      diagnosticData,
    };
    persist([entry, ...savedNotas]);
    return true;
  };

  const removeNota = (id: string) => {
    persist(savedNotas.filter(s => s.id !== id));
  };

  const updateObservation = (id: string, observation: string) => {
    persist(savedNotas.map(s => s.id === id ? { ...s, observation } : s));
  };

  const isSaved = (notaId: string, bulletinFilename: string, category?: 'error' | 'relevant') =>
    savedNotas.some(s => 
      s.notaId === notaId && 
      s.bulletinFilename === bulletinFilename && 
      (category ? s.category === category : true)
    );

  const importNotas = (imported: SavedNota[]) => {
    // Mescla as notas importadas com as atuais, evitando duplicatas por ID
    const currentIds = new Set(savedNotas.map(n => n.id));
    const newItems = imported.filter(n => !currentIds.has(n.id));
    if (newItems.length > 0) {
      persist([...newItems, ...savedNotas]);
      return newItems.length;
    }
    return 0;
  };

  return { savedNotas, saveNota, removeNota, updateObservation, isSaved, importNotas };
}
