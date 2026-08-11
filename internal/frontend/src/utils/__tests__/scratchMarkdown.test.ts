import { describe, expect, it } from "vitest";
import { markdownToHtml, htmlToMarkdown } from "../scratchMarkdown";

describe("scratchMarkdown", () => {
  it("round-trips a table preserving bold text in cells", () => {
    const md = "| Name | Age |\n| ---- | --- |\n| **Bob** | 42 |\n| [Alice](https://x.dev) | 35 |";
    const html = markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>Bob</strong>");
    const back = htmlToMarkdown(html);
    expect(back).toContain("**Bob**");
    expect(back).toContain("[Alice](https://x.dev)");
  });

  it("round-trips headings at all levels without dropping content", () => {
    const md = "## Section\n\n### Subsection\n\n#### Deeper\n\nBody text";
    const html = markdownToHtml(md);
    expect(html).toContain("<h3>Subsection</h3>");
    expect(html).toContain("<h4>Deeper</h4>");
    const back = htmlToMarkdown(html);
    expect(back).toContain("### Subsection");
    expect(back).toContain("#### Deeper");
    expect(back).toContain("Body text");
  });

  it("round-trips fenced code blocks", () => {
    const md = "```ts\nconst x: number = 1;\n```";
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toContain("```ts");
    expect(back).toContain("const x: number = 1;");
  });

  it("round-trips inline code and links", () => {
    const md = "Use `npm run dev` and see [docs](https://example.com).";
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toContain("`npm run dev`");
    expect(back).toContain("[docs](https://example.com)");
  });

  it("does not emit block-level escapes for table cells", () => {
    const tipTapHtml = `<table><tbody><tr><th colspan="1" rowspan="1"><p># per session</p></th><th colspan="1" rowspan="1"><p>Tags</p></th></tr><tr><td colspan="1" rowspan="1"><p>---</p></td><td colspan="1" rowspan="1"><p>one primary (nominally)</p></td></tr></tbody></table>`;
    const back = htmlToMarkdown(tipTapHtml);
    expect(back).toContain("| # per session | Tags |");
    expect(back).toContain("| --- | one primary (nominally) |");
    expect(back).not.toMatch(/\\[#-]/);
  });

  it("stays a GFM table after round-trip", () => {
    const tipTapHtml = `<table><tbody><tr><th colspan="1" rowspan="1"><p># per session</p></th><th colspan="1" rowspan="1"><p>Tags</p></th></tr><tr><td colspan="1" rowspan="1"><p>one primary (nominally)</p></td><td colspan="1" rowspan="1"><p><strong>bold</strong></p></td></tr></tbody></table>`;
    const back = htmlToMarkdown(tipTapHtml);
    expect(back).not.toMatch(/\\[#-]/);
    const html = markdownToHtml(back);
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("preserves inline markdown and literal special chars in table cells", () => {
    const tipTapTable = `<table><tbody><tr><td><p><em>x</em> and <strong>b</strong></p></td><td><p><a href="https://x.dev">link</a></p></td></tr><tr><td><p>*literal*</p></td><td><p>_underscore_</p></td></tr></tbody></table>`;
    const back = htmlToMarkdown(tipTapTable);
    expect(back).toContain("_x_ and **b** | [link](https://x.dev)");
    expect(back).toContain("*literal* | _underscore_");
  });
});
