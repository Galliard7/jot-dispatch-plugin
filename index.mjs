// jot-dispatch plugin — routes /jot, /anchors, and /idea slash commands
// directly to their backing Python scripts, bypassing the LLM entirely.
// This exists because LLM-based dispatch is unreliable for deterministic
// commands:
// - bare `/jot` triggers "let me know what you want" responses
// - imperative-verb args ("Run X", "Fix Y") get rewritten or swallowed
//
// The plugin registers a single tool `jot_dispatch`, which the skill
// command-dispatch system invokes directly with {command, commandName, skillName}.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

// Plain JSON Schema objects instead of TypeBox. The plugin loader doesn't
// resolve workspace-external dependencies, and TypeBox runtime shapes are just
// objects with extra Symbol metadata — since this tool is dispatched directly
// (never LLM-called), the schema only needs to serialize cleanly.
const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const DISPATCH_PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    command: {
      type: "string",
      description: "Raw argument string after the slash command",
    },
    commandName: { type: "string" },
    skillName: { type: "string" },
  },
  required: ["command"],
};

// Map skill name → absolute script path.
const SKILL_SCRIPTS = {
  jot: path.join(homedir(), "skill-backends/jot/jot.py"),
  anchors: path.join(homedir(), "skill-backends/anchors/anchors.py"),
  idea: path.join(homedir(), "skill-backends/noteflow/nf-idea.py"),
};

// Simple whitespace-split of the raw arg string into argv. The Python scripts
// already handle multi-word items by joining their argv with spaces, so
// "Run insights on CC" → ["Run", "insights", "on", "CC"] → script re-joins.
function splitArgs(argsString) {
  const trimmed = (argsString ?? "").trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/);
}

function runScript(scriptPath, argsString) {
  return new Promise((resolve) => {
    const argv = splitArgs(argsString);
    const child = spawn("python3", [scriptPath, ...argv], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ code: -1, stdout: "", stderr: `spawn failed: ${err.message}` });
    });
  });
}

const JotDispatchPlugin = {
  id: "jot-dispatch",
  name: "Jot Dispatch",
  description:
    "Deterministic dispatch for /jot, /anchors, and /idea slash commands — bypasses the LLM.",
  get configSchema() {
    return EMPTY_OBJECT_SCHEMA;
  },
  register(api) {
    api.registerTool(
      () => ({
        name: "jot_dispatch",
        label: "Jot Dispatch",
        description:
          "Internal: dispatches /jot, /anchors, and /idea slash commands to their backing Python scripts. Routed via skill command-dispatch — do not call directly from agent reasoning.",
        parameters: DISPATCH_PARAMS_SCHEMA,
        ownerOnly: true,
        async execute(_toolCallId, params) {
          const skillName =
            typeof params?.skillName === "string" ? params.skillName : "";
          const command =
            typeof params?.command === "string" ? params.command : "";
          const script = SKILL_SCRIPTS[skillName];
          if (!script) {
            const known = Object.keys(SKILL_SCRIPTS).join(", ");
            return {
              content: [
                {
                  type: "text",
                  text: `❌ jot-dispatch: unknown skill "${skillName}". Expected one of: ${known}`,
                },
              ],
            };
          }
          const { code, stdout, stderr } = await runScript(script, command);
          let text;
          if (code === 0) {
            text = stdout.trim() || "✅ Done.";
          } else {
            text = `❌ exit ${code}\n${stderr || stdout || "(no output)"}`.trim();
          }
          return { content: [{ type: "text", text }] };
        },
      }),
      { name: "jot_dispatch" }
    );
  },
};

export default JotDispatchPlugin;
