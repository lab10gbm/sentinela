/**
 * tocParser.ts
 *
 * Re-exporta as funções de parsing do Sumário do boletim.
 * O código vive em bulletinParserService.ts enquanto a migração completa não ocorre.
 */
export { extractTocBlock, parseTocLines, formatTocForDisplay } from "./bulletinParserService";
export type { SummaryItem } from "./bulletinParserService";
