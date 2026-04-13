/**
 * TableRegistry
 *
 * Cache de ColumnBoundaries por tipo de tabela e página do PDF.
 * Quando uma tabela MILITARY_PERSONNEL é reconstruída com score ≥ 0.9 e
 * boundaries.length === 6, salva as boundaries indexadas por página.
 *
 * No reconstructTableByTemplate, antes de chamar inferColumnBoundaries,
 * consulta o registry — se houver boundaries salvas para páginas próximas
 * (±3 páginas), usa diretamente, garantindo consistência entre páginas da
 * mesma tabela e eliminando o inferColumnBoundaries repetido.
 */

import { ColumnBoundary } from "./TablePatternAnalyzer";
import { TableType } from "./tableTypes";

export interface TableRegistry {
  save(page: number, type: TableType, boundaries: ColumnBoundary[]): void;
  lookup(page: number, type: TableType): ColumnBoundary[] | null;
  clear(): void;
}

interface RegistryEntry {
  page: number;
  type: TableType;
  boundaries: ColumnBoundary[];
}

const PAGE_PROXIMITY = 3;

class TableRegistryImpl implements TableRegistry {
  private entries: RegistryEntry[] = [];

  save(page: number, type: TableType, boundaries: ColumnBoundary[]): void {
    // Substitui entrada existente para a mesma página+tipo, ou adiciona nova
    const idx = this.entries.findIndex(e => e.page === page && e.type === type);
    if (idx >= 0) {
      this.entries[idx] = { page, type, boundaries };
    } else {
      this.entries.push({ page, type, boundaries });
    }
    console.log(`[TableRegistry] Salvo: tipo=${type} página=${page} boundaries=${boundaries.length}`);
  }

  lookup(page: number, type: TableType): ColumnBoundary[] | null {
    // Procura a entrada mais próxima dentro de ±PAGE_PROXIMITY páginas
    const candidates = this.entries.filter(
      e => e.type === type && Math.abs(e.page - page) <= PAGE_PROXIMITY
    );
    if (candidates.length === 0) return null;

    // Retorna a entrada da página mais próxima
    candidates.sort((a, b) => Math.abs(a.page - page) - Math.abs(b.page - page));
    const found = candidates[0];
    console.log(`[TableRegistry] Hit: tipo=${type} página=${page} → entrada da página ${found.page}`);
    return found.boundaries;
  }

  clear(): void {
    this.entries = [];
  }
}

/** Instância singleton — vive durante o processamento de um boletim */
export const tableRegistry = new TableRegistryImpl();
