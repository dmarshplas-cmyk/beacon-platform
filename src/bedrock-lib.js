/**
 * bedrock-lib.js — thin wrapper for Bedrock (Anthropic messages API).
 * Model via env BEDROCK_MODEL_ID; callers must catch and fall back —
 * intelligence is an enhancement, never a dependency.
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({});
const MODEL = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-haiku-20241022-v1:0";

async function ask(system, user, maxTokens = 600) {
  const res = await client.send(new InvokeModelCommand({
    modelId: MODEL,
    contentType: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  }));
  const body = JSON.parse(Buffer.from(res.body).toString("utf8"));
  return (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

module.exports = { ask, MODEL };
