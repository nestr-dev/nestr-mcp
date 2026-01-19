/**
 * MCP Tools for Nestr
 * Defines all available tools and their handlers
 */

import { z } from "zod";
import type { NestrClient } from "../api/client.js";

// Fields to keep for compact list responses (reduces token usage)
const COMPACT_FIELDS = {
  // Common fields for all nests
  base: ["_id", "title", "purpose"],
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
    limit: z.number().optional().describe("Maximum number of results"),
  }),

  getWorkspace: z.object({
    workspaceId: z.string().describe("Workspace ID"),
  }),

  search: z.object({
    workspaceId: z.string().describe("Workspace ID to search in"),
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(20).describe("Maximum results (default 20)"),
  }),

  getNest: z.object({
    nestId: z.string().describe("Nest ID"),
  }),

  getNestChildren: z.object({
    nestId: z.string().describe("Parent nest ID"),
  }),

  createNest: z.object({
    parentId: z.string().describe("Parent nest ID (workspace, circle, or project)"),
    title: z.string().describe("Title of the new nest"),
    purpose: z.string().optional().describe("Purpose or description"),
    labels: z.array(z.string()).optional().describe("Label IDs to apply"),
    users: z.array(z.string()).optional().describe("User IDs to assign (required for tasks/projects to associate with a person)"),
  }),

  updateNest: z.object({
    nestId: z.string().describe("Nest ID to update"),
    title: z.string().optional().describe("New title"),
    purpose: z.string().optional().describe("New purpose"),
    fields: z.record(z.unknown()).optional().describe("Field updates (e.g., status)"),
    users: z.array(z.string()).optional().describe("User IDs to assign"),
  }),

  deleteNest: z.object({
    nestId: z.string().describe("Nest ID to delete"),
  }),

  addComment: z.object({
    nestId: z.string().describe("Nest ID to comment on"),
    body: z.string().describe("Comment text (supports @mentions)"),
  }),

  listCircles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Maximum results"),
  }),

  getCircleRoles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    circleId: z.string().describe("Circle ID"),
  }),

  listRoles: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Maximum results"),
  }),

  getInsights: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    includeSubCircles: z.boolean().optional().describe("Include metrics from sub-circles"),
  }),

  listUsers: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    search: z.string().optional().describe("Search by name or email"),
  }),

  listLabels: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    search: z.string().optional().describe("Search query"),
  }),

  getProjects: z.object({
    workspaceId: z.string().describe("Workspace ID"),
    limit: z.number().optional().describe("Maximum results"),
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
};

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: "nestr_list_workspaces",
    description: "List all Nestr workspaces you have access to",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Search query to filter workspaces" },
        limit: { type: "number", description: "Maximum number of results" },
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
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "nestr_search",
    description: "Search for nests within a workspace. Supports operators: label:role (filter by type), assignee:me, completed:false, has:due, depth:1, project->status:Current (field values). Combine with spaces for AND, commas for OR. Examples: 'label:project assignee:me', 'label:role', 'marketing label:todo'",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID to search in" },
        query: { type: "string", description: "Search query with optional operators (e.g., 'label:role', 'assignee:me completed:false')" },
        limit: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["workspaceId", "query"],
    },
  },
  {
    name: "nestr_get_nest",
    description: "Get details of a specific nest (task, project, role, etc.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID" },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_get_nest_children",
    description: "Get child nests (sub-tasks, sub-projects) of a nest",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Parent nest ID" },
      },
      required: ["nestId"],
    },
  },
  {
    name: "nestr_create_nest",
    description: "Create a new nest (task, project, etc.) under a parent. Set users to assign to people - placing under a role does NOT auto-assign.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parentId: { type: "string", description: "Parent nest ID (workspace, circle, or project)" },
        title: { type: "string", description: "Title of the new nest" },
        purpose: { type: "string", description: "Purpose or description" },
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
    description: "Update properties of an existing nest",
    inputSchema: {
      type: "object" as const,
      properties: {
        nestId: { type: "string", description: "Nest ID to update" },
        title: { type: "string", description: "New title" },
        purpose: { type: "string", description: "New purpose" },
        fields: {
          type: "object",
          description: "Field updates (e.g., {status: 'done'})",
        },
        users: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to assign",
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
        body: { type: "string", description: "Comment text (supports @mentions)" },
      },
      required: ["nestId", "body"],
    },
  },
  {
    name: "nestr_list_circles",
    description: "List all circles (teams/departments) in a workspace",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Maximum results" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "nestr_get_circle_roles",
    description: "Get all roles within a specific circle, including accountabilities",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        circleId: { type: "string", description: "Circle ID" },
      },
      required: ["workspaceId", "circleId"],
    },
  },
  {
    name: "nestr_list_roles",
    description: "List all roles in a workspace",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Maximum results" },
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
    description: "List members of a workspace",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        search: { type: "string", description: "Search by name or email" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "nestr_list_labels",
    description: "List available labels in a workspace",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        search: { type: "string", description: "Search query" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "nestr_get_projects",
    description: "List all projects in a workspace. Check fields['project.status'] for status: Future (planned), Current (active), Waiting (blocked), Done (completed). The 'due' field contains the project due date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        limit: { type: "number", description: "Maximum results" },
      },
      required: ["workspaceId"],
    },
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
];

// Tool handler type
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Tool handlers
export async function handleToolCall(
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
          cleanText: true,
        });
        return formatResult(compactResponse(workspaces));
      }

      case "nestr_get_workspace": {
        const parsed = schemas.getWorkspace.parse(args);
        const workspace = await client.getWorkspace(parsed.workspaceId, true);
        return formatResult(workspace);
      }

      case "nestr_search": {
        const parsed = schemas.search.parse(args);
        const results = await client.searchWorkspace(
          parsed.workspaceId,
          parsed.query,
          { limit: parsed.limit, cleanText: true }
        );
        return formatResult(compactResponse(results));
      }

      case "nestr_get_nest": {
        const parsed = schemas.getNest.parse(args);
        const nest = await client.getNest(parsed.nestId, true);
        return formatResult(nest);
      }

      case "nestr_get_nest_children": {
        const parsed = schemas.getNestChildren.parse(args);
        const children = await client.getNestChildren(parsed.nestId, true);
        return formatResult(compactResponse(children));
      }

      case "nestr_create_nest": {
        const parsed = schemas.createNest.parse(args);
        const nest = await client.createNest({
          parentId: parsed.parentId,
          title: parsed.title,
          purpose: parsed.purpose,
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
          fields: parsed.fields,
          users: parsed.users,
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
          cleanText: true,
        });
        return formatResult(compactResponse(circles, "role"));
      }

      case "nestr_get_circle_roles": {
        const parsed = schemas.getCircleRoles.parse(args);
        const roles = await client.getCircleRoles(
          parsed.workspaceId,
          parsed.circleId,
          { cleanText: true }
        );
        return formatResult(compactResponse(roles, "role"));
      }

      case "nestr_list_roles": {
        const parsed = schemas.listRoles.parse(args);
        const roles = await client.listRoles(parsed.workspaceId, {
          limit: parsed.limit,
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
        });
        return formatResult(compactResponse(users, "user"));
      }

      case "nestr_list_labels": {
        const parsed = schemas.listLabels.parse(args);
        const labels = await client.listLabels(parsed.workspaceId, {
          search: parsed.search,
        });
        return formatResult(compactResponse(labels, "label"));
      }

      case "nestr_get_projects": {
        const parsed = schemas.getProjects.parse(args);
        const projects = await client.getWorkspaceProjects(parsed.workspaceId, {
          limit: parsed.limit,
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

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
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
