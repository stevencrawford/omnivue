import { useEffect, useRef } from "react";
import type { Message } from "../hooks/types";

function highlightDomTextNodes(root: Element, q: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = (node as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.tagName === "MARK" || p.tagName === "SCRIPT" || p.tagName === "STYLE")
        return NodeFilter.FILTER_REJECT;
      if (p.closest("pre")) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const toWrap: { node: Text; parts: { text: string; highlight: boolean }[] }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || "";
    const lower = text.toLowerCase();
    if (!lower.includes(q)) continue;
    const parts: { text: string; highlight: boolean }[] = [];
    let last = 0;
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      if (idx > last) parts.push({ text: text.slice(last, idx), highlight: false });
      parts.push({ text: text.slice(idx, idx + q.length), highlight: true });
      last = idx + q.length;
      idx = lower.indexOf(q, last);
    }
    if (last < text.length) parts.push({ text: text.slice(last), highlight: false });
    toWrap.push({ node, parts });
  }
  for (const { node, parts } of toWrap) {
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (p.highlight) {
        const mark = document.createElement("mark");
        mark.className = "search-highlight";
        mark.setAttribute("data-shl", "1");
        mark.textContent = p.text;
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(p.text));
      }
    }
    node.parentNode?.replaceChild(frag, node);
  }
}

// Only the <mark> search-query wrapping lives here now: message/step/tool
// jumps moved to useConversationJumps. The first-match scroll uses
// scrollToRendered and is skipped while a focus jump is pending so the two
// never double-scroll.
export function useSearchHighlight(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  searchHighlightQuery: string | undefined,
  messages: Message[],
  scrollToRendered: (target: number | string | HTMLElement, mode?: "center" | "top") => boolean,
  hasFocusJump: boolean,
) {
  const searchHighlightKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    container.querySelectorAll("mark[data-shl]").forEach((el) => {
      const parent = el.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent?.normalize();
    });

    container.querySelectorAll(".sess-message-highlight").forEach((el) => {
      el.classList.remove("sess-message-highlight");
    });

    if (!searchHighlightQuery || messages.length === 0) {
      searchHighlightKeyRef.current = undefined;
      return;
    }

    const q = searchHighlightQuery.toLowerCase();
    const msgElements = container.querySelectorAll("[data-message-index]");
    let firstMatch: Element | null = null;
    const fadeTimers: ReturnType<typeof setTimeout>[] = [];

    for (const el of msgElements) {
      const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
      const msg = messages[idx];
      if (!msg) continue;

      const contentToSearch = [
        msg.content || "",
        ...(msg.toolCalls ?? []).flatMap((tc) => [tc.name || "", tc.input || "", tc.output || ""]),
      ]
        .join(" ")
        .toLowerCase();

      if (contentToSearch.includes(q)) {
        el.classList.add("sess-message-highlight");
        fadeTimers.push(setTimeout(() => el.classList.remove("sess-message-highlight"), 2000));
        highlightDomTextNodes(el, q);
        if (!firstMatch) firstMatch = el;
      }
    }

    if (firstMatch && searchHighlightQuery !== searchHighlightKeyRef.current) {
      // A focus jump owns the scroll; let it land on the jump target instead.
      if (!hasFocusJump) {
        const firstIdx = parseInt(firstMatch.getAttribute("data-message-index") || "", 10);
        if (!Number.isNaN(firstIdx)) scrollToRendered(firstIdx, "center");
      }
      searchHighlightKeyRef.current = searchHighlightQuery;
    }

    return () => {
      for (const t of fadeTimers) clearTimeout(t);
    };
  }, [searchHighlightQuery, messages, scrollToRendered, hasFocusJump]);
}
