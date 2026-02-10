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

// Fields to keep for compact list responses (reduces token usage)
const COMPACT_FIELDS = {
  // Common fields for all nests (includes fields needed by the completable list app)
  base: ["_id", "title", "purpose", "completed", "labels", "path", "description", "due"],
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
  }),

  getNest: z.object({
    nestId: z.string().describe("Nest ID"),
    fieldsMetaData: z.boolean().optional().describe("Set to true to include field schema metadata (e.g., available options for project.status)"),
  }),

  getNestChildren: z.object({
    nestId: z.string().describe("Parent nest ID"),
    limit: z.number().optional().describe("Max results per page. Omit to see full count in meta.total."),
    page: z.number().optional().describe("Page number for pagination"),
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
    data: z.record(z.unknown()).optional().describe("Data updates (e.g., { botContext: 'Key info...' }, plain text)"),
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
      },
      required: ["workspaceId", "query"],
    },
    _meta: completableListUi,
  },
  {
    name: "nestr_get_nest",
    description: "Get details of a specific nest (task, project, role, etc.). Use fieldsMetaData=true to get field schema info like available options for project.status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID" },
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
    description: "Update properties of an existing nest. Use parentId to move a nest (e.g., inbox item to a project). Use data.botContext to store AI context (plain text) that persists across sessions.",
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
          description: "Data updates (e.g., { botContext: 'Key info here...' } for AI memory, plain text)",
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
    description: "List items in the user's inbox. The inbox is a collection point for 'stuff' that needs processing - ideas, tasks, notes captured quickly without organizing. Requires OAuth token (won't work with workspace API keys).",
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
    description: "Quick capture: add an item to the user's inbox for later processing. Use for capturing thoughts, ideas, or tasks without worrying about where they belong. Requires OAuth token.",
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
    description: "Get the user's daily plan - items marked for 'today'. Returns todos and projects the user has added to their daily focus list by applying the 'now' label. Use this to help users plan their day or review what's on their plate. Note: Only includes items from inbox and in-scope workspaces (token scope may limit results). Requires OAuth token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        stripDescription: { type: "boolean", description: "Set true to strip description fields from response, significantly reducing size." },
      },
    },
    _meta: completableListUi,
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
        return formatResult(compactResponse(results));
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
        return formatResult(compactResponse(children));
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
        return formatResult(compactResponse(projects));
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
        return formatResult(compactResponse(items));
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

      // Daily plan (requires OAuth token)
      case "nestr_get_daily_plan": {
        schemas.getDailyPlan.parse(args);
        const items = await client.getDailyPlan();
        return formatResult(compactResponse(items));
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
