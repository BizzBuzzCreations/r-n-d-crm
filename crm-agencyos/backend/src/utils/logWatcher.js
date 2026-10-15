'use strict';
/**
 * LogWatcher — Polls log files for new content and emits lines
 * to the Socket.IO room 'admin:syslog' in near-real-time.
 *
 * Strategy: setInterval every 1.5 s, read file bytes since last position.
 * Handles file rotation (size shrinkage) by resetting position.
 *
 * No external dependencies.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { FILES, PM2_FILES } = require('./sysLogger');

// All sources the watcher monitors, keyed by a stable ID
const ALL_SOURCES = { ...FILES, ...PM2_FILES };

// ── Line parser ────────────────────────────────────────────────────────────
function parseLine(raw, fileKey) {
  const line = (raw || '').trim();
  if (!line) return null;

  let ts      = new Date().toISOString();
  let level   = 'INFO';
  let source  = fileKey.toUpperCase().replace(/-/g, '_');
  let message = line;

  // Format 1: Structured JSON (our sysLogger)
  if (line.startsWith('{')) {
    try {
      const obj = JSON.parse(line);
      return {
        id:       `${obj.ts}-${Math.random().toString(36).slice(2)}`,
        ts:       obj.ts || ts,
        level:    (obj.level || 'INFO').toUpperCase(),
        source:   obj.source || source,
        message:  obj.message || '',
        raw:      line,
        fileKey,
      };
    } catch {}
  }

  // Format 2: PM2 timestamp prefix  "2024-01-15T14:30:00: message"
  const pm2 = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?):\s*(.+)$/);
  if (pm2) { ts = pm2[1]; message = pm2[2]; }

  // Format 3: ISO timestamp inline  "2024-01-15T14:30:00.000Z [LEVEL] [SRC] msg"
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\w.:-]+)\s+\[(\w+)\]\s+(?:\[(\w+)\]\s+)?(.+)$/);
  if (iso) { ts = iso[1]; level = iso[2]; source = iso[3] || source; message = iso[4]; }

  // Format 4: Morgan HTTP  "GET /api/tasks 200 50ms"
  const http = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})\s+(.+)$/);
  if (http) { source = 'HTTP'; level = Number(http[3]) >= 500 ? 'ERROR' : Number(http[3]) >= 400 ? 'WARN' : 'INFO'; }

  // Infer level from emoji/keywords if not already set
  if (!/^(ERROR|WARN|DEBUG)$/.test(level)) {
    if (/error|fail|exception|crash|❌/i.test(message))  level = 'ERROR';
    else if (/warn|warning|⚠|retry/i.test(message))      level = 'WARN';
    else if (/debug/i.test(message))                       level = 'DEBUG';
    else                                                   level = 'INFO';
  }

  // Infer source tag from message
  const srcMap = [
    [/mongodb|mongoose|mongo/i,          'DB'],
    [/redis/i,                           'REDIS'],
    [/bullmq|queue|job \d+/i,           'QUEUE'],
    [/smtp|nodemailer|email/i,           'SMTP'],
    [/socket|ws:|🔌/i,                   'SOCKET'],
    [/jwt|auth|token|login|logout/i,     'AUTH'],
    [/server|port|listen|🚀/i,           'SERVER'],
    [/GET |POST |PUT |DELETE |PATCH /i,  'HTTP'],
    [/worker/i,                          'WORKER'],
  ];
  for (const [re, tag] of srcMap) {
    if (re.test(message)) { source = tag; break; }
  }

  return {
    id:      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ts,
    level,
    source,
    message,
    raw:     line,
    fileKey,
  };
}

// ── LogWatcher class ───────────────────────────────────────────────────────
class LogWatcher {
  constructor(io) {
    this.io        = io;
    this.positions = {};   // fileKey → last byte position
    this.timer     = null;
    this.INTERVAL  = 1500; // ms
  }

  /** Start polling. Called once after io is initialised. */
  start() {
    if (this.timer) return;

    // Seed positions to current EOF so we only emit NEW lines going forward
    for (const [key, fp] of Object.entries(ALL_SOURCES)) {
      try {
        const stat = fs.statSync(fp);
        this.positions[key] = stat.size;
      } catch {
        this.positions[key] = 0;
      }
    }

    this.timer = setInterval(() => this._tick(), this.INTERVAL);
    console.log('[LogWatcher] Started — polling', Object.keys(ALL_SOURCES).length, 'log sources');
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Send the last N lines from a file as the initial payload for a new subscriber. */
  sendInitial(socket, fileKey, n = 300) {
    const fp = ALL_SOURCES[fileKey];
    if (!fp) return;
    const lines = this._readLastN(fp, fileKey, n);
    if (lines.length) socket.emit('system:log:lines', { fileKey, lines });
  }

  /** Send last N lines from ALL sources to a new subscriber. */
  sendAllInitial(socket, n = 200) {
    for (const fileKey of Object.keys(ALL_SOURCES)) {
      const fp = ALL_SOURCES[fileKey];
      try {
        if (fs.existsSync(fp)) this.sendInitial(socket, fileKey, n);
      } catch {}
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  _tick() {
    for (const [key, fp] of Object.entries(ALL_SOURCES)) {
      try {
        const stat = fs.statSync(fp);
        const size = stat.size;
        const last = this.positions[key] ?? 0;

        if (size < last) {
          // File was rotated/truncated. `continue`, not `return` — returning
          // abandoned the whole tick, so every log source after the rotated
          // one was skipped until the next interval (and if two rotated in
          // sequence, sources further down the list could starve).
          this.positions[key] = 0;
          continue;
        }

        if (size > last) {
          const newBytes = size - last;
          const buf = Buffer.alloc(newBytes);
          const fd  = fs.openSync(fp, 'r');
          fs.readSync(fd, buf, 0, newBytes, last);
          fs.closeSync(fd);
          this.positions[key] = size;

          const rawLines = buf.toString('utf8').split('\n');
          const parsed   = rawLines.map(l => parseLine(l, key)).filter(Boolean);
          if (parsed.length) {
            this.io.to('admin:syslog').emit('system:log:lines', { fileKey: key, lines: parsed });
          }
        }
      } catch {
        // File doesn't exist yet — ignore
      }
    }
  }

  _readLastN(fp, fileKey, n) {
    try {
      const stat = fs.statSync(fp);
      if (stat.size === 0) return [];

      const CHUNK = Math.min(stat.size, Math.max(n * 250, 65536));
      const start = Math.max(0, stat.size - CHUNK);
      const buf   = Buffer.alloc(stat.size - start);
      const fd    = fs.openSync(fp, 'r');
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);

      return buf.toString('utf8')
        .split('\n')
        .map(l => parseLine(l, fileKey))
        .filter(Boolean)
        .slice(-n);
    } catch {
      return [];
    }
  }
}

module.exports = { LogWatcher, parseLine, ALL_SOURCES };
