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
});
