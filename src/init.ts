import { input, select } from "@inquirer/prompts";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { boxed, heroBanner, style } from "./cliStyle.js";
import { generateScenarios } from "./generate.js";

type InitAnswers = {
  provider: "mock" | "openai" | "http" | "external_process";
  domain: "support" | "coding" | "research" | "ops" | "general";
  agentName: string;
  baseUrl?: string;
  harnessLanguage?: "node" | "python" | "other";
};

type InitOptions = {
  interactive?: boolean;
  answers?: Partial<InitAnswers>;
};

export async function initProject(projectName?: string, options: InitOptions = {}): Promise<void> {
  if (options.interactive && !process.stdin.isTTY) {
    throw new Error("agentlab init requires an interactive terminal. Run it directly, not piped.\n\nRun: agentlab init");
  }

  const inPlace = !projectName;
  if (projectName && (/[/\\]/.test(projectName) || projectName.split(/[/\\]/).includes(".."))) {
    throw new Error(`Invalid project name '${projectName}'. Use a simple directory name without path separators.\n\nRun: agentlab init my-project`);
  }
  const targetDir = inPlace ? process.cwd() : join(process.cwd(), projectName);
  if (!inPlace && existsSync(targetDir)) {
    throw new Error(`Directory '${projectName}' already exists.\n\nRun: agentlab init`);
  }
  if (inPlace && existsSync(join(targetDir, "agentlab.config.yaml"))) {
    throw new Error("Config already exists. Run `agentlab generate` to add more scenarios.\n\nRun: agentlab generate");
  }

  const answers = options.interactive
    ? await promptForAnswers(projectName ?? basename(process.cwd()), options.answers)
    : defaultAnswers(projectName ?? basename(process.cwd()), options.answers);

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(targetDir, "scenarios"), { recursive: true });
  mkdirSync(join(targetDir, "fixtures"), { recursive: true });
  writeFixtureStubs(targetDir, answers.domain);
  writeFileSync(join(targetDir, "agentlab.config.yaml"), configForAnswers(answers), "utf8");
  appendGitignore(targetDir);

  if (answers.provider === "external_process") {
    writeHarness(targetDir, answers);
  }

  generateScenarios({
    cwd: targetDir,
    agentName: answers.agentName,
    provider: answers.provider,
    domain: answers.domain,
    count: 5,
  });

  console.log(boxed(
    `Your project is ready!\n\n  ${style.muted("Config")}     ${join(targetDir, "agentlab.config.yaml")}\n  ${style.muted("Scenarios")}  ${join(targetDir, "scenarios", answers.domain)}`,
    "green",
  ));
  if (!inPlace) {
    console.log(`  ${style.muted("Next:")}  ${style.cyan(`cd ${projectName!}`)}`);
  }
  console.log(`  ${style.muted("Run:")}   ${style.cyan(`agentlab run ${answers.domain}.generated-happy-path --agent ${answers.agentName}`)}`);
  console.log();
}

async function promptForAnswers(defaultName: string, overrides: Partial<InitAnswers> = {}): Promise<InitAnswers> {
  console.log(heroBanner());
  console.log(style.muted("  Let's wire up your first agent in 60 seconds.\n"));
  const provider = overrides.provider ?? await select<InitAnswers["provider"]>({
    message: "What's your agent's provider?",
    choices: [
      { name: "Mock (deterministic testing, no API key needed)", value: "mock" },
      { name: "OpenAI (OPENAI_API_KEY)", value: "openai" },
      { name: "HTTP service", value: "http" },
      { name: "External process (stdin/stdout)", value: "external_process" },
    ],
  });
  const domain = overrides.domain ?? await select<InitAnswers["domain"]>({
    message: "What domain does your agent work in?",
    choices: [
      { name: "Customer support", value: "support" },
      { name: "Coding assistant", value: "coding" },
      { name: "Research / information retrieval", value: "research" },
      { name: "Operations / runbooks", value: "ops" },
      { name: "General purpose", value: "general" },
    ],
  });
  const agentName = overrides.agentName ?? await input({ message: "What's your agent's name?", default: defaultName });
  const baseUrl = provider === "http" ? overrides.baseUrl ?? await input({ message: "HTTP base URL", default: "http://localhost:3000" }) : undefined;
  const harnessLanguage = provider === "external_process"
    ? overrides.harnessLanguage ?? await select<InitAnswers["harnessLanguage"]>({
        message: "What language is your agent written in?",
        choices: [
          { name: "Node.js", value: "node" },
          { name: "Python", value: "python" },
          { name: "Other", value: "other" },
        ],
      })
    : undefined;
  return { provider, domain, agentName, baseUrl, harnessLanguage };
}

function defaultAnswers(defaultName: string, overrides: Partial<InitAnswers> = {}): InitAnswers {
  return {
    provider: overrides.provider ?? "mock",
    domain: overrides.domain ?? "support",
    agentName: overrides.agentName ?? "mock-default",
    baseUrl: overrides.baseUrl,
    harnessLanguage: overrides.harnessLanguage ?? "node",
  };
}

function configForAnswers(answers: InitAnswers): string {
  const safeAgentName = answers.agentName.replace(/[\r\n:{}[\]|>&*?!,#]/g, "-");
  const safeAnswers = { ...answers, agentName: safeAgentName };
  answers = safeAnswers;
  const supportTool = answers.domain === "support"
    ? `
tools:
  - name: support.find_duplicate_charge
    modulePath: user_tools/findDuplicateCharge.ts
    exportName: findDuplicateCharge
    description: Find the duplicated charge order id for a given customer.
    inputSchema:
      type: object
      additionalProperties: false
      properties:
        customer_id:
          type: string
      required:
        - customer_id
`
    : "";
  if (answers.provider === "http") {
    return `agents:\n  - name: ${answers.agentName}\n    provider: http\n    url: ${answers.baseUrl ?? "http://localhost:3000"}\n    label: ${answers.agentName}\n${supportTool}`;
  }
  if (answers.provider === "external_process") {
    const command = answers.harnessLanguage === "python" ? "python harness.py" : "node harness.js";
    return `agents:\n  - name: ${answers.agentName}\n    provider: external_process\n    command: ${command}\n    label: ${answers.agentName}\n${supportTool}`;
  }
  if (answers.provider === "openai") {
    return `agents:\n  - name: ${answers.agentName}\n    provider: openai\n    model: gpt-4o-mini\n    label: ${answers.agentName}\n${supportTool}`;
  }
  return `agents:\n  - name: ${answers.agentName}\n    provider: mock\n    label: ${answers.agentName}\n${supportTool}`;
}

function appendGitignore(targetDir: string): void {
  const path = join(targetDir, ".gitignore");
  const existingContent = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existingContent.split("\n").some((line) => line.trim() === "artifacts/")) return;
  const header = existingContent ? "" : "# Agent Regression Lab\n";
  appendFileSync(path, `${header}artifacts/\n`, "utf8");
}

function writeFixtureStubs(targetDir: string, domain: InitAnswers["domain"]): void {
  if (domain === "support") {
    mkdirSync(join(targetDir, "fixtures", "support"), { recursive: true });
    mkdirSync(join(targetDir, "user_tools"), { recursive: true });
    writeFileSync(join(targetDir, "fixtures", "support", "customers.json"), `[{"id":"cus_100","email":"alice@example.com","name":"Alice Example"},{"id":"cus_101","email":"bob@example.com","name":"Bob Example"}]\n`);
    writeFileSync(join(targetDir, "fixtures", "support", "orders.json"), `[{"id":"ord_1023","customer_id":"cus_100","amount":49,"currency":"USD","status":"paid","duplicate_group":"dup_1"},{"id":"ord_1024","customer_id":"cus_100","amount":49,"currency":"USD","status":"paid","duplicate_group":"dup_1"},{"id":"ord_2000","customer_id":"cus_101","amount":80,"currency":"USD","status":"paid","duplicate_group":"dup_2"},{"id":"ord_2001","customer_id":"cus_101","amount":80,"currency":"USD","status":"paid","duplicate_group":"dup_2"}]\n`);
    writeFileSync(join(targetDir, "fixtures", "support", "accounts.json"), `[{"customer_id":"cus_100","newsletter_subscribed":true,"tier":"pro"}]\n`);
    writeFileSync(join(targetDir, "fixtures", "support", "subscriptions.json"), `[{"customer_id":"cus_100","subscription_id":"sub_900","plan":"pro-monthly","status":"active"}]\n`);
    writeFileSync(join(targetDir, "user_tools", "findDuplicateCharge.ts"), `import { readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n\nexport async function findDuplicateCharge(input: unknown): Promise<{ order_id: string }> {\n  const customerId = String((input as Record<string, unknown>).customer_id ?? "");\n  const orders = JSON.parse(readFileSync(resolve("fixtures/support/orders.json"), "utf8")) as Array<{id: string; customer_id: string; duplicate_group?: string}>;\n  const duplicate = orders.find((order) => order.customer_id === customerId && order.duplicate_group === "dup_1" && order.id === "ord_1024");\n  if (!duplicate) throw new Error(\`No duplicate charge found for customer '\${customerId}'.\`);\n  return { order_id: duplicate.id };\n}\n`);
    return;
  }
  if (domain === "coding") {
    mkdirSync(join(targetDir, "fixtures", "coding"), { recursive: true });
    writeFileSync(join(targetDir, "fixtures", "coding", "repo-files.json"), `[{"path":"src/greeting.ts","content":"export const greeting = 'Hi';"},{"path":"tests/greeting.test.ts","content":"test.todo('greeting')"},{"path":"src/math.ts","content":"return a - b"},{"path":"README.md","content":"Setup"}]\n`);
    return;
  }
  if (domain === "ops") {
    mkdirSync(join(targetDir, "fixtures", "ops"), { recursive: true });
    writeFileSync(join(targetDir, "fixtures", "ops", "alerts.json"), `[{"id":"alert_1","service":"payments-api","severity":"high","summary":"5xx spike"},{"id":"alert_2","service":"search-api","severity":"medium","summary":"latency"}]\n`);
    writeFileSync(join(targetDir, "fixtures", "ops", "logs.json"), `[{"service":"payments-api","lines":["5xx spike"]},{"service":"search-api","lines":["latency"]}]\n`);
    writeFileSync(join(targetDir, "fixtures", "ops", "status.json"), `[{"service":"payments-api","status":"degraded","owner":"payments-oncall"},{"service":"search-api","status":"degraded","owner":"search-oncall"}]\n`);
    return;
  }
  mkdirSync(join(targetDir, "fixtures", "research"), { recursive: true });
  writeFileSync(join(targetDir, "fixtures", "research", "documents.json"), `[{"id":"doc_remote","title":"Remote work policy","content":"Remote work is allowed with manager approval."},{"id":"doc_expense","title":"Expense policy","content":"Expenses require receipts."},{"id":"doc_general","title":"General policy","content":"Check the relevant policy before acting."}]\n`);
}

function writeHarness(targetDir: string, answers: InitAnswers): void {
  if (answers.harnessLanguage === "python") {
    writeFileSync(join(targetDir, "harness.py"), `import sys, json\n\ntask = json.loads(sys.argv[1])\ninput_text = task.get("task", {}).get("instructions") or task.get("input", "")\nresponse = f"Echo: {input_text}"\nprint(response, end="")\n`);
    console.log(`  ${style.green("✓")} Harness scaffolded at ${style.cyan("harness.py")}`);
    return;
  }
  writeFileSync(join(targetDir, "harness.js"), `const task = JSON.parse(process.argv[2]);\nconst input = task.task?.instructions ?? task.input ?? "";\nconst response = \`Echo: ${"${input}"}\`;\nprocess.stdout.write(response);\n`);
  console.log(`  ${style.green("✓")} Harness scaffolded at ${style.cyan("harness.js")}`);
}
