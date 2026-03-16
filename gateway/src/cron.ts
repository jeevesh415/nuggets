import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { GATEWAY_DIR, CRON_EVAL_INTERVAL_MS } from "./config.js";
import { EventQueue } from "./event-queue.js";

const log = pino({ name: "cron" });

export interface CronJob {
  id: string;
  jid: string;
  cron: string; // "minute hour dom month dow" (standard 5-field)
  prompt: string;
  enabled: boolean;
  oneShot: boolean; // if true, delete after firing
  createdAt: string;
}

const CRON_DIR = resolve(GATEWAY_DIR, "cron");
const JOBS_FILE = resolve(CRON_DIR, "jobs.json");
const REQUESTS_FILE = resolve(CRON_DIR, "requests.jsonl");

/**
 * Simple cron scheduler with persistent JSON job store.
 * Evaluates jobs every CRON_EVAL_INTERVAL_MS and pushes matching events.
 */
export class CronScheduler {
  private jobs: CronJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private requestWatcher: ReturnType<typeof setInterval> | null = null;
  private lastEvalMinute = -1;
  private lastRequestSize = 0;
  private defaultJid: string | null = null;

  constructor(private queue: EventQueue) {
    mkdirSync(CRON_DIR, { recursive: true });
    this.load();
  }

  /** Set the default JID for requests that don't specify one (single-user mode) */
  setDefaultJid(jid: string): void {
    this.defaultJid = jid;
  }

  start(): void {
    if (this.timer) return;
    log.info({ jobCount: this.jobs.length }, "Cron scheduler started");
    this.timer = setInterval(() => this.evaluate(), CRON_EVAL_INTERVAL_MS);
    // Watch for schedule requests from Pi extension
    this.lastRequestSize = this.getRequestFileSize();
    this.requestWatcher = setInterval(() => this.processRequests(), 5000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.requestWatcher) {
      clearInterval(this.requestWatcher);
      this.requestWatcher = null;
    }
  }

  addJob(jid: string, cron: string, prompt: string, oneShot = false): CronJob {
    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      jid,
      cron,
      prompt,
      enabled: true,
      oneShot,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    this.save();
    log.info({ id: job.id, jid, cron, oneShot }, "Job added");
    return job;
  }

  removeJob(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.save();
    log.info({ id }, "Job removed");
    return true;
  }

  listJobs(jid?: string): CronJob[] {
    if (jid) return this.jobs.filter((j) => j.jid === jid);
    return [...this.jobs];
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private evaluate(): void {
    const now = new Date();
    const currentMinute = now.getFullYear() * 1e8 + now.getMonth() * 1e6 +
      now.getDate() * 1e4 + now.getHours() * 100 + now.getMinutes();

    // Only evaluate once per minute
    if (currentMinute === this.lastEvalMinute) return;
    this.lastEvalMinute = currentMinute;

    const toRemove: string[] = [];

    for (const job of this.jobs) {
      if (!job.enabled) continue;

      if (matchesCron(job.cron, now)) {
        log.info({ id: job.id, jid: job.jid, cron: job.cron }, "Cron job fired");
        this.queue.push({
          type: job.oneShot ? "timer" : "cron",
          jid: job.jid,
          prompt: job.prompt,
          metadata: { cronJobId: job.id },
        });

        if (job.oneShot) {
          toRemove.push(job.id);
        }
      }
    }

    if (toRemove.length > 0) {
      this.jobs = this.jobs.filter((j) => !toRemove.includes(j.id));
      this.save();
    }
  }

  private getRequestFileSize(): number {
    try {
      const stat = statSync(REQUESTS_FILE);
      return stat.size;
    } catch {
      return 0;
    }
  }

  private processRequests(): void {
    const currentSize = this.getRequestFileSize();
    if (currentSize <= this.lastRequestSize) return;

    try {
      const data = readFileSync(REQUESTS_FILE, "utf-8");
      const lines = data.trim().split("\n").filter(Boolean);

      // Process only new lines
      const allPrevious = this.lastRequestSize > 0
        ? readFileSync(REQUESTS_FILE, "utf-8").substring(0, this.lastRequestSize).trim().split("\n").filter(Boolean).length
        : 0;

      const newLines = lines.slice(allPrevious);

      for (const line of newLines) {
        try {
          const request = JSON.parse(line);
          this.handleRequest(request);
        } catch (err) {
          log.error({ line, err }, "Invalid schedule request");
        }
      }

      this.lastRequestSize = currentSize;
    } catch (err) {
      log.error({ err }, "Failed to process schedule requests");
    }
  }

  private handleRequest(request: {
    action: string;
    id?: string;
    cron?: string;
    prompt?: string;
    oneShot?: boolean;
    jid?: string;
  }): void {
    const jid = request.jid || this.defaultJid;

    if (request.action === "add") {
      if (!request.cron || !request.prompt) {
        log.error({ request }, "Schedule request missing cron or prompt");
        return;
      }
      if (!jid) {
        log.error({ request }, "Schedule request missing jid and no default set");
        return;
      }
      const job = this.addJob(jid, request.cron, request.prompt, request.oneShot);
      log.info({ id: job.id, cron: job.cron }, "Schedule request processed: add");
    }

    if (request.action === "remove" && request.id) {
      this.removeJob(request.id);
      log.info({ id: request.id }, "Schedule request processed: remove");
    }
  }

  private load(): void {
    if (!existsSync(JOBS_FILE)) {
      this.jobs = [];
      return;
    }
    try {
      const data = readFileSync(JOBS_FILE, "utf-8");
      this.jobs = JSON.parse(data);
      log.info({ count: this.jobs.length }, "Loaded cron jobs");
    } catch (err) {
      log.error({ err }, "Failed to load cron jobs — starting fresh");
      this.jobs = [];
    }
  }

  private save(): void {
    writeFileSync(JOBS_FILE, JSON.stringify(this.jobs, null, 2) + "\n");
  }
}

/**
 * Match a 5-field cron expression against a Date.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: wildcards, specific numbers, comma lists, ranges (1-5), steps
 */
function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const checks = [
    { value: date.getMinutes(), field: fields[0], min: 0, max: 59 },
    { value: date.getHours(), field: fields[1], min: 0, max: 23 },
    { value: date.getDate(), field: fields[2], min: 1, max: 31 },
    { value: date.getMonth() + 1, field: fields[3], min: 1, max: 12 },
    { value: date.getDay(), field: fields[4], min: 0, max: 6 },
  ];

  return checks.every(({ value, field, min, max }) =>
    matchesField(field, value, min, max),
  );
}

function matchesField(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === "*") return true;

  // Handle step: */5 or 1-10/2
  if (field.includes("/")) {
    const [range, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    if (range === "*") {
      return (value - min) % step === 0;
    }
    // Range with step: 1-30/5
    const [lo, hi] = range.split("-").map(Number);
    return value >= lo && value <= hi && (value - lo) % step === 0;
  }

  // Handle comma-separated: 1,15,30
  const parts = field.split(",");
  return parts.some((part) => {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      return value >= lo && value <= hi;
    }
    return parseInt(part, 10) === value;
  });
}
