/**
 * MCP Tools for Nestr
 * Defines all available tools and their handlers
 */

import { z } from "zod";
import { NestrApiError, type NestrClient, type Nest, type ToolError, type ErrorCode } from "../api/client.js";
import { appResources } from "../apps/index.js";

// MCP Apps UI metadata for tools that can render in the completable list app.
// IMPORTANT: Only use for completable items (tasks, projects, todos, inbox items).
// Do NOT use for structural nests like roles, circles, metrics, policies, etc.
const completableListUi = { ui: { resourceUri: appResources.completableList.uri } };

// Sources for the completable list app - tells the UI which reorder API to use
type CompletableSource = "inbox" | "daily-plan" | "children" | "projects" | "search";

// Wrap a compacted response with title and source for the completable list app
export function completableResponse(
  data: unknown,
  source: CompletableSource,
  title: string,
): { title: string; source: CompletableSource; items: unknown[] } {
  // Extract items array from different response shapes
  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown[] }).data)) {
    items = (data as { data: unknown[] }).data;
  } else {
    items = [];
  }
  return { title, source, items };
}

// Fields to keep for compact list responses (reduces token usage)
const COMPACT_FIELDS = {
  // Common fields for all nests (includes fields needed by the completable list app)
  base: ["_id", "title", "purpose", "completed", "labels", "path", "parentId", "ancestors", "description", "due", "hints"],
  // Additional fields for roles
  role: ["accountabilities", "domains"],
  // Additional fields for users
  user: ["_id", "username", "profile"],
  // Additional fields for labels
  label: ["_id", "title"],
};

// Strip verbose fields from API responses for list operations
export function compactResponse<T>(
  data: T[] | { status: string; meta?: unknown; data: T[] } | T,
  type: "nest" | "role" | "user" | "label" = "nest"
): Partial<T>[] | { status: string; meta?: unknown; data: Partial<T>[] } | T {
  // Handle wrapped response: { status, meta, data: [...] }
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const wrapped = data as { status: string; meta?: unknown; data: T[] };
    return {
      ...wrapped,
      data: compactResponse(wrapped.data, type) as Partial<T>[],
    };
  }

  // Guard: if not an array, return as-is
  if (!Array.isArray(data)) {
    return data;
  }

  const allowedFields = new Set([
    ...COMPACT_FIELDS.base,
    ...(type === "role" ? COMPACT_FIELDS.role : []),
    ...(type === "user" ? COMPACT_FIELDS.user : []),
    ...(type === "label" ? COMPACT_FIELDS.label : []),
  ]);

  return data.map((item) => {
    const compact: Partial<T> = {};
    for (const key of Object.keys(item as object)) {
      if (allowedFields.has(key)) {
        (compact as Record<string, unknown>)[key] = (item as Record<string, unknown>)[key];
      }
    }
    return compact;
  });
}

// URL-to-tool mapping for hint enrichment.
// The Nestr API returns hints with relative URLs (e.g., "/nests/abc123/children?search=...").
// This maps those URL patterns to MCP tool calls so models can act on hints directly.
// Note: patterns are tried in order — more specific patterns must come before catch-alls.
const HINT_URL_PATTERNS: Array<{
  pattern: RegExp;
  tool: string;
  params: (match: RegExpMatchArray, searchParams: URLSearchParams, workspaceId?: string) => Record<string, string>;
}> = [
  // /nests/{id}/children?search=... → nestr_search with in:{id} scoped query
  {
    pattern: /^\/nests\/([^/]+)\/children$/,
    tool: "nestr_search",
    params: (m, sp, workspaceId) => {
      const search = sp.get("search") || "";
      const result: Record<string, string> = { query: `in:${m[1]} ${search}`.trim() };
      if (workspaceId) result.workspaceId = workspaceId;
      return result;
    },
  },
  // /nests/{id}/posts → nestr_get_comments
  { pattern: /^\/nests\/([^/]+)\/posts$/, tool: "nestr_get_comments", params: (m) => ({ nestId: m[1] }) },
  // /nests/{id}/tensions → nestr_list_tensions
  { pattern: /^\/nests\/([^/]+)\/tensions$/, tool: "nestr_list_tensions", params: (m) => ({ nestId: m[1] }) },
  // /nests/{id} → nestr_get_nest (must be last — catches all /nests/{id} patterns)
  { pattern: /^\/nests\/([^/]+)$/, tool: "nestr_get_nest", params: (m) => ({ nestId: m[1] }) },
];

interface Hint {
  type: string;
  label: string;
  severity: string;
  count?: number;
  url?: string;
  lastPost?: string;
  readAt?: string;
  toolCall?: { tool: string; params: Record<string, string> };
}

// Enrich hints with tool call parameters so models can act on hints directly.
// Extracts workspaceId from nest ancestors (last element) for search-based hints.
export function enrichHints<T>(data: T): T {
  if (!data || typeof data !== "object") return data;

  // Handle arrays (e.g., from getNestChildren)
  if (Array.isArray(data)) {
    return data.map((item) => enrichHints(item)) as T;
  }

  // Handle wrapped responses { data: [...] }
  if ("data" in data && Array.isArray((data as Record<string, unknown>).data)) {
    return { ...data, data: enrichHints((data as Record<string, unknown>).data) } as T;
  }

  // Enrich hints on this nest
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.hints)) {
    // Extract workspaceId from ancestors (last element is always the workspace)
    const ancestors = record.ancestors as string[] | undefined;
    const workspaceId = ancestors?.length ? ancestors[ancestors.length - 1] : undefined;

    record.hints = (record.hints as Hint[]).map((hint) => {
      if (!hint.url) return hint;
      // Parse URL and query params — strip absolute URL prefix if present
      let rawUrl = hint.url;
      const apiPrefixMatch = rawUrl.match(/^https?:\/\/[^/]+\/api(\/.*)/);
      if (apiPrefixMatch) rawUrl = apiPrefixMatch[1];
      const [path, queryString] = rawUrl.split("?");
      const searchParams = new URLSearchParams(queryString || "");
      for (const { pattern, tool, params } of HINT_URL_PATTERNS) {
        const match = path.match(pattern);
        if (match) {
          return { ...hint, toolCall: { tool, params: params(match, searchParams, workspaceId) } };
        }
      }
      // Log unrecognized hint URLs so we can add mappings when the API adds new patterns
      console.error(`[nestr-mcp] Unrecognized hint URL pattern: "${hint.url}" (hint type: ${hint.type})`);
      return hint;
    });
  }

  return data;
}

// Coerce JSON-stringified arrays/objects before Zod validation.
// Some MCP clients send array/object params as JSON strings (e.g., "[\"project\"]" instead of ["project"]).
const coerceFromJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  }, schema) as z.ZodEffects<T, z.output<T>, unknown>;

// Tool input schemas using Zod
export const schemas = {
  listWorkspaces: z.object({
    search: z.string().optional().describe("Search query to filter workspaces"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number (1-indexed) for pagination"),
  }),

  getWorkspace: z.object({
    workspaceId: z.string().describe("Workspace ID"),
  }),

  createWorkspace: z.object({
    title: z.string().describe("Workspace name"),
    purpose: z.string().optional().describe("Workspace purpose — the aspirational future state of the organization. Defines the north star that all circles and roles serve."),
    type: z.enum(['personal', 'collaborative']).optional().describe("'personal' for individual use (free forever), 'collaborative' for team use (free trial, then paid). Defaults to 'collaborative'."),
    governance: z.enum(['holacracy', 'sociocracy', 'roles_circles']).optional().describe("Self-organization model. Defaults to 'roles_circles' (generic role-based)."),
    plan: z.enum(['starter', 'pro']).optional().describe("Subscription plan for collaborative workspaces. Defaults to 'pro' (17-day trial)."),
    apps: coerceFromJson(z.array(z.enum(['okr', 'feedback', 'insights']))).optional().describe("Apps to enable (e.g., ['okr', 'feedback']). 'insights' requires pro plan."),
    layout: z.enum(['board', 'list']).optional().describe("Layout style for personal workspaces. 'board' creates kanban columns (Todo, Doing, Done)."),


  }),

  search: z.object({
    workspaceId: z.string().describe("Workspace ID to search in"),
    query: z.string().describe("Search query"),
    limit: z.number().optional().describe("Max results per page. Omit on first call to see meta.total count."),
    page: z.number().optional().describe("Page number (1-indexed) for pagination"),
    _listTitle: z.string().optional().describe("Short descriptive title for the list UI (e.g., \"Marketing projects\", \"Overdue tasks\"). Omit for default."),
  }),

  getNest: z.object({
    nestId: z.string().describe("Nest ID. Supports comma-separated IDs to fetch multiple nests in one call (e.g., 'id1,id2,id3') — returns an array instead of a single object. Keep total URL under 2000 chars to avoid HTTP limits."),
    fieldsMetaData: z.boolean().optional().describe("Set to true to include field schema metadata (e.g., available options for project.status)"),
    hints: z.boolean().optional().describe("Include contextual hints on each nest (default: true). Hints surface actionable signals like unassigned roles, stale projects, or unread comments. Set to false for bulk lookups where you only need structural data, not contextual guidance."),
  }),

  getNestChildren: z.object({
    nestId: z.string().describe("Parent nest ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
    hints: z.boolean().optional().describe("Include contextual hints on each child nest (default: true). Set to false for large result sets or bulk operations where contextual signals aren't needed."),
    _listTitle: z.string().optional().describe("Short descriptive title for the list UI (e.g., \"Tasks for Website Redesign\"). Omit for default."),
  }),

  createNest: z.object({
    parentId: z.string().describe("Parent nest ID (workspace, circle, or project)"),
    title: z.string().describe("Title of the new nest (plain text, HTML stripped)"),
    description: z.string().optional().describe("The primary content field — use for project details, task context, acceptance criteria, Definition of Done, and any detailed information. Supports Markdown and HTML."),
    purpose: z.string().optional().describe("ONLY for workspaces, circles, and roles — a short aspirational statement of the future state this entity serves. Do NOT put project details, task context, or general information here; use description instead. Supports HTML."),
    labels: coerceFromJson(z.array(z.string())).optional().describe("Label IDs to apply"),
    users: coerceFromJson(z.array(z.string())).optional().describe("User IDs to assign (required for tasks/projects to associate with a person)"),
    accountabilities: coerceFromJson(z.array(z.string())).optional().describe("Accountability titles for roles/circles. Only used when labels include 'role' or 'circle'. Each string becomes an accountability child nest."),
    domains: coerceFromJson(z.array(z.string())).optional().describe("Domain titles for roles/circles. Only used when labels include 'role' or 'circle'. Each string becomes a domain child nest."),
    workspaceId: z.string().optional().describe("Workspace ID. Required when creating roles/circles with accountabilities or domains (used to route to the self-organization API)."),
  }),

  updateNest: z.object({
    nestId: z.string().describe("Nest ID to update"),
    title: z.string().optional().describe("New title (plain text, HTML stripped)"),
    description: z.string().optional().describe("The primary content field — use for project details, task context, acceptance criteria, and any detailed information. Supports Markdown and HTML."),
    purpose: z.string().optional().describe("ONLY for workspaces, circles, and roles — a short aspirational statement. Do NOT put project details, task context, or general information here; use description instead. Supports HTML."),
    parentId: z.string().optional().describe("New parent ID (move nest to different location, e.g., move inbox item to a role or project)"),
    labels: coerceFromJson(z.array(z.string())).optional().describe("Label IDs to set (e.g., ['project'] to convert an item into a project)"),
    fields: coerceFromJson(z.record(z.unknown())).optional().describe("Field updates (e.g., { 'project.status': 'Current' })"),
    users: coerceFromJson(z.array(z.string())).optional().describe("User IDs to assign"),
    data: coerceFromJson(z.record(z.unknown())).optional().describe("Key-value data store shared with Nestr internals — never overwrite existing keys. Namespace your own data under 'mcp.' (e.g., { 'mcp.lastSync': '...' }). For AI knowledge persistence, use skills instead."),
    due: z.string().optional().describe("Due date (ISO format). For projects/tasks: deadline. For roles: re-election date. For meetings: start time."),
    completed: z.boolean().optional().describe("Mark task as completed (root-level field, not in fields). Note: Projects use fields['project.status'] = 'Done' instead."),
    accountabilities: coerceFromJson(z.array(z.string())).optional().describe("Accountability titles for roles/circles (replaces existing). Only used when updating a role or circle. Requires workspaceId."),
    domains: coerceFromJson(z.array(z.string())).optional().describe("Domain titles for roles/circles (replaces existing). Only used when updating a role or circle. Requires workspaceId."),
    workspaceId: z.string().optional().describe("Workspace ID. Required when updating accountabilities or domains on roles/circles."),
  }),

  deleteNest: z.object({
    nestId: z.string().describe("Nest ID to delete"),
  }),

  addComment: z.object({
    nestId: z.string().describe("Nest ID to comment on"),
    body: z.string().describe("Comment text (supports HTML and @mentions: @{userId}, @{email}, @{circle})"),
  }),

  updateComment: z.object({
    commentId: z.string().describe("Comment ID to update"),
    body: z.string().describe("Updated comment text (supports HTML and @mentions: @{userId}, @{email}, @{circle})"),
  }),

  deleteComment: z.object({
    commentId: z.string().describe("Comment ID to delete"),
  }),

  listCircles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  getCircleRoles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    circleId: z.string().describe("Circle ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  listRoles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  getInsights: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    includeSubCircles: z.boolean().optional().describe("Include metrics from sub-circles (default: true). Cannot be false when userId is provided."),
    userId: z.string().optional().describe("Filter metrics for a specific user (Pro plan only). When provided, includes user-specific metrics like feedback_given/received."),
    nestId: z.string().optional().describe("Filter metrics for a specific circle/nest (Pro plan only). Cannot be combined with userId."),
    endDate: z.string().optional().describe("End date for metrics query (ISO format)"),
  }),

  getInsight: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    metricId: z.string().describe("Metric ID/type from getInsights (e.g., 'role_count', 'tactical_completed')"),
  }),

  listUsers: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    search: z.string().optional().describe("Search by name or email"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  listLabels: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    search: z.string().optional().describe("Search query"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  getProjects: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
    _listTitle: z.string().optional().describe("Short descriptive title for the list UI (e.g., \"Engineering projects\"). Omit for default."),
  }),

  getComments: z.object({
    nestId: z.string().describe("Nest ID to get comments from"),
    depth: z.number().optional().describe("Comment thread depth (default: all)"),
  }),

  getCircle: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    circleId: z.string().describe("Circle ID"),
  }),

  getUser: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    userId: z.string().describe("User ID"),
  }),

  addWorkspaceUser: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    username: z.string().describe("Email address of the user to add"),
    fullName: z.string().optional().describe("Full name of the user (used when creating a new account)"),
    language: z.string().optional().describe("Language preference (e.g., 'en', 'nl', 'de')"),
  }),

  getLabel: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    labelId: z.string().describe("Label ID"),
  }),

  getInsightHistory: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    metricId: z.string().describe("Metric ID from getInsights"),
    from: z.string().optional().describe("Start date (ISO format)"),
    to: z.string().optional().describe("End date (ISO format)"),
    limit: z.number().optional().describe("Maximum data points"),
  }),

  getWorkspaceApps: z.object({
    workspaceId: z.string().describe("Workspace ID"),
  }),

  // Inbox tools (require OAuth token)
  listInbox: z.object({
    completedAfter: z.string().optional().describe("Include completed items from this date (ISO format). If omitted, only non-completed items are returned. For reordering, this default is usually sufficient — nestr_reorder_inbox only requires the IDs of items you want to reposition."),
  }),

  createInboxItem: z.object({
    title: z.string().describe("Title of the inbox item (plain text, HTML stripped)"),
    description: z.string().optional().describe("Additional details or context (supports Markdown and HTML)"),
  }),

  getInboxItem: z.object({
    nestId: z.string().describe("Inbox item ID"),
  }),

  updateInboxItem: z.object({
    nestId: z.string().describe("Inbox item ID"),
    title: z.string().optional().describe("Updated title (plain text, HTML stripped)"),
    description: z.string().optional().describe("Updated description (supports Markdown and HTML)"),
    completed: z.boolean().optional().describe("Mark as completed (processed)"),
    data: coerceFromJson(z.record(z.unknown())).optional().describe("Custom data storage"),
  }),

  reorderInbox: z.object({
    nestIds: coerceFromJson(z.array(z.string())).describe("Array of inbox item IDs in the desired order"),
  }),

  reorderInboxItem: z.object({
    nestId: z.string().describe("ID of the inbox item to reorder"),
    position: z.enum(["before", "after"]).describe("Position relative to the reference item"),
    relatedNestId: z.string().describe("ID of the reference inbox item to position relative to"),
  }),

  // Label management
  addLabel: z.object({
    nestId: z.string().describe("Nest ID"),
    labelId: z.string().describe("Label ID to add"),
  }),

  removeLabel: z.object({
    nestId: z.string().describe("Nest ID"),
    labelId: z.string().describe("Label ID to remove"),
  }),

  addToDailyPlan: z.object({
    nestIds: coerceFromJson(z.array(z.string())).describe("Array of nest IDs to add to the daily plan"),
  }),

  removeFromDailyPlan: z.object({
    nestIds: coerceFromJson(z.array(z.string())).describe("Array of nest IDs to remove from the daily plan"),
  }),

  // Personal labels (require OAuth token)
  listPersonalLabels: z.object({}),

  createPersonalLabel: z.object({
    title: z.string().describe("Label title"),
    description: z.string().optional().describe("Label description"),
    color: z.string().optional().describe("Label color (hex code, e.g., '#FF5733')"),
    icon: z.string().optional().describe("Label icon identifier"),
  }),

  // Reorder tools
  reorderNest: z.object({
    nestId: z.string().describe("ID of the nest to reorder"),
    position: z.enum(["before", "after"]).describe("Position relative to the reference nest"),
    relatedNestId: z.string().describe("ID of the reference nest to position relative to"),
  }),

  bulkReorder: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    nestIds: coerceFromJson(z.array(z.string())).describe("Array of nest IDs in the desired order"),
  }),

  // Daily plan (requires OAuth token)
  getDailyPlan: z.object({}),

  // Current user identity (requires OAuth token)
  getMe: z.object({
    fullWorkspaces: z.boolean().optional().describe("Set true to include full workspace details (purpose, labels, governance type, user access roles). Recommended on first call to establish workspace context."),
  }),

  // User tension tools (requires OAuth token)
  listMyTensions: z.object({
    context: z.string().optional().describe("Optional context filter (e.g., workspace ID or circle ID)"),
  }),

  listTensionsAwaitingConsent: z.object({
    context: z.string().optional().describe("Optional context filter (e.g., workspace ID or circle ID)"),
  }),

  // Notification tools (requires OAuth token)
  listNotifications: z.object({
    type: z.enum(["all", "me", "relevant"]).optional().describe("Filter by type: 'all' (default), 'me' (direct — mentions, replies, reactions, DMs), 'relevant' (delayed — updates, governance)"),
    limit: z.number().optional().describe("Max results to return (default 50, max 200)"),
    skip: z.number().optional().describe("Number of results to skip (default 0)"),
    showRead: z.boolean().optional().describe("Include already-read notifications (default false)"),
    group: z.string().optional().describe("Filter by notification group (mentions, replies, direct_message, reactions, updates, governance)"),
  }),

  markNotificationsRead: z.object({}),

  // Tension tools
  createTension: z.object({
    nestId: z.string().describe("ID of the role or circle to create the tension on. Use a role ID when that role is sensing the tension. Use a circle ID for cross-role, governance, or personally sensed tensions."),
    title: z.string().describe("The gap you're sensing — what is the difference between current reality and desired state (plain text)"),
    description: z.string().optional().describe("The observable facts — what you see/hear/experience that creates this tension (supports Markdown and HTML)"),
    feeling: z.string().optional().describe("The feeling this tension evokes in you — separated from the facts to keep the organizational response clean (plain text)"),
    needs: z.string().optional().describe("The personal or organizational need that is alive — what need is not being met (plain text)"),
  }),

  getTension: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
  }),

  listTensions: z.object({
    nestId: z.string().describe("ID of the circle or role to list tensions for"),
    search: z.string().optional().describe("Search query to filter tensions"),
    limit: z.number().optional().describe("Max results to return"),
    order: z.string().optional().describe("Sort order (e.g., 'createdAt', '-createdAt')"),
  }),

  updateTension: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    title: z.string().optional().describe("Updated title — the gap being sensed (plain text)"),
    description: z.string().optional().describe("Updated description — the observable facts (supports Markdown and HTML)"),
    feeling: z.string().optional().describe("Updated feeling this tension evokes (plain text)"),
    needs: z.string().optional().describe("Updated need that is alive (plain text)"),
  }),

  deleteTension: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID to delete"),
  }),

  getTensionParts: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
  }),

  addTensionPart: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    _id: z.string().optional().describe("ID of an existing governance item to change or remove. Omit to propose a new item."),
    title: z.string().optional().describe("Title for the governance item"),
    labels: coerceFromJson(z.array(z.string())).optional().describe("Labels defining the item type (e.g., ['role'], ['circle'], ['policy'], ['accountability'], ['domain'])"),
    description: z.string().optional().describe("The primary content field — detailed information about the item. Supports Markdown and HTML."),
    purpose: z.string().optional().describe("ONLY for roles/circles — a short aspirational statement. Do NOT put detailed information here; use description instead. Supports HTML."),
    parentId: z.string().optional().describe("Parent ID — use to move/restructure items (e.g., move role to different circle)"),
    users: coerceFromJson(z.array(z.string())).optional().describe("User IDs to assign (e.g., for role elections: assign the elected user to the role)"),
    due: z.string().optional().describe("Due date / re-election date (ISO format)"),
    accountabilities: coerceFromJson(z.array(z.string())).optional().describe("Accountability titles to set on a role (replaces all — use children endpoint for individual management)"),
    domains: coerceFromJson(z.array(z.string())).optional().describe("Domain titles to set on a role (replaces all — use children endpoint for individual management)"),
  }),

  modifyTensionPart: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID to modify"),
    title: z.string().optional().describe("Updated title"),
    description: z.string().optional().describe("Updated description — the primary content field. Supports Markdown and HTML."),
    purpose: z.string().optional().describe("ONLY for roles/circles — updated aspirational statement. Do NOT put detailed information here; use description instead. Supports HTML."),
    labels: coerceFromJson(z.array(z.string())).optional().describe("Updated labels"),
    parentId: z.string().optional().describe("Updated parent ID"),
    users: coerceFromJson(z.array(z.string())).optional().describe("Updated user assignments"),
    due: z.string().optional().describe("Updated due date (ISO format)"),
    accountabilities: coerceFromJson(z.array(z.string())).optional().describe("Updated accountabilities (replaces all — use children endpoint for individual management)"),
    domains: coerceFromJson(z.array(z.string())).optional().describe("Updated domains (replaces all — use children endpoint for individual management)"),
  }),

  removeTensionPart: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID to remove from the proposal"),
  }),

  getTensionPartChildren: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID"),
  }),

  createTensionPartChild: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID"),
    title: z.string().describe("Title for the new accountability or domain"),
    labels: coerceFromJson(z.array(z.string())).describe("Labels defining the type: ['accountability'] or ['domain']"),
  }),

  updateTensionPartChild: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID"),
    childId: z.string().describe("Child ID to update"),
    title: z.string().describe("Updated title"),
  }),

  deleteTensionPartChild: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID"),
    childId: z.string().describe("Child ID to soft-delete (will remove the original accountability/domain when enacted)"),
  }),

  getTensionChanges: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID to get changes for"),
  }),

  getTensionStatus: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
  }),

  updateTensionStatus: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    status: z.enum(["proposed", "draft"]).describe("'proposed' to submit for voting, 'draft' to retract back to draft"),
  }),

  // Graph link tools
  getGraphLinks: z.object({
    nestId: z.string().describe("Nest ID to get graph links for"),
    relation: z.string().describe("Relation name (e.g., 'meeting' for meeting agenda items)"),
    direction: z.enum(["outgoing", "incoming"]).optional().describe("Link direction: 'outgoing' (default) = links FROM this nest, 'incoming' = links TO this nest"),
    limit: z.number().optional().describe("Max results per page (default 50)"),
    page: z.number().optional().describe("Page number for pagination"),
  }),

  addGraphLink: z.object({
    nestId: z.string().describe("Source nest ID"),
    relation: z.string().describe("Relation name (e.g., 'meeting' to link a tension to a meeting as an agenda item)"),
    targetId: z.string().describe("Target nest ID to link to"),
  }),

  removeGraphLink: z.object({
    nestId: z.string().describe("Source nest ID"),
    relation: z.string().describe("Relation name (e.g., 'meeting')"),
    targetId: z.string().describe("Target nest ID to unlink"),
  }),

  help: z.object({
    topic: z.string().describe("Topic key (e.g., 'search', 'labels', 'tensions'). Use 'topics' for the full list."),
  }),
};

// Tool annotations for MCP - hints for clients on tool behavior
const readOnly = { annotations: { readOnlyHint: true, destructiveHint: false } };
const mutating = { annotations: { readOnlyHint: false, destructiveHint: false } };
const destructive = { annotations: { readOnlyHint: false, destructiveHint: true } };

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: "nestr_help",
    description: "Get detailed Nestr documentation by topic. Call before unfamiliar operations. Topics: search, labels, nest-model, inbox, daily-plan, notifications, insights, tension-processing, skills, mcp-apps, authentication, and more. Use topic 'topics' for the full list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Topic key. Use 'topics' for the full list." },
      },
      required: ["topic"],
    },
    ...readOnly,
  },
  {
    name: "nestr_list_workspaces",
    description: "List workspaces. Prefer nestr_get_me with fullWorkspaces:true at session start. Paginated with meta.total.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Search query to filter workspaces" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed) for pagination" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for bulk/index operations." },
      },
    },
    ...readOnly,
  },
  {
    name: "nestr_get_workspace",
    description: "Get details of a specific workspace including its purpose and member count",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_create_workspace",
    description: "Create a new workspace. OAuth only. See nestr_help('workspace-setup') for guided setup.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Workspace name" },
        purpose: { type: "string", description: "Aspirational future state of the organization — a short north-star statement, not project details" },
        type: {
          type: "string",
          enum: ["personal", "collaborative"],
          description: "'personal' for individual use (free forever), 'collaborative' for team use (free trial). Defaults to 'collaborative'."
        },
        governance: {
          type: "string",
          enum: ["holacracy", "sociocracy", "roles_circles"],
          description: "Self-organization model. Defaults to 'roles_circles' (generic role-based)."
        },
        plan: {
          type: "string",
          enum: ["starter", "pro"],
          description: "Subscription plan for collaborative workspaces. Defaults to 'pro' (17-day trial)."
        },
        apps: {
          type: "array",
          items: { type: "string", enum: ["okr", "feedback", "insights"] },
          description: "Apps to enable (e.g., ['okr', 'feedback']). 'insights' requires pro plan."
        },
        layout: {
          type: "string",
          enum: ["board", "list"],
          description: "Layout style for personal workspaces. 'board' creates kanban columns (Todo, Doing, Done)."
        },


      },
      required: ["title"],
    },
    ...mutating,
  },
  {
    name: "nestr_search",
    description: "Search nests in a workspace. Supports operators like label:, assignee:, completed:, in:, sort:. Always use completed:false for active work. See nestr_help('search') for full syntax.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID to search in" },
        query: { type: "string", description: "Search query with optional operators (e.g., 'label:role', 'assignee:me completed:false')" },
        limit: { type: "number", description: "Max results per page. Do NOT set on first call - let API return default with meta.total count showing total matches." },
        page: { type: "number", description: "Page number (1-indexed) for fetching additional pages" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for bulk/index operations." },
        _listTitle: { type: "string", description: "Short descriptive title for the list UI header (2-4 words, e.g., \"Marketing projects\", \"Overdue tasks\", \"Urgent work\"). Describe WHAT is being shown, not the query syntax." },
      },
      required: ["workspaceId", "query"],
    },
    // No _meta: completableListUi — search returns all types of nests (roles, circles, etc.).
    // The completable list app should only be used when results are confirmed to be completable items.
    ...readOnly,
  },
  {
    name: "nestr_get_nest",
    description: "Get nest details. Supports comma-separated IDs for batch fetch. Add hints=true for contextual signals, fieldsMetaData=true for field schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID, or comma-separated IDs to fetch multiple nests at once (e.g., 'id1,id2,id3'). Keep total URL under 2000 chars." },
        fieldsMetaData: { type: "boolean", description: "Set to true to include field schema metadata (available options, field types)" },
        hints: { type: "boolean", description: "Include contextual hints (default: true). Set to false for bulk lookups where you only need structural data." },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["nestId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_nest_children",
    description: "Get children of a nest. Paginated. Add hints=true for contextual signals.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Parent nest ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        hints: { type: "boolean", description: "Include contextual hints (default: true). Set to false for large result sets or bulk operations." },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for bulk/index operations." },
        _listTitle: { type: "string", description: "Short descriptive title for the list UI header (e.g., \"Tasks for Website Redesign\", \"API project sub-tasks\"). Include the parent name for context." },
      },
      required: ["nestId"],
    },
    // No _meta: completableListUi — children can be any type (roles, accountabilities, etc.).
    // The completable list app should only be used when results are confirmed to be completable items.
    ...readOnly,
  },
  {
    name: "nestr_create_nest",
    description: "Create a nest under a parent. Use labels to define type (e.g., ['project'], ['role']). For governance changes in established workspaces, prefer the tension flow. See nestr_help('labels') for available types.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parentId: { type: "string", description: "Parent nest ID (workspace, circle, or project)" },
        title: { type: "string", description: "Title of the new nest (plain text, HTML tags stripped)" },
        description: { type: "string", description: "The primary content field — use for project details, task context, acceptance criteria, DoD, and any detailed information. Use fields (e.g., project.status) for structured data and comments for progress updates. Supports Markdown and HTML." },
        purpose: { type: "string", description: "ONLY for workspaces, circles, and roles — a short aspirational statement of the future state this entity serves. Do NOT put project details, task context, or general information here; use description instead. Supports HTML." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs to apply (e.g., 'project', 'role', 'circle')",
        },
        users: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to assign. ALWAYS set this for projects and tasks — use the role filler's user ID. Placing a nest under a role does NOT auto-assign it.",
        },
        accountabilities: {
          type: "array",
          items: { type: "string" },
          description: "Accountability titles for roles/circles. Each becomes an accountability child nest. Only used when labels include 'role' or 'circle'. Requires workspaceId.",
        },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Domain titles for roles/circles. Each becomes a domain child nest. Only used when labels include 'role' or 'circle'. Requires workspaceId.",
        },
        workspaceId: {
          type: "string",
          description: "Workspace ID. Required when creating roles/circles with accountabilities or domains.",
        },
      },
      required: ["parentId", "title"],
    },
    ...mutating,
  },
  {
    name: "nestr_update_nest",
    description: "Update nest properties. Set parentId to move. Only send fields you want to change. For governance changes, prefer tensions. See nestr_help('nest-model') for fields and data namespacing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to update" },
        title: { type: "string", description: "New title (plain text, HTML tags stripped)" },
        description: { type: "string", description: "The primary content field — use for details, context, acceptance criteria, and any information about the nest. Use fields for structured data, comments for progress. Supports Markdown and HTML." },
        purpose: { type: "string", description: "ONLY for workspaces, circles, and roles — a short aspirational statement. Do NOT put project details, task context, or general information here; use description instead. Supports HTML." },
        parentId: { type: "string", description: "New parent ID (move nest to different location)" },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs to set (e.g., ['project'] to convert an item into a project)",
        },
        fields: {
          type: "object",
          description: "Field updates (e.g., { 'project.status': 'Current' })",
        },
        users: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to assign",
        },
        data: {
          type: "object",
          description: "Key-value data store shared with Nestr internals — never overwrite existing keys. Namespace your own data under 'mcp.' (e.g., { 'mcp.lastSync': '...' }). For AI knowledge persistence, use skills instead.",
        },
        due: {
          type: "string",
          description: "Due date (ISO format). For projects/tasks: deadline. For roles: re-election date. For meetings: start time.",
        },
        completed: {
          type: "boolean",
          description: "Mark task as completed (root-level field, not in fields). Note: Projects use fields['project.status'] = 'Done' instead.",
        },
        accountabilities: {
          type: "array",
          items: { type: "string" },
          description: "Accountability titles for roles/circles (replaces existing). Requires workspaceId.",
        },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Domain titles for roles/circles (replaces existing). Requires workspaceId.",
        },
        workspaceId: {
          type: "string",
          description: "Workspace ID. Required when updating accountabilities or domains.",
        },
      },
      required: ["nestId"],
    },
    ...mutating,
  },
  {
    name: "nestr_delete_nest",
    description: "Delete a nest. For governance items in established workspaces, use tensions instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to delete" },
      },
      required: ["nestId"],
    },
    ...destructive,
  },
  {
    name: "nestr_add_comment",
    description: "Add a comment to a nest. Supports HTML and @mentions (@{userId}, @{email}, @{circle}). Use for progress updates and discussion.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to comment on" },
        body: { type: "string", description: "Comment text (supports HTML and @mentions: @{userId}, @{email}, @{circle})" },
      },
      required: ["nestId", "body"],
    },
    ...mutating,
  },
  {
    name: "nestr_update_comment",
    description: "Update an existing comment's body. Supports HTML and @mentions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: { type: "string", description: "Comment ID to update" },
        body: { type: "string", description: "Updated comment text (supports HTML and @mentions: @{userId}, @{email}, @{circle})" },
      },
      required: ["commentId", "body"],
    },
    ...mutating,
  },
  {
    name: "nestr_delete_comment",
    description: "Delete a comment (soft delete).",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: { type: "string", description: "Comment ID to delete" },
      },
      required: ["commentId"],
    },
    ...destructive,
  },
  {
    name: "nestr_list_circles",
    description: "List all circles (teams/departments) in a workspace. Response includes meta.total showing total matching count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for large workspaces." },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_circle_roles",
    description: "Get all roles within a specific circle, including accountabilities. Response includes meta.total showing total matching count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        circleId: { type: "string", description: "Circle ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for large circles." },
      },
      required: ["workspaceId", "circleId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_list_roles",
    description: "List all roles in a workspace. Response includes meta.total showing total matching count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for large workspaces." },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_insights",
    description: "Get organizational health metrics and trends. Each metric has currentValue and compareValue for direction. Pro plan: filter by circle (nestId) or user (userId). Requires Insights app. See nestr_help('insights').",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        includeSubCircles: { type: "boolean", description: "Include metrics from sub-circles (default: true). Cannot be false when userId is provided." },
        userId: { type: "string", description: "Filter metrics for a specific user (Pro plan only). Cannot be combined with nestId." },
        nestId: { type: "string", description: "Filter metrics for a specific circle/nest (Pro plan only). Cannot be combined with userId." },
        endDate: { type: "string", description: "End date for metrics query (ISO format)" },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_insight",
    description: "Get a single metric with its current and compare values. Use after nestr_get_insights to drill into a specific metric. Requires the Insights app to be enabled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        metricId: { type: "string", description: "Metric ID/type from getInsights (e.g., 'role_count', 'tactical_completed')" },
      },
      required: ["workspaceId", "metricId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_list_users",
    description: "List members of a workspace. Response includes meta.total showing total matching count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        search: { type: "string", description: "Search by name or email" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_list_labels",
    description: "List available labels in a workspace. Response includes meta.total showing total matching count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        search: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_projects",
    description: "List all projects in a workspace. Check fields['project.status'] for status (Future/Current/Waiting/Done). Paginated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for large workspaces." },
        _listTitle: { type: "string", description: "Short descriptive title for the list UI header (e.g., \"Engineering projects\", \"All projects\"). Omit for default." },
      },
      required: ["workspaceId"],
    },
    _meta: completableListUi,
    ...readOnly,
  },
  {
    name: "nestr_get_comments",
    description: "Get comments and discussion history on a nest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to get comments from" },
        depth: { type: "number", description: "Comment thread depth (default: all)" },
      },
      required: ["nestId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_circle",
    description: "Get details of a specific circle including purpose, domains, and accountabilities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        circleId: { type: "string", description: "Circle ID" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["workspaceId", "circleId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_user",
    description: "Get details of a specific user including profile, roles, and contact info.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["workspaceId", "userId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_add_workspace_user",
    description: "Add a user to a workspace by email. Creates account if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        username: { type: "string", description: "Email address of the user to add" },
        fullName: { type: "string", description: "Full name (for new accounts)" },
        language: { type: "string", description: "Language preference (e.g., 'en', 'nl')" },
      },
      required: ["workspaceId", "username"],
    },
    ...mutating,
  },
  {
    name: "nestr_get_label",
    description: "Get details of a specific label.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        labelId: { type: "string", description: "Label ID" },
      },
      required: ["workspaceId", "labelId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_insight_history",
    description: "Get historical data points for a metric over time. Use from/to for date range. Requires Insights app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        metricId: { type: "string", description: "Metric ID from getInsights" },
        from: { type: "string", description: "Start date (ISO format)" },
        to: { type: "string", description: "End date (ISO format)" },
        limit: { type: "number", description: "Maximum data points" },
      },
      required: ["workspaceId", "metricId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_workspace_apps",
    description: "List enabled apps/features in a workspace. Check before using features that require specific apps (e.g., Insights).",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
    ...readOnly,
  },
  // Inbox tools (require OAuth token - won't work with workspace API keys)
  {
    name: "nestr_list_inbox",
    description: "List items in the user's personal inbox. Spans all workspaces. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        completedAfter: { type: "string", description: "Include completed items from this date (ISO format). If omitted, only non-completed items are returned. For reordering, this default is usually sufficient — nestr_reorder_inbox only requires the IDs of items you want to reposition." },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
    },
    _meta: completableListUi,
    ...readOnly,
  },
  {
    name: "nestr_create_inbox_item",
    description: "Quick capture: add an item to the inbox for later processing. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Title of the inbox item (plain text, HTML stripped)" },
        description: { type: "string", description: "Additional details or context (supports Markdown and HTML)" },
      },
      required: ["title"],
    },
    ...mutating,
  },
  {
    name: "nestr_get_inbox_item",
    description: "Get details of a specific inbox item. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Inbox item ID" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["nestId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_update_inbox_item",
    description: "Update an inbox item. Set completed:true when processed. Use nestr_update_nest with parentId to move out of inbox. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Inbox item ID" },
        title: { type: "string", description: "Updated title (plain text, HTML stripped)" },
        description: { type: "string", description: "Updated description (supports Markdown and HTML)" },
        completed: { type: "boolean", description: "Mark as completed (processed)" },
        data: { type: "object", description: "Custom data storage" },
      },
      required: ["nestId"],
    },
    ...mutating,
  },
  {
    name: "nestr_reorder_inbox",
    description: "Reorder inbox items. Provide a subset of IDs — they go to the top in given order, rest unchanged. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of inbox item IDs in the desired order",
        },
      },
      required: ["nestIds"],
    },
    ...mutating,
  },
  {
    name: "nestr_reorder_inbox_item",
    description: "Reorder a single inbox item by positioning it before or after another inbox item. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the inbox item to reorder" },
        position: { type: "string", enum: ["before", "after"], description: "Position relative to the reference item" },
        relatedNestId: { type: "string", description: "ID of the reference inbox item to position relative to" },
      },
      required: ["nestId", "position", "relatedNestId"],
    },
    ...mutating,
  },
  // Personal labels (require OAuth token - user's own labels, not workspace labels)
  {
    name: "nestr_list_personal_labels",
    description: "List the current user's personal labels (not workspace labels). OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    ...readOnly,
  },
  {
    name: "nestr_create_personal_label",
    description: "Create a personal label. Can be used across workspaces. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Label title" },
        description: { type: "string", description: "Label description" },
        color: { type: "string", description: "Label color (hex code, e.g., '#FF5733')" },
        icon: { type: "string", description: "Label icon identifier" },
      },
      required: ["title"],
    },
    ...mutating,
  },
  // Reorder tools
  {
    name: "nestr_reorder_nest",
    description: "Reorder a nest by positioning it before or after another nest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the nest to reorder" },
        position: { type: "string", enum: ["before", "after"], description: "Position relative to the reference nest" },
        relatedNestId: { type: "string", description: "ID of the reference nest to position relative to" },
      },
      required: ["nestId", "position", "relatedNestId"],
    },
    ...mutating,
  },
  {
    name: "nestr_bulk_reorder",
    description: "Bulk reorder nests. Provide a subset of IDs — they go to the top in given order, rest unchanged.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        nestIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of nest IDs in the desired order",
        },
      },
      required: ["workspaceId", "nestIds"],
    },
    ...mutating,
  },
  // Daily plan (requires OAuth token)
  {
    name: "nestr_get_daily_plan",
    description: "Get the user's daily plan — items marked for today. Spans all workspaces. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
    },
    _meta: completableListUi,
    ...readOnly,
  },
  // Label management
  {
    name: "nestr_add_label",
    description: "Add a label to a nest. Personal labels (like 'now') are automatically scoped to the authenticated user by the API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID" },
        labelId: { type: "string", description: "Label ID to add (e.g., 'project', 'now', or a custom label ID)" },
      },
      required: ["nestId", "labelId"],
    },
    ...mutating,
  },
  {
    name: "nestr_remove_label",
    description: "Remove a label from a nest. Personal labels (like 'now') are automatically scoped to the authenticated user by the API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID" },
        labelId: { type: "string", description: "Label ID to remove" },
      },
      required: ["nestId", "labelId"],
    },
    ...mutating,
  },
  {
    name: "nestr_add_to_daily_plan",
    description: "Add one or more items to the daily plan by applying the 'now' label. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of nest IDs to add to the daily plan",
        },
      },
      required: ["nestIds"],
    },
    ...mutating,
  },
  {
    name: "nestr_remove_from_daily_plan",
    description: "Remove one or more items from the daily plan by removing the 'now' label. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of nest IDs to remove from the daily plan",
        },
      },
      required: ["nestIds"],
    },
    ...mutating,
  },
  // Current user identity and workspace context — primary entry point
  {
    name: "nestr_get_me",
    description: "CALL THIS FIRST at session start. Returns identity, operating mode, and workspaces. Use fullWorkspaces:true to include workspace details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fullWorkspaces: { type: "boolean", description: "Set true to include full workspace details. Recommended on first call." },
      },
    },
    ...readOnly,
  },
  // User tension tools (requires OAuth token)
  {
    name: "nestr_list_my_tensions",
    description: "List tensions created by or assigned to the current user. Check at session start and natural breakpoints. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        context: { type: "string", description: "Optional context filter (e.g., workspace ID or circle ID)" },
      },
    },
    ...readOnly,
  },
  {
    name: "nestr_list_tensions_awaiting_consent",
    description: "List tensions awaiting the current user's consent vote. Check proactively. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        context: { type: "string", description: "Optional context filter (e.g., workspace ID or circle ID)" },
      },
    },
    ...readOnly,
  },
  // Notification tools (requires OAuth token)
  {
    name: "nestr_list_notifications",
    description: "List notifications. Use type 'me' for direct (mentions, replies) or 'relevant' for organizational changes. OAuth only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["all", "me", "relevant"], description: "Filter by type: 'all' (default), 'me' (direct), 'relevant' (delayed)" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
        skip: { type: "number", description: "Number of results to skip (default 0)" },
        showRead: { type: "boolean", description: "Include already-read notifications (default false)" },
        group: { type: "string", description: "Filter by group (mentions, replies, direct_message, reactions, updates, governance)" },
      },
    },
    ...readOnly,
  },
  {
    name: "nestr_mark_notifications_read",
    description: "Mark all unread in-app notifications as read for the current user. Returns { status, data: { markedCount } }. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    ...mutating,
  },
  // Tension tools
  {
    name: "nestr_create_tension",
    description: "Create a tension on a role or circle. Tensions drive organizational change. See nestr_help('tension-processing') for guidance on placement and pathways.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the role or circle to create the tension on. Place on a role to indicate that role is sensing the tension. Place on a circle for cross-role or governance tensions (use individual-action label if sensed personally without role authority)." },
        title: { type: "string", description: "The gap — what is the difference between current reality and desired state (plain text)" },
        description: { type: "string", description: "The observable facts — what you see/hear/experience (supports Markdown and HTML)" },
        feeling: { type: "string", description: "The feeling this tension evokes — separated to keep the organizational response clean (plain text)" },
        needs: { type: "string", description: "The need that is alive — what personal or organizational need is not being met (plain text)" },
      },
      required: ["nestId", "title"],
    },
    ...mutating,
  },
  {
    name: "nestr_get_tension",
    description: "Get a single tension with its current status. Use nestr_get_tension_status for per-user voting details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_list_tensions",
    description: "List tensions for a circle or role. Supports search filtering.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role to list tensions for" },
        search: { type: "string", description: "Search query to filter tensions" },
        limit: { type: "number", description: "Max results to return" },
        order: { type: "string", description: "Sort order (e.g., 'createdAt', '-createdAt')" },
      },
      required: ["nestId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_update_tension",
    description: "Update a tension's title, description, feeling, or needs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        title: { type: "string", description: "Updated title — the gap being sensed (plain text)" },
        description: { type: "string", description: "Updated description — the observable facts (supports Markdown and HTML)" },
        feeling: { type: "string", description: "Updated feeling this tension evokes (plain text)" },
        needs: { type: "string", description: "Updated need that is alive (plain text)" },
      },
      required: ["nestId", "tensionId"],
    },
    ...mutating,
  },
  {
    name: "nestr_delete_tension",
    description: "Delete a tension (soft delete).",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID to delete" },
      },
      required: ["nestId", "tensionId"],
    },
    ...destructive,
  },
  {
    name: "nestr_get_tension_parts",
    description: "Get all parts (proposed changes) of a tension. Review before submitting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_add_tension_part",
    description: "Add or modify a governance proposal on a tension. To add new: omit _id. To modify existing: include _id with changed fields. See nestr_help('tension-processing').",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        _id: { type: "string", description: "ID of an existing governance item to change or remove. Omit to propose a new item." },
        title: { type: "string", description: "Title for the governance item" },
        labels: { type: "array", items: { type: "string" }, description: "Labels defining the item type (e.g., ['role'], ['circle'], ['policy'], ['accountability'], ['domain'])" },
        description: { type: "string", description: "The primary content field — detailed information about the item. Supports Markdown and HTML." },
        purpose: { type: "string", description: "ONLY for roles/circles — a short aspirational statement. Do NOT put detailed information here; use description instead. Supports HTML." },
        parentId: { type: "string", description: "Parent ID — use to move/restructure items (e.g., move role to different circle)" },
        users: { type: "array", items: { type: "string" }, description: "User IDs to assign (e.g., for elections: assign elected user to the role)" },
        due: { type: "string", description: "Due date / re-election date (ISO format)" },
        accountabilities: { type: "array", items: { type: "string" }, description: "Accountability titles to set on a role (replaces all — use children endpoint for individual management)" },
        domains: { type: "array", items: { type: "string" }, description: "Domain titles to set on a role (replaces all — use children endpoint for individual management)" },
      },
      required: ["nestId", "tensionId"],
    },
    ...mutating,
  },
  {
    name: "nestr_modify_tension_part",
    description: "Modify an existing proposal part. For individual accountability/domain changes, use the children tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to modify" },
        title: { type: "string", description: "Updated title" },
        description: { type: "string", description: "Updated description — the primary content field. Supports Markdown and HTML." },
        purpose: { type: "string", description: "ONLY for roles/circles — updated aspirational statement. Do NOT put detailed information here; use description instead. Supports HTML." },
        labels: { type: "array", items: { type: "string" }, description: "Updated labels" },
        parentId: { type: "string", description: "Updated parent ID" },
        users: { type: "array", items: { type: "string" }, description: "Updated user assignments" },
        due: { type: "string", description: "Updated due date (ISO format)" },
        accountabilities: { type: "array", items: { type: "string" }, description: "Updated accountabilities (replaces all — use children endpoint for individual management)" },
        domains: { type: "array", items: { type: "string" }, description: "Updated domains (replaces all — use children endpoint for individual management)" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
    ...mutating,
  },
  {
    name: "nestr_remove_tension_part",
    description: "Remove a proposal part, or propose deletion of an existing governance item.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to remove from the proposal" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
    ...destructive,
  },
  {
    name: "nestr_get_tension_part_children",
    description: "List accountabilities/domains of a proposal part. Use to review before managing individually.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
  },
  {
    name: "nestr_create_tension_part_child",
    description: "Add a new accountability or domain to a proposal part. When the proposal is enacted, this creates a new accountability/domain on the role.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID" },
        title: { type: "string", description: "Title for the new accountability or domain" },
        labels: { type: "array", items: { type: "string" }, description: "Labels defining the type: ['accountability'] or ['domain']" },
      },
      required: ["nestId", "tensionId", "partId", "title", "labels"],
    },
  },
  {
    name: "nestr_update_tension_part_child",
    description: "Rename an accountability or domain within a proposal part. When the proposal is enacted, the original accountability/domain is updated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID" },
        childId: { type: "string", description: "Child ID to update" },
        title: { type: "string", description: "Updated title" },
      },
      required: ["nestId", "tensionId", "partId", "childId", "title"],
    },
  },
  {
    name: "nestr_delete_tension_part_child",
    description: "Soft-delete an accountability or domain from a proposal part. When the proposal is enacted, the original accountability/domain is removed from the role.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID" },
        childId: { type: "string", description: "Child ID to soft-delete" },
      },
      required: ["nestId", "tensionId", "partId", "childId"],
    },
  },
  {
    name: "nestr_get_tension_changes",
    description: "Get the diff for a proposal part showing what will change (oldValue vs newValue).",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to get changes for" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_get_tension_status",
    description: "Get detailed tension status with per-user voting responses and timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
    ...readOnly,
  },
  {
    name: "nestr_update_tension_status",
    description: "Submit a tension for voting ('proposed') or retract to 'draft'. Submitting notifies circle members.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        status: { type: "string", enum: ["proposed", "draft"], description: "'proposed' to submit for voting, 'draft' to retract back to draft" },
      },
      required: ["nestId", "tensionId", "status"],
    },
    ...mutating,
  },
  // Graph link tools
  {
    name: "nestr_get_graph_links",
    description: "Get nests linked via a named graph relation. Use 'meeting' relation to get agenda items or linked meetings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to get graph links for" },
        relation: { type: "string", description: "Relation name (e.g., 'meeting' for meeting agenda items)" },
        direction: { type: "string", enum: ["outgoing", "incoming"], description: "Link direction: 'outgoing' (default) = links FROM this nest, 'incoming' = links TO this nest" },
        limit: { type: "number", description: "Max results per page (default 50)" },
        page: { type: "number", description: "Page number for pagination" },
      },
      required: ["nestId", "relation"],
    },
    ...readOnly,
  },
  {
    name: "nestr_add_graph_link",
    description: "Create a bidirectional graph link between two nests. E.g., link a tension to a meeting as an agenda item.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Source nest ID" },
        relation: { type: "string", description: "Relation name (e.g., 'meeting' to link a tension to a meeting)" },
        targetId: { type: "string", description: "Target nest ID to link to" },
      },
      required: ["nestId", "relation", "targetId"],
    },
    ...mutating,
  },
  {
    name: "nestr_remove_graph_link",
    description: "Remove a graph link between two nests. For example, remove a tension from a meeting's agenda by removing the 'meeting' relation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Source nest ID" },
        relation: { type: "string", description: "Relation name (e.g., 'meeting')" },
        targetId: { type: "string", description: "Target nest ID to unlink" },
      },
      required: ["nestId", "relation", "targetId"],
    },
    ...destructive,
  },
];

// Tool handler type
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Strip description fields from nest objects in response data
export function stripDescriptionFields(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(item => stripDescriptionFields(item));
  }
  if (data && typeof data === 'object') {
    const obj = { ...(data as Record<string, unknown>) };
    if ('_id' in obj) {
      delete obj.description;
    }
    for (const key of ['data', 'nest', 'item', 'items', 'nests']) {
      if (key in obj && obj[key] != null) {
        obj[key] = stripDescriptionFields(obj[key]);
      }
    }
    return obj;
  }
  return data;
}

// Tool handler - supports stripDescription to reduce response size
export async function handleToolCall(
  client: NestrClient,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const shouldStripDescription = args.stripDescription === true;
  const result = await _handleToolCall(client, name, args);

  if (shouldStripDescription && !result.isError) {
    try {
      const parsed = JSON.parse(result.content[0].text);
      result.content[0].text = JSON.stringify(stripDescriptionFields(parsed), null, 2);
    } catch {
      // If parsing fails, return as-is
    }
  }

  return result;
}

async function _handleToolCall(
  client: NestrClient,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case "nestr_help": {
        const parsed = schemas.help.parse(args);
        const { HELP_TOPICS } = await import("../help/topics.js");
        const content = HELP_TOPICS[parsed.topic];
        if (!content) {
          return { content: [{ type: "text", text: `Unknown topic: "${parsed.topic}". Call nestr_help({ topic: "topics" }) to see available topics.` }] };
        }
        return { content: [{ type: "text", text: content }] };
      }

      case "nestr_list_workspaces": {
        const parsed = schemas.listWorkspaces.parse(args);
        const workspaces = await client.listWorkspaces({
          search: parsed.search,
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
        });
        return formatResult(compactResponse(workspaces));
      }

      case "nestr_get_workspace": {
        const parsed = schemas.getWorkspace.parse(args);
        const workspace = await client.getWorkspace(parsed.workspaceId, true);
        return formatResult(workspace);
      }

      case "nestr_create_workspace": {
        const parsed = schemas.createWorkspace.parse(args);
        const workspace = await client.createWorkspace({
          title: parsed.title,
          purpose: parsed.purpose,
          configuration: {
            collaborators: parsed.type === 'personal' ? 'personal' : 'collaborate',
            governance: parsed.governance,
            plan: parsed.plan,
            apps: parsed.apps,
            layout: parsed.layout,


          },
        });
        return formatResult(workspace);
      }

      case "nestr_search": {
        const parsed = schemas.search.parse(args);
        const results = await client.searchWorkspace(
          parsed.workspaceId,
          parsed.query,
          { limit: parsed.limit, page: parsed.page, cleanText: true }
        );
        return formatResult(completableResponse(compactResponse(results), "search", parsed._listTitle || `Search: ${parsed.query}`));
      }

      case "nestr_get_nest": {
        const parsed = schemas.getNest.parse(args);
        const nest = await client.getNest(parsed.nestId, {
          cleanText: true,
          fieldsMetaData: parsed.fieldsMetaData,
          hints: parsed.hints !== false,
        });
        return formatResult(enrichHints(nest));
      }

      case "nestr_get_nest_children": {
        const parsed = schemas.getNestChildren.parse(args);
        const children = await client.getNestChildren(parsed.nestId, {
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
          hints: parsed.hints !== false,
        });
        return formatResult(completableResponse(compactResponse(enrichHints(children)), "children", parsed._listTitle || "Sub-items"));
      }

      case "nestr_create_nest": {
        const parsed = schemas.createNest.parse(args);
        const hasGovernanceLabels = parsed.labels?.some(l =>
          ["role", "circle"].includes(l)
        );
        const hasInlineGovernance = parsed.accountabilities?.length || parsed.domains?.length;

        // Route to self-organization API when creating roles/circles with accountabilities/domains
        if (hasGovernanceLabels && hasInlineGovernance && parsed.workspaceId) {
          const isCircle = parsed.labels?.includes("circle");
          const nestData = {
            title: parsed.title,
            purpose: parsed.purpose,
            description: parsed.description,
            labels: parsed.labels,
            users: parsed.users,
            accountabilities: parsed.accountabilities,
            domains: parsed.domains,
          };

          let result: Nest | Nest[];
          if (isCircle) {
            result = await client.createCircles(
              parsed.workspaceId,
              [{ ...nestData, parentId: parsed.parentId }]
            );
          } else {
            result = await client.createRolesInCircle(
              parsed.workspaceId,
              parsed.parentId,
              [nestData]
            );
          }
          const nest = Array.isArray(result) ? result[0] : result;
          return formatResult({ message: "Nest created successfully", nest });
        }

        const nest = await client.createNest({
          parentId: parsed.parentId,
          title: parsed.title,
          purpose: parsed.purpose,
          description: parsed.description,
          labels: parsed.labels,
          users: parsed.users,
        });
        return formatResult({ message: "Nest created successfully", nest });
      }

      case "nestr_update_nest": {
        const parsed = schemas.updateNest.parse(args);
        const hasInlineGovernance = parsed.accountabilities?.length || parsed.domains?.length;

        // Route to self-organization API when updating roles/circles with accountabilities/domains
        if (hasInlineGovernance && parsed.workspaceId) {
          // Determine if this is a circle or role by checking labels
          // If labels are being set and include 'circle', use circle endpoint
          // Otherwise default to role endpoint (more common case)
          const isCircle = parsed.labels?.includes("circle");
          const updates = {
            title: parsed.title,
            purpose: parsed.purpose,
            description: parsed.description,
            parentId: parsed.parentId,
            labels: parsed.labels,
            users: parsed.users,
            fields: parsed.fields,
            data: parsed.data as Record<string, unknown> | undefined,
            due: parsed.due,
            accountabilities: parsed.accountabilities,
            domains: parsed.domains,
          };

          const nest = isCircle
            ? await client.updateCircle(parsed.workspaceId, parsed.nestId, updates)
            : await client.updateRole(parsed.workspaceId, parsed.nestId, updates);
          return formatResult({ message: "Nest updated successfully", nest });
        }

        const nest = await client.updateNest(parsed.nestId, {
          title: parsed.title,
          purpose: parsed.purpose,
          description: parsed.description,
          parentId: parsed.parentId,
          labels: parsed.labels,
          fields: parsed.fields,
          users: parsed.users,
          data: parsed.data as Record<string, unknown> | undefined,
          due: parsed.due,
          completed: parsed.completed,
        });
        return formatResult({ message: "Nest updated successfully", nest });
      }

      case "nestr_delete_nest": {
        const parsed = schemas.deleteNest.parse(args);
        await client.deleteNest(parsed.nestId);
        return formatResult({ message: `Nest ${parsed.nestId} deleted successfully` });
      }

      case "nestr_add_comment": {
        const parsed = schemas.addComment.parse(args);
        const post = await client.createPost(parsed.nestId, parsed.body);
        return formatResult({ message: "Comment added successfully", post });
      }

      case "nestr_update_comment": {
        const parsed = schemas.updateComment.parse(args);
        const updated = await client.updateNest(parsed.commentId, {
          title: parsed.body,
        });
        return formatResult({ message: "Comment updated successfully", comment: updated });
      }

      case "nestr_delete_comment": {
        const parsed = schemas.deleteComment.parse(args);
        await client.deleteNest(parsed.commentId);
        return formatResult({ message: `Comment ${parsed.commentId} deleted successfully` });
      }

      case "nestr_list_circles": {
        const parsed = schemas.listCircles.parse(args);
        const circles = await client.listCircles(parsed.workspaceId, {
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
        });
        return formatResult(compactResponse(circles, "role"));
      }

      case "nestr_get_circle_roles": {
        const parsed = schemas.getCircleRoles.parse(args);
        const roles = await client.getCircleRoles(
          parsed.workspaceId,
          parsed.circleId,
          { limit: parsed.limit, page: parsed.page, cleanText: true }
        );
        return formatResult(compactResponse(roles, "role"));
      }

      case "nestr_list_roles": {
        const parsed = schemas.listRoles.parse(args);
        const roles = await client.listRoles(parsed.workspaceId, {
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
        });
        return formatResult(compactResponse(roles, "role"));
      }

      case "nestr_get_insights": {
        const parsed = schemas.getInsights.parse(args);
        const insights = await client.getInsights(parsed.workspaceId, {
          includeSubCircles: parsed.includeSubCircles,
          userId: parsed.userId,
          nestId: parsed.nestId,
          endDate: parsed.endDate,
        });
        return formatResult(insights);
      }

      case "nestr_get_insight": {
        const parsed = schemas.getInsight.parse(args);
        const insight = await client.getInsight(parsed.workspaceId, parsed.metricId);
        return formatResult(insight);
      }

      case "nestr_list_users": {
        const parsed = schemas.listUsers.parse(args);
        const users = await client.listUsers(parsed.workspaceId, {
          search: parsed.search,
          limit: parsed.limit,
          page: parsed.page,
        });
        return formatResult(compactResponse(users, "user"));
      }

      case "nestr_list_labels": {
        const parsed = schemas.listLabels.parse(args);
        const labels = await client.listLabels(parsed.workspaceId, {
          search: parsed.search,
          limit: parsed.limit,
          page: parsed.page,
        });
        return formatResult(compactResponse(labels, "label"));
      }

      case "nestr_get_projects": {
        const parsed = schemas.getProjects.parse(args);
        const projects = await client.getWorkspaceProjects(parsed.workspaceId, {
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
        });
        return formatResult(completableResponse(compactResponse(projects), "projects", parsed._listTitle || "Projects"));
      }

      case "nestr_get_comments": {
        const parsed = schemas.getComments.parse(args);
        const comments = await client.getNestPosts(parsed.nestId, {
          depth: parsed.depth,
        });
        return formatResult(comments);
      }

      case "nestr_get_circle": {
        const parsed = schemas.getCircle.parse(args);
        const circle = await client.getCircle(
          parsed.workspaceId,
          parsed.circleId,
          true
        );
        return formatResult(circle);
      }

      case "nestr_get_user": {
        const parsed = schemas.getUser.parse(args);
        const user = await client.getUser(parsed.workspaceId, parsed.userId);
        return formatResult(user);
      }

      case "nestr_add_workspace_user": {
        const parsed = schemas.addWorkspaceUser.parse(args);
        const user = await client.addWorkspaceUser(parsed.workspaceId, {
          username: parsed.username,
          fullName: parsed.fullName,
          language: parsed.language,
        });
        return formatResult({ message: "User added to workspace successfully", user });
      }

      case "nestr_get_label": {
        const parsed = schemas.getLabel.parse(args);
        const label = await client.getLabel(parsed.workspaceId, parsed.labelId);
        return formatResult(label);
      }

      case "nestr_get_insight_history": {
        const parsed = schemas.getInsightHistory.parse(args);
        const history = await client.getInsightHistory(
          parsed.workspaceId,
          parsed.metricId,
          {
            from: parsed.from,
            to: parsed.to,
            limit: parsed.limit,
          }
        );
        return formatResult(history);
      }

      case "nestr_get_workspace_apps": {
        const parsed = schemas.getWorkspaceApps.parse(args);
        const apps = await client.getWorkspaceApps(parsed.workspaceId);
        return formatResult(apps);
      }

      // Inbox tools (require OAuth token)
      case "nestr_list_inbox": {
        const parsed = schemas.listInbox.parse(args);
        const items = await client.listInbox({
          completedAfter: parsed.completedAfter,
        });
        return formatResult(completableResponse(compactResponse(items), "inbox", "Inbox"));
      }

      case "nestr_create_inbox_item": {
        const parsed = schemas.createInboxItem.parse(args);
        const item = await client.createInboxItem({
          title: parsed.title,
          description: parsed.description,
        });
        return formatResult({ message: "Inbox item created successfully", item });
      }

      case "nestr_get_inbox_item": {
        const parsed = schemas.getInboxItem.parse(args);
        const item = await client.getInboxItem(parsed.nestId, true);
        return formatResult(item);
      }

      case "nestr_update_inbox_item": {
        const parsed = schemas.updateInboxItem.parse(args);
        const item = await client.updateInboxItem(parsed.nestId, {
          title: parsed.title,
          description: parsed.description,
          completed: parsed.completed,
          data: parsed.data as Record<string, unknown> | undefined,
        });
        return formatResult({ message: "Inbox item updated successfully", item });
      }

      case "nestr_reorder_inbox": {
        const parsed = schemas.reorderInbox.parse(args);
        const result = await client.reorderInbox(parsed.nestIds);
        return formatResult({ message: "Inbox items reordered successfully", items: result });
      }

      case "nestr_reorder_inbox_item": {
        const parsed = schemas.reorderInboxItem.parse(args);
        const result = await client.reorderInboxItem(
          parsed.nestId,
          parsed.position,
          parsed.relatedNestId
        );
        return formatResult({ message: "Inbox item reordered successfully", nest: result });
      }

      // Personal labels (require OAuth token)
      case "nestr_list_personal_labels": {
        schemas.listPersonalLabels.parse(args);
        const labels = await client.listPersonalLabels();
        return formatResult(compactResponse(labels, "label"));
      }

      case "nestr_create_personal_label": {
        const parsed = schemas.createPersonalLabel.parse(args);
        const label = await client.createPersonalLabel({
          title: parsed.title,
          description: parsed.description,
          color: parsed.color,
          icon: parsed.icon,
        });
        return formatResult({ message: "Personal label created successfully", label });
      }

      // Reorder tools
      case "nestr_reorder_nest": {
        const parsed = schemas.reorderNest.parse(args);
        const result = await client.reorderNest(
          parsed.nestId,
          parsed.position,
          parsed.relatedNestId
        );
        return formatResult({ message: "Nest reordered successfully", nest: result });
      }

      case "nestr_bulk_reorder": {
        const parsed = schemas.bulkReorder.parse(args);
        const result = await client.bulkReorder(parsed.workspaceId, parsed.nestIds);
        return formatResult({ message: "Nests reordered successfully", nests: result });
      }

      // Label management
      case "nestr_add_label": {
        const parsed = schemas.addLabel.parse(args);
        const nest = await client.addLabel(parsed.nestId, parsed.labelId);
        return formatResult({ message: `Label '${parsed.labelId}' added successfully`, nest: compactResponse(nest) });
      }

      case "nestr_remove_label": {
        const parsed = schemas.removeLabel.parse(args);
        const nest = await client.removeLabel(parsed.nestId, parsed.labelId);
        return formatResult({ message: `Label '${parsed.labelId}' removed successfully`, nest: compactResponse(nest) });
      }

      case "nestr_add_to_daily_plan": {
        const parsed = schemas.addToDailyPlan.parse(args);
        const results = await Promise.all(
          parsed.nestIds.map(id => client.addLabel(id, "now"))
        );
        return formatResult({
          message: `${results.length} item(s) added to daily plan`,
          nests: compactResponse(results),
        });
      }

      case "nestr_remove_from_daily_plan": {
        const parsed = schemas.removeFromDailyPlan.parse(args);
        const results = await Promise.all(
          parsed.nestIds.map(id => client.removeLabel(id, "now"))
        );
        return formatResult({
          message: `${results.length} item(s) removed from daily plan`,
          nests: compactResponse(results),
        });
      }

      // Daily plan (requires OAuth token)
      case "nestr_get_daily_plan": {
        schemas.getDailyPlan.parse(args);
        const items = await client.getDailyPlan();
        return formatResult(completableResponse(compactResponse(items), "daily-plan", "Daily Plan"));
      }

      // Current user identity and workspace context
      case "nestr_get_me": {
        const parsed = schemas.getMe.parse(args);
        try {
          let user = await client.getCurrentUser({
            fullWorkspaces: parsed.fullWorkspaces,
          });
          // Guard against oversized responses (e.g. many workspaces with large adminUsers arrays).
          // If the serialized user exceeds 50KB, retry without fullWorkspaces to avoid
          // blowing past MCP client token limits.
          const MAX_USER_RESPONSE_BYTES = 50_000;
          let droppedFullWorkspaces = false;
          if (parsed.fullWorkspaces && JSON.stringify(user).length > MAX_USER_RESPONSE_BYTES) {
            user = await client.getCurrentUser({ fullWorkspaces: false });
            droppedFullWorkspaces = true;
          }
          const result: Record<string, unknown> = {
            authMode: "oauth",
            user,
            mode: user.bot ? "role-filler" : "assistant",
            hint: user.bot
              ? "You are a bot energizing roles. You have no authority as an agent — only through the roles you fill. Act autonomously within your roles' accountabilities. Process tensions proactively."
              : "You are assisting a human who energizes roles. Defer to them for decisions. Help them articulate tensions and navigate governance.",
          };
          if (droppedFullWorkspaces) {
            result.warning = "fullWorkspaces was dropped because the response exceeded the size limit. Use nestr_list_workspaces to browse workspaces individually.";
          }
          return formatResult(result);
        } catch (err) {
          // If the error is from the tokenProvider (expired OAuth session),
          // surface it instead of silently falling back to workspace mode.
          // This prevents get_me from masking expired sessions as "api-key" mode.
          if (err instanceof NestrApiError && err.message === "OAuth session expired") {
            throw err;
          }
          // getCurrentUser fails for workspace API keys — no user identity
          return formatResult({
            authMode: "api-key",
            user: null,
            mode: "workspace",
            hint: "Using a workspace API key. No user identity — user-scoped features (inbox, daily plan, personal labels, my tensions) are unavailable. You are managing the workspace directly.",
          });
        }
      }

      // User tension tools (requires OAuth token)
      case "nestr_list_my_tensions": {
        const parsed = schemas.listMyTensions.parse(args);
        const tensions = await client.listMyTensions({ context: parsed.context });
        return formatResult(compactResponse(tensions));
      }

      case "nestr_list_tensions_awaiting_consent": {
        const parsed = schemas.listTensionsAwaitingConsent.parse(args);
        const tensions = await client.listTensionsAwaitingConsent({ context: parsed.context });
        return formatResult(compactResponse(tensions));
      }

      // Notification tools (requires OAuth token)
      case "nestr_list_notifications": {
        const parsed = schemas.listNotifications.parse(args);
        const notifications = await client.listNotifications({
          type: parsed.type,
          limit: parsed.limit,
          skip: parsed.skip,
          showRead: parsed.showRead,
          group: parsed.group,
        });
        return formatResult(notifications);
      }

      case "nestr_mark_notifications_read": {
        schemas.markNotificationsRead.parse(args);
        const result = await client.markNotificationsRead();
        return formatResult(result);
      }

      // Tension tools
      case "nestr_create_tension": {
        const parsed = schemas.createTension.parse(args);
        const fields: Record<string, unknown> = {};
        if (parsed.feeling) fields["tension.feeling"] = parsed.feeling;
        if (parsed.needs) fields["tension.needs"] = parsed.needs;
        const tension = await client.createTension(parsed.nestId, {
          title: parsed.title,
          description: parsed.description,
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
        });
        return formatResult({ message: "Tension created successfully", tension });
      }

      case "nestr_get_tension": {
        const parsed = schemas.getTension.parse(args);
        const tension = await client.getTension(
          parsed.nestId,
          parsed.tensionId,
          { cleanText: true }
        );
        return formatResult(tension);
      }

      case "nestr_list_tensions": {
        const parsed = schemas.listTensions.parse(args);
        const tensions = await client.listTensions(
          parsed.nestId,
          parsed.search,
          { limit: parsed.limit, order: parsed.order, cleanText: true }
        );
        return formatResult(compactResponse(tensions));
      }

      case "nestr_update_tension": {
        const parsed = schemas.updateTension.parse(args);
        const fields: Record<string, unknown> = {};
        if (parsed.feeling !== undefined) fields["tension.feeling"] = parsed.feeling;
        if (parsed.needs !== undefined) fields["tension.needs"] = parsed.needs;
        const tension = await client.updateTension(
          parsed.nestId,
          parsed.tensionId,
          {
            title: parsed.title,
            description: parsed.description,
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
          }
        );
        return formatResult({ message: "Tension updated successfully", tension });
      }

      case "nestr_delete_tension": {
        const parsed = schemas.deleteTension.parse(args);
        await client.deleteTension(parsed.nestId, parsed.tensionId);
        return formatResult({ message: `Tension ${parsed.tensionId} deleted successfully` });
      }

      case "nestr_get_tension_parts": {
        const parsed = schemas.getTensionParts.parse(args);
        const parts = await client.getTensionParts(
          parsed.nestId,
          parsed.tensionId,
          { cleanText: true }
        );
        return formatResult(parts);
      }

      case "nestr_add_tension_part": {
        const parsed = schemas.addTensionPart.parse(args);
        const { nestId, tensionId, ...body } = parsed;

        if (body._id) {
          // Propose change to existing item (existing children auto-copied if accountabilities/domains not provided)
          const part = await client.proposeTensionChange(nestId, tensionId, body);
          return formatResult({ message: "Change proposal added successfully", part });
        } else {
          // Propose new item
          const part = await client.createTensionPart(nestId, tensionId, body);
          return formatResult({ message: "New item proposal added successfully", part });
        }
      }

      case "nestr_modify_tension_part": {
        const parsed = schemas.modifyTensionPart.parse(args);
        const { nestId, tensionId, partId, ...data } = parsed;
        const part = await client.modifyTensionPart(nestId, tensionId, partId, data);
        return formatResult({ message: "Tension part modified successfully", part });
      }

      case "nestr_remove_tension_part": {
        const parsed = schemas.removeTensionPart.parse(args);
        await client.removeTensionPart(parsed.nestId, parsed.tensionId, parsed.partId);
        return formatResult({ message: `Tension part ${parsed.partId} removed successfully` });
      }

      case "nestr_get_tension_part_children": {
        const parsed = schemas.getTensionPartChildren.parse(args);
        const children = await client.getTensionPartChildren(
          parsed.nestId,
          parsed.tensionId,
          parsed.partId
        );
        return formatResult(children);
      }

      case "nestr_create_tension_part_child": {
        const parsed = schemas.createTensionPartChild.parse(args);
        const child = await client.createTensionPartChild(
          parsed.nestId,
          parsed.tensionId,
          parsed.partId,
          { title: parsed.title, labels: parsed.labels }
        );
        return formatResult({ message: "Child created successfully", child });
      }

      case "nestr_update_tension_part_child": {
        const parsed = schemas.updateTensionPartChild.parse(args);
        const child = await client.updateTensionPartChild(
          parsed.nestId,
          parsed.tensionId,
          parsed.partId,
          parsed.childId,
          { title: parsed.title }
        );
        return formatResult({ message: "Child updated successfully", child });
      }

      case "nestr_delete_tension_part_child": {
        const parsed = schemas.deleteTensionPartChild.parse(args);
        await client.deleteTensionPartChild(
          parsed.nestId,
          parsed.tensionId,
          parsed.partId,
          parsed.childId
        );
        return formatResult({ message: `Child ${parsed.childId} soft-deleted successfully` });
      }

      case "nestr_get_tension_changes": {
        const parsed = schemas.getTensionChanges.parse(args);
        const changes = await client.getTensionPartChanges(
          parsed.nestId,
          parsed.tensionId,
          parsed.partId
        );
        return formatResult(changes);
      }

      case "nestr_get_tension_status": {
        const parsed = schemas.getTensionStatus.parse(args);
        const status = await client.getTensionStatus(parsed.nestId, parsed.tensionId);
        return formatResult(status);
      }

      case "nestr_update_tension_status": {
        const parsed = schemas.updateTensionStatus.parse(args);
        const status = await client.updateTensionStatus(
          parsed.nestId,
          parsed.tensionId,
          parsed.status
        );
        return formatResult({ message: `Tension status updated to '${parsed.status}'`, status });
      }

      // Graph link tools
      case "nestr_get_graph_links": {
        const parsed = schemas.getGraphLinks.parse(args);
        const result = await client.getGraphLinks(parsed.nestId, parsed.relation, {
          direction: parsed.direction,
          limit: parsed.limit,
          page: parsed.page,
        });
        return formatResult(compactResponse(result));
      }

      case "nestr_add_graph_link": {
        const parsed = schemas.addGraphLink.parse(args);
        const result = await client.addGraphLink(parsed.nestId, parsed.relation, parsed.targetId);
        return formatResult(result);
      }

      case "nestr_remove_graph_link": {
        const parsed = schemas.removeGraphLink.parse(args);
        const result = await client.removeGraphLink(parsed.nestId, parsed.relation, parsed.targetId);
        return formatResult({ message: "Graph link removed" });
      }

      default:
        return formatError({
          error: true,
          code: "UNKNOWN",
          message: `Unknown tool: ${name}`,
          retryable: false,
          hint: "Check available tools with the MCP tools/list endpoint.",
        });
    }
  } catch (error) {
    // Handle Nestr API errors with structured response
    if (error instanceof NestrApiError) {
      return formatError(error.toToolError());
    }

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return formatError({
        error: true,
        code: "VALIDATION",
        message: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; "),
        retryable: false,
        hint: "Check the tool parameters match the expected schema.",
      });
    }

    // Handle other errors
    const message = error instanceof Error ? error.message : "Unknown error";
    return formatError({
      error: true,
      code: "UNKNOWN",
      message,
      retryable: false,
    });
  }
}

function formatResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function formatError(error: ToolError): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(error, null, 2),
      },
    ],
    isError: true,
  };
}
