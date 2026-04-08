/**
 * notaTreeService.ts
 * Constrói a árvore hierárquica de notas para exibição na UI.
 */

import { BulletinNota } from "../types";

export interface SubNode {
  id: string;
  title: string;
  notas: BulletinNota[];
}

export type EixoSlot =
  | { kind: 'nota'; nota: BulletinNota }
  | { kind: 'sub'; sub: SubNode };

export interface EixoNode {
  id: string;
  title: string;
  slots: EixoSlot[];
}

export type ParteSlot =
  | { kind: 'nota'; nota: BulletinNota }
  | { kind: 'eixo'; eixo: EixoNode };

export interface ParteNode {
  id: string;
  title: string;
  slots: ParteSlot[];
}

export interface NotaTree {
  special: BulletinNota[];
  anexos: BulletinNota[];
  parteMap: Map<string, ParteNode>;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/**
 * Constrói a árvore hierárquica a partir de um array plano de BulletinNota.
 * Usa `hierarchyPath` quando disponível, com fallback para `hierarchy.split('>')`.
 *
 * Regra de deduplicação: notas marcadas como `isHeaderOnly` cujo título normalizado
 * coincide exatamente com o parteKey ou eixoKey são descartadas — elas já são
 * representadas pelo cabeçalho do grupo na UI.
 */
export function buildNotaTree(notas: BulletinNota[]): NotaTree {
  const special: BulletinNota[] = [];
  const anexos: BulletinNota[] = [];
  const parteMap = new Map<string, ParteNode>();

  for (const nota of notas) {
    if (nota.hierarchy === 'Sumário do Boletim' || nota.hierarchy === 'Abertura do Boletim') {
      special.push(nota);
      continue;
    }

    if (nota.hierarchy === 'Anexos do Boletim') {
      anexos.push(nota);
      continue;
    }

    const parts = nota.hierarchyPath
      ? nota.hierarchyPath
      : (nota.hierarchy || '').split('>').map(s => s.trim()).filter(Boolean);

    const parteKey = parts[0] || 'OUTRAS SEÇÕES';
    const eixoKey  = parts[1] || '';
    const subKey   = parts[2] || '';

    if (!parteMap.has(parteKey)) {
      parteMap.set(parteKey, { id: `parte-${parteKey}`, title: parteKey, slots: [] });
    }
    const parteNode = parteMap.get(parteKey)!;

    // Descarta nota que É a própria parte (título igual ao parteKey, sem eixo filho)
    if (norm(nota.title) === norm(parteKey) && !eixoKey) continue;

    if (!eixoKey) {
      parteNode.slots.push({ kind: 'nota', nota });
      continue;
    }

    // Descarta nota que É o próprio eixo (título igual ao eixoKey, sem sub-eixo filho)
    // Não depende de isHeaderOnly — se o hierarchyPath inclui o próprio título como eixoKey,
    // esta nota representa o cabeçalho do eixo e não deve aparecer como nota individual.
    if (norm(nota.title) === norm(eixoKey) && !subKey) {
      // Garante que o eixo existe na árvore mesmo sem conteúdo próprio
      if (!parteNode.slots.find(s => s.kind === 'eixo' && s.eixo.title === eixoKey)) {
        parteNode.slots.push({ kind: 'eixo', eixo: { id: `eixo-${parteKey}-${eixoKey}`, title: eixoKey, slots: [] } });
      }
      continue;
    }

    // Localiza ou cria o eixo
    let eixoSlot = parteNode.slots.find(
      s => s.kind === 'eixo' && s.eixo.title === eixoKey
    ) as { kind: 'eixo'; eixo: EixoNode } | undefined;

    if (!eixoSlot) {
      const newEixo: EixoNode = { id: `eixo-${parteKey}-${eixoKey}`, title: eixoKey, slots: [] };
      eixoSlot = { kind: 'eixo', eixo: newEixo };
      parteNode.slots.push(eixoSlot);
    }
    const eixoNode = eixoSlot.eixo;

    if (!subKey) {
      eixoNode.slots.push({ kind: 'nota', nota });
      continue;
    }

    // Localiza ou cria o sub-eixo
    let subSlot = eixoNode.slots.find(
      s => s.kind === 'sub' && s.sub.title === subKey
    ) as { kind: 'sub'; sub: SubNode } | undefined;

    if (!subSlot) {
      const newSub: SubNode = { id: `sub-${parteKey}-${eixoKey}-${subKey}`, title: subKey, notas: [] };
      subSlot = { kind: 'sub', sub: newSub };
      eixoNode.slots.push(subSlot);
    }
    subSlot.sub.notas.push(nota);
  }

  return { special, anexos, parteMap };
}
