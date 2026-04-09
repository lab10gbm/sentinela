"use client";

import { useState, useEffect } from 'react';
import { SavedNota, BulletinNota } from '../types';

const STORAGE_KEY = 'SENTINELA_SAVED_NOTAS';

export function useSavedNotas() {
  const [savedNotas, setSavedNotas] = useState<SavedNota[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedNotas(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persist = (notas: SavedNota[]) => {
    setSavedNotas(notas);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notas));
  };

  const saveNota = (nota: BulletinNota, bulletinFilename: string) => {
    // Evita duplicatas do mesmo nota+boletim
    const alreadySaved = savedNotas.some(
      s => s.notaId === nota.id && s.bulletinFilename === bulletinFilename
    );
    if (alreadySaved) return false;

    const entry: SavedNota = {
      id: crypto.randomUUID(),
      notaId: nota.id,
      notaTitle: nota.title,
      notaContent: nota.contentMarkdown,
      bulletinFilename,
      savedAt: new Date().toLocaleString('pt-BR'),
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

  const isSaved = (notaId: string, bulletinFilename: string) =>
    savedNotas.some(s => s.notaId === notaId && s.bulletinFilename === bulletinFilename);

  return { savedNotas, saveNota, removeNota, updateObservation, isSaved };
}
