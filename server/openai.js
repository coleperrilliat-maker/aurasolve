import {solutionSchema, validateSolution} from "../src/shared/solution.js";
import {TUTOR_INSTRUCTIONS} from "../src/shared/instructions.js";

export async function solveWithOpenAI(snapshot, mode, model, signal) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Server is missing OPENAI_API_KEY.");

  const image = typeof snapshot.image === "string" && snapshot.image.length < 3_500_000 && /^data:image\/(jpeg|png);base64,/.test(snapshot.image) ? snapshot.image : null;
  const text = JSON.stringify({
    mode,
    question: snapshot.question,
    fields: snapshot.fields,
    selected: snapshot.selected,
    dropTargets: snapshot.dropTargets,
    limitations: snapshot.limitations,
    screenshotAttached: Boolean(image),
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      store: false,
      instructions: TUTOR_INSTRUCTIONS,
      input: image
        ? [{role: "user", content: [{type: "input_text", text}, {type: "input_image", image_url: image, detail: "high"}]}]
        : text,
      max_output_tokens: 3000,
      text: {
        format: {
          type: "json_schema",
          name: "practice_solution",
          strict: true,
          schema: solutionSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const code = response.status;
    throw new Error(
      code === 401
        ? "OpenAI rejected the server API key."
        : code === 429
          ? "OpenAI rate limit or credit limit reached."
          : `OpenAI request failed (${code}).`,
    );
  }

  const data = await response.json();
  if (data.status !== "completed") throw new Error("OpenAI did not finish the answer.");

  const output = data.output?.flatMap(item => item.content || []) || [];
  if (output.some(item => item.type === "refusal")) throw new Error("The model declined this question.");

  const json = output.filter(item => item.type === "output_text").map(item => item.text).join("");
  try {
    return validateSolution(JSON.parse(json), snapshot, mode);
  } catch (error) {
    throw new Error(`Could not use the answer: ${error.message}`);
  }
}
