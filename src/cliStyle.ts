import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";

export function colorEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
  return Boolean((stream.isTTY || process.env.FORCE_COLOR) && !process.env.NO_COLOR);
}

// Gradient text: interpolates between two hex colors across the string
export function gradient(text: string, fromHex: string, toHex: string): string {
  if (!colorEnabled()) return text;
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  if (!from || !to) return text;
  return text
    .split("")
    .map((char, i) => {
      const t = text.length <= 1 ? 1 : i / (text.length - 1);
      const r = Math.round(from.r + (to.r - from.r) * t);
      const g = Math.round(from.g + (to.g - from.g) * t);
      const b = Math.round(from.b + (to.b - from.b) * t);
      return chalk.rgb(r, g, b)(char);
    })
    .join("");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

export const style = {
  green: (text: string) => colorEnabled() ? chalk.hex("#22c55e")(text) : text,
  red: (text: string) => colorEnabled() ? chalk.hex("#ef4444")(text) : text,
  yellow: (text: string) => colorEnabled() ? chalk.hex("#f59e0b")(text) : text,
  cyan: (text: string) => colorEnabled() ? chalk.hex("#06b6d4")(text) : text,
  blue: (text: string) => colorEnabled() ? chalk.hex("#6366f1")(text) : text,
  purple: (text: string) => colorEnabled() ? chalk.hex("#a855f7")(text) : text,
  bold: (text: string) => colorEnabled() ? chalk.bold(text) : text,
  dim: (text: string) => colorEnabled() ? chalk.dim(text) : text,
  muted: (text: string) => colorEnabled() ? chalk.hex("#6b7280")(text) : text,
};

// Badge-style labels with background color — reads like UI chips
export const badge = {
  pass: () => colorEnabled() ? chalk.bgHex("#166534").hex("#bbf7d0").bold(" ✓ PASS ") : "PASS",
  fail: () => colorEnabled() ? chalk.bgHex("#7f1d1d").hex("#fecaca").bold(" ✗ FAIL ") : "FAIL",
  error: () => colorEnabled() ? chalk.bgHex("#78350f").hex("#fef3c7").bold(" ! ERROR ") : "ERROR",
  approved: () => colorEnabled() ? chalk.bgHex("#1e3a5f").hex("#bfdbfe").bold(" ✓ APPROVED ") : "APPROVED",
  regression: () => colorEnabled() ? chalk.bgHex("#7f1d1d").hex("#fecaca").bold(" ↓ REGRESSION ") : "REGRESSION",
  improved: () => colorEnabled() ? chalk.bgHex("#14532d").hex("#bbf7d0").bold(" ↑ IMPROVED ") : "IMPROVED",
  new: () => colorEnabled() ? chalk.bgHex("#312e81").hex("#e0e7ff").bold(" NEW ") : "NEW",
  demo: () => colorEnabled() ? chalk.bgHex("#4c1d95").hex("#ede9fe").bold(" DEMO ") : "DEMO",
};

export function boxed(message: string, color: "green" | "red" | "yellow" | "blue" | "purple" = "blue"): string {
  const colorMap = {
    green: "#22c55e",
    red: "#ef4444",
    yellow: "#f59e0b",
    blue: "#6366f1",
    purple: "#a855f7",
  };
  const hex = colorMap[color];
  const coloredMessage = colorEnabled() ? chalk.hex(hex)(message) : message;
  return boxen(coloredMessage, {
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    width: Math.max(44, longestLine(message) + 8),
    borderStyle: "round",
    borderColor: colorEnabled() ? hex : undefined,
  });
}

export function boxedError(message: string): string {
  const body = colorEnabled(process.stderr) ? chalk.hex("#ef4444")(message) : message;
  return boxen(body, {
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    width: Math.max(44, longestLine(message) + 8),
    borderStyle: "round",
    borderColor: colorEnabled(process.stderr) ? "#ef4444" : undefined,
    title: colorEnabled(process.stderr) ? chalk.hex("#ef4444").bold(" Error ") : "Error",
    titleAlignment: "left",
  });
}

// Hero banner for init — big, welcoming, website-feel
export function heroBanner(): string {
  if (!colorEnabled()) {
    return `
  Agent Regression Lab
  Catch AI regressions before they ship.
`;
  }
  const title = gradient("  Agent Regression Lab", "#6366f1", "#a855f7");
  const tagline = chalk.hex("#6b7280")("  Catch AI regressions before they ship.");
  const top = chalk.hex("#312e81")("  ╭" + "─".repeat(46) + "╮");
  const bot = chalk.hex("#312e81")("  ╰" + "─".repeat(46) + "╯");
  const visibleLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const padTo = (text: string, w: number) => text + " ".repeat(Math.max(0, w - visibleLen(text)));
  const mid = (text: string) => chalk.hex("#312e81")("  │") + padTo(text, 46) + chalk.hex("#312e81")("│");
  return [
    "",
    top,
    mid(""),
    mid(`  ${title}`),
    mid(`  ${tagline}`),
    mid(""),
    bot,
    "",
  ].join("\n");
}

// Divider with optional label
export function divider(label?: string): string {
  if (!colorEnabled()) return label ? `--- ${label} ---` : "─".repeat(50);
  if (label) {
    const pad = "─".repeat(3);
    return chalk.hex("#374151")(`${pad} `) + chalk.hex("#9ca3af").bold(label) + chalk.hex("#374151")(` ${pad}`);
  }
  return chalk.hex("#374151")("─".repeat(50));
}

// Section header — like a website's section title
export function sectionHeader(title: string): string {
  if (!colorEnabled()) return `\n  ${title}\n`;
  return `\n  ${chalk.hex("#6366f1").bold(title)}\n`;
}

// Score bar — visual meter for run scores
export function scoreBar(score: number, width = 20): string {
  if (!colorEnabled()) return `${score}/100`;
  const filled = Math.min(width, Math.max(0, Math.round((score / 100) * width)));
  const empty = width - filled;
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const bar = chalk.hex(color)("█".repeat(filled)) + chalk.hex("#374151")("░".repeat(empty));
  return `${bar} ${chalk.hex(color).bold(`${score}`)}${chalk.hex("#6b7280")("/100")}`;
}

function longestLine(message: string): number {
  return Math.max(...message.split("\n").map((line) => line.length));
}

export async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  if (!colorEnabled()) {
    return await fn();
  }

  const spinnerText = colorEnabled() ? chalk.hex("#6366f1")(message) : message;
  const spinner = ora({
    text: spinnerText,
    color: "magenta",
    spinner: "dots2",
  }).start();
  try {
    const result = await fn();
    spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}


