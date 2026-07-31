import { marked } from "marked";
import TurndownService from "turndown";

marked.use({ gfm: true, breaks: true });

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Serialize tables to GFM while preserving inline formatting (bold, links,
// inline code) inside cells. The default turndown table handling flattens
// cells to plain text; running each cell through turndown keeps the markup.
turndownService.addRule("table", {
  filter: "table",
  replacement: function (_content, node) {
    if (!node) return _content;
    const table = node as HTMLElement;
    const rows = table.querySelectorAll("tr");
    if (rows.length === 0) return _content;
    const lines: string[][] = [];
    let maxCols = 0;
    for (const row of rows) {
      const cells = row.querySelectorAll("th, td");
      const rowCells: string[] = [];
      for (const cell of cells) {
        rowCells.push(turndownService.turndown(cell.outerHTML).trim());
      }
      maxCols = Math.max(maxCols, rowCells.length);
      lines.push(rowCells);
    }
    if (lines.length === 0) return _content;
    const headerRow = lines[0];
    const separator = Array(maxCols).fill("---").join(" | ");
    const resultLines: string[] = [headerRow.join(" | "), separator];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      while (row.length < maxCols) row.push("");
      resultLines.push(row.join(" | "));
    }
    return "\n" + resultLines.join("\n") + "\n";
  },
});

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string;
}

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}
