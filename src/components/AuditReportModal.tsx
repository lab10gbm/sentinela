
import React from 'react';
import { X, Bot, AlertTriangle, CheckCircle, Lightbulb, Bug } from 'lucide-react';

interface AuditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportMarkdown: string;
}

const AuditReportModal: React.FC<AuditReportModalProps> = ({ isOpen, onClose, reportMarkdown }) => {
  if (!isOpen) return null;

  // Função simples para converter markdown básico em HTML seguro para visualização
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-gray-800 mt-4 mb-2">{line.replace('### ', '')}</h3>;
      if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-indigo-700 mt-6 mb-3 border-b border-indigo-100 pb-1">{line.replace('## ', '')}</h2>;
      if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-indigo-900 mb-4">{line.replace('# ', '')}</h1>;
      if (line.startsWith('- ')) return <li key={i} className="ml-4 text-gray-700 list-disc">{line.replace('- ', '')}</li>;
      if (line.startsWith('1. ')) return <li key={i} className="ml-4 text-gray-700 list-decimal">{line.replace(/^\d+\.\s/, '')}</li>;
      if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold text-gray-900 my-2">{line.replace(/\*\*/g, '')}</p>;
      if (line.trim() === '') return <br key={i} />;
      return <p key={i} className="text-gray-700 leading-relaxed">{line}</p>;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="bg-indigo-600 p-4 flex justify-between items-center text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Relatório de Auditoria Técnica</h2>
              <p className="text-xs text-indigo-200">Análise de qualidade do algoritmo local via Gemini AI</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar bg-gray-50 flex-grow">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            {renderContent(reportMarkdown)}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-100 p-4 border-t border-gray-200 flex justify-between items-center text-xs text-gray-500 shrink-0">
          <span className="flex items-center gap-1">
            <Bug className="w-4 h-4" />
            Identificação de falhas de Regex
          </span>
          <span className="flex items-center gap-1">
            <Lightbulb className="w-4 h-4" />
            Sugestões de otimização
          </span>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition-colors"
          >
            Fechar Relatório
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuditReportModal;
