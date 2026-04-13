import React, { useState } from 'react';
import { SavedNota } from '../types';
import { Bookmark, Trash2, ChevronRight, FileText, MessageSquare, Check, X, AlertCircle, Download, Upload, Cpu, RotateCcw } from 'lucide-react';
import { calibrationService } from '../services/calibrationService';

interface SavedNotasPanelProps {
  savedNotas: SavedNota[];
  onRemove: (id: string) => void;
  onUpdateObservation: (id: string, obs: string) => void;
  onImport: (notas: SavedNota[]) => number;
}

const SavedNotasPanel: React.FC<SavedNotasPanelProps> = ({ savedNotas, onRemove, onUpdateObservation, onImport }) => {
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

  const handleExport = () => {
    const data = JSON.stringify(savedNotas, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sentinela_diagnostico_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const count = onImport(json);
        alert(`${count} novas notas importadas com sucesso!`);
      } catch (err) {
        alert("Erro ao importar arquivo. Certifique-se que é um backup válido.");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  if (savedNotas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
        <Bookmark className="w-10 h-10 opacity-30" />
        <p className="text-sm font-medium">Nenhuma nota salva ainda.</p>
        <p className="text-xs text-center max-w-xs">
          Ações disponíveis nas notas: <br/>
          <span className="text-red-400 font-bold">X</span> Reportar erro de formatação <br/>
          <span className="text-orange-400 font-bold">🔖</span> Salvar nota relevante
        </p>
      </div>
    );
  }

  // Ordenar: primeiro erros, depois relevantes (ou vice-versa)? Vamos manter a ordem de data, mas categorizar visualmente.
  
  return (
    <div className="space-y-4 pb-20">
      {/* Seção de Sincronização/Backup */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <Download className="w-4 h-4 text-indigo-500" /> Sincronização Manual
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Como os dados são salvos localmente, use o backup para levar suas notas de um computador para outro.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Exportar
            </button>
            <label className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 rounded-lg text-xs font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> Importar
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Seção de Calibração Industrial */}
      <div className="bg-fire-50 border border-fire-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex gap-3 items-start">
             <div className="bg-fire-100 p-2 rounded-lg text-fire-600">
                <Cpu className="w-5 h-5" />
             </div>
             <div>
                <h3 className="text-sm font-bold text-fire-900 flex items-center gap-2">
                  Motor de Calibração Industrial
                </h3>
                <p className="text-[10px] text-fire-700 mt-0.5 leading-relaxed">
                  O algoritmo analisa suas marcações de <b>ERRO (X)</b> para ajustar automaticamente as heurísticas de detecção geométrica e gaps de tabela.
                </p>
             </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const results = await calibrationService.calibrateFromDiagnostics(savedNotas);
                alert(`Motor Calibrado! \n• Gap de Tabela: ${results.tableGapThreshold}px \n• Sensibilidade: ${results.tableStrictGapThreshold}px`);
              }}
              disabled={savedNotas.filter(n => n.category === 'error').length === 0}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-fire-600 rounded-lg text-xs font-bold text-white hover:bg-fire-700 disabled:opacity-30 disabled:grayscale transition-all shadow-md active:scale-95"
            >
              <Cpu className="w-3.5 h-3.5" /> Calibrar Agora
            </button>
            <button
              onClick={() => {
                if (confirm("Deseja restaurar as heurísticas de fábrica do Sentinela?")) {
                    calibrationService.reset();
                    alert("Heurísticas restauradas para o padrão original.");
                }
              }}
              className="p-2 border border-fire-300 rounded-lg text-fire-700 hover:bg-fire-100 transition-colors"
              title="Resetar para padrões de fábrica"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          {savedNotas.length} {savedNotas.length === 1 ? 'nota salva' : 'notas salvas'}
        </span>
        <div className="flex gap-3">
            <span className="flex items-center gap-1 text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                <X className="w-2.5 h-2.5" /> ERROS: {savedNotas.filter(n => n.category === 'error').length}
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                <Bookmark className="w-2.5 h-2.5" /> RELEVANTES: {savedNotas.filter(n => n.category === 'relevant').length}
            </span>
        </div>
      </div>

      {savedNotas.map(saved => {
        const isExpanded = expandedId === saved.id;
        const isError = saved.category === 'error';
        
        return (
          <div 
            key={saved.id} 
            className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
              isError 
                ? 'border-red-200 hover:border-red-300' 
                : 'border-orange-200 hover:border-orange-300'
            }`}
          >
            {/* Header */}
            <div
              className={`px-4 py-3 border-b flex items-start gap-3 cursor-pointer transition-colors ${
                isError ? 'bg-red-50/60 border-red-100 hover:bg-red-50' : 'bg-orange-50/60 border-orange-100 hover:bg-orange-50'
              }`}
              onClick={() => setExpandedId(isExpanded ? null : saved.id)}
            >
              <div className="mt-0.5 flex-shrink-0 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <ChevronRight className={`w-4 h-4 ${isError ? 'text-red-400' : 'text-orange-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    {isError ? (
                        <span className="flex items-center gap-1 text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm">
                            <AlertCircle className="w-2.5 h-2.5" /> ERRO
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-[9px] font-black bg-orange-500 text-white px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm">
                            <Bookmark className="w-2.5 h-2.5" /> RELEVANTE
                        </span>
                    )}
                    <p className="text-sm font-bold text-gray-800 leading-tight truncate">{saved.notaTitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <FileText className="w-3 h-3" /> {saved.bulletinFilename}
                  </span>
                  <span className="text-[10px] text-gray-300">•</span>
                  <span className="text-[10px] text-gray-400">{saved.savedAt}</span>
                </div>
                {saved.observation && (
                  <p className={`mt-1 text-[11px] rounded px-2 py-0.5 inline-block ${
                    isError ? 'text-red-700 bg-red-100' : 'text-orange-700 bg-orange-100'
                  }`}>
                    💬 {saved.observation}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => startEdit(saved)}
                  title="Adicionar observação"
                  className={`p-1.5 rounded-lg text-gray-400 transition-colors ${
                    isError ? 'hover:text-red-600 hover:bg-red-100' : 'hover:text-orange-600 hover:bg-orange-100'
                  }`}
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
              <div className={`px-4 py-3 border-b flex gap-2 ${isError ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'}`} onClick={e => e.stopPropagation()}>
                <input
                  autoFocus
                  type="text"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveEdit(saved.id)}
                  placeholder={isError ? "Ex: tabela mal detectada, parágrafo ignorado..." : "Ex: nota importante sobre transferência..."}
                  className={`flex-1 text-xs border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 ${
                    isError ? 'border-red-200 focus:ring-red-400' : 'border-orange-200 focus:ring-orange-400'
                  }`}
                />
                <button
                  onClick={() => saveEdit(saved.id)}
                  className={`p-1.5 text-white rounded-lg transition-colors ${
                    isError ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Conteúdo expandido */}
            {isExpanded && (
              <div className="px-4 py-4 bg-white">
                <pre className={`text-xs whitespace-pre-wrap font-mono rounded-lg p-3 border max-h-96 overflow-y-auto leading-relaxed ${
                    isError ? 'text-red-900 bg-red-50/30 border-red-50' : 'text-gray-600 bg-gray-50 border-gray-100'
                }`}>
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
