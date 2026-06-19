import type { ReactNode } from "react";

export function renderSnippet(snippet: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(snippet, "text/html");
  const parts: ReactNode[] = [];
  let key = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || "");
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName.toLowerCase() === "mark") {
        parts.push(<mark key={key++}>{el.textContent || ""}</mark>);
      }
    }
  }
  return parts;
}
