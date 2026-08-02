/**
 * Query Router — decides fast (Groq/Cerebras) vs slow (Claude Code)
 *
 * Strategy A (v1): keyword regex.
 * If user mentions an action verb + a system target, route to Claude.
 * Otherwise route to the fast path.
 *
 * Tunable via env: FAST_MODE=on (default on if FAST_LLM_API_KEY set)
 */

// Keywords that indicate the user wants something DONE (tools required),
// not just answered.
const ACTION_VERBS = [
  'run', 'execute', 'check', 'start', 'stop', 'restart', 'reboot',
  'install', 'uninstall', 'update', 'upgrade', 'create', 'delete',
  'remove', 'edit', 'modify', 'change', 'fix', 'debug', 'troubleshoot',
  'deploy', 'push', 'commit', 'build', 'compile', 'test', 'monitor',
  'show me', 'list', 'find', 'search', 'grep', 'tail', 'cat',
  'send', 'post', 'message', 'email', 'notify', 'alert',
  'set up', 'configure', 'enable', 'disable',
];

// Targets that strongly suggest tool use
const SYSTEM_TARGETS = [
  'docker', 'container', 'compose', 'kubernetes', 'k8s', 'pod',
  'server', 'vm', 'proxmox', 'lxc', 'qemu',
  'nginx', 'apache', 'caddy', 'traefik',
  'systemctl', 'service', 'systemd', 'journalctl',
  'ssh', 'scp', 'rsync',
  'file', 'directory', 'folder', 'log', 'logs',
  'database', 'mysql', 'postgres', 'redis', 'mongo',
  'firewall', 'iptables', 'ufw', 'network', 'dns',
  'git', 'repository', 'repo',
  'process', 'pid', 'memory', 'cpu', 'disk', 'storage',
  'cron', 'system', 'syslog', 'dmesg',
  '3cx', 'sip', 'extension', 'drachtio', 'freeswitch',
  'script', 'code', 'function', 'bug', 'error', 'stack trace',
];

// Phrases that are clearly knowledge questions (always fast)
const KNOWLEDGE_HINTS = [
  'what is', 'who is', 'when did', 'where is', 'why is', 'why do',
  'how do you', 'how does', 'how much', 'how many', 'how long',
  'translate', 'meaning of', 'definition', 'difference between',
  'spell', 'synonym', 'antonym',
  'recipe', 'cook', 'bake',
  'weather', 'temperature', 'forecast',
  'calculate', 'what\'s ', "what's ",
  'tell me about', 'explain',
  'opinion', 'think about', 'recommend',
  'joke', 'story', 'poem',
];

// Compile patterns once
const ACTION_RE = new RegExp(
  '\\b(' + ACTION_VERBS.join('|') + ')\\b',
  'i'
);
const TARGET_RE = new RegExp(
  '\\b(' + SYSTEM_TARGETS.join('|') + ')\\b',
  'i'
);
const KNOWLEDGE_RE = new RegExp(
  '(' + KNOWLEDGE_HINTS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
  'i'
);

/**
 * Classify a query.
 * @param {string} text - User's transcribed speech
 * @returns {{path: 'fast'|'slow', reason: string}}
 */
function classify(text) {
  if (!text || !text.trim()) {
    return { path: 'fast', reason: 'empty' };
  }

  // Strong knowledge hint → fast
  if (KNOWLEDGE_RE.test(text)) {
    return { path: 'fast', reason: 'knowledge_hint' };
  }

  // Action verb + system target → slow
  const hasAction = ACTION_RE.test(text);
  const hasTarget = TARGET_RE.test(text);
  if (hasAction && hasTarget) {
    return { path: 'slow', reason: 'action+target' };
  }

  // "check the weather" — action + weather → still fast (knowledge)
  if (hasAction && /weather|forecast|temperature/i.test(text)) {
    return { path: 'fast', reason: 'weather' };
  }

  // Default: fast. False negatives (sent to fast but needed tools) are
  // caught by the fast model saying "I can't actually do that."
  return { path: 'fast', reason: 'default' };
}

module.exports = {
  classify,
  // Export for testing
  ACTION_VERBS,
  SYSTEM_TARGETS,
  KNOWLEDGE_HINTS,
};
