import { type ReactNode } from "react";
import { createLowlight, common } from "lowlight";

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
      const className = (child.properties?.className as string[] | undefined)?.join(" ") || undefined;
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
    <div className="diff-file-view">
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

export function PatchRenderer({
  patch,
  lang,
}: {
  patch: string;
  lang?: string;
}) {
  const lines = patch.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let oldLine = 0;
  let newLine = 0;

  return (
    <div className="diff-file-view">
      <table className="diff-table">
        <tbody>
          {lines.map((line, i) => {
            if (line.startsWith("---") || line.startsWith("+++")) {
              return null;
            }

            if (line.startsWith("@@")) {
              const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
              if (match) {
                oldLine = parseInt(match[1]) - 1;
                newLine = parseInt(match[3]) - 1;
              }
              return (
                <tr key={i} className="diff-line diff-line-hunk-header">
                  <td className="diff-line-num diff-line-num-empty" />
                  <td className="diff-line-num diff-line-num-empty" />
                  <td className="diff-line-content">{line}</td>
                </tr>
              );
            }

            const prefix = line.charAt(0);
            const content = line.slice(1);
            let lineClass = "diff-line-ctx";
            let oldNum = "";
            let newNum = "";

            if (prefix === "+") {
              lineClass = "diff-line-add";
              newLine++;
              newNum = String(newLine);
            } else if (prefix === "-") {
              lineClass = "diff-line-del";
              oldLine++;
              oldNum = String(oldLine);
            } else {
              oldLine++;
              newLine++;
              oldNum = String(oldLine);
              newNum = String(newLine);
            }

            return (
              <tr key={i} className={`diff-line ${lineClass}`}>
                <td className="diff-line-num">{oldNum}</td>
                <td className="diff-line-num">{newNum}</td>
                <td className="diff-line-content">
                  <span className="diff-prefix">{prefix}</span>
                  <span className="diff-text">{highlightLine(content, lang)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
