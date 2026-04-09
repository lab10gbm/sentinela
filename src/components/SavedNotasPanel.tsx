import React, { useState } from 'react';
import { SavedNota } from '../types';
import { Bookmark, Trash2, ChevronRight, FileText, MessageSquare, Check } from 'lucide-react';

interface SavedNotasPanelProps {
  savedNotas: SavedNota[];
  onRemove: (id: string) => void;
  onUpdateObservation: (id: string, obs: string) => void;
}

const SavedNotasPanel: React.FC<SavedNotasPanelProps> = ({ savedNotas, onRemove, onUpdateObservation }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const startEdit = (nota: SavedNota) => {
    setEditingId(nota.id);
    setEditText(nota.observation || '');
  };

  const saveEdit = (id: string) => {
    onUpdateObservation(id, editText);
    setEditingId(null);
  };

  if (savedNotas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
        <Bookmark className="w-10 h-10 opacity-30" />
        <p className="text-sm font-medium">Nenhuma nota salva ainda.</p>
        <p className="text-xs text-center max-w-xs">
          Clique no ícone 🔖 ao lado de qualquer nota para salvá-la aqui e analisar problemas de formatação.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          {savedNotas.length} {savedNotas.length === 1 ? 'nota salva' : 'notas salvas'}
        </span>
        <span className="text-[10px] text-gray-400">Clique para expandir • Edite observações</span>
      </div>

      {savedNotas.map(saved => {
        const isExpanded = expandedId === saved.id;
        return (
          <div key={saved.id} className="bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div
              className="px-4 py-3 bg-orange-50/60 border-b border-orange-100 flex items-start gap-3 cursor-pointer hover:bg-orange-50 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : saved.id)}
            >
              <div className="mt-0.5 flex-shrink-0 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <ChevronRight className="w-4 h-4 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800 leading-tight truncate">{saved.notaTitle}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <FileText className="w-3 h-3" /> {saved.bulletinFilename}
                  </span>
                  <span className="text-[10px] text-gray-300">•</span>
                  <span className="text-[10px] text-gray-400">{saved.savedAt}</span>
                </div>
                {saved.observation && (
                  <p className="mt-1 text-[11px] text-orange-700 bg-orange-100 rounded px-2 py-0.5 inline-block">
                    💬 {saved.observation}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => startEdit(saved)}
                  title="Adicionar observação"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-100 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onRemove(saved.id)}
                  title="Remover"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Edição de observação */}
            {editingId === saved.id && (
              <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex gap-2" onClick={e => e.stopPropagation()}>
                <input
                  autoFocus
                  type="text"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveEdit(saved.id)}
                  placeholder="Ex: tabela mal detectada, parágrafo virou tabela..."
                  className="flex-1 text-xs border border-orange-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                <button
                  onClick={() => saveEdit(saved.id)}
                  className="p-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Conteúdo expandido */}
            {isExpanded && (
              <div className="px-4 py-4 bg-white">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-3 border border-gray-100 max-h-96 overflow-y-auto leading-relaxed">
                  {saved.notaContent}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SavedNotasPanel;
