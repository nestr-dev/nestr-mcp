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
  /** Miscellaneous data storage (e.g., third-party IDs, custom metadata) */
  data?: Record<string, unknown>;
  /**
   * Context-dependent date field:
   * - Project/Task: due date
   * - Role: re-election date
   * - Meeting: start date
   */
  due?: string;
  /** Whether this item is completed (for tasks/projects/meetings etc.) */
  completed?: boolean;
  /** User IDs assigned to this nest (must be explicitly set, not inherited from parent role) */
  users?: string[];
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

export interface WorkspaceApp {
  _id: string;
  title: string;
  description?: string;
  enabled: boolean;
}

/** Error codes for structured error handling */
export type ErrorCode =
  | "AUTH_FAILED"      // 401 - Invalid or missing credentials
  | "FORBIDDEN"        // 403 - Valid auth but no permission
  | "APP_DISABLED"     // 403 - Feature/app not enabled
  | "PLAN_REQUIRED"    // 403 - Requires plan upgrade
  | "NOT_FOUND"        // 404 - Resource doesn't exist
  | "VALIDATION"       // 400 - Invalid input
  | "RATE_LIMITED"     // 429 - Too many requests
  | "SERVER_ERROR"     // 5xx - Server-side issue
  | "NETWORK_ERROR"    // Connection/timeout issues
  | "UNKNOWN";         // Unclassified error

/** Structured error for MCP tool responses */
export interface ToolError {
  error: true;
  code: ErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
  hint?: string;
}

export class NestrApiError extends Error {
  public code: ErrorCode;
  public hint?: string;
  public retryable: boolean;

  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    options?: { code?: ErrorCode; hint?: string; retryable?: boolean }
  ) {
    super(message);
    this.name = "NestrApiError";
    this.code = options?.code ?? this.inferCode(status, message);
    this.hint = options?.hint;
    this.retryable = options?.retryable ?? this.inferRetryable(this.code);
  }

  private inferCode(status: number, message: string): ErrorCode {
    const lowerMsg = message.toLowerCase();

    if (status === 401) return "AUTH_FAILED";
    if (status === 404) return "NOT_FOUND";
    if (status === 429) return "RATE_LIMITED";
    if (status === 400) return "VALIDATION";
    if (status >= 500) return "SERVER_ERROR";

    if (status === 403) {
      if (lowerMsg.includes("app") && (lowerMsg.includes("enabled") || lowerMsg.includes("disabled"))) {
        return "APP_DISABLED";
      }
      if (lowerMsg.includes("pro") || lowerMsg.includes("plan") || lowerMsg.includes("upgrade")) {
        return "PLAN_REQUIRED";
      }
      return "FORBIDDEN";
    }

    return "UNKNOWN";
  }

  private inferRetryable(code: ErrorCode): boolean {
    // Only retry transient errors
    return code === "RATE_LIMITED" || code === "SERVER_ERROR" || code === "NETWORK_ERROR";
  }

  /** Convert to structured error for MCP responses */
  toToolError(): ToolError {
    return {
      error: true,
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      hint: this.hint,
    };
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

      // Try to parse JSON error response for clearer error messages
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        // Check common error message field patterns
        errorMessage =
          errorJson.message ||
          errorJson.error ||
          errorJson.reason ||
          errorJson.detail ||
          errorJson.description ||
          // Nested patterns
          errorJson.data?.message ||
          errorJson.data?.error ||
          // Fallback: if it's an object, stringify it compactly
          (typeof errorJson === "object" ? JSON.stringify(errorJson) : errorText);
      } catch {
        // Not JSON, use raw text
      }

      // Create error and let it infer the code
      const error = new NestrApiError(
        errorMessage,
        response.status,
        endpoint
      );

      // Set hints based on inferred error code
      switch (error.code) {
        case "AUTH_FAILED":
          error.hint = "Check your API key or OAuth token is valid.";
          break;
        case "APP_DISABLED":
          error.hint = "Enable this app in workspace settings > Apps.";
          break;
        case "PLAN_REQUIRED":
          error.hint = "This feature requires a Pro plan. Upgrade in workspace settings.";
          break;
        case "FORBIDDEN":
          error.hint = "You don't have permission for this action. Check your role/access level.";
          break;
        case "NOT_FOUND":
          error.hint = "The resource doesn't exist or you don't have access to it.";
          break;
        case "RATE_LIMITED":
          error.hint = "Too many requests. Wait a moment and try again.";
          break;
        case "VALIDATION":
          error.hint = "Check the input parameters are correct.";
          break;
        case "SERVER_ERROR":
          error.hint = "Server error. Try again in a few moments.";
          break;
      }

      throw error;
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
    page?: number;
    cleanText?: boolean;
  }): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
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
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams({ search });
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    return this.fetch<Nest[]>(`/workspaces/${workspaceId}/search?${params}`);
  }

  async getWorkspaceProjects(
    workspaceId: string,
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
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
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Nest[]>(`/nests/${nestId}/children${query ? `?${query}` : ""}`);
  }

  async createNest(data: {
    parentId: string;
    title: string;
    purpose?: string;
    description?: string;
    labels?: string[];
    fields?: Record<string, unknown>;
    users?: string[];
  }): Promise<Nest> {
    return this.fetch<Nest>("/nests", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateNest(
    nestId: string,
    updates: Partial<{
      title: string;
      purpose: string;
      description: string;
      parentId: string;
      labels: string[];
      fields: Record<string, unknown>;
      users: string[];
      data: Record<string, unknown>;
      due: string;
      completed: boolean;
    }>
  ): Promise<Nest> {
    return this.fetch<Nest>(`/nests/${nestId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
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
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
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
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Role[]>(
      `/workspaces/${workspaceId}/circles/${circleId}/roles${query ? `?${query}` : ""}`
    );
  }

  async listRoles(
    workspaceId: string,
    options?: { limit?: number; page?: number; cleanText?: boolean }
  ): Promise<Role[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
    if (options?.cleanText) params.set("cleanText", "true");

    const query = params.toString();
    return this.fetch<Role[]>(
      `/workspaces/${workspaceId}/roles${query ? `?${query}` : ""}`
    );
  }

  // ============ USERS ============

  async listUsers(
    workspaceId: string,
    options?: { search?: string; limit?: number; page?: number; includeSuspended?: boolean }
  ): Promise<User[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());
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
    options?: { search?: string; limit?: number; page?: number }
  ): Promise<Label[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.page) params.set("page", options.page.toString());

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

  // ============ APPS ============

  async getWorkspaceApps(workspaceId: string): Promise<WorkspaceApp[]> {
    return this.fetch<WorkspaceApp[]>(`/workspaces/${workspaceId}/apps`);
  }

  // ============ INBOX (requires OAuth token) ============

  /**
   * List items in the current user's inbox.
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   */
  async listInbox(options?: {
    completedAfter?: string;
  }): Promise<Nest[]> {
    const params = new URLSearchParams();
    if (options?.completedAfter) params.set("completedAfter", options.completedAfter);

    const query = params.toString();
    return this.fetch<Nest[]>(`/users/me/inbox${query ? `?${query}` : ""}`);
  }

  /**
   * Create a new item in the current user's inbox (quick capture).
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   */
  async createInboxItem(data: {
    title: string;
    description?: string;
  }): Promise<Nest> {
    return this.fetch<Nest>("/users/me/inbox", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Get a single inbox item by ID.
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   */
  async getInboxItem(nestId: string, cleanText = false): Promise<Nest> {
    const params = cleanText ? "?cleanText=true" : "";
    return this.fetch<Nest>(`/users/me/inbox/${nestId}${params}`);
  }

  /**
   * Update an inbox item.
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   * To move out of inbox, use nestr_update_nest to change parentId.
   */
  async updateInboxItem(
    nestId: string,
    updates: Partial<{
      title: string;
      description: string;
      completed: boolean;
      data: Record<string, unknown>;
    }>
  ): Promise<Nest> {
    return this.fetch<Nest>(`/users/me/inbox/${nestId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  // ============ PERSONAL LABELS (requires OAuth token) ============

  /**
   * List the current user's personal labels.
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   */
  async listPersonalLabels(): Promise<Label[]> {
    return this.fetch<Label[]>("/users/me/labels");
  }

  /**
   * Create a new personal label for the current user.
   * Requires OAuth token (user-scoped) - does not work with workspace API keys.
   */
  async createPersonalLabel(data: {
    title: string;
    description?: string;
    color?: string;
    icon?: string;
  }): Promise<Label> {
    return this.fetch<Label>("/users/me/labels", {
      method: "POST",
      body: JSON.stringify(data),
    });
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
