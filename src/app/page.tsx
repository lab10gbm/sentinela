"use client";

import React, { useState, useEffect } from 'react';
import { Shield, FileText, Users, Search, AlertTriangle, Download, Settings, ChevronDown, ChevronRight, ChevronLeft, Menu, Target, ToggleLeft, ToggleRight, X, Type, Minus, Plus, AlignJustify, AlignLeft, Database, Trash2, Eye, HardDrive, EyeOff, Bot, MessageSquare, RotateCcw, Cloud, Bookmark } from 'lucide-react';
import FileUploader from '../components/FileUploader';
import ResultsView from '../components/ResultsView';
import KeywordManager from '../components/KeywordManager';
import AuditReportModal from '../components/AuditReportModal';
import { ExtractionResult, SearchPreferences, TextToken } from '../types';
import { extractTextFromPdf } from '../services/pdfWorkerService';
import NotasView from '../components/NotasView';
import dynamic from 'next/dynamic';
const PdfViewer = dynamic(() => import('../components/PdfViewer'), { 
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center bg-gray-100">Carregando visualizador...</div>
});

import { auditLocalAnalysis } from '../services/geminiService';
import { analyzeDocumentLocal } from '../services/localSearchService';
import { useBulletinPipeline } from '../hooks/useBulletinPipeline';
import { useRoster } from '../hooks/useRoster';
import { useSavedNotas } from '../hooks/useSavedNotas';
import SavedNotasPanel from '../components/SavedNotasPanel';
import * as XLSX from 'xlsx';

const STORAGE_KEY_KEYWORDS = 'SENTINELA_KEYWORDS';
const STORAGE_KEY_CONTEXTS = 'SENTINELA_CONTEXTS';

const DEFAULT_KEYWORDS = [
  'Angra dos Reis', '10º GBM', 'Itaguai', 'DBM 1/10',
  'Ilha Grande', 'DBM 2/10', 'Frade', 'DBM 3/10', 'Mangaratiba', 'DBM 4/10'
];

const DEFAULT_CONTEXTS = ['todas as unidades', 'BOLETIM RESERVADO'];

type TabType = 'report' | 'database' | 'pdf' | 'saved';

function App() {
  const {
    personnel, excelFile, hasMemoryData, isSyncing,
    checkMemory, loadFromMemory, clearMemory, handleExcelUpload, handleGoogleSync,
  } = useRoster();

  const {
    extractedNotas, bulletinHistory, selectedBulletinId, setSelectedBulletinId,
    isHistoryLoaded, pageMap, setPageMap, state, setState,
    loadHistory, runBulletinExtraction, deleteBulletin, resetBulletin,
  } = useBulletinPipeline();

  const { savedNotas, saveNota, removeNota, updateObservation, isSaved } = useSavedNotas();

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [navigateTo, setNavigateTo] = useState<string | null>(null);

  // Tabs State Management
  const [openTabs, setOpenTabs] = useState<TabType[]>([]); 
  const [activeTab, setActiveTab] = useState<TabType | null>(null); 
  const [viewPage, setViewPage] = useState<number>(1);
  const [isPdfMaximized, setIsPdfMaximized] = useState(false);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);

  // Sidebar and Settings state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true); 
  const [isRgConfigOpen, setIsRgConfigOpen] = useState(false); 
  const [showExtraDatabaseColumns, setShowExtraDatabaseColumns] = useState(false);

  // Audit State
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditReport, setAuditReport] = useState<string>("");
  const [isAuditing, setIsAuditing] = useState(false);

  // Custom Prompt State
  const [customInstruction, setCustomInstruction] = useState<string>("");

  const [searchPrefs, setSearchPrefs] = useState<SearchPreferences>({
    useIdFuncional: true,
    useRg: true,
    useNomeGuerra: true,
    rgFormat5Digit: true,
    rgFormat7Digit: true
  });

  const [resultFont, setResultFont] = useState<'Segoe UI' | 'Arial Narrow'>('Segoe UI');
  const [resultFontSize, setResultFontSize] = useState<number>(11);
  const [isJustified, setIsJustified] = useState<boolean>(true);

  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [targetContexts, setTargetContexts] = useState<string[]>(DEFAULT_CONTEXTS);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  useEffect(() => {
    checkMemory();

    // Load Keywords and Contexts
    const savedKeywords = localStorage.getItem(STORAGE_KEY_KEYWORDS);
    if (savedKeywords) {
      try {
        setKeywords(JSON.parse(savedKeywords));
      } catch (e) {
        console.error("Erro ao carregar keywords:", e);
      }
    }

    const savedContexts = localStorage.getItem(STORAGE_KEY_CONTEXTS);
    if (savedContexts) {
      try {
        setTargetContexts(JSON.parse(savedContexts));
      } catch (e) {
        console.error("Erro ao carregar contextos:", e);
      }
    }
    setIsConfigLoaded(true);

    // Load Bulletin History from IndexedDB
    loadHistory().then(() => {
      if (bulletinHistory.length > 0) {
        setOpenTabs(prev => prev.includes('report') ? prev : ['report', ...prev]);
        setActiveTab('report');
      }
    });
  }, []);

  // Os Filtros e Contextos continuam no LocalStorage (são pequenos)
  useEffect(() => {
    if (isConfigLoaded) localStorage.setItem(STORAGE_KEY_KEYWORDS, JSON.stringify(keywords));
  }, [keywords, isConfigLoaded]);

  useEffect(() => {
    if (isConfigLoaded) localStorage.setItem(STORAGE_KEY_CONTEXTS, JSON.stringify(targetContexts));
  }, [targetContexts, isConfigLoaded]);

  // Remover o useEffect do bulletinHistory pois ele agora é salvo individualmente no IndexedDB

  const openTab = (tabName: TabType) => {
    if (!openTabs.includes(tabName)) {
      setOpenTabs(prev => [...prev, tabName]);
    }
    setActiveTab(tabName);
  };

  const closeTab = (e: React.MouseEvent, tabName: TabType) => {
    e.stopPropagation(); 
    
    const newOpenTabs = openTabs.filter(t => t !== tabName);
    setOpenTabs(newOpenTabs);

    if (activeTab === tabName) {
      if (newOpenTabs.length > 0) {
        setActiveTab(newOpenTabs[newOpenTabs.length - 1]);
      } else {
        setActiveTab(null);
      }
    }
  };

  const handlePdfUpload = (file: File) => {
    setPdfFile(file);
    setResults([]);
    setPageMap([]);
    setAuditReport("");
  };

  const resetKeywords = () => {
    if(window.confirm("Restaurar a lista padrão de Filtros de Unidade?")) setKeywords(DEFAULT_KEYWORDS);
  };

  const resetContexts = () => {
    if(window.confirm("Restaurar a lista padrão de Contextos de Interesse?")) setTargetContexts(DEFAULT_CONTEXTS);
  };

  const addKeyword = (k: string) => setKeywords(prev => [...prev, k]);
  const removeKeyword = (k: string) => setKeywords(prev => prev.filter(item => item !== k));
  const addContext = (k: string) => setTargetContexts(prev => [...prev, k]);
  const removeContext = (k: string) => setTargetContexts(prev => prev.filter(item => item !== k));
  const toggleSearchPref = (key: keyof SearchPreferences) => setSearchPrefs(prev => ({ ...prev, [key]: !prev[key] }));

  // --- Função para registrar a correção do usuário (ITEM INDIVIDUAL) ---
  const handleCorrection = (id: string, correctionText: string) => {
    setResults(prevResults => prevResults.map(result => {
        if (result.id === id) {
            return { ...result, userCorrection: correctionText };
        }
        return result;
    }));
  };

  // --- Função para registrar a correção do usuário (CORPO DA SEÇÃO) ---
  const handleSectionBodyCorrection = (sectionTitle: string, correctionText: string) => {
    setResults(prevResults => prevResults.map(result => {
        // Atualiza TODOS os itens que pertencem a essa seção
        if (result.section === sectionTitle) {
            return { ...result, userSectionBodyCorrection: correctionText };
        }
        return result;
    }));
  };

  // --- Função para registrar a correção do usuário (TÍTULO DA SEÇÃO) ---
  const handleSectionTitleCorrection = (oldSectionTitle: string, newTitle: string) => {
    setResults(prevResults => prevResults.map(result => {
        // Atualiza TODOS os itens que pertencem a essa seção
        if (result.section === oldSectionTitle) {
            return { ...result, userSectionTitleCorrection: newTitle };
        }
        return result;
    }));
  };

  // --- FUNÇÃO DE BUSCA LOCAL (AGORA É A PRINCIPAL) ---
  const runLocalAnalysis = async () => {
    if (!pdfFile || personnel.length === 0) return;
    openTab('report'); 
    setState({ isProcessing: true, stage: 'parsing_pdf' });

    try {
      const { pageMap: extractedPageMap } = await extractTextFromPdf(pdfFile);
      setPageMap(extractedPageMap);

      setState({ isProcessing: true, stage: 'analyzing_ai' }); // Mantendo nome do stage para compatibilidade visual
      
      const findings = await analyzeDocumentLocal(
        extractedPageMap, 
        personnel, 
        keywords, 
        targetContexts, 
        searchPrefs
      );
      
      setResults(findings);
      setState({ isProcessing: false, stage: 'complete' });

    } catch (error: any) {
      console.error(error);
      setState({ 
        isProcessing: false, 
        stage: 'error', 
        errorMessage: error.message || 'Ocorreu um erro durante a análise local.' 
      });
    }
  };

  // --- FUNÇÃO DE EXTRAÇÃO DO BOLETIM ---
  const handleRunBulletinExtraction = () => {
    if (!pdfFile) return;
    openTab('report');
    runBulletinExtraction(pdfFile, personnel, keywords, searchPrefs, pageMap);
  };

  // --- FUNÇÃO PARA RODAR A AUDITORIA VIA IA ---
  const runAudit = async () => {
    if (!pdfFile || results.length === 0) {
      alert("Execute uma análise primeiro para poder auditá-la.");
      return;
    }
    setIsAuditing(true);
    try {
      let fullText = "";
      if (pageMap.length > 0) {
        fullText = pageMap.map(p => p.text).join('\n');
      } else {
        const { text } = await extractTextFromPdf(pdfFile);
        fullText = text;
      }
      const report = await auditLocalAnalysis(fullText, results, personnel, customInstruction);
      setAuditReport(report);
      setIsAuditModalOpen(true);
    } catch (e) {
      console.error(e);
      alert("Erro ao realizar auditoria.");
    } finally {
      setIsAuditing(false);
    }
  };

  const resetAll = () => {
    setPdfFile(null);
    setResults([]);
    resetBulletin();
    setAuditReport("");
    setState({ isProcessing: false, stage: 'idle' });
  };

  const downloadReport = () => {
    if (results.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(results.map(r => ({
      Tipo: r.type,
      Texto_Encontrado: r.matchedText,
      Pagina: r.pageNumber,
      Contexto: r.context,
      Relevancia: r.relevanceScore,
      Secao: r.userSectionTitleCorrection || r.section,
      Conteudo: r.relatedContent
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório Sentinela");
    XLSX.writeFile(wb, "Relatorio_Sentinela.xlsx");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans overflow-x-hidden">
      
      {/* MODAL DE AUDITORIA */}
      <AuditReportModal 
        isOpen={isAuditModalOpen} 
        onClose={() => setIsAuditModalOpen(false)} 
        reportMarkdown={auditReport} 
      />

      {/* Header */}
      <header className="bg-fire-700 text-white shadow-lg sticky top-0 z-50 h-16">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1 rounded-full hover:bg-fire-600 transition-colors focus:outline-none focus:ring-2 focus:ring-fire-400 group relative"
              title="Abrir Menu Lateral"
            >
              <Shield className={`w-8 h-8 transition-transform duration-300 ${isSidebarOpen ? 'rotate-180 scale-110' : 'group-hover:scale-110'}`} />
              <span className="absolute -bottom-1 -right-1 bg-white text-fire-700 rounded-full p-0.5 shadow-sm">
                <Menu className="w-3 h-3" />
              </span>
            </button>
            
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight leading-none">SENTINELA</h1>
              <p className="text-xs text-fire-100 font-medium tracking-wider">10º GBM - ANGRA DOS REIS</p>
            </div>
          </div>
          <div className="text-sm bg-fire-800 px-3 py-1 rounded-md hidden md:block border border-fire-600">
            Sistema de Monitoramento de Diário Oficial
          </div>
        </div>
      </header>

      <div className="flex flex-1 relative">
        {/* Sidebar Sheet */}
        <aside 
          className={`
            fixed inset-y-0 left-0 top-16 w-80 bg-white shadow-2xl z-40
            transform transition-transform duration-300 ease-in-out border-r border-gray-200
            ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <div className="h-full overflow-y-auto p-4 custom-scrollbar pb-20">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Menu Principal</h3>
            
            <div className="mb-4">
              <button
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`
                  w-full flex items-center justify-between p-3 rounded-lg transition-colors
                  ${isSettingsOpen ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-50 text-gray-700'}
                `}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-md ${isSettingsOpen ? 'bg-fire-100 text-fire-600' : 'bg-gray-200 text-gray-500'}`}>
                    <Settings className="w-5 h-5" />
                  </div>
                  <span className="font-medium">Configuração de Busca</span>
                </div>
                {isSettingsOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              <div 
                className={`
                  overflow-hidden transition-all duration-300 ease-in-out
                  ${isSettingsOpen ? 'max-h-[800px] opacity-100 mt-2' : 'max-h-0 opacity-0'}
                `}
              >
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 ml-2 mb-3">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-gray-500 font-semibold flex items-center gap-1">
                        <Target className="w-3 h-3" />
                        Filtros de Unidade / Local
                    </p>
                    <button 
                        onClick={resetKeywords}
                        className="text-[10px] text-gray-400 hover:text-fire-600 hover:bg-fire-50 p-1 rounded transition-colors"
                        title="Restaurar padrão"
                    >
                        <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                  <KeywordManager 
                    keywords={keywords}
                    onAddKeyword={addKeyword}
                    onRemoveKeyword={removeKeyword}
                    disabled={state.isProcessing}
                    placeholder="Ex: 10º GBM"
                  />
                </div>

                <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 ml-2 mb-3">
                   <div className="flex justify-between items-center mb-2">
                        <p className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            Contextos de Interesse
                        </p>
                        <button 
                            onClick={resetContexts}
                            className="text-[10px] text-blue-400 hover:text-blue-700 hover:bg-blue-100 p-1 rounded transition-colors"
                            title="Restaurar padrão"
                        >
                            <RotateCcw className="w-3 h-3" />
                        </button>
                   </div>
                  <KeywordManager 
                    keywords={targetContexts}
                    onAddKeyword={addContext}
                    onRemoveKeyword={removeContext}
                    disabled={state.isProcessing}
                    placeholder="Ex: Punição"
                    colorTheme="blue"
                  />
                </div>

                {/* PRIORIDADE DE BUSCA BLOCK */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 ml-2 mb-3">
                   <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">
                    Prioridade de Busca
                  </p>
                  
                  {/* ID FUNCIONAL */}
                  <div className="flex items-center justify-between w-full text-xs mb-2">
                     <span className="text-gray-700">1. ID Funcional</span>
                     <button onClick={() => toggleSearchPref('useIdFuncional')}>
                        {searchPrefs.useIdFuncional 
                          ? <ToggleRight className="w-6 h-6 text-green-500" />
                          : <ToggleLeft className="w-6 h-6 text-gray-300" />
                        }
                     </button>
                  </div>

                  {/* RG */}
                  <div className="flex flex-col mb-2">
                        <div className="flex items-center justify-between w-full text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-gray-700 cursor-pointer" onClick={() => toggleSearchPref('useRg')}>
                              2. RG (Variações)
                            </span>
                            <button 
                              onClick={() => setIsRgConfigOpen(!isRgConfigOpen)}
                              className={`
                                font-bold px-1 rounded focus:outline-none transition-colors text-[10px] border border-transparent
                                ${isRgConfigOpen ? 'text-blue-700 bg-blue-100 border-blue-200' : 'text-blue-500 hover:bg-blue-50'}
                              `}
                              title="Configurar formatos de RG"
                            >
                              *
                            </button>
                          </div>
                          <button onClick={() => toggleSearchPref('useRg')}>
                            {searchPrefs.useRg 
                              ? <ToggleRight className="w-6 h-6 text-green-500" />
                              : <ToggleLeft className="w-6 h-6 text-gray-300" />
                            }
                          </button>
                        </div>

                        {/* RG SUB-CONFIG */}
                        {isRgConfigOpen && searchPrefs.useRg && (
                          <div className="mt-1 mb-1 w-full bg-blue-50/50 border border-blue-100 rounded-lg p-2 text-[10px] animate-in slide-in-from-top-2 duration-200">
                             <div className="space-y-1">
                               <label className="flex items-center gap-2 cursor-pointer hover:bg-blue-100/50 p-1 rounded transition-colors">
                                 <input 
                                    type="checkbox" 
                                    checked={searchPrefs.rgFormat5Digit}
                                    onChange={() => toggleSearchPref('rgFormat5Digit')}
                                    className="rounded text-fire-600 focus:ring-fire-500 w-3 h-3"
                                 />
                                 <span className="text-gray-700">5 Dígitos (Ex: 54.444)</span>
                               </label>
                               <label className="flex items-center gap-2 cursor-pointer hover:bg-blue-100/50 p-1 rounded transition-colors">
                                 <input 
                                    type="checkbox" 
                                    checked={searchPrefs.rgFormat7Digit}
                                    onChange={() => toggleSearchPref('rgFormat7Digit')}
                                    className="rounded text-fire-600 focus:ring-fire-500 w-3 h-3"
                                 />
                                 <span className="text-gray-700">7 Dígitos (Ex: 2.200.000)</span>
                               </label>
                             </div>
                          </div>
                        )}
                  </div>

                  {/* NOME DE GUERRA */}
                  <div className="flex items-center justify-between w-full text-xs">
                        <span className="text-gray-700">3. Nome de Guerra</span>
                        <button onClick={() => toggleSearchPref('useNomeGuerra')}>
                          {searchPrefs.useNomeGuerra 
                            ? <ToggleRight className="w-6 h-6 text-green-500" />
                            : <ToggleLeft className="w-6 h-6 text-gray-300" />
                          }
                        </button>
                  </div>
                </div>

                {/* MEMORIA DO EFETIVO BLOCK */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 ml-2 mb-3">
                     <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">
                        Memória do Efetivo
                     </p>
                     <div className="space-y-1">
                        {hasMemoryData ? (
                            <>
                                <button
                                    onClick={() => loadFromMemory(() => openTab('database'))}
                                    className="flex items-center gap-2 w-full text-xs text-green-700 hover:text-green-900 hover:bg-green-100 p-1.5 rounded transition-colors text-left"
                                    >
                                    <HardDrive className="w-3 h-3" />
                                    <span>Carregar Efetivo da Memória</span>
                                </button>
                                
                                {personnel.length > 0 && (
                                    <button
                                        onClick={() => openTab('database')}
                                        className="flex items-center gap-2 w-full text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded text-left group"
                                    >
                                        <Database className="w-3 h-3" />
                                        <span>Visualizar Efetivo</span>
                                    </button>
                                )}
                                <button
                                    onClick={clearMemory}
                                    className="flex items-center gap-2 w-full text-xs text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors text-left"
                                    >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Limpar Memória</span>
                                </button>
                            </>
                        ) : (
                            <p className="text-[10px] text-gray-400 italic">Nenhum dado salvo.</p>
                        )}
                     </div>
                </div>

              </div>
            </div>

            <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <h4 className="text-gray-800 font-semibold text-sm mb-2 flex items-center gap-2">
                <Users className="w-4 h-4" /> Status do Efetivo
              </h4>
              <p className="text-xs text-gray-600 mb-2">
                {personnel.length > 0 
                  ? `${personnel.length} militares carregados.` 
                  : 'Nenhum efetivo carregado.'}
              </p>
              {hasMemoryData && (
                <p className="text-xs text-green-600 mb-1 flex items-center gap-1">
                   <HardDrive className="w-3 h-3" /> Dados disponíveis na memória.
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main 
          className={`
            flex-grow w-full px-4 sm:px-6 py-6 transition-all duration-300 ease-in-out
            ${isSidebarOpen ? 'md:ml-80' : 'ml-0'}
          `}
        >
          <div className="w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Inputs */}
              <div className={`${isLeftCollapsed ? 'lg:col-span-1' : 'lg:col-span-3'} space-y-6 transition-all duration-300 relative`}>
                
                {/* Collapse toggle button */}
                <button
                  onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
                  className="absolute -right-3 top-2 z-10 bg-white border border-gray-200 rounded-full p-1 shadow-sm hover:bg-gray-50 text-gray-400 hover:text-gray-700 transition-colors"
                  title={isLeftCollapsed ? 'Expandir painel' : 'Minimizar painel'}
                >
                  {isLeftCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>

                {/* Collapsed state: show only icons */}
                {isLeftCollapsed && (
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm" title="Banco de Dados">
                      <Users className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm" title="Documento Oficial">
                      <FileText className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                )}

                {/* Full content when expanded */}
                <div className={isLeftCollapsed ? 'hidden' : 'contents'}>
                
                {/* 1. Database Upload */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 relative">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                      <Users className="w-5 h-5 text-gray-500" />
                      1. Banco de Dados
                    </h2>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Selecionar Unidade</p>
                      <div className="flex gap-2">
                        {/* 10º GBM - sincroniza efetivo */}
                        <button
                          onClick={() => handleGoogleSync(
                            () => { setState({ isProcessing: false, stage: 'idle' }); openTab('database'); },
                            (msg) => setState({ isProcessing: false, stage: 'error', errorMessage: msg })
                          )}
                          disabled={isSyncing || state.isProcessing}
                          className={`
                            flex-1 py-3 rounded-lg font-bold text-white text-sm shadow-sm transition-all flex items-center justify-center gap-1.5
                            ${isSyncing || state.isProcessing ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 hover:shadow-md active:scale-95'}
                          `}
                          title="Sincronizar efetivo do 10º GBM"
                        >
                          {isSyncing ? (
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <Cloud className="w-4 h-4" />
                          )}
                          10º GBM
                        </button>

                        {/* 26º GBM - sem dados */}
                        <button
                          disabled
                          className="flex-1 py-3 rounded-lg font-bold text-gray-400 text-sm bg-gray-100 border border-gray-200 cursor-not-allowed"
                          title="Sem dados disponíveis"
                        >
                          26º GBM
                        </button>

                        {/* CBA 7 - sem dados */}
                        <button
                          disabled
                          className="flex-1 py-3 rounded-lg font-bold text-gray-400 text-sm bg-gray-100 border border-gray-200 cursor-not-allowed"
                          title="Sem dados disponíveis"
                        >
                          CBA 7
                        </button>
                      </div>
                    </div>

                    <div className="relative flex items-center py-1 opacity-60">
                        <div className="flex-grow border-t border-gray-300"></div>
                        <span className="flex-shrink-0 mx-4 text-gray-500 text-[10px] font-bold uppercase tracking-wider">OU ARQUIVO LOCAL</span>
                        <div className="flex-grow border-t border-gray-300"></div>
                    </div>

                    <FileUploader 
                      label="Planilha de Militares (.xlsx)"
                      accept=".xlsx,.xls"
                      onFileSelect={(file) => handleExcelUpload(
                        file,
                        () => { setState({ isProcessing: false, stage: 'idle' }); openTab('database'); },
                        (msg) => setState({ isProcessing: false, stage: 'error', errorMessage: msg })
                      )}
                      selectedFile={excelFile}
                      color="blue"
                      disabled={state.isProcessing}
                      helperText="Opcional: Suba uma base avulsa se necessário."
                    />
                  </div>
                  
                  {personnel.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center text-xs text-green-600 font-medium justify-center">
                      <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                      Base Alocada: {personnel.length} militares
                    </div>
                  )}
                </div>

                {/* 2. Document Upload */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                   <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-gray-500" />
                    2. Documento Oficial
                  </h2>
                  <FileUploader 
                    label="Boletim ou DO (.pdf)"
                    accept=".pdf"
                    onFileSelect={handlePdfUpload}
                    selectedFile={pdfFile}
                    color="red"
                    disabled={state.isProcessing}
                  />
                </div>

                {/* MAIN ACTION: LOCAL SEARCH */}
                <button
                  onClick={runLocalAnalysis}
                  disabled={!pdfFile || personnel.length === 0 || state.isProcessing}
                  className={`
                    w-full py-4 rounded-lg font-bold text-white text-lg shadow-md transition-all flex items-center justify-center gap-2 mb-4
                    ${(!pdfFile || personnel.length === 0) 
                      ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                      : 'bg-fire-600 hover:bg-fire-700 hover:shadow-lg active:scale-95'}
                  `}
                >
                    {state.isProcessing && state.stage !== 'analyzing_ai' ? (
                         <>
                         <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                           <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                           <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                         </svg>
                         PROCESSANDO DOC (LOCAL)...
                       </>
                    ) : (
                        <>
                        <Search className="w-5 h-5" />
                        INICIAR VARREDURA LOCAL
                        </>
                    )}
                </button>
                
                {/* EXTRAÇÃO DE NOTAS ESTRUTURADAS (LOCAL) */}
                <button
                  id="btn-run-extraction"
                  onClick={handleRunBulletinExtraction}
                  disabled={!pdfFile || state.isProcessing}
                  className={`
                    w-full py-3 rounded-lg font-bold text-fire-700 text-sm border-2 border-fire-600 bg-white transition-all flex items-center justify-center gap-2
                    ${(!pdfFile) 
                      ? 'border-gray-300 text-gray-400 cursor-not-allowed' 
                      : 'hover:bg-fire-50 hover:shadow active:scale-95'}
                  `}
                >
                        <AlignJustify className="w-4 h-4" />
                        TESTAR NOVO EXTRATOR (SEM IA)
                </button>

                {/* BOTÃO MÁGICO DE DEBUG */}
                <button
                  onClick={async () => {
                      const res = await fetch('/test.pdf');
                      const blob = await res.blob();
                      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });
                      handlePdfUpload(file);
                      // Set an immediate timeout so state updates
                      setTimeout(() => {
                           const el = document.getElementById('btn-run-extraction');
                           if(el) el.click();
                      }, 500);
                  }}
                  className="w-full py-2 bg-yellow-400 text-black font-bold rounded-lg mt-2"
                >
                    DEBUG MAGICO MOCK FILE
                </button>

                {/* BOTÃO SECUNDÁRIO: AUDITORIA DE ALGORITMO */}
                {results.length > 0 && (
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 animate-in fade-in slide-in-from-bottom-2">
                   <h3 className="text-xs font-bold text-indigo-800 mb-2 uppercase tracking-wide flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      Engenharia Reversa & Otimização
                   </h3>
                   <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                      1. Revise os resultados ao lado e faça correções manuais (ícone lápis).<br/>
                      2. Clique abaixo para a IA analisar por que o Regex falhou e sugerir melhorias.
                   </p>
                   
                   <div className="bg-white border border-indigo-200 rounded-lg p-2 mb-3">
                      <label className="text-[10px] font-bold text-gray-500 mb-1 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        Foco da Auditoria:
                      </label>
                      <textarea
                        className="w-full text-xs p-1.5 border-none focus:ring-0 resize-none bg-transparent"
                        rows={2}
                        placeholder="Ex: 'Verifique por que não pegou o 2º Sgt Silva' ou 'Analise a formatação da tabela'."
                        value={customInstruction}
                        onChange={(e) => setCustomInstruction(e.target.value)}
                      />
                   </div>

                   <button
                    onClick={runAudit}
                    disabled={isAuditing}
                    className={`
                      w-full py-3 rounded-lg font-bold text-white text-md shadow-sm transition-all flex items-center justify-center gap-2 border
                      ${isAuditing ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 border-indigo-800 hover:shadow-md active:scale-95'}
                    `}
                  >
                     {isAuditing ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          AUDITANDO ALGORITMO...
                        </>
                     ) : (
                        <>
                          <Bot className="w-4 h-4" />
                          AUDITAR COM IA
                        </>
                     )}
                  </button>
                  </div>
                )}

                {state.errorMessage && (
                  <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    {state.errorMessage}
                  </div>
                )}
                
                {results.length > 0 && (
                  <button
                    onClick={resetAll}
                    className="w-full py-2 text-gray-500 hover:text-gray-700 text-sm font-medium underline"
                  >
                    Nova Análise
                  </button>
                )}
                </div> {/* end expanded content */}
              </div>

                  {/* Right Column: Results & Database Tabs */}
                  <div className={`${isLeftCollapsed ? 'lg:col-span-11' : 'lg:col-span-9'} transition-all duration-300`}>
                    {openTabs.length > 0 ? (
                      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-visible flex flex-col min-h-[500px]">
                      
                        <div className="bg-white border-b border-gray-200 flex overflow-x-auto no-scrollbar relative min-h-14">
                          {/* REPORT TAB HEADER */}
                          {openTabs.includes('report') && (
                            <div className="flex-1 relative group min-w-[200px]">
                              <button
                                onClick={() => setActiveTab('report')}
                                className={`w-full h-full py-4 text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors
                                    ${activeTab === 'report' ? 'bg-white text-fire-700 border-b-2 border-b-fire-500' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                                `}
                              >
                                <Shield className="w-4 h-4" />
                                Relatório de Inteligência
                              </button>
                              <button 
                                  onClick={(e) => closeTab(e, 'report')}
                                  className="absolute top-2 right-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Fechar Aba"
                              >
                                  <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {/* PDF TAB HEADER */}
                          {openTabs.includes('pdf') && (
                            <div className="flex-1 relative group min-w-[150px]">
                              <button
                                onClick={() => setActiveTab('pdf')}
                                className={`w-full h-full py-4 text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors
                                    ${activeTab === 'pdf' ? 'bg-white text-indigo-700 border-b-2 border-b-indigo-500' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                                `}
                              >
                                <FileText className="w-4 h-4" />
                                Leitor PDF
                              </button>
                              <button 
                                  onClick={(e) => closeTab(e, 'pdf')}
                                  className="absolute top-2 right-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Fechar Aba"
                              >
                                  <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {/* DATABASE TAB HEADER */}
                          {openTabs.includes('database') && (
                            <div className="flex-1 relative group min-w-[200px]">
                              <button
                                onClick={() => setActiveTab('database')}
                                className={`w-full h-full py-4 text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors
                                    ${activeTab === 'database' ? 'bg-white text-blue-700 border-b-2 border-b-blue-500' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                                `}
                              >
                                <Database className="w-4 h-4" />
                                Banco de Dados Completo
                                <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded-full">
                                    {personnel.length}
                                </span>
                              </button>
                              <button 
                                  onClick={(e) => closeTab(e, 'database')}
                                  className="absolute top-2 right-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Fechar Aba"
                              >
                                  <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {/* SAVED NOTAS TAB HEADER */}
                          <div className="flex-1 relative min-w-[150px]">
                            <button
                              onClick={() => { setActiveTab('saved'); if (!openTabs.includes('saved')) setOpenTabs(prev => [...prev, 'saved']); }}
                              className={`w-full h-full py-4 text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors
                                  ${activeTab === 'saved' ? 'bg-white text-orange-700 border-b-2 border-b-orange-500' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                              `}
                            >
                              <Bookmark className="w-4 h-4" />
                              Notas Salvas
                              {savedNotas.length > 0 && (
                                <span className="bg-orange-100 text-orange-600 text-[10px] px-2 py-0.5 rounded-full font-black">
                                  {savedNotas.length}
                                </span>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* --- TAB CONTENT AREA --- */}
                        <div>
                          
                          {/* REPORT TAB CONTENT */}
                          {activeTab === 'report' && (
                            <div className="bg-white">
                              {(state.stage === 'complete' || results.length > 0 || extractedNotas.length > 0 || bulletinHistory.length > 0) ? (
                                <div>
                                  {(extractedNotas.length > 0 || bulletinHistory.length > 0) ? (
                                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0" style={{ height: 'calc(100vh - 4rem)' }}>
                                          <div className={`${isPdfMaximized ? 'hidden' : 'lg:col-span-7'} overflow-y-auto p-6 bg-gray-50/30`}>
                                              <NotasView 
                                                  notas={selectedBulletinId ? bulletinHistory.find(b => b.id === selectedBulletinId)?.notas || [] : []} 
                                                  history={bulletinHistory}
                                                  selectedId={selectedBulletinId}
                                                  onSelect={(id) => setSelectedBulletinId(id)}
                                                  onDelete={deleteBulletin}
                                                  onViewPage={(page) => {
                                                    setViewPage(page);
                                                  }}
                                                  onVisiblePage={(page) => setViewPage(page)}
                                                  navigateTo={navigateTo}
                                                  onNavigate={(title) => setNavigateTo(title)}
                                                  onNavigateComplete={() => setNavigateTo(null)}
                                                  personnel={personnel}
                                                  searchPrefs={searchPrefs}
                                                  onSaveNota={(nota) => {
                                                    const filename = bulletinHistory.find(b => b.id === selectedBulletinId)?.filename || 'boletim';
                                                    saveNota(nota, filename);
                                                  }}
                                                  isNotaSaved={(notaId) => {
                                                    const filename = bulletinHistory.find(b => b.id === selectedBulletinId)?.filename || 'boletim';
                                                    return isSaved(notaId, filename);
                                                  }}
                                              />
                                          </div>
                                          <div className={`hidden lg:flex lg:flex-col ${isPdfMaximized ? 'lg:col-span-12' : 'lg:col-span-5'} border-l border-gray-200 relative group`}>
                                              <div className="h-full p-4 bg-gray-100">
                                                <button 
                                                  onClick={() => setIsPdfMaximized(!isPdfMaximized)}
                                                  className="absolute top-6 left-6 z-40 bg-white/80 hover:bg-white text-gray-700 p-2 rounded-full shadow-md border border-gray-200 transition-all opacity-0 group-hover:opacity-100"
                                                  title={isPdfMaximized ? "Ver Lado a Lado" : "Maximizar Documento"}
                                                >
                                                  {isPdfMaximized ? <AlignJustify className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                                </button>
                                                <PdfViewer file={pdfFile} initialPage={viewPage} />
                                              </div>
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="grid grid-cols-1 lg:grid-cols-12 overflow-visible">
                                         <div className={`${isPdfMaximized ? 'hidden' : 'lg:col-span-7'} flex flex-col`}>
                                            <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
                                               <span className="text-sm text-gray-500 font-medium">Resultados encontrados: {results.length}</span>
                                               
                                               <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-lg border border-gray-200">
                                                  <div className="relative group">
                                                    <select 
                                                       value={resultFont}
                                                       onChange={(e) => setResultFont(e.target.value as any)}
                                                       className="appearance-none bg-white text-xs font-medium text-gray-700 border border-gray-300 rounded px-2 py-1 pr-6 focus:outline-none focus:ring-1 focus:ring-fire-400 cursor-pointer min-w-[100px]"
                                                    >
                                                      <option value="Segoe UI">Segoe UI</option>
                                                      <option value="Arial Narrow">Arial Narrow</option>
                                                    </select>
                                                    <Type className="w-3 h-3 text-gray-400 absolute right-2 top-1.5 pointer-events-none" />
                                                  </div>

                                                  <div className="flex items-center bg-white border border-gray-300 rounded overflow-hidden h-[26px]">
                                                    <button 
                                                      onClick={() => setResultFontSize(Math.max(8, resultFontSize - 1))}
                                                      className="px-1.5 hover:bg-gray-50 text-gray-600 border-r border-gray-200"
                                                      title="Diminuir fonte"
                                                    >
                                                      <Minus className="w-3 h-3" />
                                                    </button>
                                                    <span className="text-xs font-medium w-8 text-center text-gray-700">{resultFontSize}</span>
                                                    <button 
                                                      onClick={() => setResultFontSize(Math.min(24, resultFontSize + 1))}
                                                      className="px-1.5 hover:bg-gray-50 text-gray-600 border-l border-gray-200"
                                                      title="Aumentar fonte"
                                                    >
                                                      <Plus className="w-3 h-3" />
                                                    </button>
                                                  </div>

                                                  <button 
                                                    onClick={() => setIsJustified(!isJustified)}
                                                    className={`p-1 rounded border h-[26px] w-[26px] flex items-center justify-center transition-colors ${isJustified ? 'bg-fire-100 border-fire-300 text-fire-600' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                                                    title={isJustified ? "Texto Justificado (Ativo)" : "Texto Justificado (Inativo)"}
                                                  >
                                                    {isJustified ? <AlignJustify className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
                                                  </button>
                                               </div>
                                               
                                               <button 
                                                   onClick={downloadReport}
                                                   className="flex items-center gap-2 text-sm text-fire-700 font-medium hover:bg-fire-50 px-3 py-1.5 rounded transition-colors"
                                               >
                                                   <Download className="w-4 h-4" />
                                                   Exportar Excel
                                               </button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                                              <ResultsView 
                                                  results={results} 
                                                  fontFamily={resultFont}
                                                  fontSize={resultFontSize}
                                                  isJustified={isJustified}
                                                  onCorrection={handleCorrection} 
                                                  onSectionBodyCorrection={handleSectionBodyCorrection} 
                                                  onSectionTitleCorrection={handleSectionTitleCorrection}
                                              />
                                            </div>
                                         </div>
                                         <div className={`hidden lg:block ${isPdfMaximized ? 'lg:col-span-12' : 'lg:col-span-5'} border-l border-gray-200 overflow-visible relative group`}>
                                            <div className="sticky top-16 h-[calc(100vh-4rem)] p-4 bg-gray-100">
                                              <button 
                                                onClick={() => setIsPdfMaximized(!isPdfMaximized)}
                                                className="absolute top-6 left-6 z-40 bg-white/80 hover:bg-white text-gray-700 p-2 rounded-full shadow-md border border-gray-200 transition-all opacity-0 group-hover:opacity-100"
                                                title={isPdfMaximized ? "Ver Lado a Lado" : "Maximizar Documento"}
                                              >
                                                {isPdfMaximized ? <AlignJustify className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                              </button>
                                               <PdfViewer file={pdfFile} initialPage={viewPage} />
                                            </div>
                                         </div>
                                      </div>
                                  )}
                                </div>
                              ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 min-h-[400px] bg-gray-50/50 p-6">
                                  <Shield className="w-24 h-24 mb-4 text-gray-200" />
                                  <p className="text-lg font-medium">Aguardando documentos</p>
                                  <p className="text-sm max-w-md text-center mt-2">
                                    Faça o upload da planilha de efetivo e do documento oficial (PDF) para iniciar o monitoramento.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* PDF TAB CONTENT */}
                          {activeTab === 'pdf' && (
                            <div className="flex flex-col h-full bg-gray-100 p-4">
                               <PdfViewer file={pdfFile} initialPage={viewPage} />
                            </div>
                          )}

                          {/* DATABASE TAB CONTENT */}
                          {activeTab === 'database' && (
                            <div className="flex flex-col h-full overflow-hidden">
                              {personnel.length > 0 ? (
                                <div className="flex-1 overflow-auto p-0">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-600">
                                      <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b border-gray-200 sticky top-0 z-10">
                                        <tr>
                                          {showExtraDatabaseColumns && (
                                             <th scope="col" className="px-6 py-3 font-bold bg-gray-50">Posto/Grad</th>
                                          )}
                                          <th scope="col" className="px-6 py-3 font-bold">Nome Completo</th>
                                          <th scope="col" className="px-6 py-3 font-bold">Nome de Guerra</th>
                                          <th scope="col" className="px-6 py-3 font-bold">RG</th>
                                          <th scope="col" className="px-6 py-3 font-bold">
                                            <div className="flex items-center gap-2">
                                                ID Funcional
                                                <button 
                                                    onClick={() => setShowExtraDatabaseColumns(!showExtraDatabaseColumns)}
                                                    className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                                                    title={showExtraDatabaseColumns ? "Ocultar detalhes" : "Exibir Posto, OBM e Região"}
                                                >
                                                    {showExtraDatabaseColumns ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                          </th>
                                          {showExtraDatabaseColumns && (
                                             <th scope="col" className="px-6 py-3 font-bold bg-gray-50">OBM/DBM</th>
                                          )}
                                          {showExtraDatabaseColumns && (
                                             <th scope="col" className="px-6 py-3 font-bold bg-gray-50">Região</th>
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100 bg-white">
                                        {personnel.map((person, index) => (
                                          <tr key={index} className="hover:bg-gray-50">
                                            {showExtraDatabaseColumns && (
                                                <td className="px-6 py-3 font-medium text-gray-500 bg-gray-50/30">{person.postoGraduacao || '-'}</td>
                                            )}
                                            <td className="px-6 py-3 font-medium text-gray-900">{person.nomeCompleto}</td>
                                            <td className="px-6 py-3">{person.nomeGuerra || '-'}</td>
                                            <td className="px-6 py-3 font-mono text-xs">{person.rg || '-'}</td>
                                            <td className="px-6 py-3 font-mono text-xs text-gray-700">{person.idFuncional || '-'}</td>
                                            {showExtraDatabaseColumns && (
                                                <td className="px-6 py-3 text-gray-500 bg-gray-50/30">{person.obmDbm || '-'}</td>
                                            )}
                                            {showExtraDatabaseColumns && (
                                                <td className="px-6 py-3 text-gray-500 bg-gray-50/30">{person.regiao || '-'}</td>
                                            )}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                 <div className="h-full flex flex-col items-center justify-center text-gray-400 min-h-[400px] bg-gray-50/50 p-6">
                                  <Database className="w-24 h-24 mb-4 text-gray-200" />
                                  <p className="text-lg font-medium">Banco de Dados Vazio</p>
                                  <p className="text-sm max-w-md text-center mt-2">
                                    Carregue uma planilha Excel para popular o efetivo.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* SAVED NOTAS TAB CONTENT */}
                          {activeTab === 'saved' && (
                            <div className="overflow-y-auto p-6 bg-gray-50/30" style={{ minHeight: 'calc(100vh - 8rem)' }}>
                              <div className="max-w-3xl mx-auto">
                                <div className="flex items-center gap-2 mb-6">
                                  <Bookmark className="w-5 h-5 text-orange-500" />
                                  <h2 className="text-lg font-black text-gray-800">Notas Salvas para Análise</h2>
                                </div>
                                <p className="text-xs text-gray-500 mb-6 bg-orange-50 border border-orange-100 rounded-lg px-4 py-3">
                                  Use este espaço para guardar notas com problemas de formatação. Adicione observações para identificar padrões e melhorar o detector.
                                </p>
                                <SavedNotasPanel
                                  savedNotas={savedNotas}
                                  onRemove={removeNota}
                                  onUpdateObservation={updateObservation}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                        <div className="h-full border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400 min-h-[500px]">
                            <p className="text-sm">Selecione uma análise ou visualize o banco de dados.</p>
                        </div>
                    )}
                  </div>

                </div>
              </div>
            </main>
          </div>
          
          <footer className="bg-gray-800 text-gray-400 py-6 mt-auto z-50 relative">
              <div className="w-full px-4 sm:px-6 text-center text-sm">
                <p>&copy; {new Date().getFullYear()} Sentinela 10º GBM. Todos os direitos reservados.</p>
                <p className="text-xs mt-1 text-gray-600">Desenvolvido para uso interno administrativo.</p>
              </div>
          </footer>
        </div>
      );
    }

    export default App;
