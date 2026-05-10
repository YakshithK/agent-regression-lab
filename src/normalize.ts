const SUPPORTED_RULES = ["strip_whitespace", "lowercase", "ignore_dates"] as const;

export type NormalizeRule = (typeof SUPPORTED_RULES)[number];

const MONTH_PATTERN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
].join("|");

const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONTH_DAY_YEAR_PATTERN = new RegExp(`\\b(?:${MONTH_PATTERN})\\s+\\d{1,2},?\\s+\\d{4}\\b`, "gi");
const DAY_MONTH_YEAR_PATTERN = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{4}\\b`, "gi");
const MONTH_YEAR_PATTERN = new RegExp(`\\b(?:${MONTH_PATTERN})\\s+\\d{4}\\b`, "gi");

export function normalizeOutput(text: string, rules: string[] = []): string {
  let output = text;
  for (const rule of rules) {
    if (!isSupportedRule(rule)) {
      throw new Error(`Unknown normalize rule: ${rule}. Supported: ${SUPPORTED_RULES.join(", ")}`);
    }

    if (rule === "strip_whitespace") {
      output = output.trim().replace(/\s+/g, " ");
    } else if (rule === "lowercase") {
      output = output.toLowerCase();
    } else if (rule === "ignore_dates") {
      output = output
        .replace(ISO_DATE_PATTERN, "<DATE>")
        .replace(MONTH_DAY_YEAR_PATTERN, "<DATE>")
        .replace(DAY_MONTH_YEAR_PATTERN, "<DATE>")
        .replace(MONTH_YEAR_PATTERN, "<DATE>");
    }
  }
  return output;
}

function isSupportedRule(rule: string): rule is NormalizeRule {
  return (SUPPORTED_RULES as readonly string[]).includes(rule);
}
