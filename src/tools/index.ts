/**
 * MCP Tools for Nestr
 * Defines all available tools and their handlers
 */

import { z } from "zod";
import { NestrApiError, type NestrClient, type ToolError, type ErrorCode } from "../api/client.js";
import { appResources } from "../apps/index.js";

// MCP Apps UI metadata for tools that can render in the completable list app.
// IMPORTANT: Only use for completable items (tasks, projects, todos, inbox items).
// Do NOT use for structural nests like roles, circles, metrics, policies, etc.
const completableListUi = { ui: { resourceUri: appResources.completableList.uri } };

// Sources for the completable list app - tells the UI which reorder API to use
type CompletableSource = "inbox" | "daily-plan" | "children" | "projects" | "search";

// Wrap a compacted response with title and source for the completable list app
function completableResponse(
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
  base: ["_id", "title", "purpose", "completed", "labels", "path", "parentId", "ancestors", "description", "due"],
  // Additional fields for roles
  role: ["accountabilities", "domains"],
  // Additional fields for users
  user: ["_id", "username", "profile"],
  // Additional fields for labels
  label: ["_id", "title"],
};

// Strip verbose fields from API responses for list operations
function compactResponse<T>(
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
    purpose: z.string().optional().describe("Workspace purpose or description"),
    type: z.enum(['personal', 'collaborative']).optional().describe("'personal' for individual use (free forever), 'collaborative' for team use (free trial, then paid). Defaults to 'collaborative'."),
    governance: z.enum(['holacracy', 'sociocracy', 'roles_circles']).optional().describe("Self-organization model. Defaults to 'roles_circles' (generic role-based)."),
    plan: z.enum(['starter', 'pro']).optional().describe("Subscription plan for collaborative workspaces. Defaults to 'pro' (17-day trial)."),
    apps: z.array(z.enum(['okr', 'feedback', 'insights'])).optional().describe("Apps to enable (e.g., ['okr', 'feedback']). 'insights' requires pro plan."),
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
  }),

  getNestChildren: z.object({
    nestId: z.string().describe("Parent nest ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
    _listTitle: z.string().optional().describe("Short descriptive title for the list UI (e.g., \"Tasks for Website Redesign\"). Omit for default."),
  }),

  createNest: z.object({
    parentId: z.string().describe("Parent nest ID (workspace, circle, or project)"),
    title: z.string().describe("Title of the new nest (plain text, HTML stripped)"),
    purpose: z.string().optional().describe("Purpose - why this nest exists (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)"),
    description: z.string().optional().describe("Detailed description (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)"),
    labels: z.array(z.string()).optional().describe("Label IDs to apply"),
    users: z.array(z.string()).optional().describe("User IDs to assign (required for tasks/projects to associate with a person)"),
  }),

  updateNest: z.object({
    nestId: z.string().describe("Nest ID to update"),
    title: z.string().optional().describe("New title (plain text, HTML stripped)"),
    purpose: z.string().optional().describe("New purpose (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)"),
    description: z.string().optional().describe("New description (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)"),
    parentId: z.string().optional().describe("New parent ID (move nest to different location, e.g., move inbox item to a role or project)"),
    labels: z.array(z.string()).optional().describe("Label IDs to set (e.g., ['project'] to convert an item into a project)"),
    fields: z.record(z.unknown()).optional().describe("Field updates (e.g., { 'project.status': 'Current' })"),
    users: z.array(z.string()).optional().describe("User IDs to assign"),
    data: z.record(z.unknown()).optional().describe("Key-value data store shared with Nestr internals — never overwrite existing keys. Namespace your own data under 'mcp.' (e.g., { 'mcp.lastSync': '...' }). For AI knowledge persistence, use skills instead."),
    due: z.string().optional().describe("Due date (ISO format). For projects/tasks: deadline. For roles: re-election date. For meetings: start time."),
    completed: z.boolean().optional().describe("Mark task as completed (root-level field, not in fields). Note: Projects use fields['project.status'] = 'Done' instead."),
  }),

  deleteNest: z.object({
    nestId: z.string().describe("Nest ID to delete"),
  }),

  addComment: z.object({
    nestId: z.string().describe("Nest ID to comment on"),
    body: z.string().describe("Comment text (supports HTML and @mentions)"),
  }),

  updateComment: z.object({
    commentId: z.string().describe("Comment ID to update"),
    body: z.string().describe("Updated comment text (supports HTML and @mentions)"),
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
    includeSubCircles: z.boolean().optional().describe("Include metrics from sub-circles"),
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
    completedAfter: z.string().optional().describe("Include completed items from this date (ISO format). If omitted, only non-completed items are returned."),
  }),

  createInboxItem: z.object({
    title: z.string().describe("Title of the inbox item (plain text, HTML stripped)"),
    description: z.string().optional().describe("Additional details or context (supports HTML)"),
  }),

  getInboxItem: z.object({
    nestId: z.string().describe("Inbox item ID"),
  }),

  updateInboxItem: z.object({
    nestId: z.string().describe("Inbox item ID"),
    title: z.string().optional().describe("Updated title (plain text, HTML stripped)"),
    description: z.string().optional().describe("Updated description (supports HTML)"),
    completed: z.boolean().optional().describe("Mark as completed (processed)"),
    data: z.record(z.unknown()).optional().describe("Custom data storage"),
  }),

  reorderInbox: z.object({
    nestIds: z.array(z.string()).describe("Array of inbox item IDs in the desired order"),
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
    nestIds: z.array(z.string()).describe("Array of nest IDs to add to the daily plan"),
  }),

  removeFromDailyPlan: z.object({
    nestIds: z.array(z.string()).describe("Array of nest IDs to remove from the daily plan"),
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
    nestIds: z.array(z.string()).describe("Array of nest IDs in the desired order"),
  }),

  // Daily plan (requires OAuth token)
  getDailyPlan: z.object({}),

  // Current user identity (requires OAuth token)
  getMe: z.object({}),

  // User tension tools (requires OAuth token)
  listMyTensions: z.object({
    context: z.string().optional().describe("Optional context filter (e.g., workspace ID or circle ID)"),
  }),

  listTensionsAwaitingConsent: z.object({
    context: z.string().optional().describe("Optional context filter (e.g., workspace ID or circle ID)"),
  }),

  // Tension tools
  createTension: z.object({
    nestId: z.string().describe("ID of the circle or role to create the tension on"),
    title: z.string().describe("The gap you're sensing — what is the difference between current reality and desired state (plain text)"),
    description: z.string().optional().describe("The observable facts — what you see/hear/experience that creates this tension (supports HTML)"),
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
    description: z.string().optional().describe("Updated description — the observable facts (supports HTML)"),
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
    labels: z.array(z.string()).optional().describe("Labels defining the item type (e.g., ['role'], ['circle'], ['policy'], ['accountability'], ['domain'])"),
    purpose: z.string().optional().describe("Purpose of the item (supports HTML)"),
    description: z.string().optional().describe("Description (supports HTML)"),
    parentId: z.string().optional().describe("Parent ID — use to move/restructure items (e.g., move role to different circle)"),
    users: z.array(z.string()).optional().describe("User IDs to assign (e.g., for role elections: assign the elected user to the role)"),
    due: z.string().optional().describe("Due date / re-election date (ISO format)"),
    accountabilities: z.array(z.string()).optional().describe("Accountability titles to set on a role (replaces all — use children endpoint for individual management)"),
    domains: z.array(z.string()).optional().describe("Domain titles to set on a role (replaces all — use children endpoint for individual management)"),
  }),

  modifyTensionPart: z.object({
    nestId: z.string().describe("ID of the circle or role the tension belongs to"),
    tensionId: z.string().describe("Tension ID"),
    partId: z.string().describe("Part ID to modify"),
    title: z.string().optional().describe("Updated title"),
    purpose: z.string().optional().describe("Updated purpose (supports HTML)"),
    description: z.string().optional().describe("Updated description (supports HTML)"),
    labels: z.array(z.string()).optional().describe("Updated labels"),
    parentId: z.string().optional().describe("Updated parent ID"),
    users: z.array(z.string()).optional().describe("Updated user assignments"),
    due: z.string().optional().describe("Updated due date (ISO format)"),
    accountabilities: z.array(z.string()).optional().describe("Updated accountabilities (replaces all — use children endpoint for individual management)"),
    domains: z.array(z.string()).optional().describe("Updated domains (replaces all — use children endpoint for individual management)"),
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
    labels: z.array(z.string()).describe("Labels defining the type: ['accountability'] or ['domain']"),
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
};

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: "nestr_list_workspaces",
    description: "List all Nestr workspaces you have access to. Response includes meta.total showing total count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Search query to filter workspaces" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed) for pagination" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for bulk/index operations." },
      },
    },
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
  },
  {
    name: "nestr_create_workspace",
    description: `Create a new workspace. Use this rarely - mainly when a user has no workspaces (e.g., new signup).

**If the user has no workspaces, they must create one first using this tool before they can do anything else in Nestr.**

A workspace is a container for work - either personal or collaborative:
- **Personal**: For individual use, free forever. Only you have access.
- **Collaborative**: For teams, starts with free trial (no auto-payment - user must explicitly activate).

The creator is the only one with access initially. Others must be explicitly invited. Safe to create and test - no one else will see it.

**Important**: Always ask the user to provide a purpose - why does this workspace exist? What is it trying to achieve? They can always change it later, but starting with a clear purpose is valuable. Probe them for the why, but create the workspace with or without it.

Requires user-scoped authentication (OAuth token or personal API key with user scope).`,
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Workspace name" },
        purpose: { type: "string", description: "Workspace purpose or description" },
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
  },
  {
    name: "nestr_search",
    description: "Search for nests within a workspace. Supports operators: label:, parent-label:, assignee: (me/userId/!userId/none), admin:, createdby:, completed:, type:, has: (due/pastdue/children/incompletechildren), depth:, mindepth:, in:, updated-date:, limit:, template:, data.property:, fields.{label}.{property}: to search any value in a nest's fields object (supports partial match, e.g., fields.project.status:Current — use nestr_get_nest with fieldsMetaData=true to discover available fields), label->field:value. Use ! prefix for negation. IMPORTANT: Use completed:false when searching for work to exclude old completed items. Response includes meta.total showing total matching count. NOTE: The completable list UI app should ONLY be used when results are completable items (tasks, projects, todos). Do NOT use the app for any other type of nest.",
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
    _meta: completableListUi,
  },
  {
    name: "nestr_get_nest",
    description: "Get details of a specific nest (task, project, role, etc.). Supports fetching multiple nests in one call by passing comma-separated IDs (returns an array). Use fieldsMetaData=true to get field schema info like available options for project.status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID, or comma-separated IDs to fetch multiple nests at once (e.g., 'id1,id2,id3'). Keep total URL under 2000 chars." },
        fieldsMetaData: { type: "boolean", description: "Set to true to include field schema metadata (available options, field types)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_get_nest_children",
    description: "Get child nests (sub-tasks, sub-projects) of a nest. Response includes meta.total showing total matching count. NOTE: The completable list UI app should ONLY be used when results are completable items (tasks, projects, todos). Do NOT use the app for any other type of nest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Parent nest ID" },
        limit: { type: "number", description: "Omit on first call to see meta.total count" },
        page: { type: "number", description: "Page number (1-indexed)" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size. Ideal for bulk/index operations." },
        _listTitle: { type: "string", description: "Short descriptive title for the list UI header (e.g., \"Tasks for Website Redesign\", \"API project sub-tasks\"). Include the parent name for context." },
      },
      required: ["nestId"],
    },
    _meta: completableListUi,
  },
  {
    name: "nestr_create_nest",
    description: "Create a new nest (task, project, etc.) under a parent. Set users to assign to people - placing under a role does NOT auto-assign.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parentId: { type: "string", description: "Parent nest ID (workspace, circle, or project)" },
        title: { type: "string", description: "Title of the new nest (plain text, HTML tags stripped)" },
        purpose: { type: "string", description: "Purpose - why this nest exists (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)" },
        description: { type: "string", description: "Detailed description (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)" },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs to apply (e.g., 'project', 'todo')",
        },
        users: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to assign (required for tasks/projects to associate with a person)",
        },
      },
      required: ["parentId", "title"],
    },
  },
  {
    name: "nestr_update_nest",
    description: "Update properties of an existing nest. Use parentId to move a nest (e.g., inbox item to a project). For AI knowledge persistence, create skill-labeled nests under roles/circles instead of using data fields.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to update" },
        title: { type: "string", description: "New title (plain text, HTML tags stripped)" },
        purpose: { type: "string", description: "New purpose (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)" },
        description: { type: "string", description: "New description (supports HTML: <b>, <i>, <code>, <ul>, <li>, <a>)" },
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
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_delete_nest",
    description: "Delete a nest (use with caution)",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to delete" },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_add_comment",
    description: "Add a comment to a nest. Use @username to mention someone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to comment on" },
        body: { type: "string", description: "Comment text (supports HTML and @mentions)" },
      },
      required: ["nestId", "body"],
    },
  },
  {
    name: "nestr_update_comment",
    description: "Update an existing comment's text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: { type: "string", description: "Comment ID to update" },
        body: { type: "string", description: "Updated comment text (supports HTML and @mentions)" },
      },
      required: ["commentId", "body"],
    },
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
  },
  {
    name: "nestr_get_insights",
    description: "Get self-organization and team health metrics. Includes: role-awareness (how well people use their roles), governance participation, circle meeting output, plus task completion rates, overdue items, and activity stats. Pro accounts can access these metrics at circle and user level; other accounts get workspace-level insights only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        includeSubCircles: { type: "boolean", description: "Include metrics from sub-circles" },
      },
      required: ["workspaceId"],
    },
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
  },
  {
    name: "nestr_get_projects",
    description: "List all projects in a workspace. Check fields['project.status'] for status: Future (planned), Current (active), Waiting (blocked), Done (completed). The 'due' field contains the project due date. Response includes meta.total showing total matching count.",
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
  },
  {
    name: "nestr_get_comments",
    description: "Get comments and discussion history on a nest. Useful for understanding context, decisions made, and team communication around a task or project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to get comments from" },
        depth: { type: "number", description: "Comment thread depth (default: all)" },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_get_circle",
    description: "Get details of a specific circle including its purpose, domains, and accountabilities. Circles are self-governing teams in Holacracy/Sociocracy.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        circleId: { type: "string", description: "Circle ID" },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
      required: ["workspaceId", "circleId"],
    },
  },
  {
    name: "nestr_get_user",
    description: "Get details of a specific user including their profile, roles, and contact info. Useful for @mentions and understanding who is responsible for what.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["workspaceId", "userId"],
    },
  },
  {
    name: "nestr_add_workspace_user",
    description: `Add a user to a workspace by email address. If the user already has a Nestr account, they are added to the workspace. If not, a new account is created and they receive an invitation email.

**Requirements:**
- Caller must be a workspace admin (user-scoped key) or use a workspace API key
- If the user does not yet have a Nestr account, the email domain must be associated with and verified for the workspace — otherwise provisioning will fail with a 405 error
- If the user already exists in Nestr, they can be added regardless of domain`,
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
  },
  {
    name: "nestr_get_label",
    description: "Get details of a specific label. Labels define what type a nest is (e.g., 'project', 'todo', 'role', 'circle', 'meeting').",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        labelId: { type: "string", description: "Label ID" },
      },
      required: ["workspaceId", "labelId"],
    },
  },
  {
    name: "nestr_get_insight_history",
    description: "Get historical trend data for a specific metric. Use after getInsights to see how metrics like role-awareness, governance participation, or completion rates have changed over time.",
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
  },
  {
    name: "nestr_get_workspace_apps",
    description: "List enabled apps/features in a workspace. Shows which Nestr modules are active (e.g., goals, metrics, notes, feed). Check this before using features - if an app is disabled, its related tools won't return useful data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
  },
  // Inbox tools (require OAuth token - won't work with workspace API keys)
  {
    name: "nestr_list_inbox",
    description: "List items in the user's personal inbox. The inbox holds unprocessed 'stuff' — sensed tensions, ideas, and captured items that haven't yet been differentiated into role work or personal projects. Spans all workspaces in scope. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        completedAfter: { type: "string", description: "Include completed items from this date (ISO format). If omitted, only non-completed items are returned." },
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
    },
    _meta: completableListUi,
  },
  {
    name: "nestr_create_inbox_item",
    description: "Quick capture: add an item to the user's personal inbox for later processing. Use for capturing sensed tensions, thoughts, or ideas before deciding which workspace, role, or personal context they belong to. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Title of the inbox item (plain text, HTML stripped)" },
        description: { type: "string", description: "Additional details or context (supports HTML)" },
      },
      required: ["title"],
    },
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
  },
  {
    name: "nestr_update_inbox_item",
    description: "Update an inbox item. Set completed:true when processed. To move out of inbox (clarify/organize), use nestr_update_nest to change parentId to a project, role, or other location. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Inbox item ID" },
        title: { type: "string", description: "Updated title (plain text, HTML stripped)" },
        description: { type: "string", description: "Updated description (supports HTML)" },
        completed: { type: "boolean", description: "Mark as completed (processed)" },
        data: { type: "object", description: "Custom data storage" },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_reorder_inbox",
    description: "Reorder inbox items by providing an array of item IDs in the desired order. You can provide a subset of items - they will be placed at the top in the given order, with remaining items unchanged below. Requires OAuth token.",
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
  },
  // Personal labels (require OAuth token - user's own labels, not workspace labels)
  {
    name: "nestr_list_personal_labels",
    description: "List the current user's personal labels. These are labels owned by the user, not workspace labels. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "nestr_create_personal_label",
    description: "Create a new personal label for the current user. Personal labels are owned by the user and can be used across workspaces. Requires OAuth token.",
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
  },
  // Reorder tools
  {
    name: "nestr_reorder_nest",
    description: "Reorder a nest by positioning it before or after another nest. Updates searchOrder (global sort order) and order (if both nests share the same parent). Use this to change the display order of items.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the nest to reorder" },
        position: { type: "string", enum: ["before", "after"], description: "Position relative to the reference nest" },
        relatedNestId: { type: "string", description: "ID of the reference nest to position relative to" },
      },
      required: ["nestId", "position", "relatedNestId"],
    },
  },
  {
    name: "nestr_bulk_reorder",
    description: "Bulk reorder multiple nests by providing an array of nest IDs in the desired order. You can provide a subset of items - they will be placed at the top in the given order, with remaining items unchanged below. Useful for large containers or search results where you only need to reorder a few items. Updates searchOrder for all nests and order for nests sharing the same parent.",
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
  },
  // Daily plan (requires OAuth token)
  {
    name: "nestr_get_daily_plan",
    description: "Get the user's personal daily plan - items marked for 'today'. Returns todos and projects across all contexts: role work from any workspace, personal projects, errands, or anything else the user has chosen to focus on today. Spans all workspaces in scope. Note: Token scope may limit which workspaces are included. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
    },
    _meta: completableListUi,
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
  },
  // Current user identity
  {
    name: "nestr_get_me",
    description: "Get the current authenticated identity and operating mode. Returns user info including `bot: true` if the agent energizes roles directly (role-filler mode) or absent/false if assisting a human who energizes roles. Returns `authMode: 'api-key'` when using a workspace API key (no user identity, no user-scoped features). Call at session start to determine how to behave. Requires OAuth token for full user info; gracefully handles API key auth.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  // User tension tools (requires OAuth token)
  {
    name: "nestr_list_my_tensions",
    description: "List tensions created by or assigned to the current user. Tensions are the primary communication mechanism between roles — check at natural breakpoints: session start, after completing work, when user asks what to do next. Returns both authored and assigned tensions across all workspaces. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        context: { type: "string", description: "Optional context filter (e.g., workspace ID or circle ID)" },
      },
    },
  },
  {
    name: "nestr_list_tensions_awaiting_consent",
    description: "List tensions awaiting the current user's consent vote. Returns governance proposals and other tensions that need the user's input. Check proactively — unprocessed tensions block organizational progress. Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        context: { type: "string", description: "Optional context filter (e.g., workspace ID or circle ID)" },
      },
    },
  },
  // Tension tools
  {
    name: "nestr_create_tension",
    description: "Create a new tension — the fundamental unit of inter-role communication. Tensions represent a gap between current reality and potential. Use for ALL cross-role communication: requesting information, sharing information, requesting outcomes/projects, requesting actions/tasks, or setting expectations (governance). The parent nest must be a role, circle, or anchor-circle.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role to create the tension on" },
        title: { type: "string", description: "The gap — what is the difference between current reality and desired state (plain text)" },
        description: { type: "string", description: "The observable facts — what you see/hear/experience (supports HTML)" },
        feeling: { type: "string", description: "The feeling this tension evokes — separated to keep the organizational response clean (plain text)" },
        needs: { type: "string", description: "The need that is alive — what personal or organizational need is not being met (plain text)" },
      },
      required: ["nestId", "title"],
    },
  },
  {
    name: "nestr_get_tension",
    description: "Get a single tension including its current status (draft/proposed/accepted/objected). Use nestr_get_tension_status for detailed per-user voting responses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_list_tensions",
    description: "List tensions for a circle or role. Supports search query filtering. Use to find existing governance proposals or pending decisions.",
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
  },
  {
    name: "nestr_update_tension",
    description: "Update a tension's title, description, feeling, or needs. Use to refine the tension statement or add personal context before adding proposal parts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        title: { type: "string", description: "Updated title — the gap being sensed (plain text)" },
        description: { type: "string", description: "Updated description — the observable facts (supports HTML)" },
        feeling: { type: "string", description: "Updated feeling this tension evokes (plain text)" },
        needs: { type: "string", description: "Updated need that is alive (plain text)" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_delete_tension",
    description: "Delete a tension (soft delete). Use when a tension is no longer relevant or was created in error.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID to delete" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_get_tension_parts",
    description: "Get all parts of a tension. Each part contains items representing proposed governance changes (with action: create/update/delete/role2circle/circle2role). Review parts to understand what a tension proposes before submitting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_add_tension_part",
    description: `Add a governance change to a tension. Three modes based on input:

**New item** (no _id): Propose creating a new governance item. Provide title and labels (e.g., ["role"], ["circle"], ["policy"], ["accountability"], ["domain"]). For roles, include accountabilities and/or domains as bulk shorthand.

**Change existing item** (_id provided): Propose changes to an existing governance item. Provide the _id of the item plus fields to change. Supports title/purpose changes, restructuring (parentId to move between circles), conversions (labels to convert role↔circle), user assignment changes (for elections), and accountability/domain changes. When updating a role with _id, if accountabilities/domains arrays are not provided, existing children are auto-copied into the proposal — use nestr_get_tension_part_children to list them and manage individually.

**Remove existing item** (_id only, no other fields): Use nestr_remove_tension_part after adding the part, or use DELETE /parts to propose removal.

The accountabilities/domains arrays are bulk shorthand — they replace all children at once. For individual management (rename, add, remove single accountabilities/domains), use the tension part children tools instead.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        _id: { type: "string", description: "ID of an existing governance item to change or remove. Omit to propose a new item." },
        title: { type: "string", description: "Title for the governance item" },
        labels: { type: "array", items: { type: "string" }, description: "Labels defining the item type (e.g., ['role'], ['circle'], ['policy'], ['accountability'], ['domain'])" },
        purpose: { type: "string", description: "Purpose of the item (supports HTML)" },
        description: { type: "string", description: "Description (supports HTML)" },
        parentId: { type: "string", description: "Parent ID — use to move/restructure items (e.g., move role to different circle)" },
        users: { type: "array", items: { type: "string" }, description: "User IDs to assign (e.g., for elections: assign elected user to the role)" },
        due: { type: "string", description: "Due date / re-election date (ISO format)" },
        accountabilities: { type: "array", items: { type: "string" }, description: "Accountability titles to set on a role (replaces all — use children endpoint for individual management)" },
        domains: { type: "array", items: { type: "string" }, description: "Domain titles to set on a role (replaces all — use children endpoint for individual management)" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_modify_tension_part",
    description: "Modify an existing proposal part. Use to refine proposed values after initial creation — e.g., adjust a role's title or purpose. For individual accountability/domain changes, prefer the children endpoint (nestr_get_tension_part_children, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to modify" },
        title: { type: "string", description: "Updated title" },
        purpose: { type: "string", description: "Updated purpose (supports HTML)" },
        description: { type: "string", description: "Updated description (supports HTML)" },
        labels: { type: "array", items: { type: "string" }, description: "Updated labels" },
        parentId: { type: "string", description: "Updated parent ID" },
        users: { type: "array", items: { type: "string" }, description: "Updated user assignments" },
        due: { type: "string", description: "Updated due date (ISO format)" },
        accountabilities: { type: "array", items: { type: "string" }, description: "Updated accountabilities (replaces all — use children endpoint for individual management)" },
        domains: { type: "array", items: { type: "string" }, description: "Updated domains (replaces all — use children endpoint for individual management)" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
  },
  {
    name: "nestr_remove_tension_part",
    description: "Remove a part from the proposal entirely, or propose deletion of a governance item. When used on a part that references an existing item (_id), this proposes removal of that governance item. When used on a part for a new item, it simply removes the proposal part.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to remove from the proposal" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
  },
  {
    name: "nestr_get_tension_part_children",
    description: "List children (accountabilities/domains) of a proposal part. When a part proposes changes to an existing role (_id), existing accountabilities/domains are auto-copied into the proposal. Use this to see them and then manage individually with create/update/delete children tools.",
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
    description: "Get the namespaced diff for a proposal part. Returns { nestId, variable, newValue, oldValue } entries showing exactly what will change. Variables are namespaced: role.title, accountability.title, domain.title, policy.title, etc. For creates: oldValue is null. For deletes: newValue is null.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        partId: { type: "string", description: "Part ID to get changes for" },
      },
      required: ["nestId", "tensionId", "partId"],
    },
  },
  {
    name: "nestr_get_tension_status",
    description: "Get detailed status of a tension including per-user voting responses. Returns status (draft/proposed/accepted/objected), individual responses with timestamps, and auto-approval date if set. Use this to check who has voted and the current decision state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
      },
      required: ["nestId", "tensionId"],
    },
  },
  {
    name: "nestr_update_tension_status",
    description: "Submit a tension for voting (set to 'proposed') or retract it back to draft. Submitting triggers the async consent/voting process — circle members are notified and can accept or object. Retracting returns it to draft for further editing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "ID of the circle or role the tension belongs to" },
        tensionId: { type: "string", description: "Tension ID" },
        status: { type: "string", enum: ["proposed", "draft"], description: "'proposed' to submit for voting, 'draft' to retract back to draft" },
      },
      required: ["nestId", "tensionId", "status"],
    },
  },
];

// Tool handler type
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Strip description fields from nest objects in response data
function stripDescriptionFields(data: unknown): unknown {
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
        });
        return formatResult(nest);
      }

      case "nestr_get_nest_children": {
        const parsed = schemas.getNestChildren.parse(args);
        const children = await client.getNestChildren(parsed.nestId, {
          limit: parsed.limit,
          page: parsed.page,
          cleanText: true,
        });
        return formatResult(completableResponse(compactResponse(children), "children", parsed._listTitle || "Sub-items"));
      }

      case "nestr_create_nest": {
        const parsed = schemas.createNest.parse(args);
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
        });
        return formatResult(insights);
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

      // Current user identity
      case "nestr_get_me": {
        schemas.getMe.parse(args);
        try {
          const user = await client.getCurrentUser();
          return formatResult({
            authMode: "oauth",
            user,
            mode: user.bot ? "role-filler" : "assistant",
            hint: user.bot
              ? "You are a bot energizing roles. You have no authority as an agent — only through the roles you fill. Act autonomously within your roles' accountabilities. Process tensions proactively."
              : "You are assisting a human who energizes roles. Defer to them for decisions. Help them articulate tensions and navigate governance.",
          });
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
