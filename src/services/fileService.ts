import * as XLSX from 'xlsx';
import { MilitaryPerson } from '../types';

/**
 * Função auxiliar para limpar RGs e IDs:
 * 1. Remove pontos, traços, espaços.
 * 2. Remove ZEROS à esquerda (ex: 0054444 -> 54444).
 */
const sanitizeId = (value: any): string | undefined => {
  if (!value) return undefined;
  // Converte para string, remove não-alfanuméricos e depois remove zeros do início
  let clean = String(value).replace(/[^a-zA-Z0-9]/g, '');
  clean = clean.replace(/^0+/, ''); 
  return clean === '' ? undefined : clean;
};

/**
 * Core extraction logic from XLSX workbook.
 */
export const extractDataFromWorkbook = (workbook: XLSX.WorkBook): MilitaryPerson[] => {
  let allPersonnel: MilitaryPerson[] = [];

  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    // Convert to Array of Arrays to find exactly where the header is
    const aoa: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    let headerRowIndex = 0;
    // Find the row that contains 'NOME' or 'RG'
    for (let i = 0; i < aoa.length; i++) {
        const row = aoa[i];
        if (Array.isArray(row)) {
            const rowStr = row.join(' ').toLowerCase();
            if (rowStr.includes('nome') && (rowStr.includes('rg') || rowStr.includes('guerra') || rowStr.includes('posto'))) {
                headerRowIndex = i;
                break;
            }
        }
    }

    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex });
    
    const sheetPersonnel: MilitaryPerson[] = rawRows.map((row): MilitaryPerson | null => {
      const getVal = (possibleHeaders: string[]) => {
         for (const header of possibleHeaders) {
           if (row[header] !== undefined) return row[header];
         }
         
         const rowKeys = Object.keys(row);
         for (const header of possibleHeaders) {
           const foundKey = rowKeys.find(k => k.trim().toLowerCase() === header.toLowerCase());
           if (foundKey) return row[foundKey];
         }
         return '';
      };

      const nomeCompleto = getVal(['NOME COMPLETO', 'NOME', 'Nome', 'Nome Completo']);
      const nomeGuerra = getVal(['NOME GUERRA', 'N.Guerra', 'N. GUERRA', 'Nome de Guerra', 'Guerra']);
      const rg = getVal(['RG', 'R.G.', 'Rg', 'Identidade']);
      const idFuncional = getVal(['ID Funcional', 'ID FUNCIONAL', 'Id Funcional', 'ID', 'Matrícula']);
      
      const postoGraduacao = getVal(['Posto/Grad', 'Posto', 'Graduação', 'Patente']);
      const obmDbm = getVal(['OBM/DBM', 'OBM', 'DBM', 'Lotação', 'Unidade']);
      const regiao = getVal(['Região', 'Regiao', 'CBA']);

      if (!nomeCompleto) return null;

      return {
        nomeCompleto: String(nomeCompleto).trim(),
        nomeGuerra: nomeGuerra ? String(nomeGuerra).trim() : undefined,
        rg: sanitizeId(rg), 
        idFuncional: sanitizeId(idFuncional), 
        postoGraduacao: postoGraduacao ? String(postoGraduacao).trim() : undefined,
        obmDbm: obmDbm ? String(obmDbm).trim() : undefined,
        regiao: regiao ? String(regiao).trim() : undefined,
      };
    }).filter((p): p is MilitaryPerson => p !== null);

    allPersonnel = [...allPersonnel, ...sheetPersonnel];
  });

  return allPersonnel;
};

/**
 * Parses an Excel file to extract military personnel data (Frontend/FileReader)
 */
export const parseExcelRoster = async (file: File): Promise<MilitaryPerson[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        resolve(extractDataFromWorkbook(workbook));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Parses an ArrayBuffer directly (Backend/Server Side)
 */
export const parseBufferRoster = (buffer: ArrayBuffer): MilitaryPerson[] => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  return extractDataFromWorkbook(workbook);
};