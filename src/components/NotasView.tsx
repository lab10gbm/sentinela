import React, { useState, useRef, useEffect } from 'react';
import { BulletinNota, TableData, StoredBulletin, MilitaryPerson, SearchPreferences } from '../types';
import { TableValidationReport } from '../services/TableValidator';
import { BookOpen, ChevronRight, Copy, Check, FileText, Download, Table, ArrowLeft, Calendar, Trash2, Star, Bookmark, X, AlertCircle } from 'lucide-react';
import SumarioView from './SumarioView';
import * as XLSX from 'xlsx';
import { normalizeTitle } from '../services/textUtils';
import { splitFormFieldLines, hasMultipleFormFields, isFormFieldLine } from '../core/text/formFieldSplitter';
import { buildNotaTree, ParteNode, EixoNode, SubNode, EixoSlot, ParteSlot } from '../services/notaTreeService';
import { matchPersonnelInLine } from '../services/localSearchService';

interface NotasViewProps {
  notas: BulletinNota[];
  history?: StoredBulletin[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onDelete?: (id: string) => void;
  onViewPage?: (page: number) => void;
  /** Chamado quando uma nota entra na viewport — passa o pageNumber da nota */
  onVisiblePage?: (page: number) => void;
  navigateTo?: string | null;
  onNavigate?: (title: string) => void;
  onNavigateComplete?: () => void;
  personnel?: MilitaryPerson[];
  searchPrefs?: SearchPreferences;
  /** Callback para salvar nota como relevante */
  onSaveNota?: (nota: BulletinNota) => void;
  /** Callback para salvar nota como erro de detecção/formatação */
  onSaveError?: (nota: BulletinNota) => void;
  /** Verifica se uma nota já foi salva em certa categoria */
  isNotaSaved?: (notaId: string, category?: 'error' | 'relevant') => boolean;
}

/**
 * Renderiza uma tabela estruturada com controles de exportação.
 */
const COLLAPSED_ROWS = 11;

const StructuredTable: React.FC<{
  data: TableData;
  id: string;
  pageNumber?: number;
  onViewPage?: (page: number) => void;
  personnel?: MilitaryPerson[];
  searchPrefs?: SearchPreferences;
  onFilteredRowsChange?: (tableIdx: number, rows: TableData['rows']) => void;
  tableIdx?: number;
  report?: TableValidationReport;
}> = ({ data, id, pageNumber, onViewPage, personnel, searchPrefs, onFilteredRowsChange, tableIdx, report }) => {
  const [expanded, setExpanded] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);

  // Determina quais linhas contêm militares do banco de dados usando matchPersonnelInLine
  const hasPersonnel = personnel && personnel.length > 0 && searchPrefs;
  const matchedRowIndices = React.useMemo(() => {
    if (!hasPersonnel) return null;
    const indices = new Set<number>();
    data.rows.forEach((row, rowIdx) => {
      if (rowIdx === 0) return; // cabeçalho sempre incluído separadamente
      const rowText = row.map(c => c.text).join(' ');
      // strictMode=true: tabelas só aceitam match por ID/RG, nunca por nome parcial
      const found = matchPersonnelInLine(rowText, personnel!, searchPrefs!, true);
      if (found.length > 0) indices.add(rowIdx);
    });
    return indices.size > 0 ? indices : null;
  }, [data.rows, personnel, searchPrefs, hasPersonnel]);

  const isFiltered = !!matchedRowIndices && !showAll;
  const filteredRows = isFiltered
    ? [data.rows[0], ...data.rows.filter((_, i) => i > 0 && matchedRowIndices!.has(i))]
    : data.rows;

  // Notifica o pai sempre que as linhas visíveis mudam (para o handleCopy da nota)
  React.useEffect(() => {
    if (onFilteredRowsChange !== undefined && tableIdx !== undefined) {
      onFilteredRowsChange(tableIdx, filteredRows);
    }
  }, [isFiltered, filteredRows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLarge = filteredRows.length > COLLAPSED_ROWS;
  const visibleRows = isLarge && !expanded ? filteredRows.slice(0, COLLAPSED_ROWS) : filteredRows;

  const handleExportCSV = () => {
    const csvContent = data.rows.map(row => 
      row.map(cell => `"${cell.text.replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `tabela_${id.replace(/[^a-z0-9]/gi, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet(data.rows.map(row => row.map(cell => cell.text)));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tabela");
    XLSX.writeFile(wb, `tabela_${id.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
  };

  const [copiedTable, setCopiedTable] = React.useState(false);

  const handleCopyTable = async () => {
    // Copia as linhas atualmente visíveis (filtradas ou completas)
    const rowsToCopy = isFiltered ? filteredRows : data.rows;
    const tableHtml = `<table border="1" style="border-collapse:collapse;font-family:'Segoe UI',sans-serif;font-size:10pt;">${
      rowsToCopy.map((row, ri) =>
        `<tr>${row.map(cell => {
          const bg = ri === 0 ? 'background:#f3f4f6;font-weight:bold;' : '';
          const content = cell.text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-height: 44px; display: block; margin: 4px auto;" />');
          return `<td style="padding:4px 8px;border:1px solid black;${bg}">${content}</td>`;
        }).join('')}</tr>`
      ).join('')
    }</table>`;

    const plainText = rowsToCopy.map(row => row.map(c => c.text).join('\t')).join('\n');

    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([tableHtml], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })]);
    } catch {
      await navigator.clipboard.writeText(plainText);
    }
    setCopiedTable(true);
    setTimeout(() => setCopiedTable(false), 2000);
  };

  return (
    <div className={`my-4 overflow-hidden bg-white ${isFiltered ? 'border-amber-400' : 'border-black'}`}>
      <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Table className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
          <span
            className="text-[9px] font-bold text-gray-500 uppercase tracking-widest cursor-pointer hover:text-indigo-600"
            onClick={() => pageNumber !== undefined && onViewPage?.(pageNumber)}
          >
            Tabela Reconstruída {pageNumber !== undefined && `(Pág. ${pageNumber})`}
          </span>
          {report?.needsManualReview && (
            <span
              className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1"
              title={`Score: ${report.overallScore.toFixed(2)} | Tipo: ${report.tableType}${report.columnValidations.flatMap(v => v.issues).length > 0 ? ' | ' + report.columnValidations.flatMap(v => v.issues).slice(0, 2).join('; ') : ''}`}
            >
              <AlertCircle className="w-2.5 h-2.5" /> ⚠ Tabela com baixa confiança ({(report.overallScore * 100).toFixed(0)}%)
            </span>
          )}
          {isFiltered && (
            <span className="text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">
              ★ {matchedRowIndices!.size} militar{matchedRowIndices!.size !== 1 ? 'es' : ''} do efetivo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {matchedRowIndices && (
            <button
              onClick={() => { setShowAll(v => !v); setExpanded(false); }}
              className={`text-[9px] font-bold px-2 py-1 rounded flex items-center gap-1 transition-colors border ${showAll ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300 hover:text-amber-700'}`}
            >
              {showAll ? '▲ Só efetivo' : '▼ Tabela completa'}
            </button>
          )}
          <button
            onClick={handleCopyTable}
            className={`text-[9px] font-bold px-2 py-1 rounded flex items-center gap-1 transition-colors border ${copiedTable ? 'bg-green-50 text-green-700 border-green-300' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'}`}
            title={isFiltered ? 'Copiar tabela (só efetivo)' : 'Copiar tabela completa'}
          >
            {copiedTable ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
            {copiedTable ? 'Copiado!' : isFiltered ? 'Copiar efetivo' : 'Copiar'}
          </button>
          <button
            onClick={handleExportCSV}
            className="text-[9px] font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded flex items-center gap-1 transition-colors border border-indigo-100"
          >
            <Download className="w-2.5 h-2.5" /> CSV
          </button>
          <button 
            onClick={handleExportExcel}
            className="text-[9px] font-bold text-green-600 hover:bg-green-50 px-2 py-1 rounded flex items-center gap-1 transition-colors border border-green-100"
          >
            <Download className="w-2.5 h-2.5" /> EXCEL
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table 
          className="w-full border-collapse" 
          style={{ border: '1px solid black' }}
        >
          <tbody className="bg-white">
            {visibleRows.map((row, rowIdx) => {
              // Índice real na tabela original (para checar matchedRowIndices no modo completo)
              const originalIdx = isFiltered
                ? (rowIdx === 0 ? 0 : Array.from(matchedRowIndices!)[rowIdx - 1])
                : rowIdx;
              const isMatchedRow = rowIdx > 0 && matchedRowIndices?.has(originalIdx);
              return (
              <tr key={rowIdx} className={isMatchedRow ? 'bg-amber-50' : ''}>
                {row.map((cell, cellIdx) => {
                  let spannerFound = false;
                  for (let i = 0; i < cellIdx; i++) {
                    const c = row[i];
                    if (c.colSpan && c.colSpan > 1 && i + c.colSpan > cellIdx) {
                      spannerFound = true;
                      break;
                    }
                  }
                  if (spannerFound) return null;

                  let htmlContent = cell.text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-height: 80px; display: block; margin: 4px auto;" />');

                  const isSpanning = cell.colSpan && cell.colSpan > 1;

                  return (
                    <td
                      key={cellIdx}
                      className={`px-2 py-1 text-[11px] text-black ${isSpanning ? 'font-bold bg-gray-100 text-center' : ''} ${rowIdx === 0 ? 'font-bold bg-gray-100 text-center' : ''} ${isMatchedRow ? 'font-semibold' : ''}`}
                      style={{
                        fontFamily: "'Segoe UI', sans-serif",
                        border: '1px solid black',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        textAlign: isSpanning ? 'center' : (rowIdx === 0 ? 'center' : 'left'),
                      }}
                      colSpan={isSpanning ? cell.colSpan : undefined}
                      dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isLarge && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 border-t border-gray-200 transition-colors flex items-center justify-center gap-1.5"
        >
          {expanded
            ? `▲ Recolher (mostrar ${COLLAPSED_ROWS} de ${data.rows.length} linhas)`
            : `▼ Expandir tabela — ${data.rows.length - COLLAPSED_ROWS} linhas ocultas (${data.rows.length} total)`}
        </button>
      )}
    </div>
  );
};

const renderParagraphs = (
  text: string,
  tables?: TableData[],
  notaId?: string,
  pageNumber?: number,
  onViewPage?: (page: number) => void,
  personnel?: MilitaryPerson[],
  searchPrefs?: SearchPreferences,
  onFilteredRowsChange?: (tableIdx: number, rows: TableData['rows']) => void,
  tableReports?: TableValidationReport[]
) => {
  // CORREÇÃO #2D: Pré-processamento para quebrar linhas com múltiplos campos de formulário
  // Usa formFieldSplitter — fonte única de verdade para esta lógica
  let processedText = text;
  const lines = text.split('\n');
  const newLines: string[] = [];
  
  for (const line of lines) {
    if (hasMultipleFormFields(line)) {
      // splitFormFieldLines já retorna as linhas quebradas com indentação
      const split = splitFormFieldLines([line]);
      newLines.push(...split);
    } else {
      newLines.push(line);
    }
  }
  
  processedText = newLines.join('\n');
  
  // Compatibilidade com boletins antigos: converte <p align="center">...</p> para [CENTER]
  const normalizedText = processedText.replace(/<p\s+align="center">([\s\S]*?)<\/p>/gi, '[CENTER]$1');
  const processedLines = normalizedText.split('\n');
  
  const elements: React.ReactNode[] = [];
  let paragraphBuffer: string[] = [];
  let tableBuffer: string[] = [];
  let isInsideTable = false;
  let currentTableIdx: number | null = null;
  
  const flushParagraph = (idx: number) => {
    if (paragraphBuffer.length === 0) return;
    let raw = paragraphBuffer.join(' ');
    paragraphBuffer = [];

    // Remove [CENTER] de qualquer lugar da linha
    let isCentered = false;
    if (raw.includes('[CENTER]')) {
      isCentered = true;
      raw = raw.replace(/\[CENTER\]/g, '');
    }

    let html = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>');
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; max-height: 800px; margin: 16px auto; display: block; border: 1px solid #ddd; object-fit: contain;" />');

    // Estilo especial para sub-títulos de notas (agora dentro do dropdown do Eixo)
    const isInternalTitle = /^\s*\*\*<u>[\s\S]+?<\/u>\*\*\s*$/.test(raw.trim()) || /^\s*#+\s+/.test(raw.trim());
    
    if (isInternalTitle) {
      elements.push(
        <div key={`title-${idx}`} className="mt-10 mb-5 border-l-4 border-black pl-5 py-2 bg-gray-50 rounded-r-xl">
           <h4 className="text-[15px] font-black text-black uppercase tracking-tight leading-snug" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      );
      return;
    }

    elements.push(
      <p 
        key={`p-${idx}`}
        className={`leading-relaxed mb-1 text-gray-800 ${isCentered ? 'text-center' : 'indent-8'}`}
        style={{ 
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          fontSize: '12px',
          lineHeight: 1.6,
          textAlign: isCentered ? 'center' : 'justify',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };
  
  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('```grid')) {
      flushParagraph(i);
      isInsideTable = true;
      const tabMatch = trimmed.match(/```grid-tab-(\d+)/);
      currentTableIdx = tabMatch ? parseInt(tabMatch[1], 10) : null;
      tableBuffer = [];
      continue;
    }
    
    if (trimmed === '```' && isInsideTable) {
      isInsideTable = false;
      const structuredData = (currentTableIdx !== null && tables) ? tables[currentTableIdx] : null;
      
      if (structuredData) {
        elements.push(
          <StructuredTable
            key={`struct-grid-${i}`}
            data={structuredData}
            id={`${notaId || 'table'}-${currentTableIdx}`}
            pageNumber={pageNumber}
            onViewPage={onViewPage}
            personnel={personnel}
            searchPrefs={searchPrefs}
            tableIdx={currentTableIdx ?? undefined}
            onFilteredRowsChange={onFilteredRowsChange}
            report={currentTableIdx !== null && tableReports ? tableReports[currentTableIdx] : undefined}
          />
        );
      } else {
        // Fallback: usar o parser de pipes se não houver tableData estruturado
        const rows = tableBuffer.map(r => r.split(' | '));
        elements.push(
          <div key={`grid-fallback-${i}`} className="my-10 mx-auto max-w-5xl overflow-hidden rounded-lg border border-black shadow-md bg-white">
            <table className="mx-auto min-w-[90%] border-collapse" style={{ border: '1px solid black', margin: '20px auto' }}>
              <tbody className="bg-white">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td 
                        key={cIdx} 
                        className="px-4 py-2 text-[11px] text-black" 
                        style={{ fontFamily: "'Segoe UI', sans-serif", border: '1px solid black' }}
                      >
                        {cell.trim()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      tableBuffer = [];
      currentTableIdx = null;
      continue;
    }
    
    if (isInsideTable) {
      tableBuffer.push(line);
      continue;
    }

    if (trimmed === '') {
      flushParagraph(i);
      elements.push(<div key={`sp-${i}`} className="h-1" />);
    } else if (/^!\[.*?\]\(data:image\//.test(trimmed) || /^\[CENTER\]!\[.*?\]\(data:image\//.test(trimmed)) {
      // Linha de imagem — renderiza diretamente como <img>, nunca como tabela
      flushParagraph(i);
      const isCentered = trimmed.includes('[CENTER]');
      const imgMarkdown = trimmed.replace(/\[CENTER\]/g, '').trim();
      const imgMatch = imgMarkdown.match(/^!\[(.*?)\]\((data:image\/[^)]+)\)$/);
      if (imgMatch) {
        elements.push(
          <div key={`img-${i}`} className={`my-4 ${isCentered ? 'text-center' : ''}`}>
            <img
              src={imgMatch[2]}
              alt={imgMatch[1] || 'Imagem extraída'}
              style={{ maxWidth: '100%', maxHeight: '600px', margin: '12px auto', display: 'block', objectFit: 'contain' }}
            />
          </div>
        );
      }
    } else {
      // Remove [CENTER] de headers e títulos
      let cleanTrimmed = trimmed.replace(/\[CENTER\]/g, '');
      const isHeaderLine = /^\s*\*{1,3}.*\*{1,3}\s*$/.test(cleanTrimmed);
      const isListItem = /^\s*(\d+|[a-z]|[IVX]+)[\s\.\)\-]/.test(cleanTrimmed);
      
      // Usa isFormFieldLine — fonte única de verdade para detecção de campos de formulário
      const isFormDataLine = isFormFieldLine(cleanTrimmed);
      
      if (isHeaderLine || isListItem || isFormDataLine) {
        flushParagraph(i);
        let lineHtml = cleanTrimmed
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<u>$1</u>')
          .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

        // Detecta centralização mesmo se [CENTER] estiver no início
        let isCentered = false;
        if (trimmed.includes('[CENTER]')) isCentered = true;

        // Linhas de dados de formulário: sem indent, alinhamento à esquerda
        const textAlign = isFormDataLine ? 'left' : (isCentered ? 'center' : 'justify');
        const indent = isFormDataLine ? '0' : (isCentered ? '0' : '2rem');

        elements.push(
          <p 
            key={`h-${i}`}
            className={`leading-relaxed mb-1 text-gray-900 ${isHeaderLine ? 'font-semibold' : ''}`}
            style={{ 
              fontFamily: "'Segoe UI', system-ui, sans-serif",
              fontSize: '12px',
              lineHeight: 1.6,
              textAlign: textAlign as any,
              textIndent: indent,
            }}
            dangerouslySetInnerHTML={{ __html: lineHtml }}
          />
        );
      } else {
        paragraphBuffer.push(cleanTrimmed);
      }
    }
  }
  flushParagraph(lines.length);
  
  return elements;
};

const NotasView: React.FC<NotasViewProps> = ({ 
  notas, 
  history = [], 
  selectedId = null, 
  onSelect, 
  onDelete, 
  onViewPage,
  onVisiblePage,
  navigateTo = null,
  onNavigate,
  onNavigateComplete,
  personnel,
  searchPrefs,
  onSaveNota,
  onSaveError,
  isNotaSaved,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Map of normalizedTitle -> DOM element for programmatic scroll
  const noteRefs = useRef<globalThis.Map<string, HTMLElement>>(new globalThis.Map());

  // Mapa de linhas filtradas por nota: notaId -> (tableIdx -> rows)
  // Usado pelo handleCopy para copiar apenas as linhas visíveis das tabelas
  const filteredTableRowsRef = useRef<Map<string, Map<number, TableData['rows']>>>(new Map());

  const hierarchyTree = React.useMemo(() => buildNotaTree(notas), [notas]);

  // Lista plana de todas as notas para expansão inicial e navegação
  const groupedNotas = React.useMemo(() => {
    const groups: { id: string; title: string; items: BulletinNota[] }[] = [];
    hierarchyTree.parteMap.forEach((parteNode) => {
      const allItems: BulletinNota[] = [];
      const collectSlots = (slots: ParteNode['slots']) => {
        slots.forEach(slot => {
          if (slot.kind === 'nota') allItems.push(slot.nota);
          else {
            slot.eixo.slots.forEach(es => {
              if (es.kind === 'nota') allItems.push(es.nota);
              else es.sub.notas.forEach(n => allItems.push(n));
            });
          }
        });
      };
      collectSlots(parteNode.slots);
      groups.push({ id: parteNode.id, title: parteNode.title, items: allItems });
    });
    return groups;
  }, [hierarchyTree]);

  // Efeito para definir expansão inicial
  React.useEffect(() => {
    if (notas.length > 0) {
      const initialNotes = new Set<string>();
      const initialGroups = new Set<string>();

      // INTRODUÇÃO sempre expandida (sem ABERTURA DO BOLETIM — começa colapsada)
      initialGroups.add('parte-introducao');

      // 2ª PARTE expandida por padrão, com seus eixos
      hierarchyTree.parteMap.forEach(parteNode => {
        const is2aParte = parteNode.title.includes('2ª PARTE') || parteNode.title.includes('2a PARTE');
        if (is2aParte) {
          initialGroups.add(parteNode.id);
          parteNode.slots.forEach(slot => {
            if (slot.kind === 'eixo') {
              initialGroups.add(slot.eixo.id);
              slot.eixo.slots.forEach(es => {
                if (es.kind === 'nota') initialNotes.add(es.nota.id);
                else {
                  initialGroups.add(es.sub.id);
                  es.sub.notas.forEach(n => initialNotes.add(n.id));
                }
              });
            } else {
              initialNotes.add(slot.nota.id);
            }
          });
        }
      });

      setExpandedGroups(initialGroups);
      setExpandedIds(initialNotes);
    }
  }, [groupedNotas, notas.length]);

  // Efeito para navegar até a nota alvo quando navigateTo muda
  useEffect(() => {
    if (!navigateTo) return;

    // Matching robusto: primeiro tenta igualdade exata, depois inclusão parcial
    // (o cleanTitle do sumário pode ser mais curto que o rawTitle da nota)
    const targetNota = notas.find(n => normalizeTitle(n.title) === navigateTo)
      ?? notas.find(n => {
        const noteNorm = normalizeTitle(n.title);
        // O navigateTo contém as palavras principais do título da nota
        const navWords = navigateTo.split(' ').filter(w => w.length > 3);
        if (navWords.length === 0) return false;
        const matchCount = navWords.filter(w => noteNorm.includes(w)).length;
        return matchCount >= Math.ceil(navWords.length * 0.7);
      });
    if (!targetNota) return;

    // Expand the parte that contains this nota
    const targetGroup = groupedNotas.find(g => g.items.some(n => n.id === targetNota.id));
    if (targetGroup) {
      setExpandedGroups(prev => {
        const next = new Set(prev);
        next.add(targetGroup.id);
        // Also expand eixo/sub nodes that contain this nota
        hierarchyTree.parteMap.forEach(parteNode => {
          parteNode.slots.forEach(slot => {
            if (slot.kind !== 'eixo') return;
            const inEixo = slot.eixo.slots.some(es =>
              (es.kind === 'nota' && es.nota.id === targetNota.id) ||
              (es.kind === 'sub' && es.sub.notas.some(n => n.id === targetNota.id))
            );
            if (inEixo) {
              next.add(slot.eixo.id);
              slot.eixo.slots.forEach(es => {
                if (es.kind === 'sub' && es.sub.notas.some(n => n.id === targetNota.id)) next.add(es.sub.id);
              });
            }
          });
        });
        return next;
      });
    }

    setExpandedIds(prev => { const next = new Set(prev); next.add(targetNota.id); return next; });

    const scrollTimer = setTimeout(() => {
      // Tenta pelo navigateTo exato primeiro, depois pelo título normalizado da nota encontrada
      const element = noteRefs.current.get(navigateTo)
        ?? noteRefs.current.get(normalizeTitle(targetNota.title));
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setHighlightedId(targetNota.id);
        setTimeout(() => setHighlightedId(null), 2000);
      }
      onNavigateComplete?.();
    }, 100);

    return () => clearTimeout(scrollTimer);
  }, [navigateTo, notas, groupedNotas, hierarchyTree]);

  // Se não houver boletim selecionado, mostramos a lista de histórico
  if (!selectedId) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-900">
              <BookOpen className="text-indigo-600" /> Histórico de Boletins
            </h2>
            <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full">
              {history.length} {history.length === 1 ? 'registrado' : 'registrados'}
            </span>
          </div>
          <p className="text-sm text-gray-600">
            Selecione um boletim processado para visualizar as notas extraídas e tabelas reconstruídas.
          </p>
        </div>

        {history.length === 0 ? (
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">Nenhum boletim registrado no histórico.</p>
            <p className="text-xs text-gray-400 mt-1">Os boletins aparecerão aqui após a Extração Estrutural.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {history.map((bulletin) => (
              <div 
                key={bulletin.id}
                className="group bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden"
              >
                <div className="p-1 flex items-center gap-4">
                   <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center ml-3 group-hover:bg-indigo-50 transition-colors">
                      <FileText className="w-6 h-6 text-gray-400 group-hover:text-indigo-500" />
                   </div>
                   <div className="flex-1 py-4">
                      <h3 className="font-bold text-gray-900 text-sm mb-1 group-hover:text-indigo-900 line-clamp-1">
                        {bulletin.filename}
                      </h3>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 font-medium bg-gray-100 px-2 py-0.5 rounded">
                           <Calendar className="w-3 h-3" /> {bulletin.dateProcessed}
                        </span>
                        <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                           {bulletin.notas.length} notas extraídas
                        </span>
                      </div>
                   </div>
                   <div className="flex items-center gap-2 pr-4">
                      <button 
                         onClick={() => onSelect?.(bulletin.id)}
                         className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all active:scale-95"
                      >
                        Visualizar
                      </button>
                      <button 
                        onClick={() => onDelete?.(bulletin.id)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Apagar do histórico"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const handleCopy = async (nota: BulletinNota) => {
    // Pré-processamento: quebra linhas com campos de formulário (usa formFieldSplitter)
    const preprocessMarkdown = (md: string): string => {
      return md.split('\n').flatMap(line =>
        hasMultipleFormFields(line) ? splitFormFieldLines([line]) : [line]
      ).join('\n');
    };

    const preprocessed = preprocessMarkdown(nota.contentMarkdown);

    // 1. Texto Plano (para blocos de notas simples)
    const cleanTextPlain = preprocessed
      .replace(/```grid(-tab-\d+)?\n/g, '')
      .replace(/\n```/g, '')
      .replace(/ \| /g, '\t')
      .replace(/!\[.*?\]\(data:image\/.*?\)/g, '[IMAGEM]');
    const fullTextPlain = `${nota.title}\n\n${cleanTextPlain}`;

    // 2. HTML (para Word/LibreOffice manter negrito e justificação)
    let bodyHtml = preprocessed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*\*(.*?)\*\*\*/g, '<b><i>$1</i></b>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')
      .replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>')
      .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width: 55%; display: block; margin: 10px auto;" />')
      // Tabelas (Simuladas como grids simples se for grid-tab)
      .replace(/```grid-tab-(\d+)\n([\s\S]*?)```/g, (_, tabIdxStr, content) => {
          const tabIdx = parseInt(tabIdxStr, 10);
          // Usa linhas filtradas se disponíveis (modo "só efetivo"), senão usa o markdown
          const filteredRows = filteredTableRowsRef.current.get(nota.id)?.get(tabIdx);
          if (filteredRows && filteredRows.length > 0) {
            return `</div><table border="1" style="border-collapse:collapse;margin:20px auto;width:95%;font-size:10pt;color:black;">${
              filteredRows.map((row, ri) => `<tr>${row.map(cell => {
                const bg = ri === 0 ? 'background:#f3f4f6;font-weight:bold;' : '';
                const c = cell.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
                return `<td style="padding:4px 8px;border:1px solid black;${bg}">${c}</td>`;
              }).join('')}</tr>`).join('')
            }</table><div style="text-align:justify;line-height:1.15;margin-bottom:6pt;color:black;">`;
          }
          const rows = content.trim().split('\n');
          return `</div><table border="1" style="border-collapse:collapse;margin:20px auto;width:95%;font-size:10pt;color:black;">${
            rows.map(r => `<tr>${r.split(' | ').map(c => `<td style="padding:4px;border:1px solid black;">${c}</td>`).join('')}</tr>`).join('')
          }</table><div style="text-align:justify;line-height:1.15;margin-bottom:6pt;color:black;">`;
      })
      .split('\n')
      .map(line => {
        const plainLine = line.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
        const isFormLine = /^(<b>|<i>|<strong>)?[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-Za-záéíóúâêîôûãõç\s]{0,30}:/.test(plainLine);
        const isListItem = /^\d+[\d.]*\.?\s/.test(plainLine) || /^[a-z]\)\s/.test(plainLine) || /^-\s/.test(plainLine);
        if (isFormLine || isListItem) {
          return `<div style="text-align:left;line-height:1.5;margin-bottom:2pt;text-indent:0;color:black;">${line}</div>`;
        }
        return line;
      })
      .join('\n')
      .split('\n\n')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => {
        if (p.startsWith('<div')) return p; // já processado
        const isListItem = /^\d+[\d.]*\.?\s/.test(p) || /^[a-z]\)\s/.test(p);
        const indent = isListItem ? '0' : '1cm';
        return `<div style="text-align:justify;line-height:1.15;margin-bottom:6pt;text-indent:${indent};color:black;">${p}</div>`;
      })
      .join('');

    const fullHtml = `
      <div style="font-family: 'Segoe UI', sans-serif; color: black; line-height: 1.15;">
        <h3 style="color: black; font-weight: bold; text-decoration: underline; text-align: center; margin-bottom: 12pt;">${nota.title}</h3>
        ${bodyHtml}
      </div>
    `;

    try {
      // Tenta usar a Clipboard API moderna com blobs
      const blobHtml = new Blob([fullHtml], { type: 'text/html' });
      const blobText = new Blob([fullTextPlain], { type: 'text/plain' });
      
      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      })];
      
      await navigator.clipboard.write(data);
      setCopiedId(nota.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.warn('Falha ao copiar com formatação, usando fallback texto-plano', err);
      // Fallback para texto plano se falhar
      try {
        await navigator.clipboard.writeText(fullTextPlain);
        setCopiedId(nota.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = fullTextPlain;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedId(nota.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    const isOpening = !next.has(id);
    if (isOpening) {
      next.add(id);
      // Emite a página da nota quando ela é aberta
      const nota = notas.find(n => n.id === id);
      if (nota?.pageNumber && onVisiblePage) {
        onVisiblePage(nota.pageNumber);
      }
    } else {
      next.delete(id);
    }
    setExpandedIds(next);
  };

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedGroups(next);
  };

  const expandAll = () => {
    const allGroupIds = new Set<string>();
    allGroupIds.add('parte-introducao');
    allGroupIds.add('abertura-do-boletim');
    groupedNotas.forEach(g => allGroupIds.add(g.id));
    hierarchyTree.parteMap.forEach(parteNode => {
      parteNode.slots.forEach(slot => {
        if (slot.kind === 'eixo') {
          allGroupIds.add(slot.eixo.id);
          slot.eixo.slots.forEach(es => { if (es.kind === 'sub') allGroupIds.add(es.sub.id); });
        }
      });
    });
    setExpandedGroups(allGroupIds);
    setExpandedIds(new Set(notas.map(n => n.id)));
  };

  const collapseAll = () => {
    setExpandedGroups(new Set());
    setExpandedIds(new Set());
  };

  // Renderiza o card de uma nota individual
  const renderNotaCard = (nota: BulletinNota) => {
    const isExpanded = expandedIds.has(nota.id);

    // Callback para StructuredTable notificar quais linhas estão visíveis
    const handleFilteredRowsChange = (tableIdx: number, rows: TableData['rows']) => {
      if (!filteredTableRowsRef.current.has(nota.id)) {
        filteredTableRowsRef.current.set(nota.id, new Map());
      }
      filteredTableRowsRef.current.get(nota.id)!.set(tableIdx, rows);
    };
    if (nota.isHeaderOnly) {
      return (
        <div key={nota.id} className="pt-4 pb-1 px-1">
          <div className="flex items-start gap-3">
            <div className="mt-2.5 h-[1.5px] w-8 bg-indigo-500 rounded-full flex-shrink-0" />
            <h5 className="text-[12px] font-black uppercase tracking-wider text-black leading-relaxed underline decoration-black decoration-2 underline-offset-4">
              {nota.title}
            </h5>
          </div>
        </div>
      );
    }
    return (
      <div
        key={nota.id}
        data-nota-id={nota.id}
        ref={el => {
          if (el) noteRefs.current.set(normalizeTitle(nota.title), el);
          else noteRefs.current.delete(normalizeTitle(nota.title));
        }}
        className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all relative ${nota.isRelevant ? 'border-amber-400 ring-1 ring-amber-400' : highlightedId === nota.id ? 'border-indigo-400 ring-2 ring-indigo-500' : 'border-gray-200 hover:border-indigo-200'}`}
      >
        {nota.isRelevant && (
          <div className="absolute top-0 right-0 bg-amber-400 text-amber-900 text-[10px] font-black px-3 py-1 rounded-bl-lg shadow-sm z-10 flex items-center gap-1 animate-pulse">
            <Star className="w-3.5 h-3.5 fill-amber-900" /> FAVORITO
          </div>
        )}
        {nota.hasFuzzyMatch && (
          <div className="absolute top-0 left-0 bg-purple-600 text-white text-[9px] font-black px-3 py-1 rounded-br-lg shadow-sm z-10 flex items-center gap-1 animate-pulse">
            <AlertCircle className="w-3 h-3" /> VERIFICAR NOME
          </div>
        )}
        <div
          className="bg-gray-50/80 px-4 py-3 border-b border-gray-200 flex items-start gap-3 cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => toggleExpand(nota.id)}
        >
          <div className="mt-0.5 flex-shrink-0 transition-transform duration-300" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <ChevronRight className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="min-w-0 flex-grow pt-0.5">
            <h4 className="text-sm font-bold text-black tracking-tight leading-tight underline decoration-black decoration-2 underline-offset-[3px]">
              {nota.title}
            </h4>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 pl-2" onClick={e => e.stopPropagation()}>
            {onSaveError && (
              <button
                onClick={() => onSaveError(nota)}
                title={isNotaSaved?.(nota.id, 'error') ? 'Erro já reportado' : 'Reportar erro de formatação (X)'}
                className={`p-1.5 rounded-lg border transition-all ${
                  isNotaSaved?.(nota.id, 'error')
                    ? 'bg-red-100 text-red-500 border-red-200'
                    : 'bg-white text-gray-300 hover:text-red-500 border-gray-200 hover:border-red-200 hover:bg-red-50'
                }`}
              >
                <X className={`w-3.5 h-3.5 ${isNotaSaved?.(nota.id, 'error') ? 'stroke-[3px]' : ''}`} />
              </button>
            )}
            {onSaveNota && (
              <button
                onClick={() => onSaveNota(nota)}
                title={isNotaSaved?.(nota.id, 'relevant') ? 'Nota já salva' : 'Salvar como relevante'}
                className={`p-1.5 rounded-lg border transition-all ${
                  isNotaSaved?.(nota.id, 'relevant')
                    ? 'bg-orange-100 text-orange-500 border-orange-200'
                    : 'bg-white text-gray-300 hover:text-orange-500 border-gray-200 hover:border-orange-200 hover:bg-orange-50'
                }`}
              >
                <Bookmark className={`w-3.5 h-3.5 ${isNotaSaved?.(nota.id, 'relevant') ? 'fill-orange-400' : ''}`} />
              </button>
            )}
            <button
              onClick={() => handleCopy(nota)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                copiedId === nota.id
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-white text-gray-400 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50'
              }`}
            >
              {copiedId === nota.id ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="px-6 py-5 bg-white animate-in slide-in-from-top-2 duration-300">
            {nota.matchedEntities && nota.matchedEntities.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                  Militar{nota.matchedEntities.length > 1 ? 'es' : ''} do efetivo:
                </span>
                {nota.matchedEntities.map((name, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                    title={nota.matchedEntitiesReason?.[name] ? `Localizado por: ${nota.matchedEntitiesReason[name]}` : undefined}
                  >
                    <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                    {name}
                    {nota.matchedEntitiesReason?.[name] && (
                      <span className="text-[9px] font-normal text-amber-600 ml-0.5 opacity-75">
                        via {nota.matchedEntitiesReason[name]}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-4">
              <div className="w-1 rounded-full flex-shrink-0 bg-indigo-50 mt-1" />
              <div className="flex-1 min-w-0">
                {renderParagraphs(nota.contentMarkdown, nota.tables, nota.id, nota.pageNumber, onViewPage, personnel, searchPrefs, handleFilteredRowsChange, nota.tableReports)}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-6 animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="text-indigo-600" /> {history.find(b => b.id === selectedId)?.filename}
          </h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => onSelect?.(null)}
              className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-all flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Histórico
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {history.find(b => b.id === selectedId)?.dateProcessed}</span>
              <span className="flex items-center gap-1 font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{notas.length} notas extraídas</span>
           </div>
           <div className="flex items-center gap-2">
              <button onClick={expandAll} className="text-[10px] font-bold text-gray-500 hover:text-indigo-600 px-2 py-1 rounded border border-gray-200 hover:border-indigo-200 transition-all">Expandir Tudo</button>
              <button onClick={collapseAll} className="text-[10px] font-bold text-gray-500 hover:text-indigo-600 px-2 py-1 rounded border border-gray-200 hover:border-indigo-200 transition-all">Recolher Tudo</button>
           </div>
        </div>
      </div>

      {/* Parte especial INTRODUÇÃO: Sumário + Abertura do Boletim */}
      {(hierarchyTree.special.length > 0) && (() => {
        const introducaoId = 'parte-introducao';
        const isIntroExpanded = expandedGroups.has(introducaoId);
        const aberturaNotas = hierarchyTree.special.filter(n => n.hierarchy === 'Abertura do Boletim');
        const sumarioNotas = hierarchyTree.special.filter(n => n.hierarchy === 'Sumário do Boletim');
        const aberturaId = 'abertura-do-boletim';
        const isAberturaExpanded = expandedGroups.has(aberturaId);

        return (
          <div className="space-y-3">
            <div
              className={`rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${isIntroExpanded ? 'border-indigo-100 bg-indigo-50/20' : 'border-gray-200 bg-white hover:border-indigo-200'}`}
              onClick={() => toggleGroup(introducaoId)}
            >
              <div className="px-6 py-4 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg transition-colors ${isIntroExpanded ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 group-hover:text-indigo-600'}`}>
                    <ChevronRight className={`w-5 h-5 transition-transform duration-300 ${isIntroExpanded ? 'rotate-90' : ''}`} />
                  </div>
                  <h3 className={`text-sm font-black uppercase tracking-widest ${isIntroExpanded ? 'text-indigo-900' : 'text-gray-600'}`}>INTRODUÇÃO</h3>
                </div>
              </div>
            </div>

            {isIntroExpanded && (
              <div className="pl-4 md:pl-10 space-y-4 animate-in slide-in-from-top-4 duration-300">
                {/* Sumário direto, sem dropdown */}
                {sumarioNotas.map(nota => (
                  <div key={nota.id} className="mb-2"><SumarioView nota={nota} notas={notas} onNavigate={onNavigate} onViewPage={onViewPage} /></div>
                ))}

                {/* Abertura do Boletim como dropdown colapsado */}
                {aberturaNotas.length > 0 && (
                  <div className="space-y-3">
                    <div
                      className={`rounded-lg border transition-all cursor-pointer overflow-hidden ${isAberturaExpanded ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200 bg-gray-50 hover:border-indigo-200'}`}
                      onClick={e => { e.stopPropagation(); toggleGroup(aberturaId); }}
                    >
                      <div className="px-5 py-3 flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <ChevronRight className={`w-4 h-4 text-indigo-400 transition-transform duration-300 ${isAberturaExpanded ? 'rotate-90' : ''}`} />
                          <h4 className={`text-xs font-black uppercase tracking-wider ${isAberturaExpanded ? 'text-indigo-800' : 'text-gray-500'}`}>ABERTURA DO BOLETIM</h4>
                        </div>
                        <span className="text-[9px] font-bold text-gray-400">{aberturaNotas.length} {aberturaNotas.length === 1 ? 'nota' : 'notas'}</span>
                      </div>
                    </div>
                    {isAberturaExpanded && (
                      <div className="pl-4 md:pl-8 space-y-3 animate-in slide-in-from-top-2 duration-200">
                        {aberturaNotas.map(nota => renderNotaCard(nota))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Árvore hierárquica: Parte → Eixo → Sub-eixo → Notas (ordem cronológica preservada) */}
      {Array.from(hierarchyTree.parteMap.values()).map(parteNode => {
        const isParteExpanded = expandedGroups.has(parteNode.id);
        const totalNotas = groupedNotas.find(g => g.id === parteNode.id)?.items.length ?? 0;
        const relevantInParte = groupedNotas.find(g => g.id === parteNode.id)?.items.filter(n => n.isRelevant).length ?? 0;

        return (
          <div key={parteNode.id} className="space-y-3">
            <div
              className={`rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${isParteExpanded ? 'border-indigo-100 bg-indigo-50/20' : relevantInParte > 0 ? 'border-amber-300 bg-amber-50/30 hover:border-amber-400' : 'border-gray-200 bg-white hover:border-indigo-200'}`}
              onClick={() => toggleGroup(parteNode.id)}
            >
              <div className="px-6 py-4 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg transition-colors ${isParteExpanded ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 group-hover:text-indigo-600'}`}>
                    <ChevronRight className={`w-5 h-5 transition-transform duration-300 ${isParteExpanded ? 'rotate-90' : ''}`} />
                  </div>
                  <h3 className={`text-sm font-black uppercase tracking-widest ${isParteExpanded ? 'text-indigo-900' : 'text-gray-600'}`}>{parteNode.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {relevantInParte > 0 && (
                    <span className="text-[10px] font-black bg-amber-400 text-amber-900 px-2 py-1 rounded shadow-sm flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-900" /> {relevantInParte}
                    </span>
                  )}
                  <span className="text-[10px] font-bold bg-white/80 border border-gray-200 px-2 py-1 rounded shadow-sm">
                    {totalNotas} {totalNotas === 1 ? 'Nota' : 'Notas'}
                  </span>
                </div>
              </div>
            </div>

            {isParteExpanded && (
              <div className="pl-4 md:pl-10 space-y-4 animate-in slide-in-from-top-4 duration-300">
                {/* Slots em ordem cronológica: nota direta ou dropdown de eixo */}
                {parteNode.slots.map((slot, si) => {
                  if (slot.kind === 'nota') {
                    return <React.Fragment key={slot.nota.id}>{renderNotaCard(slot.nota)}</React.Fragment>;
                  }

                  // Slot de eixo
                  const eixoNode = slot.eixo;
                  const isEixoExpanded = expandedGroups.has(eixoNode.id);
                  const eixoTotal = eixoNode.slots.reduce((acc, es) =>
                    acc + (es.kind === 'nota' ? 1 : es.sub.notas.length), 0);
                  const eixoRelevant = eixoNode.slots.reduce((acc, es) =>
                    acc + (es.kind === 'nota' ? (es.nota.isRelevant ? 1 : 0) : es.sub.notas.filter(n => n.isRelevant).length), 0);

                  return (
                    <div key={eixoNode.id} className="space-y-3">
                      <div
                        className={`rounded-lg border transition-all cursor-pointer overflow-hidden ${isEixoExpanded ? 'border-indigo-200 bg-indigo-50/30' : eixoRelevant > 0 ? 'border-amber-300 bg-amber-50/20 hover:border-amber-400' : 'border-gray-200 bg-gray-50 hover:border-indigo-200'}`}
                        onClick={() => toggleGroup(eixoNode.id)}
                      >
                        <div className="px-5 py-3 flex items-center justify-between group">
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`w-4 h-4 text-indigo-400 transition-transform duration-300 ${isEixoExpanded ? 'rotate-90' : ''}`} />
                            <h4 className={`text-xs font-black uppercase tracking-wider ${isEixoExpanded ? 'text-indigo-800' : 'text-gray-500'}`}>{eixoNode.title}</h4>
                          </div>
                          <div className="flex items-center gap-2">
                            {eixoRelevant > 0 && (
                              <span className="text-[9px] font-black bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Star className="w-2.5 h-2.5 fill-amber-900" /> {eixoRelevant}
                              </span>
                            )}
                            <span className="text-[9px] font-bold text-gray-400">{eixoTotal} {eixoTotal === 1 ? 'nota' : 'notas'}</span>
                          </div>
                        </div>
                      </div>

                      {isEixoExpanded && (
                        <div className="pl-4 md:pl-8 space-y-3 animate-in slide-in-from-top-2 duration-200">
                          {/* Slots do eixo em ordem cronológica: nota direta ou sub-eixo */}
                          {eixoNode.slots.map((es, ei) => {
                            if (es.kind === 'nota') {
                              return <React.Fragment key={es.nota.id}>{renderNotaCard(es.nota)}</React.Fragment>;
                            }

                            const subNode = es.sub;
                            const isSubExpanded = expandedGroups.has(subNode.id);
                            const subRelevant = subNode.notas.filter(n => n.isRelevant).length;
                            return (
                              <div key={subNode.id} className="space-y-2">
                                <div
                                  className={`rounded-lg border transition-all cursor-pointer overflow-hidden ${isSubExpanded ? 'border-indigo-200 bg-indigo-50/30' : subRelevant > 0 ? 'border-amber-300 bg-amber-50/20 hover:border-amber-400' : 'border-gray-200 bg-gray-50 hover:border-indigo-200'}`}
                                  onClick={() => toggleGroup(subNode.id)}
                                >
                                  <div className="px-5 py-3 flex items-center justify-between group">
                                    <div className="flex items-center gap-2">
                                      <ChevronRight className={`w-4 h-4 text-indigo-400 transition-transform duration-300 ${isSubExpanded ? 'rotate-90' : ''}`} />
                                      <h5 className={`text-xs font-black uppercase tracking-wider ${isSubExpanded ? 'text-indigo-800' : 'text-gray-500'}`}>{subNode.title}</h5>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {subRelevant > 0 && (
                                        <span className="text-[9px] font-black bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded flex items-center gap-1">
                                          <Star className="w-2.5 h-2.5 fill-amber-900" /> {subRelevant}
                                        </span>
                                      )}
                                      <span className="text-[9px] font-bold text-gray-400">{subNode.notas.length} {subNode.notas.length === 1 ? 'nota' : 'notas'}</span>
                                    </div>
                                  </div>
                                </div>
                                {isSubExpanded && (
                                  <div className="pl-4 md:pl-6 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                    {subNode.notas.map(nota => renderNotaCard(nota))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Dropdown ANEXOS — aparece após as partes */}
      {hierarchyTree.anexos.length > 0 && (() => {
        const anexosId = 'parte-anexos';
        const isAnexosExpanded = expandedGroups.has(anexosId);
        return (
          <div className="space-y-3">
            <div
              className={`rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${isAnexosExpanded ? 'border-amber-200 bg-amber-50/20' : 'border-gray-200 bg-white hover:border-amber-200'}`}
              onClick={() => toggleGroup(anexosId)}
            >
              <div className="px-6 py-4 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg transition-colors ${isAnexosExpanded ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-400 group-hover:text-amber-600'}`}>
                    <ChevronRight className={`w-5 h-5 transition-transform duration-300 ${isAnexosExpanded ? 'rotate-90' : ''}`} />
                  </div>
                  <h3 className={`text-sm font-black uppercase tracking-widest ${isAnexosExpanded ? 'text-amber-900' : 'text-gray-600'}`}>ANEXOS</h3>
                </div>
                <span className="text-[10px] font-bold bg-white/80 border border-gray-200 px-2 py-1 rounded shadow-sm">
                  {hierarchyTree.anexos.length} {hierarchyTree.anexos.length === 1 ? 'Anexo' : 'Anexos'}
                </span>
              </div>
            </div>
            {isAnexosExpanded && (
              <div className="pl-4 md:pl-10 space-y-4 animate-in slide-in-from-top-4 duration-300">
                {hierarchyTree.anexos.map(nota => renderNotaCard(nota))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default NotasView;
