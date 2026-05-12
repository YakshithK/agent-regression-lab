import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boxed, sectionHeader, style } from "./cliStyle.js";

const DOMAINS = ["support", "coding", "research", "ops", "general"] as const;
type Domain = (typeof DOMAINS)[number];

export type GenerateOptions = {
  agentName?: string;
  provider?: string;
  domain?: string;
  count?: number;
  cwd?: string;
};

export function parseGenerateArgs(args: string[]): GenerateOptions {
  const options: GenerateOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--agent") {
      const val = args[++index];
      if (!val) throw new Error("--agent requires a value.");
      options.agentName = val;
      continue;
    }
    if (arg === "--provider") {
      const val = args[++index];
      if (!val) throw new Error("--provider requires a value.");
      options.provider = val;
      continue;
    }
    if (arg === "--domain") {
      const val = args[++index];
      if (!val) throw new Error("--domain requires a value.");
      options.domain = val;
      continue;
    }
    if (arg === "--count") {
      const val = args[++index];
      if (!val) throw new Error("--count requires a value.");
      options.count = Number(val);
      continue;
    }
    throw new Error(`Unexpected argument '${arg}'.`);
  }
  return options;
}

export async function handleGenerate(args: string[]): Promise<string[]> {
  return generateScenarios(parseGenerateArgs(args));
}

export function generateScenarios(options: GenerateOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const domain = normalizeDomain(options.domain ?? "support");
  const count = options.count ?? 5;
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("--count must be a positive integer.");
  }

  const templates = listTemplates(domain);
  const selected = templates.slice(0, Math.min(count, templates.length));
  const targetDir = join(cwd, "scenarios", domain);
  mkdirSync(targetDir, { recursive: true });

  const values = {
    agent_name: options.agentName ?? "mock-default",
    provider: options.provider ?? "mock",
    domain,
  };
  const written: string[] = [];
  let todoCount = 0;

  for (const templatePath of selected) {
    const rendered = substitute(readFileSync(templatePath, "utf8"), values);
    todoCount += countTodos(rendered);
    const name = parse(templatePath).name.replace(/\.yaml$/, "");
    const targetPath = join(targetDir, `generated-${name}.yaml`);
    try {
      writeFileSync(targetPath, rendered, { encoding: "utf8", flag: "wx" });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Scenario already exists at ${targetPath}.\n\nRun: agentlab generate --domain ${domain} --count ${count} in a clean directory, or delete the existing file first.`);
      }
      throw err;
    }
    written.push(targetPath);
  }

  console.log();
  console.log(sectionHeader(`Generated ${written.length} scenario${written.length !== 1 ? "s" : ""}`));
  for (const path of written) {
    console.log(`    ${style.green("✓")} ${style.dim(path)}`);
  }
  if (todoCount > 0) {
    console.log();
    console.log(boxed(
      `${style.yellow("!")} ${todoCount} TODO marker${todoCount !== 1 ? "s" : ""} remain — fill in evaluator expectations\n  before running against your real agent.`,
      "yellow",
    ));
  }
  console.log(`  ${style.muted("Next:")} ${style.cyan(`agentlab run ${domain}.generated-happy-path --agent ${options.agentName ?? "mock-default"}`)}`);
  console.log();
  return written;
}

function listTemplates(domain: Domain): string[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "templates", domain);
  if (!existsSync(root)) {
    throw new Error(`No templates found for domain '${domain}'.\n\nRun: agentlab generate --domain support`);
  }
  return readdirSync(root)
    .filter((name) => name.endsWith(".yaml.tmpl"))
    .sort()
    .map((name) => join(root, name));
}

function normalizeDomain(value: string): Domain {
  const normalized = value === "customer-support" ? "support" : value;
  if (!DOMAINS.includes(normalized as Domain)) {
    throw new Error(`Unknown domain '${value}'. Supported domains: ${DOMAINS.join(", ")}.\n\nRun: agentlab generate --domain support`);
  }
  return normalized as Domain;
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Unknown template variable '{{${key}}}' in scenario template.`);
    return values[key];
  });
}

function countTodos(text: string): number {
  return (text.match(/TODO/g) ?? []).length;
}
