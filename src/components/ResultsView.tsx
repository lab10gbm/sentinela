
import React, { useMemo, useState } from 'react';
import { ExtractionResult, MatchType, MilitaryPerson } from '../types';
import { Users, BookOpen, ChevronRight, Quote, CornerDownRight, Tag, AlignLeft, Building2, AlertCircle, CheckCircle2, HelpCircle, Table, PenSquare, Save, X } from 'lucide-react';

interface ResultsViewProps {
  results: ExtractionResult[];
  fontFamily?: 'Segoe UI' | 'Arial Narrow';
  fontSize?: number;
  isJustified?: boolean;
  onCorrection?: (id: string, correctionText: string) => void;
  onSectionBodyCorrection?: (sectionTitle: string, correctionText: string) => void;
  onSectionTitleCorrection?: (oldSectionTitle: string, newTitle: string) => void; // NOVO
}

interface GroupedSection {
  sectionKey: string;
  sectionTitle: string;
  userSectionTitleCorrection?: string; // NOVO
  sectionBody?: string;
  sectionFooter?: string;
  pageNumber?: number;
  maxRelevance: number;
  items: ExtractionResult[];
}

type MainTab = 'units' | 'personnel';
type ConfidenceTab = 'high' | 'medium' | 'low';

// --- HELPER: NORMALIZE TEXT FOR COMPARISON ---
const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

// --- HELPER COMPONENT: HIGHLIGHTER ---
const Highlighter = ({ text, person }: { text: string, person?: MilitaryPerson }) => {
  if (!text) return null;
  if (!person) return <span>{text}</span>;

  // Split text into words/tokens keeping delimiters and multiple spaces to preserve table formatting
  const tokens = text.split(/(\s+|[.,;!?()"\-:])/);

  return (
    <span>
      {tokens.map((token, i) => {
        // Skip normalizing whitespace tokens to preserve formatting
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;

        const cleanToken = normalize(token);
        
        if (!cleanToken) return <span key={i}>{token}</span>;

        // 1. NOME DE GUERRA (VERMELHO E NEGRITO)
        if (person.nomeGuerra) {
            const warParts = normalize(person.nomeGuerra).split(' '); // Normalize war name parts too
            // Exact match on normalized token
            if (warParts.some(part => part === cleanToken)) {
                return <span key={i} className="font-bold text-fire-600">{token}</span>;
            }
        }

        let isOtherMatch = false;

        // 2. RG (NEGRITO)
        if (person.rg) {
            const cleanRg = person.rg.replace(/[^0-9]/g, ''); 
            const cleanTokenNum = token.replace(/[^0-9]/g, '');
            if (cleanTokenNum && cleanRg.includes(cleanTokenNum) && cleanTokenNum.length > 2) {
                isOtherMatch = true;
            }
        }

        // 3. ID (NEGRITO)
        if (person.idFuncional) {
            const cleanId = person.idFuncional.replace(/[^0-9]/g, '');
            const cleanTokenNum = token.replace(/[^0-9]/g, '');
            if (cleanTokenNum && cleanId.includes(cleanTokenNum) && cleanTokenNum.length > 2) {
                isOtherMatch = true;
            }
        }

        // 4. PARTES DO NOME COMPLETO (NEGRITO)
        if (person.nomeCompleto) {
             const nameParts = person.nomeCompleto.toLowerCase().split(' ').map(normalize).filter(p => p.length > 2);
             if (nameParts.includes(cleanToken)) {
                 isOtherMatch = true;
             }
        }

        if (isOtherMatch) {
            return <span key={i} className="font-bold text-gray-900">{token}</span>;
        }

        return <span key={i}>{token}</span>;
      })}
    </span>
  );
};

// --- HELPER COMPONENT: DATA BAR (MINI TABELA) ---
const DataBar = ({ person, text }: { person: MilitaryPerson, text: string }) => {
    // Helper to check if field exists in text to highlight in DataBar
    const normalizedText = normalize(text);

    const isFound = (value?: string) => {
        if (!value) return false;
        const cleanVal = normalize(value);
        if (cleanVal.length < 2) return false; 
        return normalizedText.includes(cleanVal);
    };

    const isNumFound = (value?: string) => {
        if (!value) return false;
        const cleanVal = value.replace(/[^0-9]/g, '');
        const cleanTextNum = text.replace(/[^0-9]/g, '');
        if (cleanVal.length < 3) return false;
        return cleanTextNum.includes(cleanVal);
    };

    return (
        <div className="flex flex-wrap items-center gap-y-1 gap-x-4 bg-gray-50 border-b border-gray-200 px-4 py-2 text-xs text-gray-600 font-mono">
            <div className="flex items-center gap-1">
                <span className="text-gray-400">POSTO:</span>
                <span className="font-semibold text-gray-700">{person.postoGraduacao || '-'}</span>
            </div>
            
            <div className={`flex items-center gap-1 ${isFound(person.nomeCompleto) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">NOME:</span>
                <span className={`font-semibold ${isFound(person.nomeCompleto) ? 'font-bold' : ''}`}>
                    {person.nomeCompleto}
                </span>
            </div>

            <div className={`flex items-center gap-1 ${isFound(person.nomeGuerra) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">GUERRA:</span>
                <span className={`font-semibold ${isFound(person.nomeGuerra) ? 'font-bold' : ''}`}>
                    {person.nomeGuerra || '-'}
                </span>
            </div>

            <div className={`flex items-center gap-1 ${isNumFound(person.rg) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">RG:</span>
                <span className={`font-semibold ${isNumFound(person.rg) ? 'font-bold' : ''}`}>
                    {person.rg || '-'}
                </span>
            </div>

             <div className={`flex items-center gap-1 ${isNumFound(person.idFuncional) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">ID:</span>
                <span className={`font-semibold ${isNumFound(person.idFuncional) ? 'font-bold' : ''}`}>
                    {person.idFuncional || '-'}
                </span>
            </div>

            <div className={`flex items-center gap-1 ${isFound(person.obmDbm) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">OBM:</span>
                <span className={`font-semibold ${isFound(person.obmDbm) ? 'font-bold' : ''}`}>
                    {person.obmDbm || '-'}
                </span>
            </div>

            <div className={`flex items-center gap-1 ${isFound(person.regiao) ? 'text-blue-700' : ''}`}>
                <span className="text-gray-400">REGIÃO:</span>
                <span className={`font-semibold ${isFound(person.regiao) ? 'font-bold' : ''}`}>
                    {person.regiao || '-'}
                </span>
            </div>
        </div>
    );
};


const ResultsView: React.FC<ResultsViewProps> = ({ 
  results,
  fontFamily = 'Segoe UI',
  fontSize = 11,
  isJustified = true,
  onCorrection,
  onSectionBodyCorrection,
  onSectionTitleCorrection
}) => {
  
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('personnel');
  const [activeConfidenceTab, setActiveConfidenceTab] = useState<ConfidenceTab>('high');
  
  // Estado para gerenciar qual item está sendo editado (ITEM INDIVIDUAL)
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [tempCorrection, setTempCorrection] = useState('');

  // Estado para gerenciar edição do CORPO DA SEÇÃO
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [tempSectionCorrection, setTempSectionCorrection] = useState('');

  // Estado para gerenciar edição do TÍTULO DA SEÇÃO
  const [editingTitleKey, setEditingTitleKey] = useState<string | null>(null);
  const [tempTitleCorrection, setTempTitleCorrection] = useState('');

  // --- HANDLERS PARA ITEM INDIVIDUAL ---
  const handleEditClick = (item: ExtractionResult) => {
    setEditingItemId(item.id);
    setTempCorrection(item.userCorrection || item.relatedContent || '');
  };

  const handleSaveCorrection = (id: string) => {
    if (onCorrection) {
        onCorrection(id, tempCorrection);
    }
    setEditingItemId(null);
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setTempCorrection('');
  };

  // --- HANDLERS PARA CORPO DA SEÇÃO ---
  const handleSectionEditClick = (sectionKey: string, currentBody: string) => {
    setEditingSectionKey(sectionKey);
    setTempSectionCorrection(currentBody);
  };

  const handleSectionSave = (sectionTitle: string) => {
    if (onSectionBodyCorrection) {
        onSectionBodyCorrection(sectionTitle, tempSectionCorrection);
    }
    setEditingSectionKey(null);
  };

  const handleSectionCancel = () => {
    setEditingSectionKey(null);
    setTempSectionCorrection('');
  };

  // --- HANDLERS PARA TÍTULO DA SEÇÃO ---
  const handleTitleEditClick = (sectionKey: string, currentTitle: string) => {
    setEditingTitleKey(sectionKey);
    setTempTitleCorrection(currentTitle);
  };

  const handleTitleSave = (oldTitle: string) => {
    if (onSectionTitleCorrection) {
        onSectionTitleCorrection(oldTitle, tempTitleCorrection);
    }
    setEditingTitleKey(null);
  };

  const handleTitleCancel = () => {
    setEditingTitleKey(null);
    setTempTitleCorrection('');
  };


  const getDynamicStyle = () => ({
    fontFamily: fontFamily, 
    fontSize: `${fontSize}px`, 
    textAlign: isJustified ? 'justify' as const : 'left' as const,
    lineHeight: 1.5
  });

  const dynamicStyle = getDynamicStyle();

  // --- HELPER PARA RENDERIZAR TEXTO COM MÚLTIPLOS PARÁGRAFOS ---
  // Separa o texto por \n e renderiza um <p> com indent-8 para CADA parágrafo
  const renderMultiParagraphText = (text: string, isCorrection = false) => {
      const paragraphs = text.split('\n');
      return paragraphs.map((para, i) => {
          if (!para.trim()) return null;
          return (
              <p 
                key={i} 
                className={`leading-relaxed indent-8 mb-2 ${isCorrection ? 'text-indigo-900' : 'text-gray-800'}`}
                style={dynamicStyle}
              >
                  {para}
              </p>
          );
      });
  };

  const filteredResults = useMemo(() => {
    return results.filter(r => {
      // UNIT TAB
      if (activeMainTab === 'units') {
        return r.type === MatchType.UNIT_KEYWORD;
      }
      
      if (activeMainTab === 'personnel') {
        if (r.type !== MatchType.PERSONNEL) return false;
        if (activeConfidenceTab === 'high') return r.relevanceScore >= 90; 
        if (activeConfidenceTab === 'medium') return r.relevanceScore >= 50 && r.relevanceScore < 90;
        if (activeConfidenceTab === 'low') return r.relevanceScore < 50; 
      }
      return false;
    });
  }, [results, activeMainTab, activeConfidenceTab]);

  const groupedResults = useMemo(() => {
    const groups: { [key: string]: GroupedSection } = {};
    filteredResults.forEach(result => {
      const sectionKey = result.section ? result.section.toLowerCase().trim() : `unknown-page-${result.pageNumber}`;
      if (!groups[sectionKey]) {
        groups[sectionKey] = {
          sectionKey,
          sectionTitle: result.section || 'Seção não identificada',
          userSectionTitleCorrection: result.userSectionTitleCorrection, // Pega do primeiro item
          sectionBody: result.sectionBody,
          sectionFooter: result.sectionFooter,
          pageNumber: result.pageNumber,
          maxRelevance: 0,
          items: []
        };
      }
      if (result.relevanceScore > groups[sectionKey].maxRelevance) {
        groups[sectionKey].maxRelevance = result.relevanceScore;
      }
      groups[sectionKey].items.push(result);
    });
    return Object.values(groups).sort((a, b) => b.maxRelevance - a.maxRelevance);
  }, [filteredResults]);

  // Count items for badges
  const unitCount = results.filter(r => r.type === MatchType.UNIT_KEYWORD).length;
  const personnelCount = results.filter(r => r.type === MatchType.PERSONNEL).length;

  if (results.length === 0) return null;

  return (
    <div className="space-y-6">
      
      {/* --- LEVEL 1 TABS: UNITS VS PERSONNEL --- */}
      <div className="flex space-x-1 bg-gray-100/80 p-1 rounded-lg border border-gray-200">
        <button
          onClick={() => setActiveMainTab('personnel')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all
            ${activeMainTab === 'personnel' ? 'bg-white text-gray-800 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}
          `}
        >
          <Users className="w-4 h-4" />
          MILITARES
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeMainTab === 'personnel' ? 'bg-fire-100 text-fire-700' : 'bg-gray-200 text-gray-600'}`}>
            {personnelCount}
          </span>
        </button>
        
        <button
          onClick={() => setActiveMainTab('units')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all
            ${activeMainTab === 'units' ? 'bg-white text-gray-800 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}
          `}
        >
          <Building2 className="w-4 h-4" />
          UNIDADES / OBM
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeMainTab === 'units' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
            {unitCount}
          </span>
        </button>
      </div>

      {/* --- LEVEL 2 TABS: CONFIDENCE (Only for Personnel) --- */}
      {activeMainTab === 'personnel' && (
         <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveConfidenceTab('high')}
              className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
                ${activeConfidenceTab === 'high' ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              <CheckCircle2 className="w-4 h-4" />
              Alta Confiança (ID/RG)
            </button>
            <button
              onClick={() => setActiveConfidenceTab('medium')}
              className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
                ${activeConfidenceTab === 'medium' ? 'border-yellow-500 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              <HelpCircle className="w-4 h-4" />
              Média Confiança
            </button>
            <button
              onClick={() => setActiveConfidenceTab('low')}
              className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
                ${activeConfidenceTab === 'low' ? 'border-red-500 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              <AlertCircle className="w-4 h-4" />
              Baixa Confiança (Homônimos)
            </button>
         </div>
      )}

      {groupedResults.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-white rounded-lg border border-dashed border-gray-200">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Nenhum resultado encontrado nesta categoria.</p>
        </div>
      ) : (
        groupedResults.map((group, groupIdx) => {
          // Verifica se existe alguma correção de seção salva para este grupo
          const sectionCorrection = group.items[0]?.userSectionBodyCorrection;
          const displayBody = sectionCorrection || group.sectionBody;
          
          // Verifica se existe correção de TÍTULO
          const titleCorrection = group.items[0]?.userSectionTitleCorrection;
          const displayTitle = titleCorrection || group.sectionTitle;

          return (
            <div key={groupIdx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Section Header */}
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-start gap-3 relative group/title">
                
                <BookOpen className="w-5 h-5 text-fire-600 mt-0.5 flex-shrink-0" />
                
                <div className="min-w-0 flex-grow">
                  <div className="flex items-center gap-2">
                     <p className="text-xs font-bold text-fire-700 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                        <CornerDownRight className="w-3 h-3" />
                        Localização da Seção {group.pageNumber ? `(Pág. aprox ${group.pageNumber})` : ''}
                     </p>
                     
                     {/* Botão de Edição de Título */}
                     {editingTitleKey !== group.sectionKey && (
                        <button
                            onClick={() => handleTitleEditClick(group.sectionKey, displayTitle)}
                            className="opacity-0 group-hover/title:opacity-100 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-indigo-600 transition-all"
                            title="Corrigir Título da Seção"
                        >
                            <PenSquare className="w-3 h-3" />
                        </button>
                     )}
                  </div>
                  
                  {editingTitleKey === group.sectionKey ? (
                      // FORMULÁRIO DE EDIÇÃO DE TÍTULO
                      <div className="mt-1 flex flex-col gap-2 bg-white p-2 rounded border border-indigo-200 shadow-sm animate-in fade-in zoom-in duration-100">
                          <textarea
                             className="w-full text-sm p-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-['Segoe_UI']"
                             rows={2}
                             value={tempTitleCorrection}
                             onChange={(e) => setTempTitleCorrection(e.target.value)}
                          />
                          <div className="flex justify-end gap-2">
                             <button onClick={handleTitleCancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
                             <button onClick={() => handleTitleSave(group.sectionTitle)} className="text-xs text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded font-bold">Salvar Título</button>
                          </div>
                      </div>
                  ) : (
                      // VISUALIZAÇÃO DO TÍTULO (CORRIGIDO OU ORIGINAL)
                      <div className={`text-sm text-gray-800 break-words leading-snug ${titleCorrection ? 'bg-indigo-50 px-1 rounded -ml-1 border border-indigo-100' : ''}`}>
                        {titleCorrection ? (
                            // Se foi corrigido manualmente, mostra como texto simples (pois o usuário pode ter colado algo novo)
                            <span className="font-bold underline decoration-gray-400 underline-offset-2 font-['Segoe_UI'] text-indigo-900">
                                {titleCorrection}
                            </span>
                        ) : (
                            // Se é original, mostra breadcrumbs
                            displayTitle.split('>').map((part, i, arr) => (
                              <span key={i} className={i === arr.length - 1 ? "font-bold underline decoration-gray-400 underline-offset-2 font-['Segoe_UI']" : "text-gray-500"}>
                                {part.trim()}
                                {i < arr.length - 1 && <ChevronRight className="w-3 h-3 inline mx-1 text-gray-300" />}
                              </span>
                            ))
                        )}
                      </div>
                  )}

                </div>
              </div>

              {/* Section Body (Intro Text) with EDIT SUPPORT */}
              {group.sectionBody && (
                <div className="px-4 py-3 bg-white border-b border-gray-100 relative group/sectionbody">
                   
                   {/* Botão de Edição da Seção */}
                   {editingSectionKey !== group.sectionKey && (
                     <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/sectionbody:opacity-100 transition-opacity">
                        <button
                            onClick={() => handleSectionEditClick(group.sectionKey, displayBody || '')}
                            className="p-1.5 rounded bg-gray-100 hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 border border-transparent hover:border-indigo-200 transition-all"
                            title="Corrigir texto da seção (Gabarito)"
                        >
                            <PenSquare className="w-4 h-4" />
                        </button>
                     </div>
                   )}

                   {/* Indicador de Correção Pendente */}
                   {sectionCorrection && editingSectionKey !== group.sectionKey && (
                      <div className="absolute top-0 right-10 bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-b font-bold uppercase tracking-wider">
                          Correção de Seção Pendente
                      </div>
                   )}

                   {editingSectionKey === group.sectionKey ? (
                      // FORMULÁRIO DE EDIÇÃO DA SEÇÃO
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 animate-in fade-in zoom-in duration-200">
                         <label className="block text-xs font-bold text-indigo-800 mb-1">
                            CORREÇÃO DO TEXTO DA SEÇÃO (Como deveria ser o cabeçalho/descrição?):
                         </label>
                         <textarea 
                            className="w-full text-sm p-2 border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 mb-2 font-mono"
                            rows={5}
                            value={tempSectionCorrection}
                            onChange={(e) => setTempSectionCorrection(e.target.value)}
                         />
                         <div className="flex justify-end gap-2">
                            <button 
                                onClick={handleSectionCancel}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded"
                            >
                                <X className="w-3 h-3" /> Cancelar
                            </button>
                            <button 
                                onClick={() => handleSectionSave(group.sectionTitle)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm"
                            >
                                <Save className="w-3 h-3" /> Salvar Gabarito da Seção
                            </button>
                         </div>
                      </div>
                   ) : (
                      // VISUALIZAÇÃO NORMAL DO TEXTO DA SEÇÃO
                      <div className={`flex gap-3 ${sectionCorrection ? 'bg-indigo-50/50 p-2 rounded border border-indigo-100' : ''}`}>
                        <div className={`w-1 rounded-full flex-shrink-0 mt-2 ${sectionCorrection ? 'bg-indigo-400' : 'bg-gray-200'}`} />
                        <div className="flex-1">
                           {renderMultiParagraphText(displayBody || '', !!sectionCorrection)}
                        </div>
                      </div>
                   )}
                </div>
              )}

              {/* Items in this Section */}
              <div className="divide-y divide-gray-100">
                {group.items.map((item) => (
                  <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors group relative">
                    
                    {/* BOTÃO SUGERIR CORREÇÃO (ITEM) - CANTO SUPERIOR ESQUERDO */}
                    <div className="absolute top-2 left-2 z-10">
                      <button
                          onClick={() => handleEditClick(item)}
                          className={`p-1.5 rounded-full bg-white shadow border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 transition-all ${editingItemId === item.id ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}
                          title="Sugerir como deveria ser a resposta (Gabarito)"
                      >
                          <PenSquare className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Data Bar (Mini Tabela) for Personnel */}
                    {item.type === MatchType.PERSONNEL && item.person && (
                        <div className="mb-3 ml-6 rounded-md overflow-hidden border border-gray-200">
                            <DataBar person={item.person} text={item.relatedContent || ''} />
                        </div>
                    )}

                    <div className="flex items-start gap-3">
                      {/* ICONE LATERAL */}
                      <div className={`
                        p-2 rounded-full flex-shrink-0 ml-1
                        ${item.type === MatchType.PERSONNEL ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}
                      `}>
                        {item.type === MatchType.PERSONNEL ? <Users className="w-5 h-5" /> : <Tag className="w-5 h-5" />}
                      </div>
                      
                      <div className="flex-grow min-w-0 space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <h4 className="text-md font-bold text-gray-900 leading-tight flex items-center gap-2">
                            {item.matchedText}
                          </h4>
                          
                          {/* SCORE BADGE */}
                          <div className={`
                            text-xs font-bold px-2 py-1 rounded shadow-sm whitespace-nowrap
                            ${item.relevanceScore >= 90 ? 'bg-green-100 text-green-700' : 
                              item.relevanceScore >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}
                          `}>
                            SCORE: {item.relevanceScore}%
                          </div>
                        </div>

                        {/* AREA DE EDIÇÃO DE CORREÇÃO (ITEM) */}
                        {editingItemId === item.id && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 animate-in fade-in zoom-in duration-200">
                               <label className="block text-xs font-bold text-indigo-800 mb-1">
                                  CORREÇÃO HUMANA (Como deveria ser a resposta ideal?):
                               </label>
                               <textarea 
                                  className="w-full text-sm p-2 border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 mb-2"
                                  rows={3}
                                  value={tempCorrection}
                                  onChange={(e) => setTempCorrection(e.target.value)}
                                  placeholder="Cole aqui o conteúdo exato como deveria ter sido extraído..."
                               />
                               <div className="flex justify-end gap-2">
                                  <button 
                                      onClick={handleCancelEdit}
                                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded"
                                  >
                                      <X className="w-3 h-3" /> Cancelar
                                  </button>
                                  <button 
                                      onClick={() => handleSaveCorrection(item.id)}
                                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm"
                                  >
                                      <Save className="w-3 h-3" /> Salvar Gabarito
                                  </button>
                               </div>
                            </div>
                        )}

                        {/* Related Content (Evidence) */}
                        {item.relatedContent && editingItemId !== item.id && (
                          <div className={`
                               rounded-md border text-sm text-gray-700 relative
                               ${item.userCorrection ? 'border-indigo-400 bg-indigo-50' : (item.isTableRow ? 'bg-white border-gray-300 p-0 overflow-x-auto' : 'bg-white border-gray-200 p-3')}
                          `}>
                            {item.userCorrection && (
                                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-bl font-bold uppercase tracking-wider">
                                    Correção Pendente
                                </div>
                            )}

                            {item.isTableRow && !item.userCorrection && (
                              <div className="sticky left-0 top-0 bg-blue-50/80 backdrop-blur-sm px-2 py-1 border-b border-blue-100 mb-0 flex items-center gap-1">
                                  <Table className="w-3 h-3 text-blue-500" />
                                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Formato de Tabela</span>
                              </div>
                            )}
                            
                            <div className={item.isTableRow ? "p-3 min-w-max" : ""}>
                               {!item.isTableRow && (
                                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <AlignLeft className="w-3 h-3" /> Trecho Original:
                                  </p>
                               )}
                               
                               {item.isTableRow ? (
                                   <p className="font-mono whitespace-pre text-xs leading-snug" style={dynamicStyle}>
                                      <Highlighter text={item.relatedContent} person={item.person} />
                                   </p>
                               ) : (
                                   // USO DO RENDERIZADOR MULTI-PARAGRAFO AQUI TAMBÉM SE NECESSÁRIO
                                   // MAS GERALMENTE 'RELATED CONTENT' É CURTO. VAMOS MANTER O HIGHLIGHTER SIMPLES
                                   // MAS COM A CLASSE DE INDENTAÇÃO SE TIVER QUEBRA.
                                    item.relatedContent.split('\n').map((line, idx) => (
                                      <p key={idx} className="indent-8 text-gray-800" style={dynamicStyle}>
                                         <Highlighter text={line} person={item.person} />
                                      </p>
                                    ))
                               )}
                            </div>
                          </div>
                        )}

                        {/* AI Context / Summary */}
                        <div className="text-sm text-gray-600 bg-gray-100/50 p-2 rounded border border-gray-100">
                          <span className="font-semibold text-gray-700 uppercase text-xs mr-2">Resumo:</span>
                          {item.context}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

               {/* Section Footer (Outro) */}
               {group.sectionFooter && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                   <div className="flex gap-2 items-center">
                     <Quote className="w-3 h-3 text-gray-400 rotate-180" />
                     <p className="text-xs text-gray-500 italic font-medium">
                       {group.sectionFooter}
                     </p>
                   </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ResultsView;
