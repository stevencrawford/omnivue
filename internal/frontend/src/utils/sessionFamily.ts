import type { Session } from "../hooks/types";

// A "session family" is a root session (no parentId) plus every descendant it
// spawned — sub-agents, nested sub-agents, research sessions, etc. The sidebar
// shows only the root; the main-view header renders a selector over the whole
// family so a sub-agent is reached in place rather than as its own tree row.

export interface SessionFamilyMember {
  session: Session;
  /** "Main" for the root, otherwise the sub-agent name or session title. */
  label: string;
  isMain: boolean;
}

const MAX_FAMILY_DEPTH = 64;

/** Resolve a session's family root by walking `parentId` up, guarding cycles. */
export function resolveFamilyRoot(sessions: Session[], id: string | null): string | null {
  if (!id) return null;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  let current = byId.get(id);
  if (!current) return id;
  const seen = new Set<string>([current.id]);
  let depth = 0;
  while (current.parentId && depth < MAX_FAMILY_DEPTH) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    depth++;
  }
  return current.id;
}

function memberLabel(session: Session, subIndex: number): string {
  const name = session.subAgent?.trim();
  if (name) return name;
  const title = session.title?.trim();
  if (title) return title;
  return `Sub-agent ${subIndex}`;
}

/**
 * Build the display order for a family: the root ("Main") first, then every
 * descendant flattened in creation order (nested sub-agents stay grouped under
 * their branch but still render as a flat list).
 */
export function buildSessionFamily(sessions: Session[], rootId: string): SessionFamilyMember[] {
  const root = sessions.find((s) => s.id === rootId);
  if (!root) return [];

  const childMap = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!s.parentId) continue;
    const list = childMap.get(s.parentId) ?? [];
    list.push(s);
    childMap.set(s.parentId, list);
  }
  for (const list of childMap.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  const members: SessionFamilyMember[] = [];
  let subIndex = 0;
  const walk = (session: Session, isMain: boolean, depth: number) => {
    if (depth > MAX_FAMILY_DEPTH) return;
    members.push({
      session,
      label: isMain ? "Main" : memberLabel(session, ++subIndex),
      isMain,
    });
    for (const child of childMap.get(session.id) ?? []) walk(child, false, depth + 1);
  };
  walk(root, true, 0);
  return members;
}

/** The family for the active session, or `[]` when unfound / has no sub-agents. */
export function activeSessionFamily(
  sessions: Session[],
  activeId: string | null,
): SessionFamilyMember[] {
  const rootId = resolveFamilyRoot(sessions, activeId);
  if (!rootId) return [];
  return buildSessionFamily(sessions, rootId);
}
