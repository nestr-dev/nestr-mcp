/**
 * Analytics Event Tracking
 *
 * Generic event tracking interface with pluggable implementations.
 * Trackers register themselves and all receive events.
 *
 * Usage:
 *   import { analytics, AnalyticsContext } from "./analytics/index.js";
 *   analytics.trackSessionStart(context, { hasToken: true });
 */

import { randomUUID } from "node:crypto";

/**
 * Analytics context for an MCP session
 */
export interface AnalyticsContext {
  /** Client ID for session tracking */
  clientId: string;
  /** User ID for cross-session tracking (e.g., Nestr user._id) */
  userId?: string;
  /** MCP client name (e.g., "claude-desktop", "cursor") */
  mcpClient?: string;
  /** Transport type */
  transport: "http" | "stdio";
}

/**
 * Session start event parameters
 */
export interface SessionStartParams {
  hasToken?: boolean;
  authMethod?: "oauth" | "api_key";
}

/**
 * Tool call event parameters
 */
export interface ToolCallParams {
  toolName: string;
  workspaceId?: string;
  success?: boolean;
  errorCode?: string;
}

/**
 * OAuth start event parameters
 */
export interface OAuthStartParams {
  clientConsumer?: string;
}

/**
 * OAuth complete event parameters
 */
export interface OAuthCompleteParams {
  isNewUser?: boolean;
}

/**
 * Session end event parameters
 */
export interface SessionEndParams {
  duration?: number;
  toolCallCount?: number;
}

/**
 * Error event parameters
 */
export interface ErrorParams {
  errorType: string;
  errorMessage?: string;
  toolName?: string;
}

/**
 * Event tracker interface - implement this to add a new analytics provider
 */
export interface EventTracker {
  /** Unique name for this tracker (for logging) */
  readonly name: string;

  /** Called when tracker is registered - use for startup validation */
  initialize?(): void;

  /** Track MCP session start */
  trackSessionStart(context: AnalyticsContext, params?: SessionStartParams): void;

  /** Track MCP tool call */
  trackToolCall(context: AnalyticsContext, params: ToolCallParams): void;

  /** Track OAuth flow start */
  trackOAuthStart(context: AnalyticsContext, params?: OAuthStartParams): void;

  /** Track OAuth flow completion */
  trackOAuthComplete(context: AnalyticsContext, params?: OAuthCompleteParams): void;

  /** Track MCP session end */
  trackSessionEnd(context: AnalyticsContext, params?: SessionEndParams): void;

  /** Track errors */
  trackError(context: AnalyticsContext, params: ErrorParams): void;
}

/**
 * Analytics registry - manages multiple event trackers
 */
class Analytics {
  private trackers: EventTracker[] = [];

  /**
   * Register an event tracker
   */
  register(tracker: EventTracker): void {
    try {
      tracker.initialize?.();
      this.trackers.push(tracker);
      console.log(`[Analytics] Registered tracker: ${tracker.name}`);
    } catch (error) {
      console.error(`[Analytics] Failed to register tracker ${tracker.name}:`, error);
    }
  }

  /**
   * Check if any trackers are registered
   */
  isEnabled(): boolean {
    return this.trackers.length > 0;
  }

  /**
   * Generate a new client ID for session tracking
   */
  generateClientId(): string {
    return randomUUID();
  }

  /**
   * Track session start across all registered trackers
   */
  trackSessionStart(context: AnalyticsContext, params?: SessionStartParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackSessionStart(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackSessionStart error:`, error);
      }
    }
  }

  /**
   * Track tool call across all registered trackers
   */
  trackToolCall(context: AnalyticsContext, params: ToolCallParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackToolCall(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackToolCall error:`, error);
      }
    }
  }

  /**
   * Track OAuth start across all registered trackers
   */
  trackOAuthStart(context: AnalyticsContext, params?: OAuthStartParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackOAuthStart(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackOAuthStart error:`, error);
      }
    }
  }

  /**
   * Track OAuth complete across all registered trackers
   */
  trackOAuthComplete(context: AnalyticsContext, params?: OAuthCompleteParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackOAuthComplete(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackOAuthComplete error:`, error);
      }
    }
  }

  /**
   * Track session end across all registered trackers
   */
  trackSessionEnd(context: AnalyticsContext, params?: SessionEndParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackSessionEnd(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackSessionEnd error:`, error);
      }
    }
  }

  /**
   * Track error across all registered trackers
   */
  trackError(context: AnalyticsContext, params: ErrorParams): void {
    for (const tracker of this.trackers) {
      try {
        tracker.trackError(context, params);
      } catch (error) {
        console.error(`[Analytics] ${tracker.name} trackError error:`, error);
      }
    }
  }
}

/**
 * Singleton analytics instance
 */
export const analytics = new Analytics();
