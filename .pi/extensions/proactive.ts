/**
 * Proactive Extension — Schedule future messages via the gateway
 *
 * Gives Pi tools to schedule reminders, set timers, and manage scheduled jobs.
 * Communicates with the gateway by writing to .gateway/cron/requests.jsonl.
 * The gateway watches this file and processes requests.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Request file bridge — writes to .gateway/cron/requests.jsonl
// ---------------------------------------------------------------------------

const REQUESTS_FILE = ".gateway/cron/requests.jsonl";

interface ScheduleRequest {
  action: "add" | "remove" | "list";
  id?: string;
  cron?: string;
  prompt?: string;
  oneShot?: boolean;
  timestamp: string;
}

async function writeRequest(
  pi: ExtensionAPI,
  request: ScheduleRequest,
): Promise<{ success: boolean; error?: string }> {
  try {
    const line = JSON.stringify(request);
    const result = await pi.exec("sh", [
      "-c",
      `mkdir -p .gateway/cron && echo '${line.replace(/'/g, "'\\''")}' >> ${REQUESTS_FILE}`,
    ], { timeout: 3000 });
    if (result.code !== 0) {
      return { success: false, error: result.stderr || "Failed to write request" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

const ScheduleParams = Type.Object({
  action: StringEnum(["create", "delete", "list"] as const),
  cron: Type.Optional(Type.String({
    description: 'Cron expression (5-field: min hour dom month dow). Required for "create".',
  })),
  message: Type.Optional(Type.String({
    description: 'The message/prompt to send when the schedule fires. Required for "create".',
  })),
  one_shot: Type.Optional(Type.Boolean({
    description: "If true, fires once then auto-deletes. Default false (recurring).",
  })),
  schedule_id: Type.Optional(Type.String({
    description: 'ID of the schedule to delete. Required for "delete".',
  })),
});

export default function proactive(pi: ExtensionAPI) {
  pi.registerTool({
    name: "schedule",
    label: "Schedule Message",
    description:
      "Schedule future messages, reminders, or follow-ups. " +
      "Use when the user asks to be reminded, wants a check-in later, or needs recurring messages. " +
      'Cron format: "minute hour day-of-month month day-of-week". ' +
      'Examples: "0 9 * * *" (daily 9am), "30 14 * * 1-5" (weekdays 2:30pm), "0 */2 * * *" (every 2h).',
    promptSnippet: "schedule: create/delete/list scheduled messages and reminders",
    promptGuidelines: [
      'Use schedule to create reminders when users say "remind me", "check back", "follow up"',
      "Use one_shot=true for one-time reminders, false for recurring",
      "Always confirm with the user what was scheduled",
    ],
    parameters: ScheduleParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action } = params;

      if (action === "create") {
        if (!params.cron || !params.message) {
          return {
            content: [{ type: "text", text: "Error: both 'cron' and 'message' are required for create action." }],
            isError: true,
          };
        }

        const request: ScheduleRequest = {
          action: "add",
          cron: params.cron,
          prompt: params.message,
          oneShot: params.one_shot ?? false,
          timestamp: new Date().toISOString(),
        };

        const { success, error } = await writeRequest(pi, request);
        if (!success) {
          return {
            content: [{ type: "text", text: `Failed to create schedule: ${error}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: `Schedule created: "${params.message}" with cron "${params.cron}"${params.one_shot ? " (one-shot)" : " (recurring)"}`,
          }],
        };
      }

      if (action === "delete") {
        if (!params.schedule_id) {
          return {
            content: [{ type: "text", text: "Error: 'schedule_id' is required for delete action." }],
            isError: true,
          };
        }

        const request: ScheduleRequest = {
          action: "remove",
          id: params.schedule_id,
          timestamp: new Date().toISOString(),
        };

        const { success, error } = await writeRequest(pi, request);
        if (!success) {
          return {
            content: [{ type: "text", text: `Failed to delete schedule: ${error}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Schedule ${params.schedule_id} deleted.` }],
        };
      }

      if (action === "list") {
        try {
          const result = await pi.exec("cat", [".gateway/cron/jobs.json"], { timeout: 3000 });
          if (result.code !== 0) {
            return {
              content: [{ type: "text", text: "No schedules found." }],
            };
          }

          const jobs = JSON.parse(result.stdout);
          if (!Array.isArray(jobs) || jobs.length === 0) {
            return {
              content: [{ type: "text", text: "No active schedules." }],
            };
          }

          const lines = jobs.map((j: any) =>
            `- [${j.id}] ${j.cron} → "${j.prompt}" ${j.oneShot ? "(one-shot)" : "(recurring)"}${j.enabled ? "" : " (disabled)"}`,
          );

          return {
            content: [{ type: "text", text: `Active schedules:\n${lines.join("\n")}` }],
          };
        } catch {
          return {
            content: [{ type: "text", text: "No schedules found." }],
          };
        }
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${action}` }],
        isError: true,
      };
    },
  });

  // Inject proactive capabilities into system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + `\n\n## Proactive Capabilities

You can schedule future messages and reminders using the \`schedule\` tool.
When a user says "remind me", "check back later", "follow up on this", or similar — use the schedule tool to create a cron job.

Examples:
- "Remind me to exercise at 7am" → schedule with cron "0 7 * * *", one_shot=false
- "Check on the deployment in 30 minutes" → calculate the cron for 30 min from now, one_shot=true
- "Send me a quote every morning" → schedule with cron "0 8 * * *"`,
    };
  });
}
