export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    go: "go",
    py: "python",
    rs: "rust",
    rb: "ruby",
    java: "java",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sh: "shellscript",
    bash: "shellscript",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
    c: "c",
    cpp: "cpp",
    h: "c",
  };
  return langMap[ext] || "";
}
