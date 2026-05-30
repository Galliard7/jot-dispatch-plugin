// jot-dispatch plugin — routes /jot, /anchors, and /idea slash commands
// directly to their backing Python scripts, bypassing the LLM entirely.
//
// Uses registerCommand (not registerTool) so the script output goes straight
// to the user without the LLM summarizing, reformatting, or adding commentary.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

// Map command name → absolute script path.
const COMMAND_SCRIPTS = {
  jot: path.join(homedir(), "skill-backends/jot/jot.py"),
  anchors: path.join(homedir(), "skill-backends/anchors/anchors.py"),
  idea: path.join(homedir(), "skill-backends/noteflow/nf-idea.py"),
};

function runScript(scriptPath, argsString) {
  return new Promise((resolve) => {
    const trimmed = (argsString ?? "").trim();
    const argv = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
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
    "Deterministic dispatch for /jot, /anchors, and /idea — script output goes directly to the user, no LLM involved.",
  get configSchema() {
    return { type: "object", additionalProperties: false, properties: {} };
  },
  register(api) {
    for (const [cmdName, scriptPath] of Object.entries(COMMAND_SCRIPTS)) {
      api.registerCommand({
        name: cmdName,
        description: `Run the ${cmdName} script`,
        acceptsArgs: true,
        requireAuth: true,
        async handler(ctx) {
          const { code, stdout, stderr } = await runScript(
            scriptPath,
            ctx.args ?? ""
          );
          if (code === 0) {
            return { text: stdout.trim() || "✅ Done." };
          }
          return {
            text: `❌ exit ${code}\n${stderr || stdout || "(no output)"}`.trim(),
          };
        },
      });
    }
  },
};

export default JotDispatchPlugin;
