// Debug panel utility - logs appear on screen for mobile debugging
let debugLogs: string[] = [];
let debugPanel: HTMLDivElement | null = null;

export function initDebugPanel() {
  // Create debug panel
  debugPanel = document.createElement('div');
  debugPanel.id = 'debug-panel';
  debugPanel.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    width: 300px;
    height: 200px;
    background: rgba(0, 0, 0, 0.8);
    color: #0f0;
    font-family: monospace;
    font-size: 11px;
    padding: 10px;
    border-radius: 8px;
    overflow-y: auto;
    z-index: 9999;
    border: 2px solid #0f0;
  `;
  document.body.appendChild(debugPanel);

  // Override console.log
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    originalLog(...args);
    addDebugLog(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
  };

  console.error = (...args: any[]) => {
    originalLog('ERROR:', ...args);
    addDebugLog('❌ ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
  };

  console.warn = (...args: any[]) => {
    originalLog('WARN:', ...args);
    addDebugLog('⚠️ ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
  };
}

export function addDebugLog(message: string) {
  if (!debugPanel) return;
  
  debugLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (debugLogs.length > 50) debugLogs.shift(); // Keep last 50 logs
  
  debugPanel.innerHTML = debugLogs.map(log => `<div>${log}</div>`).join('');
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

export function clearDebugPanel() {
  debugLogs = [];
  if (debugPanel) {
    debugPanel.innerHTML = '';
  }
}
