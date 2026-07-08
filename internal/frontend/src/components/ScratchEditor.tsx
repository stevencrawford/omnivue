import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { marked } from "marked";
import TurndownService from "turndown";
import Editor from "@monaco-editor/react";
import { Copy, Check, Lock, Minimize2, Maximize2, X } from "lucide-react";
import { getScratchFile, updateScratchFile } from "../hooks/useApi";
import { useCopy } from "../hooks/useCopy";

marked.use({ gfm: true, breaks: true });
const lowlight = createLowlight(common);

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

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
        rowCells.push(cell.textContent?.trim() || "");
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

const monacoEditorOptions = (readOnly: boolean) =>
  ({
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: "on" as const,
    wordWrap: "on" as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    renderWhitespace: "selection" as const,
    padding: { top: 8 },
    readOnly,
  }) as const;

const DEBOUNCE_MS = 800;

function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.7);
}

function extractFirstH1(md: string): string | null {
  const match = md.match(/^# (.+)$/m);
  return match ? match[1].trim() : null;
}

interface ScratchEditorProps {
  sessionId: string;
  fileId: string;
  onDelete?: () => void;
}

export function ScratchEditor({ sessionId, fileId, onDelete }: ScratchEditorProps) {
  const [sourceContent, setSourceContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [editorMode, setEditorMode] = useState<"wysiwyg" | "source">("wysiwyg");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Record<string, boolean>>({});
  const [isReadOnly, setIsReadOnly] = useState(false);
  const { copied, copy } = useCopy(2000);
  const originalTitleRef = useRef("Untitled");
  const lastSavedMarkdownRef = useRef("");
  const isUpdatingRef = useRef(false);

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      const f = await getScratchFile(sessionId, fileId);
      setSourceContent(f.content);
      originalTitleRef.current = f.title;
      lastSavedMarkdownRef.current = f.content;
      setIsReadOnly(f.mode === "readonly");
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [sessionId, fileId]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        codeBlock: false,
        link: false,
      }),
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: "",
    editable: !isReadOnly,
    immediatelyRender: false,
    onUpdate: () => {
      if (!isUpdatingRef.current && editor) {
        const md = turndownService.turndown(editor.getHTML());
        setSourceContent(md);
      }
    },
    editorProps: {
      attributes: {
        class: "h-full outline-none",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const updateFormats = () => {
      setActiveFormats({
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        strike: editor.isActive("strike"),
        code: editor.isActive("code"),
        link: editor.isActive("link"),
        bulletList: editor.isActive("bulletList"),
        orderedList: editor.isActive("orderedList"),
        heading1: editor.isActive("heading", { level: 1 }),
        heading2: editor.isActive("heading", { level: 2 }),
        blockquote: editor.isActive("blockquote"),
        codeBlock: editor.isActive("codeBlock"),
      });
    };
    editor.on("selectionUpdate", updateFormats);
    editor.on("transaction", updateFormats);
    updateFormats();
    return () => {
      editor.off("selectionUpdate", updateFormats);
      editor.off("transaction", updateFormats);
    };
  }, [editor]);

  // Load content into editor when file changes
  useEffect(() => {
    if (!editor || loading) return;
    isUpdatingRef.current = true;
    editor.setEditable(!isReadOnly);
    const html = marked.parse(sourceContent) as string;
    editor.commands.setContent(html);
    isUpdatingRef.current = false;
  }, [fileId, editor, loading, isReadOnly]);

  // Auto-save WYSIWYG mode
  useEffect(() => {
    if (!fileId || !editor || editorMode !== "wysiwyg" || isReadOnly) return;
    const md = turndownService.turndown(editor.getHTML());
    if (md === lastSavedMarkdownRef.current) return;
    const timer = setTimeout(() => {
      doSave(fileId, md);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [editor?.getHTML(), fileId, editorMode, isReadOnly]);

  // Auto-save source mode
  useEffect(() => {
    if (!fileId || editorMode !== "source" || isReadOnly) return;
    if (sourceContent === lastSavedMarkdownRef.current) return;
    const timer = setTimeout(() => {
      doSave(fileId, sourceContent);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sourceContent, fileId, editorMode, isReadOnly]);

  const doSave = useCallback(
    async (fid: string, md: string) => {
      setSaveStatus("saving");
      const title =
        originalTitleRef.current === "Untitled"
          ? extractFirstH1(md) || "Untitled"
          : originalTitleRef.current;
      try {
        await updateScratchFile(sessionId, fid, title, md);
        setSaveStatus("saved");
        lastSavedMarkdownRef.current = md;
      } catch {
        setSaveStatus("error");
      }
    },
    [sessionId],
  );

  const handleClose = () => {
    onDelete?.();
  };

  const handleToolbarAction = (action: string) => {
    if (!editor) return;
    switch (action) {
      case "bold":
        editor.chain().focus().toggleBold().run();
        break;
      case "italic":
        editor.chain().focus().toggleItalic().run();
        break;
      case "strike":
        editor.chain().focus().toggleStrike().run();
        break;
      case "code":
        editor.chain().focus().toggleCode().run();
        break;
      case "bullet":
        editor.chain().focus().toggleBulletList().run();
        break;
      case "ordered":
        editor.chain().focus().toggleOrderedList().run();
        break;
      case "h1":
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case "h2":
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case "quote":
        editor.chain().focus().toggleBlockquote().run();
        break;
      case "codeblock":
        editor.chain().focus().toggleCodeBlock().run();
        break;
      case "table":
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
    }
  };

  const handleSourceChange = (val: string | undefined) => {
    setSourceContent(val ?? "");
  };

  const toggleMode = () => {
    if (editorMode === "wysiwyg" && editor) {
      const md = turndownService.turndown(editor.getHTML());
      setSourceContent(md);
      setEditorMode("source");
    } else {
      if (editor) {
        isUpdatingRef.current = true;
        const html = marked.parse(sourceContent) as string;
        editor.commands.setContent(html);
        isUpdatingRef.current = false;
      }
      setEditorMode("wysiwyg");
    }
  };

  const currentContent = editorMode === "source" ? sourceContent : editor?.getText() || "";
  const stats = useMemo(() => {
    const chars = currentContent.length;
    const words = countWords(currentContent);
    const lines = currentContent.split("\n").length;
    const tokens = estimateTokens(currentContent);
    return { chars, words, lines, tokens };
  }, [currentContent]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-xs text-ov-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col flex-1 overflow-hidden ${isFullscreen ? "fixed inset-0 z-50 bg-ov-bg" : ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-ov-border shrink-0 bg-ov-bg-secondary/50">
        {isReadOnly ? (
          <div className="flex items-center gap-1.5 text-xs text-ov-text-secondary">
            <Lock size={12} />
            <span>Read-only</span>
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            <ToolBtn
              icon="bold"
              active={activeFormats.bold}
              onClick={() => handleToolbarAction("bold")}
              title="Bold"
            />
            <ToolBtn
              icon="italic"
              active={activeFormats.italic}
              onClick={() => handleToolbarAction("italic")}
              title="Italic"
            />
            <ToolBtn
              icon="strikethrough"
              active={activeFormats.strike}
              onClick={() => handleToolbarAction("strike")}
              title="Strikethrough"
            />
            <ToolBtn
              icon="code"
              active={activeFormats.code}
              onClick={() => handleToolbarAction("code")}
              title="Code"
            />
            <div className="w-px h-4 bg-ov-border mx-1" />
            <ToolBtn
              icon="bullet-list"
              active={activeFormats.bulletList}
              onClick={() => handleToolbarAction("bullet")}
              title="Bullet List"
            />
            <ToolBtn
              icon="ordered-list"
              active={activeFormats.orderedList}
              onClick={() => handleToolbarAction("ordered")}
              title="Ordered List"
            />
            <div className="w-px h-4 bg-ov-border mx-1" />
            <ToolBtn
              icon="h1"
              active={activeFormats.heading1}
              onClick={() => handleToolbarAction("h1")}
              title="Heading 1"
            />
            <ToolBtn
              icon="h2"
              active={activeFormats.heading2}
              onClick={() => handleToolbarAction("h2")}
              title="Heading 2"
            />
            <ToolBtn
              icon="quote"
              active={activeFormats.blockquote}
              onClick={() => handleToolbarAction("quote")}
              title="Quote"
            />
            <div className="w-px h-4 bg-ov-border mx-1" />
            <ToolBtn
              icon="table"
              onClick={() => handleToolbarAction("table")}
              title="Insert Table"
            />
            <ToolBtn
              icon="code-block"
              active={activeFormats.codeBlock}
              onClick={() => handleToolbarAction("codeblock")}
              title="Code Block"
            />
          </div>
        )}
        <div className="flex items-center gap-1">
          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={toggleMode}
                className={`text-[11px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  editorMode === "wysiwyg"
                    ? "bg-accent-muted text-accent"
                    : "text-ov-text-secondary hover:text-ov-text"
                }`}
                title="WYSIWYG"
              >
                Visual
              </button>
              <button
                type="button"
                onClick={toggleMode}
                className={`text-[11px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  editorMode === "source"
                    ? "bg-accent-muted text-accent"
                    : "text-ov-text-secondary hover:text-ov-text"
                }`}
                title="Source"
              >
                Code
              </button>
              <div className="w-px h-4 bg-ov-border mx-1" />
            </>
          )}
          <button
            type="button"
            onClick={() => copy(sourceContent)}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5 rounded"
            title="Copy"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5 rounded"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5 rounded"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-hidden">
        {editorMode === "source" ? (
          <Editor
            height="100%"
            defaultLanguage="markdown"
            theme="vs-dark"
            value={sourceContent}
            onChange={handleSourceChange}
            options={monacoEditorOptions(isReadOnly)}
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 py-2">
            <EditorContent editor={editor} />
          </div>
        )}
      </div>

      {/* Footer */}
      {!isReadOnly && (
        <div className="shrink-0 flex items-center justify-between px-3 py-1 border-t border-ov-border text-[11px] text-ov-text-secondary">
          <div className="flex items-center gap-3">
            <span>
              {stats.words.toLocaleString()} word{stats.words !== 1 ? "s" : ""}
            </span>
            <span>
              {stats.lines.toLocaleString()} line{stats.lines !== 1 ? "s" : ""}
            </span>
            <span>
              ~{stats.tokens.toLocaleString()} token{stats.tokens !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {saveStatus === "saved" && <span className="text-emerald-500">Saved</span>}
            {saveStatus === "saving" && <span className="text-amber-500">Saving...</span>}
            {saveStatus === "error" && <span className="text-red-500">Save failed</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  icon,
  active,
  onClick,
  title,
}: {
  icon: string;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  const paths: Record<string, string> = {
    bold: "M4 2h4.5a3.5 3.5 0 0 1 2.39 6.04A3.5 3.5 0 0 1 9 14H4V2Zm2 5h2.5a1.5 1.5 0 0 0 0-3H6v3Zm0 5h3a1.5 1.5 0 0 0 0-3H6v3Z",
    italic:
      "M6 2.75A.75.75 0 0 1 6.75 2h5.5a.75.75 0 0 1 0 1.5h-2.04l-2.72 9H9.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5h2.04l2.72-9H6.75A.75.75 0 0 1 6 2.75Z",
    strikethrough:
      "M5.5 4.5a3 3 0 0 1 3-3h3.5a.75.75 0 0 1 0 1.5H8.5a1.5 1.5 0 0 0 0 3h1.5a3 3 0 0 1 0 6H6.5a.75.75 0 0 1 0-1.5h3.5a1.5 1.5 0 0 0 0-3H8.5a3 3 0 0 1-3-3ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z",
    code: "M5.22 3.97a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 0 1-1.06-1.06L8.44 8 5.22 4.78a.75.75 0 0 1 0-1.06Zm5.56 0a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 0 1-1.06-1.06L14.44 8l-3.22-3.22a.75.75 0 0 1 0-1.06Z",
    "bullet-list":
      "M3 4.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-.75a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75ZM3 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-.75a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75ZM3 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3.75-.75a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Z",
    "ordered-list":
      "M2.003 2.5a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 .5.5v.81l.436-.29a.5.5 0 1 1 .528.85l-.964.642V6.5a.5.5 0 0 1-1 0V2.5ZM5 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 3.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 8.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 13.25ZM2.753 10.5a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 .5.5v.229c0 .179-.066.35-.187.478l-.955 1.006a.5.5 0 0 0-.142.287H4.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5v-.229a1.25 1.25 0 0 1 .468-.977l.593-.625a.246.246 0 0 0 .092-.19v-.004l-.003-.005h-.397a.5.5 0 0 1-.5-.5Z",
    h1: "M2 2.75A.75.75 0 0 1 2.75 2h.5a.75.75 0 0 1 .75.75v4.5h7v-4.5a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V8.75h-7v4.5a.75.75 0 0 1-.75.75h-.5A.75.75 0 0 1 2 13.25V2.75Z",
    h2: "M2 2.75A.75.75 0 0 1 2.75 2h.5a.75.75 0 0 1 .75.75v4.5h7v-4.5a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V8.75h-7v4.5a.75.75 0 0 1-.75.75h-.5A.75.75 0 0 1 2 13.25V2.75Zm13.54 2.49a.75.75 0 0 1 .21.51v6.5h.75a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5h1.5V6.94l-.78.26a.75.75 0 0 1-.44-1.44l1.5-.5a.75.75 0 0 1 .76.02Z",
    quote:
      "M1.75 2.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.5a.75.75 0 0 1-.75-.75ZM4 12.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Z",
    table:
      "M1 3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3Zm2 0v3h3V3H3Zm4 0v3h4V3H7Zm6 0H9v3h4V3Zm-6 5v4h4V8H7Zm-1 4V8H3v4h3Zm1 1v3h4v-3H7Zm-1 3v-3H3v3h3Zm6-3h-1v3h2v-2a1 1 0 0 0-1-1Z",
    "code-block":
      "M2.22 2.22a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 0 1-1.06-1.06L5.56 6.5 2.22 3.28a.75.75 0 0 1 0-1.06Zm6.28 8.78a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75Z",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded cursor-pointer transition-colors ${
        active
          ? "bg-accent-muted text-accent"
          : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
      }`}
    >
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d={paths[icon] || ""} />
      </svg>
    </button>
  );
}
