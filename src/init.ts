import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_SCENARIO = `id: sample.hello-world
name: Hello World Sample
suite: sample
description: A minimal example to verify your setup.
difficulty: easy
tags:
  - smoke
  - sample
task:
  instructions: |
    Say hello to the user and confirm the system is working.
  context:
    user_name: Alice
tools:
  allowed: []
runtime:
  max_steps: 5
evaluators:
  - id: greeting-output
    type: final_answer_contains
    mode: hard_gate
    config:
      required_substrings:
        - "Hello"
`;

const SAMPLE_FIXTURE = `{
  "users": [
    { "id": "user_001", "name": "Alice", "email": "alice@example.com" }
  ]
}
`;

const SAMPLE_CONFIG = `# Agent Regression Lab Configuration
# Docs: https://github.com/YakshithK/agent-regression-lab#readme

agents:
  - name: mock-default
    provider: mock
    label: mock-default

  # Uncomment and configure to test with OpenAI:
  # - name: openai-test
  #   provider: openai
  #   model: gpt-4o-mini
  #   label: openai-test

# Custom tools can be registered here (must be repo-local paths)
# tools:
#   - name: my.custom_tool
#     modulePath: ./tools/customTool.ts
#     exportName: customTool
`;

export async function initProject(projectName: string): Promise<void> {
  const targetDir = join(process.cwd(), projectName);

  if (existsSync(targetDir)) {
    throw new Error(`Directory '${projectName}' already exists.`);
  }

  // Create directory structure
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(targetDir, "scenarios"), { recursive: true });
  mkdirSync(join(targetDir, "scenarios", "sample"), { recursive: true });
  mkdirSync(join(targetDir, "fixtures"), { recursive: true });

  // Write files
  writeFileSync(join(targetDir, "scenarios", "sample", "hello-world.yaml"), SAMPLE_SCENARIO);
  writeFileSync(join(targetDir, "fixtures", "users.json"), SAMPLE_FIXTURE);
  writeFileSync(join(targetDir, "agentlab.config.yaml"), SAMPLE_CONFIG);

  console.log(`Created '${projectName}' with sample scenario.`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${projectName}`);
  console.log("  agentlab run sample.hello-world --agent mock-default");
}
