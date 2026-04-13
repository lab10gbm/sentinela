/**
 * Fonte única de verdade para campos de formulário do boletim.
 *
 * IMPORTANTE: Esta é a ÚNICA definição desta lista no projeto.
 * Todos os módulos que precisam detectar campos de formulário devem importar daqui.
 * Nunca duplique esta lista em outro arquivo.
 */
export const FORM_FIELD_NAMES = [
  'Data',
  'Horário',
  'Horario',
  'Local',
  'Endereço',
  'Endereco',
  'Palestrante',
  'Tema',
  'Período',
  'Periodo',
  'Uniforme',
  'Traje',
  'Local de Apresentação',
] as const;

export type FormFieldName = (typeof FORM_FIELD_NAMES)[number];

/**
 * Detecta qualquer campo de formulário em qualquer posição da linha.
 * Ex: "Data: 16/03; Horário: 10h" → match em "Data:" e "Horário:"
 */
export const FORM_FIELD_PATTERN = new RegExp(
  `(${FORM_FIELD_NAMES.join('|')}):`,
  'gi'
);

/**
 * Detecta se a linha COMEÇA com um campo de formulário.
 * Ex: "Data: 16/03" → match; "Texto com Data: no meio" → sem match
 */
export const FORM_FIELD_START_PATTERN = new RegExp(
  `^(${FORM_FIELD_NAMES.join('|')}):`,
  'i'
);
