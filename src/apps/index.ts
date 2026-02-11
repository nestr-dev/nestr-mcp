/**
 * MCP Apps for Nestr
 * Interactive UI components that can be embedded in MCP clients
 */

// Completable List HTML - inline for bundling
const COMPLETABLE_LIST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completable Nests</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 16px;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 0;
    }

    .scroll-container {
      max-height: 750px;
      overflow-y: auto;
      overscroll-behavior: none;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 26px;
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 10;
      transition: box-shadow 0.2s;
    }

    .header.scrolled {
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    .header-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      width: 28px;
      flex-shrink: 0;
    }

    .header-logo img {
      max-width: 24px;
      max-height: 24px;
    }

    .header h3 {
      font-weight: 500;
      color: #333;
      margin: 0;
      flex: 1;
    }

    .refresh-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      border-radius: 50%;
      cursor: pointer;
      color: #999;
      transition: color 0.15s, background 0.15s;
    }

    .refresh-btn:hover {
      background: #f0f0f0;
      color: #666;
    }

    .refresh-btn svg {
      width: 16px;
      height: 16px;
    }

    .refresh-btn.loading svg {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    #app {
      padding: 0 16px 16px 16px;
    }

    .nest-list {
      list-style: none;
    }

    .nest-item {
      display: flex;
      align-items: center;
      padding: 12px 8px;
      border-bottom: 1px solid #e8e8e8;
      gap: 10px;
      cursor: grab;
      transition: background 0.15s;
      -webkit-user-select: none;
      user-select: none;
    }

    .nest-item:hover {
      background: #fafafa;
    }

    .nest-item.dragging {
      opacity: 0.5;
      background: #f0f4ff;
    }

    .nest-item.drag-over {
      border-top: 2px solid #4b44ee;
    }

    /* Completed state */
    .nest-item.completed .nest-title {
      text-decoration: line-through;
      color: #aaa;
    }

    .nest-item.completed .icon-container svg {
      opacity: 0.4;
    }

    .nest-item.completed .checkbox {
      border-color: #ccc;
      background: #f0f0f0;
    }

    .icon-container {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    /* Project cube icon */
    .project-icon {
      color: #4b44ee;
    }

    .project-icon svg {
      width: 24px;
      height: 24px;
    }

    /* Checkbox for todos and hover state */
    .checkbox-icon {
      display: none;
    }

    .checkbox-icon .checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #ccc;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .checkbox-icon .checkbox:hover {
      border-color: #4b44ee;
    }

    .checkbox-icon .checkbox.checked {
      background: #f0f0f0;
      border-color: #ccc;
    }

    .checkbox-icon .checkbox.checked::after {
      content: '';
      width: 6px;
      height: 11px;
      border: solid #aaa;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
      margin-bottom: 3px;
    }

    /* Show checkbox on hover for projects */
    .nest-item:hover .project-icon {
      display: none;
    }

    .nest-item:hover .checkbox-icon {
      display: flex;
    }

    /* Always show checkbox for todos (non-projects) */
    .nest-item.todo .project-icon {
      display: none;
    }

    .nest-item.todo .checkbox-icon {
      display: flex;
    }

    .nest-content {
      flex: 1;
      min-width: 0;
    }

    .nest-title {
      font-size: 16px;
      line-height: 1.4;
      color: #1a1a1a;
      padding: 2px 4px;
      margin: -2px -4px;
      border-radius: 4px;
      border: 1px solid transparent;
      outline: none;
      width: 100%;
    }

    .nest-title:hover {
      text-decoration: underline;
      text-decoration-style: dashed;
      text-decoration-color: #ccc;
      text-underline-offset: 3px;
      cursor: text;
    }

    .nest-title:focus {
      text-decoration: none;
      border-color: #4b44ee;
      -webkit-user-select: text;
      user-select: text;
    }

    .nest-path {
      font-size: 13px;
      color: #999;
      margin-top: 1px;
      min-height: 1.2em;
    }

    a.nest-path {
      text-decoration: underline;
      text-decoration-color: #ddd;
      text-underline-offset: 3px;
    }

    a.nest-path:hover {
      color: #666;
      text-decoration-color: #999;
    }

    /* Due date button */
    .due-btn {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ccc;
      border: none;
      background: none;
      border-radius: 4px;
      cursor: pointer;
      position: relative;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s, color 0.15s;
    }

    .due-btn.has-due {
      color: #888;
    }

    .nest-item:hover .due-btn,
    .due-btn:has(.due-picker.open) {
      opacity: 1;
    }

    .due-btn:hover {
      background: #f0f0f0;
      color: #666;
    }

    .due-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Due date tooltip */
    .due-tooltip {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 6px;
      background: #333;
      color: #fff;
      font-size: 12px;
      line-height: 1.4;
      padding: 6px 10px;
      border-radius: 4px;
      white-space: nowrap;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      display: none;
    }

    .due-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      right: 10px;
      border: 5px solid transparent;
      border-top-color: #333;
    }

    .due-btn:hover .due-tooltip {
      display: block;
    }

    /* Due date picker popup */
    .due-picker {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 6px;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 10px;
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: none;
      white-space: nowrap;
    }

    .due-picker.open {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .due-input {
      font-family: inherit;
      font-size: 13px;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      outline: none;
    }

    .due-input:focus {
      border-color: #4b44ee;
    }

    .due-save-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      background: #4b44ee;
      color: white;
    }

    .due-save-btn:hover {
      background: #3d37c9;
    }

    /* Description button */
    .desc-btn {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ccc;
      border: none;
      background: none;
      border-radius: 4px;
      cursor: pointer;
      position: relative;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s, color 0.15s;
    }

    .desc-btn.has-desc {
      color: #888;
    }

    .nest-item:hover .desc-btn {
      opacity: 1;
    }

    .desc-btn:hover {
      background: #f0f0f0;
      color: #666;
    }

    .desc-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Description tooltip */
    .desc-tooltip {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 6px;
      background: #333;
      color: #fff;
      font-size: 12px;
      line-height: 1.4;
      padding: 8px 10px;
      border-radius: 4px;
      max-width: 200px;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      display: none;
    }

    .desc-tooltip-text {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      word-wrap: break-word;
    }

    .desc-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      right: 10px;
      border: 5px solid transparent;
      border-top-color: #333;
    }

    .desc-btn:hover .desc-tooltip {
      display: block;
    }

    /* Description editor */
    .desc-editor {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out;
      margin-top: 0;
    }

    .desc-editor.open {
      max-height: 200px;
      margin-top: 8px;
    }

    .desc-editor-wrap {
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
      transition: border-color 0.15s;
    }

    .desc-editor-wrap:focus-within {
      border-color: #4b44ee;
    }

    .desc-toolbar {
      display: flex;
      gap: 2px;
      padding: 4px 6px;
      background: #f8f8f8;
      border-bottom: 1px solid #eee;
    }

    .desc-toolbar button {
      width: 28px;
      height: 24px;
      border: none;
      background: none;
      border-radius: 3px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      font-size: 13px;
      font-weight: 600;
    }

    .desc-toolbar button:hover {
      background: #e8e8e8;
      color: #333;
    }

    .desc-toolbar button.active {
      background: #4b44ee;
      color: white;
    }

    .desc-toolbar button svg {
      width: 14px;
      height: 14px;
    }

    .desc-content {
      width: 100%;
      min-height: 60px;
      max-height: 120px;
      overflow-y: auto;
      padding: 8px 10px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      -webkit-user-select: text;
      user-select: text;
    }

    .desc-content:empty::before {
      content: attr(data-placeholder);
      color: #999;
    }

    .desc-content ul, .desc-content ol {
      margin: 4px 0;
      padding-left: 20px;
    }

    .desc-content li {
      margin: 2px 0;
    }

    .nest-link {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
      text-decoration: none;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s;
    }

    .nest-item:hover .nest-link {
      opacity: 1;
    }

    .nest-link:hover {
      background: #f0f0f0;
      color: #666;
    }

    .nest-link svg {
      width: 16px;
      height: 16px;
    }

    .empty-state {
      text-align: center;
      color: #999;
      padding: 32px;
    }

    .loading {
      text-align: center;
      color: #999;
      padding: 32px;
    }
  </style>
</head>
<body>
<div class="scroll-container">
  <div class="header">
    <a href="https://nestr.io" target="_blank" class="header-logo" title="Nestr">
      <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><circle cx="128" cy="128" r="120" fill="#4b44ee"/><circle cx="151" cy="151" r="62" fill="#fff"/></svg>
    </a>
    <h3 id="list-title">Nestr work</h3>
    <button class="refresh-btn" id="refresh-btn" title="Refresh">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6"></path>
        <path d="M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </div>
  <div id="app">
    <div class="loading">Loading...</div>
  </div>
</div>

  <script type="module">
    // MCP App SDK - inline implementation of official MCP Apps protocol (2026-01-26)
    class McpApp {
      constructor() {
        this.pendingRequests = new Map();
        this.requestId = 0;
        this.hostContext = null;

        window.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });
      }

      handleMessage(message) {
        if (!message || message.jsonrpc !== '2.0') return;

        // Handle responses to our requests
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            console.error('McpApp error response:', message.method || message.id, message.error);
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
          return;
        }

        // Handle notifications from host (official MCP Apps protocol)
        switch (message.method) {
          case 'ui/notifications/tool-result':
            // params is CallToolResult: { content: [...], isError?: boolean }
            this.onToolResult?.(message.params);
            break;
          case 'ui/notifications/tool-input':
            this.onToolInput?.(message.params);
            break;
          case 'ui/notifications/host-context-changed':
            Object.assign(this.hostContext || {}, message.params);
            break;
        }
      }

      // Initialize connection with host (required by MCP Apps protocol)
      async connect() {
        const id = ++this.requestId;

        return new Promise((resolve) => {
          this.pendingRequests.set(id, {
            resolve: (result) => {
              this.hostContext = result?.hostContext || null;

              // Send initialized notification (required by protocol)
              window.parent.postMessage({
                jsonrpc: '2.0',
                method: 'ui/notifications/initialized',
                params: {}
              }, '*');

              resolve(result);
            },
            reject: (err) => { console.error('McpApp connect rejected:', err); resolve(null); }
          });

          window.parent.postMessage({
            jsonrpc: '2.0',
            id,
            method: 'ui/initialize',
            params: {
              appInfo: { name: 'Nestr Completable List', version: '1.0.0' },
              appCapabilities: {},
              protocolVersion: '2026-01-26'
            }
          }, '*');

          // Timeout - don't fail, just continue without host context
          setTimeout(() => {
            if (this.pendingRequests.has(id)) {
              this.pendingRequests.delete(id);
              resolve(null);
            }
          }, 10000);
        });
      }

      async callTool(name, args = {}) {
        const id = ++this.requestId;

        return new Promise((resolve, reject) => {
          this.pendingRequests.set(id, { resolve, reject });

          window.parent.postMessage({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name, arguments: args }
          }, '*');

          // Timeout after 30 seconds
          setTimeout(() => {
            if (this.pendingRequests.has(id)) {
              this.pendingRequests.delete(id);
              reject(new Error('Request timeout'));
            }
          }, 30000);
        });
      }

      sendSizeChanged() {
        const height = Math.min(document.documentElement.scrollHeight, 750);
        const width = document.documentElement.scrollWidth;
        window.parent.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/size-changed',
          params: { height, width }
        }, '*');
      }

      setupAutoResize() {
        let pending = false;
        const notify = () => {
          if (!pending) {
            pending = true;
            requestAnimationFrame(() => {
              this.sendSizeChanged();
              pending = false;
            });
          }
        };
        const observer = new ResizeObserver(notify);
        observer.observe(document.documentElement);
        observer.observe(document.body);
        return () => observer.disconnect();
      }

      async updateModelContext(content) {
        const id = ++this.requestId;

        return new Promise((resolve) => {
          this.pendingRequests.set(id, { resolve, reject: (err) => { console.error('McpApp updateModelContext rejected:', err); resolve(null); } });

          window.parent.postMessage({
            jsonrpc: '2.0',
            id,
            method: 'ui/update-model-context',
            params: { content }
          }, '*');

          setTimeout(() => {
            if (this.pendingRequests.has(id)) {
              this.pendingRequests.delete(id);
              resolve(null);
            }
          }, 10000);
        });
      }
    }

    const app = new McpApp();
    const appEl = document.getElementById('app');
    const titleEl = document.getElementById('list-title');

    let nests = [];
    let source = null; // tracks which context we're in (inbox, daily-plan, children, projects, search)
    let draggedItem = null;

    // System labels that define structure (not categorization)
    const SYSTEM_LABELS = ['circle', 'anchor-circle', 'role', 'policy', 'domain', 'accountability', 'project', 'prepared-tension', 'goal', 'result', 'contact', 'deal', 'organisation', 'metric', 'checklist', 'meeting', 'feedback'];

    // Project box icon (isometric 3D cube with white edges)
    const cubeIcon = \`<svg viewBox="0 0 1024 1024" fill="currentColor">
      <path d="M512 56 L906 284 L906 740 L512 968 L118 740 L118 284 Z" fill="currentColor" stroke="currentColor" stroke-width="56" stroke-linejoin="round"/>
      <path d="M512 512 L512 968 M118 284 L512 512 L906 284" stroke="white" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>\`;

    // Document icon for description
    const docIcon = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <line x1="10" y1="9" x2="8" y2="9"></line>
    </svg>\`;

    // Calendar icon for due date
    const calendarIcon = \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>\`;

    function formatDueDate(dateStr) {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();

      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (isToday) return \`Today at \${timeStr}\`;
      if (isTomorrow) return \`Tomorrow at \${timeStr}\`;

      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) + \` at \${timeStr}\`;
    }

    function toDateTimeLocal(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toISOString().slice(0, 16);
    }

    function getParentTitle(nest) {
      // Show "Inbox" for inbox items (parentId is case-insensitive 'inbox')
      if (nest.parentId && nest.parentId.toLowerCase() === 'inbox') return 'Inbox';
      // No parent = no path
      if (!nest.parentId || !nest.path) return '';
      const parts = nest.path.split(' / ');
      // Return just the last part (the role/circle name)
      return parts[parts.length - 1] || '';
    }

    function getParentUrl(nest) {
      // No link for inbox items
      if (nest.parentId && nest.parentId.toLowerCase() === 'inbox') return null;
      // ancestors order: [self, parent, grandparent, ...] - need at least 2 for context link
      if (!nest.ancestors || nest.ancestors.length < 2) return null;
      const self = nest.ancestors[0];
      const parent = nest.ancestors[1];
      return \`https://app.nestr.io/n/\${parent}/\${self}\`;
    }

    function isProject(nest) {
      return nest.labels && nest.labels.includes('project');
    }

    function isTodo(nest) {
      // A todo is a nest without any system labels (can have other labels for categorization)
      if (!nest.labels || nest.labels.length === 0) return true;
      return !nest.labels.some(label => SYSTEM_LABELS.includes(label));
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function render() {
      if (nests.length === 0) {
        appEl.innerHTML = '<div class="empty-state">No items to show</div>';
        return;
      }

      const html = \`
        <ul class="nest-list">
          \${nests.map((nest, index) => \`
            <li class="nest-item \${nest.completed ? 'completed' : ''} \${isTodo(nest) ? 'todo' : ''}"
                data-id="\${nest._id}"
                data-index="\${index}"
                draggable="true">
              <div class="icon-container" data-action="toggle" data-id="\${nest._id}">
                <div class="project-icon">\${cubeIcon}</div>
                <div class="checkbox-icon">
                  <div class="checkbox \${nest.completed ? 'checked' : ''}"></div>
                </div>
              </div>
              <div class="nest-content">
                <div class="nest-title"
                     contenteditable="true"
                     data-id="\${nest._id}"
                     data-original="\${escapeHtml(nest.title)}">\${nest.title}</div>
                \${getParentUrl(nest)
                  ? \`<a href="\${getParentUrl(nest)}" target="_blank" class="nest-path">\${escapeHtml(getParentTitle(nest))}</a>\`
                  : \`<div class="nest-path">\${escapeHtml(getParentTitle(nest))}</div>\`}
                <div class="desc-editor" data-id="\${nest._id}">
                  <div class="desc-editor-wrap">
                    <div class="desc-toolbar">
                      <button type="button" data-cmd="bold" title="Bold"><strong>B</strong></button>
                      <button type="button" data-cmd="italic" title="Italic"><em>I</em></button>
                      <button type="button" data-cmd="insertUnorderedList" title="Bullet list">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="9" y1="6" x2="20" y2="6"></line>
                          <line x1="9" y1="12" x2="20" y2="12"></line>
                          <line x1="9" y1="18" x2="20" y2="18"></line>
                          <circle cx="4" cy="6" r="1.5" fill="currentColor"></circle>
                          <circle cx="4" cy="12" r="1.5" fill="currentColor"></circle>
                          <circle cx="4" cy="18" r="1.5" fill="currentColor"></circle>
                        </svg>
                      </button>
                    </div>
                    <div class="desc-content"
                         contenteditable="true"
                         data-id="\${nest._id}"
                         data-placeholder="Add a description...">\${nest.description || ''}</div>
                  </div>
                </div>
              </div>
              <div class="due-btn \${nest.due ? 'has-due' : ''}"
                   data-action="due"
                   data-id="\${nest._id}">
                \${calendarIcon}
                <span class="due-tooltip">\${nest.due ? formatDueDate(nest.due) : 'Set due date'}</span>
                <div class="due-picker" data-id="\${nest._id}">
                  <input type="datetime-local" class="due-input" value="\${toDateTimeLocal(nest.due)}" data-id="\${nest._id}">
                  <button type="button" class="due-save-btn" data-id="\${nest._id}">Save</button>
                </div>
              </div>
              <button class="desc-btn \${nest.description ? 'has-desc' : ''}"
                      data-action="desc"
                      data-id="\${nest._id}">
                \${docIcon}
                <span class="desc-tooltip"><span class="desc-tooltip-text">\${nest.description ? escapeHtml(nest.description) : 'Add description'}</span></span>
              </button>
              <a href="https://app.nestr.io/n/\${nest._id}"
                 target="_blank"
                 class="nest-link"
                 title="Open in Nestr">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            </li>
          \`).join('')}
        </ul>
      \`;

      appEl.innerHTML = html;
      attachEventListeners();
    }

    function attachEventListeners() {
      // Toggle completion
      document.querySelectorAll('[data-action="toggle"]').forEach(el => {
        el.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const nest = nests.find(n => n._id === id);
          if (!nest) return;

          const newCompleted = !nest.completed;
          nest.completed = newCompleted;
          render();

          try {
            await app.callTool('nestr_update_nest', {
              nestId: id,
              completed: newCompleted
            });
          } catch (err) {
            console.error('Failed to update completion:', err);
            nest.completed = !newCompleted;
            render();
          }
        });
      });

      // Editable titles
      document.querySelectorAll('.nest-title').forEach(el => {
        el.addEventListener('blur', async (e) => {
          const id = e.target.dataset.id;
          const original = e.target.dataset.original;
          const newTitle = e.target.innerHTML.trim();

          if (newTitle === original || !e.target.textContent.trim()) {
            e.target.innerHTML = original;
            return;
          }

          const nest = nests.find(n => n._id === id);
          if (nest) nest.title = newTitle;
          e.target.dataset.original = newTitle;

          try {
            await app.callTool('nestr_update_nest', {
              nestId: id,
              title: newTitle
            });
          } catch (err) {
            console.error('Failed to update title:', err);
            if (nest) nest.title = original;
            e.target.innerHTML = original;
            e.target.dataset.original = original;
          }
        });

        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
          }
          if (e.key === 'Escape') {
            e.target.innerHTML = e.target.dataset.original;
            e.target.blur();
          }
        });
      });

      // Due date - open picker
      document.querySelectorAll('[data-action="due"]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.due-picker')) return; // Don't toggle if clicking inside picker
          e.stopPropagation();
          // Close other pickers
          document.querySelectorAll('.due-picker.open').forEach(p => p.classList.remove('open'));
          const picker = el.querySelector('.due-picker');
          if (picker) {
            picker.classList.toggle('open');
          }
        });
      });

      // Due date - save button
      document.querySelectorAll('.due-save-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const picker = btn.closest('.due-picker');
          const input = picker.querySelector('.due-input');
          const newDue = input.value ? new Date(input.value).toISOString() : null;

          const nest = nests.find(n => n._id === id);
          const oldDue = nest ? nest.due : null;
          if (nest) nest.due = newDue;

          // Update button state
          const dueBtn = btn.closest('.due-btn');
          if (dueBtn) {
            const tooltip = dueBtn.querySelector('.due-tooltip');
            if (newDue) {
              dueBtn.classList.add('has-due');
              if (tooltip) tooltip.textContent = formatDueDate(newDue);
            } else {
              dueBtn.classList.remove('has-due');
              if (tooltip) tooltip.textContent = 'Set due date';
            }
          }

          picker.classList.remove('open');

          try {
            await app.callTool('nestr_update_nest', {
              nestId: id,
              due: newDue
            });
          } catch (err) {
            console.error('Failed to update due date:', err);
            if (nest) nest.due = oldDue;
            render();
          }
        });
      });

      // Close picker when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.due-btn')) {
          document.querySelectorAll('.due-picker.open').forEach(p => p.classList.remove('open'));
        }
      });

      // Description toggle
      document.querySelectorAll('[data-action="desc"]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = e.currentTarget.dataset.id;
          const editor = document.querySelector(\`.desc-editor[data-id="\${id}"]\`);
          if (editor) {
            // Close other open editors
            document.querySelectorAll('.desc-editor.open').forEach(ed => {
              if (ed !== editor) ed.classList.remove('open');
            });
            const isOpen = editor.classList.toggle('open');
            if (isOpen) {
              const content = editor.querySelector('.desc-content');
              if (content) content.focus();
            }
          }
        });
      });

      // Description toolbar buttons
      document.querySelectorAll('.desc-toolbar button').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent losing focus from contenteditable
          const cmd = btn.dataset.cmd;
          document.execCommand(cmd, false, null);
        });
      });

      // Description rich text editor
      document.querySelectorAll('.desc-content').forEach(el => {
        el.addEventListener('blur', async (e) => {
          const id = e.target.dataset.id;
          const newDesc = e.target.innerHTML.trim();
          const nest = nests.find(n => n._id === id);
          if (!nest) return;

          const oldDesc = nest.description || '';
          const isEmpty = !e.target.textContent.trim();

          if (newDesc === oldDesc) return;

          nest.description = isEmpty ? '' : newDesc;

          // Update button state
          const btn = document.querySelector(\`.desc-btn[data-id="\${id}"]\`);
          if (btn) {
            const tooltip = btn.querySelector('.desc-tooltip');
            if (!isEmpty) {
              btn.classList.add('has-desc');
              if (tooltip) tooltip.textContent = e.target.textContent.trim();
            } else {
              btn.classList.remove('has-desc');
              if (tooltip) tooltip.textContent = 'Add description';
            }
          }

          try {
            await app.callTool('nestr_update_nest', {
              nestId: id,
              description: isEmpty ? '' : newDesc
            });
          } catch (err) {
            console.error('Failed to update description:', err);
            nest.description = oldDesc;
            e.target.innerHTML = oldDesc;
            // Revert button state
            if (btn) {
              const tooltip = btn.querySelector('.desc-tooltip');
              if (oldDesc) {
                btn.classList.add('has-desc');
                if (tooltip) tooltip.textContent = oldDesc.replace(/<[^>]*>/g, '');
              } else {
                btn.classList.remove('has-desc');
                if (tooltip) tooltip.textContent = 'Add description';
              }
            }
          }
        });

        el.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            const editor = e.target.closest('.desc-editor');
            if (editor) editor.classList.remove('open');
            e.target.blur();
          }
        });
      });

      // Drag and drop - clear selection on mousedown to prevent text selection blocking drag
      document.querySelectorAll('.nest-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          // Don't interfere if clicking into an already-focused editable field
          const editable = e.target.closest('.nest-title') || e.target.closest('.desc-content');
          if (editable && document.activeElement === editable) return;
          window.getSelection().removeAllRanges();
        });

        el.addEventListener('dragstart', (e) => {
          window.getSelection().removeAllRanges();
          // Blur any focused title so it doesn't block drag
          const focused = document.querySelector('.nest-title:focus');
          if (focused) focused.blur();
          draggedItem = e.target.closest('.nest-item');
          draggedItem.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        el.addEventListener('dragend', (e) => {
          e.target.classList.remove('dragging');
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          draggedItem = null;
        });

        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          if (e.target.closest('.nest-item') !== draggedItem) {
            const item = e.target.closest('.nest-item');
            if (item) {
              document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
              item.classList.add('drag-over');
            }
          }
        });

        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          const targetItem = e.target.closest('.nest-item');
          if (!targetItem || targetItem === draggedItem) return;

          const draggedId = draggedItem.dataset.id;
          const targetId = targetItem.dataset.id;
          const draggedIndex = parseInt(draggedItem.dataset.index);
          const targetIndex = parseInt(targetItem.dataset.index);

          // Remove dragged item from array
          const [movedNest] = nests.splice(draggedIndex, 1);

          // Calculate new index - when moving down, target index shifts by 1 after removal
          const newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
          nests.splice(newIndex, 0, movedNest);
          render();

          try {
            // Use inbox-specific reorder for inbox/daily-plan sources, generic for others
            const reorderTool = source === 'inbox'
              ? 'nestr_reorder_inbox_item'
              : 'nestr_reorder_nest';
            await app.callTool(reorderTool, {
              nestId: draggedId,
              position: 'before',
              relatedNestId: targetId
            });
          } catch (err) {
            console.error('Failed to reorder:', err);
            // Re-render to revert visual order
            render();
          }
        });
      });
    }

    function handleData(data) {
      try {
        // Parse the data if it's a string
        let parsed = data;
        if (typeof data === 'string') {
          parsed = JSON.parse(data);
        }

        // Handle different response formats
        if (Array.isArray(parsed)) {
          nests = parsed;
        } else if (parsed.content && Array.isArray(parsed.content)) {
          // MCP tool result format
          const textContent = parsed.content.find(c => c.type === 'text');
          if (textContent) {
            const inner = JSON.parse(textContent.text);
            // Extract source context for reorder routing
            if (inner.source) {
              source = inner.source;
            }
            // Check if it has title and items
            if (inner.title) {
              titleEl.textContent = inner.title;
              nests = inner.items || [];
            } else if (Array.isArray(inner)) {
              nests = inner;
            } else if (inner.data && Array.isArray(inner.data)) {
              // Wrapped response: { status, meta, data: [...] }
              nests = inner.data;
            } else {
              nests = inner.items || [];
            }
          }
        } else if (parsed.title !== undefined || parsed.items !== undefined) {
          // Object with optional title and items
          if (parsed.source) source = parsed.source;
          if (parsed.title) {
            titleEl.textContent = parsed.title;
          }
          nests = parsed.items || [];
        } else if (parsed.data && Array.isArray(parsed.data)) {
          nests = parsed.data;
        } else {
          nests = [];
        }

        render();
      } catch (err) {
        console.error('Failed to parse data:', err);
        nests = [];
        render();
      }
    }

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-btn');
      btn.classList.add('loading');

      try {
        // Request refresh via model context update - the host should respond with fresh data
        await app.updateModelContext({ action: 'refresh' });
      } catch (err) {
        console.error('Failed to refresh:', err);
      } finally {
        // Remove loading state after a short delay (host should send new data)
        setTimeout(() => btn.classList.remove('loading'), 2000);
      }
    });

    // Sticky header shadow on scroll
    const scrollContainer = document.querySelector('.scroll-container');
    scrollContainer.addEventListener('scroll', () => {
      document.querySelector('.header').classList.toggle('scrolled', scrollContainer.scrollTop > 0);
    });

    // Initialize: connect to host via MCP Apps protocol, then listen for tool results
    appEl.innerHTML = '<div class="loading">Loading...</div>';
    app.onToolResult = handleData;
    app.connect().then(() => {
      app.setupAutoResize();
    }).catch(err => console.error('Failed to connect:', err));
  </script>
</body>
</html>`;

// Get the HTML content for the completable list app
export function getCompletableListHtml(): string {
  return COMPLETABLE_LIST_HTML;
}

// App resource definitions
export const appResources = {
  completableList: {
    uri: "ui://nestr/completable-list",
    name: "Completable List",
    description: "Interactive list for completing tasks and projects. Only use for completable items (tasks, projects, todos, inbox items) - not for roles, circles, metrics, or other structural nests.",
    mimeType: "text/html;profile=mcp-app",
  },
};

// Tool metadata for UI-enabled tools
export const uiToolMeta = {
  completableList: {
    ui: {
      resourceUri: "ui://nestr/completable-list",
    },
  },
};
