import type { ToolHandler } from "./tools.js";
import type { ScenarioDefinition, ToolSpec } from "./types.js";

export const DEMO_SCENARIO: ScenarioDefinition = {
  id: "demo.snapshot-companion",
  name: "Snapshot Companion Demo",
  suite: "demo",
  description: "Zero-config demo scenario for Agent Regression Lab.",
  task: {
    instructions: "Use the bundled demo notes to answer today's date.",
  },
  context: {
    variables: {
      query: "today date",
      expected_answer: "May 10 2026",
      answer_prefix: "Today",
    },
  },
  tools: {
    allowed: ["docs.search", "docs.read"],
  },
  runtime: {
    max_steps: 4,
    timeout_seconds: 10,
  },
  evaluators: [
    {
      id: "mentions-date",
      type: "final_answer_contains",
      mode: "weighted",
      weight: 50,
      config: {
        required_substrings: ["May 10 2026", "source: demo-note"],
      },
    },
    {
      id: "uses-two-tools",
      type: "tool_call_count_max",
      mode: "weighted",
      weight: 50,
      config: {
        max: 2,
      },
    },
  ],
};

export const DEMO_REGRESSION_SCENARIO: ScenarioDefinition = {
  ...DEMO_SCENARIO,
  evaluators: DEMO_SCENARIO.evaluators.map((evaluator) =>
    evaluator.id === "mentions-date"
      ? {
          ...evaluator,
          config: {
            required_substrings: ["May 11 2026", "source: demo-note"],
          },
        }
      : evaluator,
  ),
};

export const DEMO_TOOL_SPECS: ToolSpec[] = [
  {
    name: "docs.search",
    description: "Search bundled demo notes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "docs.read",
    description: "Read a bundled demo note.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        doc_id: { type: "string" },
      },
      required: ["doc_id"],
    },
  },
];

export const DEMO_TOOLS: Record<string, ToolHandler> = {
  "docs.search": async () => [{ id: "demo-note", title: "Demo date note" }],
  "docs.read": async () => ({
    id: "demo-note",
    title: "Demo date note",
    content: "The demo date is May 10 2026.",
  }),
};
