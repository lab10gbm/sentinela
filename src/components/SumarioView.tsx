import React from 'react';
import { BulletinNota } from '../types';
import { normalizeTitle } from '../services/textUtils';

interface SumarioViewProps {
  nota: BulletinNota;
  onNavigate?: (title: string) => void;
  onViewPage?: (page: number) => void;
}

type Level = 'parte' | 'secao' | 'letra_secao' | 'nota';

interface SumarioEntry {
  text: string;
  page: string | null;
  level: Level;
}

const parseSumarioLines = (markdown: string): SumarioEntry[] => {
  const lines = markdown.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const pageMatch = line.match(/\[p\.\s*(\d+)\]/);
    const page = pageMatch ? pageMatch[1] : null;

    let level: Level = 'nota';
    let text = line;

    if (line.startsWith('PARTE:')) {
      level = 'parte';
      text = line.slice(6);
    } else if (line.startsWith('SECAO:')) {
      level = 'secao';
      text = line.slice(6);
    } else if (line.startsWith('LETRA_SECAO:')) {
      level = 'letra_secao';
      text = line.slice(12);
    } else if (line.startsWith('NOTA:')) {
      level = 'nota';
      text = line.slice(5);
    } else {
      // Legacy fallback: detect by indentation
      const indent = line.length - line.trimStart().length;
      if (indent === 0) level = 'parte';
      else if (indent <= 2) level = 'secao';
      else level = 'nota';
    }

    text = text
      .replace(/\[p\.\s*\d+\]/, '')   // remove page reference
      .replace(/_{2,}/g, '')           // remove sequences of underscores
      .replace(/\*{2,}/g, '')          // remove sequences of asterisks
      .replace(/\s+\d+\s*$/, '')       // remove isolated trailing number
      .replace(/\s{2,}/g, ' ')         // collapse multiple spaces
      .trim();
    return { text, page, level };
  });
};

// Group entries so each PARTE contains its children, enabling "SEM ALTERAÇÃO" detection
interface ParteGroup {
  parte: SumarioEntry;
  children: SumarioEntry[];
}

const groupByParte = (entries: SumarioEntry[]): ParteGroup[] => {
  const groups: ParteGroup[] = [];
  let current: ParteGroup | null = null;

  for (const entry of entries) {
    if (entry.level === 'parte') {
      if (current) groups.push(current);
      current = { parte: entry, children: [] };
    } else if (current) {
      current.children.push(entry);
    } else {
      // entries before any PARTE (e.g. FATOS HISTÓRICOS at root level)
      groups.push({ parte: entry, children: [] });
    }
  }
  if (current) groups.push(current);
  return groups;
};

/** Returns true when a secao group has no children with a non-null page */
const secaoHasNoPagedChildren = (children: SumarioEntry[], secaoIndex: number): boolean => {
  // collect children belonging to this secao (until next secao or end)
  const secaoChildren: SumarioEntry[] = [];
  for (let i = secaoIndex + 1; i < children.length; i++) {
    if (children[i].level === 'secao') break;
    secaoChildren.push(children[i]);
  }
  return secaoChildren.every(c => c.page === null);
};

const DotLeader: React.FC<{ light?: boolean }> = ({ light }) => (
  <span
    className={`flex-1 border-b border-dotted mx-2 mb-1 min-w-[20px] ${light ? 'border-gray-200' : 'border-gray-300'}`}
  />
);

const PageNum: React.FC<{ page: string; size?: string }> = ({ page, size = 'text-[12px]' }) => (
  <span className={`${size} tabular-nums w-7 text-right flex-shrink-0 font-semibold text-gray-800`}>
    {page}
  </span>
);

const SumarioView: React.FC<SumarioViewProps> = ({ nota, onNavigate, onViewPage }) => {
  const entries = parseSumarioLines(nota.contentMarkdown);
  const groups = groupByParte(entries);

  const handleNavigate = (text: string, page: string | null) => {
    if (onViewPage && page) onViewPage(parseInt(page, 10));
    if (onNavigate) onNavigate(normalizeTitle(text));
  };

  return (
    <div className="font-['Segoe_UI',system-ui,sans-serif] select-text">
      {/* Header */}
      <div className="bg-[#8B2020] text-white px-6 py-4 flex items-center justify-center rounded-t-lg">
        <h2 className="text-2xl font-black tracking-[0.2em] uppercase">SUMÁRIO</h2>
      </div>

      {/* TOC body */}
      <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg overflow-hidden">
        {groups.map((group, gi) => {
          const { parte, children } = group;
          const parteHasNoPagedChildren = children.every(c => c.page === null);

          return (
            <div key={gi} className="border-b border-gray-100 last:border-b-0">
              {/* PARTE row */}
              <div
                className={`flex items-baseline gap-1 px-5 py-3 bg-gray-50 border-l-4 border-[#8B2020] ${onNavigate ? 'cursor-pointer hover:bg-gray-100 transition-colors' : ''}`}
                onClick={() => onNavigate && handleNavigate(parte.text, parte.page)}
              >
                <span className="text-[13px] font-black text-gray-900 uppercase tracking-wide leading-snug flex-shrink-0 max-w-[75%]">
                  {parte.text}
                </span>
                {parte.page ? (
                  <>
                    <DotLeader />
                    <PageNum page={parte.page} size="text-[13px]" />
                  </>
                ) : parteHasNoPagedChildren ? (
                  <span className="ml-3 text-[11px] italic text-gray-400 font-normal">SEM ALTERAÇÃO.</span>
                ) : null}
              </div>

              {/* Children: SECAO, LETRA_SECAO and NOTA rows */}
              {children.map((child, ci) => {
                if (child.level === 'secao') {
                  const noPagedChildren = secaoHasNoPagedChildren(children, ci);
                  return (
                    <div
                      key={ci}
                      className={`flex items-baseline gap-1 px-5 py-2 pl-10 bg-white border-t border-gray-50 ${onNavigate ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}`}
                      onClick={() => onNavigate && handleNavigate(child.text, child.page)}
                    >
                      <span className="text-[12px] font-bold text-gray-800 uppercase tracking-wide leading-snug flex-shrink-0 max-w-[72%]">
                        {child.text}
                      </span>
                      {child.page ? (
                        <>
                          <DotLeader />
                          <PageNum page={child.page} />
                        </>
                      ) : noPagedChildren ? (
                        <span className="ml-3 text-[11px] italic text-gray-400 font-normal">SEM ALTERAÇÃO.</span>
                      ) : null}
                    </div>
                  );
                }

                if (child.level === 'letra_secao') {
                  return (
                    <div
                      key={ci}
                      className={`flex items-baseline gap-1 px-5 py-2 pl-12 bg-gray-50/50 border-t border-gray-100 ${onNavigate ? 'cursor-pointer hover:bg-gray-100 transition-colors' : ''}`}
                      onClick={() => onNavigate && handleNavigate(child.text, child.page)}
                    >
                      <span className="text-[11.5px] font-bold text-gray-800 uppercase tracking-wide leading-snug flex-shrink-0 max-w-[72%]">
                        {child.text}
                      </span>
                      {child.page ? (
                        <>
                          <DotLeader />
                          <PageNum page={child.page} />
                        </>
                      ) : null}
                    </div>
                  );
                }

                // NOTA
                return (
                  <div
                    key={ci}
                    className={`flex items-baseline gap-1 px-5 py-1.5 pl-14 bg-white hover:bg-gray-50/60 transition-colors border-t border-gray-50 ${onNavigate ? 'cursor-pointer hover:underline' : ''}`}
                    onClick={() => onNavigate && handleNavigate(child.text, child.page)}
                  >
                    <span className="text-[11.5px] text-gray-700 leading-snug flex-shrink-0 max-w-[68%]">
                      {child.text}
                    </span>
                    {child.page ? (
                      <>
                        <DotLeader light />
                        <PageNum page={child.page} size="text-[11.5px]" />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SumarioView;
