import { EventEmitter } from "node:events";
import pino from "pino";

const log = pino({ name: "event-queue" });

export interface ProactiveEvent {
  type: "cron" | "heartbeat" | "timer" | "webhook";
  jid: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Central event queue for all proactive triggers.
 * Cron, heartbeat, and timers push events here.
 * The router subscribes and handles them like WhatsApp messages.
 */
export class EventQueue extends EventEmitter {
  push(event: ProactiveEvent): void {
    log.info({ type: event.type, jid: event.jid }, "Proactive event queued");
    this.emit("event", event);
  }
}
