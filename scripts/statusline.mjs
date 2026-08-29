#!/usr/bin/env node
import fs from 'fs';

function formatPct(val) {
  if (!val || typeof val.remaining_fraction !== 'number') return null;
  const pct = Math.round(val.remaining_fraction * 100);
  const color = pct > 50 ? '\x1b[32m' : (pct > 20 ? '\x1b[33m' : '\x1b[31m');
  return `${color}${pct}%\x1b[0m`;
}

try {
  const input = fs.readFileSync(0, 'utf-8');
  if (!input.trim()) process.exit(0);

  const data = JSON.parse(input);

  // Model name + Effort (high / medium / low)
  let rawName = data.model?.display_name || data.model?.id || 'Gemini';
  let effort = data.model?.effort || '';
  
  if (!effort) {
    const m = rawName.match(/\((High|Medium|Low)\)/i);
    if (m) effort = m[1].toLowerCase();
  }

  let modelShort = rawName
    .replace(/^Gemini\s*/i, 'G-')
    .replace(/\s*\(High\)|\s*\(Medium\)|\s*\(Low\)/gi, '')
    .trim();

  let effortTag = '';
  if (effort) {
    const effColor = effort === 'high' ? '\x1b[33m' : (effort === 'medium' ? '\x1b[36m' : '\x1b[32m');
    effortTag = ` \x1b[90m·\x1b[0m ${effColor}${effort}\x1b[0m`;
  }

  // Context %
  let usedPct = 0;
  if (typeof data.context_window?.used_percentage === 'number') {
    usedPct = Math.round(data.context_window.used_percentage);
  } else if (typeof data.context_window?.remaining_percentage === 'number') {
    usedPct = Math.round(100 - data.context_window.remaining_percentage);
  }

  // Quotas
  const quota = data.quota || {};
  const g5h = formatPct(quota['gemini-5h']);
  const gWeek = formatPct(quota['gemini-weekly']);
  const p3Week = formatPct(quota['3p-weekly']);

  const quotaParts = [];
  if (g5h) quotaParts.push(`\x1b[90m5h:\x1b[0m${g5h}`);
  if (gWeek) quotaParts.push(`\x1b[90mSem:\x1b[0m${gWeek}`);
  if (p3Week) quotaParts.push(`\x1b[90m3P:\x1b[0m${p3Week}`);

  const tokenColor = usedPct < 60 ? '\x1b[36m' : (usedPct < 85 ? '\x1b[33m' : '\x1b[31m');
  const ctxStr = `\x1b[90mCtx:\x1b[0m${tokenColor}${usedPct}%\x1b[0m`;
  const quotaStr = quotaParts.length > 0 ? ` \x1b[90m|\x1b[0m ${quotaParts.join(' ')}` : '';

  const output = `\x1b[1;34m[AGY]\x1b[0m \x1b[35m${modelShort}\x1b[0m${effortTag} \x1b[90m|\x1b[0m ${ctxStr}${quotaStr}`;

  process.stdout.write(output);
} catch {
  // Silent fallback
}
