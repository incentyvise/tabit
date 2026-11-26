import { tab as tabData, type TabWithMembers, type FriendTab, type TabWithBalance } from "data";
import { ToolError } from "./context.js";
import { displayUser } from "./format.js";

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, " ");
}

type Candidate<T> = { value: T; keys: string[]; label: string };

/**
 * Picks one candidate for a free-text reference: exact id → exact key →
 * whole-word match (e.g. "Sam" for "Sam Lee") → unique prefix → unique
 * substring. With `strict` (used by tools that write), only exact ids, exact
 * keys and whole-word matches resolve; looser hits come back as "did you
 * mean…" candidates so money never lands on a guessed person or tab.
 * Throws a ToolError listing the options when nothing or more than one thing
 * matches, so the model can ask the user instead of guessing.
 */
export function pickOne<T>(
  ref: string,
  candidates: Candidate<T>[],
  what: string,
  idOf: (v: T) => string,
  strict = false,
): T {
  const raw = ref.trim();
  const byId = candidates.find((c) => idOf(c.value) === raw);
  if (byId) return byId.value;

  const q = normalize(raw);
  const words = (k: string) => k.split(/[\s._-]+/);
  const confident: Array<(k: string) => boolean> = [(k) => k === q, (k) => words(k).includes(q)];
  const loose: Array<(k: string) => boolean> = [(k) => k.startsWith(q), (k) => k.includes(q)];
  const list = (hits: Candidate<T>[]) => hits.map((c) => ({ id: idOf(c.value), name: c.label }));
  const uniq = (hits: Candidate<T>[]) => [...new Map(hits.map((h) => [idOf(h.value), h])).values()];

  for (const test of [...confident, ...loose]) {
    const isLoose = loose.includes(test);
    const unique = uniq(candidates.filter((c) => c.keys.some(test)));
    if (unique.length === 0) continue;
    if (unique.length > 1) {
      throw new ToolError(
        `"${ref}" matches more than one ${what}. Ask the user which one they mean, then pass its id.`,
        { candidates: list(unique) },
      );
    }
    if (isLoose && strict) {
      throw new ToolError(
        `No ${what} is called exactly "${ref}". Did you mean ${unique[0]!.label}? Confirm with the user, then pass its id.`,
        { candidates: list(unique) },
      );
    }
    return unique[0]!.value;
  }
  throw new ToolError(`No ${what} matches "${ref}".`, {
    available: list(candidates.slice(0, 25)),
  });
}

export type TargetTab =
  | { kind: "group"; tabId: string; name: string; currency: string }
  | { kind: "friend"; tabId: string; name: string; currency: string; friendUserId: string };

/** Lazily-loaded view of the user's tabs and friends, cached for one tool call. */
export class Directory {
  private groups?: Promise<TabWithBalance[]>;
  private friends?: Promise<FriendTab[]>;
  private details = new Map<string, Promise<TabWithMembers | null>>();

  constructor(readonly userId: string) {}

  groupTabs(): Promise<TabWithBalance[]> {
    this.groups ??= tabData.getTabsForUser(this.userId, {
      includeDirect: false,
      includeBalance: true,
      includeLastExpenseDate: true,
      includeExpenseCount: true,
    });
    return this.groups;
  }

  friendTabs(): Promise<FriendTab[]> {
    this.friends ??= tabData.getDirectTabsForUser(this.userId);
    return this.friends;
  }

  tabDetail(tabId: string): Promise<TabWithMembers | null> {
    let p = this.details.get(tabId);
    if (!p) {
      p = tabData.getWithMembers(tabId);
      this.details.set(tabId, p);
    }
    return p;
  }

  /**
   * Resolves a tab reference: a tab id, a group tab name, or a friend (their
   * username or name, for the 1:1 tab with them).
   */
  async resolveTarget(ref: string, strict = false): Promise<TargetTab> {
    const [groups, friends] = await Promise.all([this.groupTabs(), this.friendTabs()]);
    const candidates: Candidate<TargetTab>[] = [
      ...groups.map((g) => ({
        value: { kind: "group" as const, tabId: g.id, name: g.name, currency: g.currency },
        keys: [normalize(g.name)],
        label: `${g.name} (group tab)`,
      })),
      ...friends.map((f) => {
        const name = displayUser(f.friend);
        return {
          value: {
            kind: "friend" as const,
            tabId: f.id,
            name,
            currency: f.currency,
            friendUserId: f.friend.id,
          },
          keys: [
            ...(f.friend.username ? [normalize(f.friend.username)] : []),
            ...(f.friend.name ? [normalize(f.friend.name)] : []),
          ],
          label: `${name}${f.friend.username ? ` (@${f.friend.username})` : ""} (friend)`,
        };
      }),
    ];
    return pickOne(ref, candidates, "tab or friend", (t) => t.tabId, strict);
  }

  /** Resolves a friend (username, name or friend tab id) to their 1:1 tab. */
  async resolveFriend(
    ref: string,
    strict = false,
  ): Promise<Extract<TargetTab, { kind: "friend" }>> {
    const friends = await this.friendTabs();
    const f = pickOne(
      ref,
      friends.map((f) => ({
        value: f,
        keys: [
          ...(f.friend.username ? [normalize(f.friend.username)] : []),
          ...(f.friend.name ? [normalize(f.friend.name)] : []),
        ],
        label: `${displayUser(f.friend)}${f.friend.username ? ` (@${f.friend.username})` : ""}`,
      })),
      "friend",
      (f) => f.id,
      strict,
    );
    return {
      kind: "friend",
      tabId: f.id,
      name: displayUser(f.friend),
      currency: f.currency,
      friendUserId: f.friend.id,
    };
  }

  /** Loads a tab the user belongs to, or throws. */
  async requireTab(tabId: string): Promise<TabWithMembers> {
    const t = await this.tabDetail(tabId);
    if (!t || !t.members.some((m) => m.userId === this.userId)) {
      throw new ToolError("Not found: tab not found or you are not a member");
    }
    return t;
  }
}

export type Participant = TabWithMembers["participants"][number];

export function participantName(p: Participant): string {
  return p.user ? displayUser(p.user) : p.displayName;
}

const SELF_WORDS = new Set(["me", "i", "myself", "self", "you"]);

/**
 * Resolves a person inside a tab: "me", a participant id, a user id, an
 * @username, a name, or a placeholder's display name.
 */
export function resolveParticipant(
  t: TabWithMembers,
  ref: string,
  meUserId: string,
  strict = false,
): Participant {
  const q = normalize(ref);
  if (SELF_WORDS.has(q)) {
    const me = t.participants.find((p) => p.userId === meUserId);
    if (!me) throw new ToolError("You are not a participant in this tab");
    return me;
  }
  const byUserId = t.participants.find((p) => p.userId === ref.trim());
  if (byUserId) return byUserId;
  return pickOne(
    ref,
    t.participants.map((p) => ({
      value: p,
      keys: [
        normalize(p.displayName),
        ...(p.user?.username ? [normalize(p.user.username)] : []),
        ...(p.user?.name ? [normalize(p.user.name)] : []),
      ],
      label: `${participantName(p)}${p.user?.username ? ` (@${p.user.username})` : ""}${p.kind === "placeholder" ? " (placeholder)" : ""}`,
    })),
    `person in "${t.name}"`,
    (p) => p.id,
    strict,
  );
}

/** Compact participant list for tool output (no emails). */
export function participantSummary(t: TabWithMembers, meUserId: string) {
  return t.participants.map((p) => ({
    participantId: p.id,
    name: p.userId === meUserId ? "You" : participantName(p),
    username: p.user?.username ?? null,
    isYou: p.userId === meUserId,
    isPlaceholder: p.kind === "placeholder",
  }));
}

/** Map from participant id and user id to a display name. */
export function nameIndex(t: TabWithMembers, meUserId: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of t.participants) {
    const n = p.userId === meUserId ? "You" : participantName(p);
    m.set(p.id, n);
    if (p.userId) m.set(p.userId, n);
  }
  return m;
}
