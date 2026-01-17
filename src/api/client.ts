/**
 * Nestr API Client
 * Wrapper for the Nestr REST API
 */

export interface NestrClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** MCP client name (e.g., "claude-desktop", "cursor") for tracking */
  mcpClient?: string;
}

export interface Nest {
  _id: string;
  title: string;
  purpose?: string;
  description?: string;
  parentId?: string;
  ancestors?: string[];
  labels?: string[];
  fields?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Post {
  _id: string;
  body: string;
  parentId: string;
  ancestors?: string[];
  labels?: string[];
  createdAt?: string;
}

export interface User {
  _id: string;
  username: string;
  profile?: {
    email?: string;
    fullName?: string;
    avatar?: string;
  };
}

export interface Label {
  _id: string;
  title: string;
  workspaceId?: string;
  userId?: string;
}

export interface Role extends Nest {
  accountabilities?: string[];
  domains?: string[];
}

export interface Insight {
  nestId: string;
  type: string;
  workspaceId: string;
  title: string;
  currentValue: number;
  compareValue?: number;
  dataType?: string;
  goal?: number;
}

export class NestrApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = "NestrApiError";
  }
}

export class NestrClient {
  private apiKey: string;
  private baseUrl: string;
  private mcpClient?: string;

  constructor(config: NestrClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://app.nestr.io/api";
    this.mcpClient = config.mcpClient;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    // Add MCP client header for tracking which AI agent made the request
    if (this.mcpClient) {
      headers["X-MCP-Client"] = this.mcpClient;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new NestrApiError(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`,
        response.status,
        endpoint
      );
    }

    // Handle empty responses (e.g., DELETE)
    const text = await response.text();
    if (!text) return {} as T;

    return JSON.parse(text) as T;
  }

  // ============ WORKSPACES ============

  async listWorkspaces(options?: {
    search?: string;
    limit?: number;
    cleanText?: boolean;
  }): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Nest[]>(`/workspaces${query ? `?${query}` : ""}`);
  }

  async getWorkspace(workspaceId: string, cleanText = false): Promise<Nest> {
    const params = cleanText ? "?cleanText=true" : "";
    return this.fetch<Nest>(`/workspaces/${workspaceId}${params}`);
  }

  async searchWorkspace(
    workspaceId: string,
    search: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams({ search });
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    return this.fetch<Nest[]>(`/workspaces/${workspaceId}/search?${params}`);
  }

  async getWorkspaceProjects(
    workspaceId: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Nest[]>(
      `/workspaces/${workspaceId}/projects${query ? `?${query}` : ""}`
    );
  }

  // ============ NESTS ============

  async getNest(nestId: string, cleanText = false): Promise<Nest> {
    const params = cleanText ? "?cleanText=true" : "";
    return this.fetch<Nest>(`/nests/${nestId}${params}`);
  }

  async getNestChildren(
    nestId: string,
    cleanText = false
  ): Promise<Nest[]> {
    const params = cleanText ? "?cleanText=true" : "";
    return this.fetch<Nest[]>(`/nests/${nestId}/children${params}`);
  }

  async createNest(data: {
    parentId: string;
    title: string;
    purpose?: string;
    description?: string;
    labels?: string[];
    fields?: Record<string, unknown>;
  }): Promise<Nest> {
    return this.fetch<Nest>("/nests", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateNest(
    nestId: string,
    data: Partial<{
      title: string;
      purpose: string;
      description: string;
      labels: string[];
      fields: Record<string, unknown>;
    }>
  ): Promise<Nest> {
    return this.fetch<Nest>(`/nests/${nestId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteNest(nestId: string): Promise<void> {
    await this.fetch<void>(`/nests/${nestId}`, {
      method: "DELETE",
    });
  }

  async searchNest(
    nestId: string,
    search: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams({ search });
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    return this.fetch<Nest[]>(`/nests/${nestId}/search?${params}`);
  }

  // ============ POSTS/COMMENTS ============

  async getNestPosts(
    nestId: string,
    options?: { depth?: number }
  ): Promise<Post[]> {
    const params = new URLSearchParams();
    if (options?.depth) params.set("depth", options.depth.toString());

    const query = params.toString();
    return this.fetch<Post[]>(`/nests/${nestId}/posts${query ? `?${query}` : ""}`);
  }

  async createPost(nestId: string, body: string): Promise<Post> {
    return this.fetch<Post>(`/nests/${nestId}/posts`, {
      method: "POST",
      body: JSON.stringify({ body, parentId: nestId }),
    });
  }

  // ============ CIRCLES & ROLES ============

  async listCircles(
    workspaceId: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Role[]>(
      `/workspaces/${workspaceId}/circles${query ? `?${query}` : ""}`
    );
  }

  async getCircle(
    workspaceId: string,
    circleId: string,
    cleanText = false
  ): Promise<Role> {
    const params = cleanText ? "?cleanText=true" : "";
    return this.fetch<Role>(
      `/workspaces/${workspaceId}/circles/${circleId}${params}`
    );
  }

  async getCircleRoles(
    workspaceId: string,
    circleId: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Role[]>(
      `/workspaces/${workspaceId}/circles/${circleId}/roles${query ? `?${query}` : ""}`
    );
  }

  async listRoles(
    workspaceId: string,
    options?: { limit?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Role[]>(
      `/workspaces/${workspaceId}/roles${query ? `?${query}` : ""}`
    );
  }

  // ============ USERS ============

  async listUsers(
    workspaceId: string,
    options?: { search?: string; includeSuspended?: boolean }
  ): Promise<User[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.includeSuspended) params.set("includeSuspended", "true");

    const query = params.toString();
    return this.fetch<User[]>(
      `/workspaces/${workspaceId}/users${query ? `?${query}` : ""}`
    );
  }

  async getUser(workspaceId: string, userId: string): Promise<User> {
    return this.fetch<User>(`/workspaces/${workspaceId}/users/${userId}`);
  }

  // ============ LABELS ============

  async listLabels(
    workspaceId: string,
    options?: { search?: string }
  ): Promise<Label[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);

    const query = params.toString();
    return this.fetch<Label[]>(
      `/workspaces/${workspaceId}/labels${query ? `?${query}` : ""}`
    );
  }

  async getLabel(workspaceId: string, labelId: string): Promise<Label> {
    return this.fetch<Label>(`/workspaces/${workspaceId}/labels/${labelId}`);
  }

  // ============ INSIGHTS ============

  async getInsights(
    workspaceId: string,
    options?: { includeSubCircles?: boolean; userId?: string }
  ): Promise<{ status: string; metrics: Insight[] }> {
    const params = new URLSearchParams();
    if (options?.includeSubCircles !== undefined) {
      params.set("includeSubCircles", options.includeSubCircles.toString());
    }
    if (options?.userId) params.set("userId", options.userId);

    const query = params.toString();
    return this.fetch<{ status: string; metrics: Insight[] }>(
      `/workspaces/${workspaceId}/insights${query ? `?${query}` : ""}`
    );
  }

  async getInsightHistory(
    workspaceId: string,
    metricId: string,
    options?: { from?: string; to?: string; limit?: number }
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (options?.from) params.set("from", options.from);
    if (options?.to) params.set("to", options.to);
    if (options?.limit) params.set("limit", options.limit.toString());

    const query = params.toString();
    return this.fetch<unknown[]>(
      `/workspaces/${workspaceId}/insights/${metricId}/history${query ? `?${query}` : ""}`
    );
  }
}

/**
 * Factory function to create client from environment variables
 *
 * Supports two authentication methods:
 * 1. NESTR_OAUTH_TOKEN - OAuth Bearer token (recommended - respects user permissions)
 * 2. NESTR_API_KEY - API key from workspace settings (full workspace access)
 *
 * If both are set, NESTR_API_KEY takes precedence for backwards compatibility.
 */
export function createClientFromEnv(): NestrClient {
  const apiKey = process.env.NESTR_API_KEY;
  const oauthToken = process.env.NESTR_OAUTH_TOKEN;

  const authToken = apiKey || oauthToken;

  if (!authToken) {
    throw new Error(
      "Authentication required. Set one of the following environment variables:\n" +
      "  - NESTR_API_KEY: API key from workspace settings > Integrations > Workspace API access\n" +
      "  - NESTR_OAUTH_TOKEN: OAuth Bearer token from Nestr OAuth flow"
    );
  }

  return new NestrClient({
    apiKey: authToken,
    baseUrl: process.env.NESTR_API_BASE,
  });
}
