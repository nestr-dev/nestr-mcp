/**
 * GA4 Analytics via Measurement Protocol
 *
 * Implements the EventTracker interface for Google Analytics 4.
 * Uses the Measurement Protocol for server-side event tracking.
 *
 * Environment variables:
 * - GA4_MEASUREMENT_ID: GA4 measurement ID (e.g., G-XXXXXXXXXX)
 * - GA4_API_SECRET: Measurement Protocol API secret
 * - GA4_DEBUG: Set to "true" to use debug endpoint (validates but doesn't record)
 */

import {
  analytics,
  type EventTracker,
  type AnalyticsContext,
  type SessionStartParams,
  type ToolCallParams,
  type OAuthStartParams,
  type OAuthCompleteParams,
  type SessionEndParams,
  type ErrorParams,
} from "./index.js";

// GA4 configuration from environment
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

// Debug endpoint for testing (validates but doesn't record)
const GA4_DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";
const DEBUG_MODE = process.env.GA4_DEBUG === "true";

/**
 * GA4 event parameters
 */
interface GA4EventParams {
  [key: string]: string | number | boolean | undefined;
}

/**
 * GA4 event structure
 */
interface GA4Event {
  name: string;
  params?: GA4EventParams;
}

/**
 * GA4 Measurement Protocol payload
 */
interface GA4Payload {
  client_id: string;
  user_id?: string;
  events: GA4Event[];
}

/**
 * Send event(s) to GA4 Measurement Protocol
 * Non-blocking - failures are logged but don't throw
 */
async function sendToGA4(payload: GA4Payload): Promise<void> {
  const endpoint = DEBUG_MODE ? GA4_DEBUG_ENDPOINT : GA4_ENDPOINT;
  const url = `${endpoint}?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (DEBUG_MODE) {
      const debugResponse = await response.json();
      console.log("[GA4] Debug response:", JSON.stringify(debugResponse, null, 2));
    } else if (!response.ok) {
      console.error(`[GA4] Failed to send event: ${response.status}`);
    }
  } catch (error) {
    console.error("[GA4] Error sending event:", error);
  }
}

/**
 * Build and send an event
 */
function trackEvent(
  context: AnalyticsContext,
  eventName: string,
  params?: GA4EventParams
): void {
  const payload: GA4Payload = {
    client_id: context.clientId,
    events: [
      {
        name: eventName,
        params: {
          ...params,
          app: "nestr_mcp",
          mcp_client: context.mcpClient,
          transport: context.transport,
          engagement_time_msec: 100,
        },
      },
    ],
  };

  if (context.userId) {
    payload.user_id = context.userId;
  }

  // Fire and forget
  sendToGA4(payload).catch(() => {});
}

/**
 * GA4 EventTracker implementation
 */
class GA4Tracker implements EventTracker {
  readonly name = "GA4";

  initialize(): void {
    // Validate configuration
    if (GA4_MEASUREMENT_ID && !GA4_API_SECRET) {
      console.warn(
        "[GA4] Warning: GA4_MEASUREMENT_ID is set but GA4_API_SECRET is missing. " +
        "GA4 analytics is disabled. Get your API secret from: " +
        "GA4 Admin → Data Streams → Measurement Protocol API secrets"
      );
      throw new Error("GA4 configuration incomplete");
    }

    if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
      throw new Error("GA4 not configured");
    }

    console.log(`[GA4] Initialized with measurement ID: ${GA4_MEASUREMENT_ID}${DEBUG_MODE ? " (debug mode)" : ""}`);
  }

  trackSessionStart(context: AnalyticsContext, params?: SessionStartParams): void {
    trackEvent(context, "mcp_session_start", {
      has_token: params?.hasToken,
      auth_method: params?.authMethod,
    });
  }

  trackToolCall(context: AnalyticsContext, params: ToolCallParams): void {
    trackEvent(context, "mcp_tool_call", {
      tool_name: params.toolName,
      workspace_id: params.workspaceId,
      success: params.success,
      error_code: params.errorCode,
    });
  }

  trackOAuthStart(context: AnalyticsContext, params?: OAuthStartParams): void {
    trackEvent(context, "mcp_oauth_start", {
      client_consumer: params?.clientConsumer,
    });
  }

  trackOAuthComplete(context: AnalyticsContext, params?: OAuthCompleteParams): void {
    trackEvent(context, "mcp_oauth_complete", {
      is_new_user: params?.isNewUser,
    });
  }

  trackSessionEnd(context: AnalyticsContext, params?: SessionEndParams): void {
    trackEvent(context, "mcp_session_end", {
      duration_seconds: params?.duration,
      tool_call_count: params?.toolCallCount,
    });
  }

  trackError(context: AnalyticsContext, params: ErrorParams): void {
    trackEvent(context, "mcp_error", {
      error_type: params.errorType,
      error_message: params.errorMessage?.slice(0, 100),
      tool_name: params.toolName,
    });
  }
}

// Auto-register GA4 tracker if configured
try {
  analytics.register(new GA4Tracker());
} catch {
  // Not configured or incomplete - that's fine, warning already logged if needed
}
