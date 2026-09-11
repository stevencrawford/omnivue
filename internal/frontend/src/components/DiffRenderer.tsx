import { type ReactNode } from "react";
import { createLowlight, common } from "lowlight";
import { renderHunk, type DiffHunk } from "../utils/diff";

const lowlight = createLowlight(common);

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function hastChildrenToReact(children: HastNode[] | undefined): ReactNode[] {
  return (children ?? []).map((child, i) => {
    if (child.type === "text") return child.value as ReactNode;
    if (child.type === "element" && child.tagName) {
      const className =
        (child.properties?.className as string[] | undefined)?.join(" ") || undefined;
      return (
        <span key={i} className={className}>
          {hastChildrenToReact(child.children)}
        </span>
      );
    }
    if (child.type === "root") {
      return <span key={i}>{hastChildrenToReact(child.children)}</span>;
    }
    return null;
  });
}

function highlightLine(line: string, lang?: string): ReactNode {
  if (!lang) return line;
  try {
    const tree = lowlight.highlight(lang, line);
    const root = tree as HastNode;
    return <>{hastChildrenToReact(root.children)}</>;
  } catch {
    return line;
  }
}

export function FileRenderer({
  content,
  lang,
  startLine = 1,
}: {
  content: string;
  lang?: string;
  startLine?: number;
}) {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return (
    <div className="diff-file-view max-w-full overflow-x-auto min-w-0">
      <table className="diff-table">
        <tbody>
          {lines.map((line, i) => {
            const lineNum = startLine + i;
            return (
              <tr key={lineNum} className="diff-line diff-line-ctx">
                <td className="diff-line-num">{lineNum}</td>
                <td className="diff-line-content">
                  <span className="diff-text">{highlightLine(line, lang)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HunkRenderer({ hunk, lang }: { hunk: DiffHunk; lang?: string }) {
  const rows = renderHunk(hunk);

  return (
    <div className="diff-file-view max-w-full overflow-x-auto min-w-0">
      <table className="diff-table">
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "header") {
              return (
                <tr key={i} className="diff-line diff-line-hunk-header">
                  <td className="diff-line-num diff-line-num-empty" />
                  <td className="diff-line-num diff-line-num-empty" />
                  <td className="diff-line-content">{row.text}</td>
                </tr>
              );
            }

            const lineClass =
              row.kind === "add"
                ? "diff-line-add"
                : row.kind === "del"
                  ? "diff-line-del"
                  : "diff-line-ctx";

            return (
              <tr key={i} className={`diff-line ${lineClass}`}>
                <td className="diff-line-num">{row.oldNum}</td>
                <td className="diff-line-num">{row.newNum}</td>
                <td className="diff-line-content">
                  <span className="diff-prefix">{row.prefix}</span>
                  <span className="diff-text">{highlightLine(row.text, lang)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
