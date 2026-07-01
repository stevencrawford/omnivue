import { useCallback, useEffect, useRef } from "react";
import type { Message } from "../hooks/useApi";

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

export function useSearchHighlight(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  searchHighlightQuery: string | undefined,
  focusStepIndex: number | undefined,
  focusMessageIndex: number | undefined,
  messagesWithoutReminders: Message[],
) {
  const searchHighlightKeyRef = useRef<string | undefined>(undefined);
  const consumedFocusIdx = useRef<number | undefined>(undefined);

  const scrollToMessageEl = useCallback(
    (el: Element) => {
      const container = scrollRef.current;
      if (!container) return;
      try {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        container.scrollTop +=
          rect.top - containerRect.top - container.clientHeight / 2 + rect.height / 2;
      } catch {
        /* scrollTop assignment can throw in restricted contexts */
      }
    },
    [scrollRef],
  );

  useEffect(() => {
    if (focusStepIndex === undefined || !scrollRef.current) return;
    const container = scrollRef.current;
    const msgElements = container.querySelectorAll("[data-message-index]");
    for (const el of msgElements) {
      const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
      if (idx === focusStepIndex) {
        scrollToMessageEl(el);
        el.classList.add("sess-message-highlight");
        const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [focusStepIndex, messagesWithoutReminders.length, scrollToMessageEl, scrollRef]);

  useEffect(() => {
    if (focusMessageIndex === undefined) return;
    if (consumedFocusIdx.current === focusMessageIndex) return;
    if (!scrollRef.current || messagesWithoutReminders.length === 0) return;
    const el = scrollRef.current.querySelector(`[data-message-index="${focusMessageIndex}"]`);
    if (el) {
      scrollToMessageEl(el);
      el.classList.add("sess-message-highlight");
      consumedFocusIdx.current = focusMessageIndex;
      const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
      return () => clearTimeout(timer);
    }
  }, [focusMessageIndex, messagesWithoutReminders.length, scrollToMessageEl, scrollRef]);

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

    if (!searchHighlightQuery || messagesWithoutReminders.length === 0) {
      searchHighlightKeyRef.current = undefined;
      return;
    }

    const q = searchHighlightQuery.toLowerCase();
    const msgElements = container.querySelectorAll("[data-message-index]");
    let firstMatch: Element | null = null;
    const fadeTimers: ReturnType<typeof setTimeout>[] = [];

    for (const el of msgElements) {
      const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
      const msg = messagesWithoutReminders[idx];
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
      scrollToMessageEl(firstMatch);
      searchHighlightKeyRef.current = searchHighlightQuery;
    }

    return () => {
      for (const t of fadeTimers) clearTimeout(t);
    };
  }, [searchHighlightQuery, messagesWithoutReminders.length, scrollToMessageEl, scrollRef]);
}
