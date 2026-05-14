import assert from "node:assert";
import test, { describe } from "node:test";

// All tests run in non-TTY mode (CI / test process), so colorEnabled() is false.
// We test the plain-text fallback paths exhaustively and confirm no ANSI leaks.

// Force non-TTY for all tests in this module.
const originalIsTTY = process.stdout.isTTY;
const originalStderrIsTTY = process.stderr.isTTY;
const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

// Patch before importing so the module sees NO_COLOR set
process.env.NO_COLOR = "1";
const {
  badge,
  boxed,
  boxedError,
  colorEnabled,
  divider,
  gradient,
  heroBanner,
  scoreBar,
  sectionHeader,
  style,
  withSpinner,
} = await import("../src/cliStyle.js");

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// colorEnabled
// ---------------------------------------------------------------------------
describe("colorEnabled", () => {
  test("returns false when NO_COLOR is set", () => {
    assert.equal(colorEnabled(), false);
  });

  test("treats FORCE_COLOR=0 as disabled", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "0";
    try {
      assert.equal(colorEnabled({ isTTY: true } as NodeJS.WriteStream), false);
    } finally {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
    }
  });

  test("treats FORCE_COLOR=1 as enabled", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    try {
      assert.equal(colorEnabled({ isTTY: false } as NodeJS.WriteStream), true);
    } finally {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
    }
  });
});

// ---------------------------------------------------------------------------
// gradient
// ---------------------------------------------------------------------------
describe("gradient", () => {
  test("returns plain text when color disabled", () => {
    const result = gradient("hello", "#000000", "#ffffff");
    assert.equal(result, "hello");
  });

  test("returns empty string unchanged", () => {
    assert.equal(gradient("", "#000000", "#ffffff"), "");
  });
});

// ---------------------------------------------------------------------------
// style
// ---------------------------------------------------------------------------
describe("style", () => {
  for (const [name, fn] of Object.entries(style) as [string, (t: string) => string][]) {
    test(`${name}() returns plain text when color disabled`, () => {
      const result = fn("test text");
      assert.equal(stripAnsi(result), "test text");
    });
  }
});

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------
describe("badge", () => {
  for (const [name, fn] of Object.entries(badge) as [string, () => string][]) {
    test(`badge.${name}() returns a non-empty string when color disabled`, () => {
      const result = fn();
      assert.ok(result.length > 0, `badge.${name}() returned empty string`);
      // Should not leak ANSI in non-TTY (NO_COLOR=1)
      assert.doesNotMatch(stripAnsi(result) + result, /\x1b\[/, `badge.${name}() leaked ANSI`);
    });
  }
});

// ---------------------------------------------------------------------------
// boxed
// ---------------------------------------------------------------------------
describe("boxed", () => {
  test("returns a string containing the message", () => {
    const result = boxed("Hello world");
    assert.ok(result.includes("Hello world"));
  });

  test("accepts all valid colors without throwing", () => {
    for (const color of ["green", "red", "yellow", "blue", "purple"] as const) {
      assert.doesNotThrow(() => boxed("msg", color));
    }
  });
});

// ---------------------------------------------------------------------------
// boxedError
// ---------------------------------------------------------------------------
describe("boxedError", () => {
  test("returns a string containing the message", () => {
    const result = boxedError("Something went wrong");
    assert.ok(result.includes("Something went wrong"));
  });
});

// ---------------------------------------------------------------------------
// heroBanner
// ---------------------------------------------------------------------------
describe("heroBanner", () => {
  test("returns a string containing brand text", () => {
    const result = heroBanner();
    assert.ok(result.includes("Agent Regression Lab"));
  });

  test("plain-text branch does not contain ANSI codes", () => {
    const result = heroBanner();
    assert.doesNotMatch(result, /\x1b\[/);
  });
});

// ---------------------------------------------------------------------------
// divider
// ---------------------------------------------------------------------------
describe("divider", () => {
  test("returns a non-empty string without label", () => {
    const result = divider();
    assert.ok(result.length > 0);
  });

  test("includes label text when provided", () => {
    const result = divider("My Section");
    assert.ok(result.includes("My Section"));
  });
});

// ---------------------------------------------------------------------------
// sectionHeader
// ---------------------------------------------------------------------------
describe("sectionHeader", () => {
  test("includes the title", () => {
    const result = sectionHeader("Test Title");
    assert.ok(result.includes("Test Title"));
  });
});

// ---------------------------------------------------------------------------
// scoreBar
// ---------------------------------------------------------------------------
describe("scoreBar", () => {
  test("plain-text fallback returns score/100", () => {
    const result = scoreBar(75);
    assert.ok(result.includes("75"), `scoreBar(75) output was '${result}'`);
  });

  test("handles score 0", () => {
    assert.doesNotThrow(() => scoreBar(0));
  });

  test("handles score 100", () => {
    assert.doesNotThrow(() => scoreBar(100));
  });
});

// ---------------------------------------------------------------------------
// withSpinner
// ---------------------------------------------------------------------------
describe("withSpinner", () => {
  test("executes the callback and returns its result in non-TTY mode", async () => {
    const result = await withSpinner("Loading...", async () => 42);
    assert.equal(result, 42);
  });

  test("propagates errors from the callback", async () => {
    await assert.rejects(
      () => withSpinner("Loading...", async () => { throw new Error("cb error"); }),
      /cb error/,
    );
  });
});

// Restore env after tests
test("cleanup: restore env", () => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
  if (originalForceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = originalForceColor;
  }
  (process.stdout as { isTTY?: boolean }).isTTY = originalIsTTY;
  (process.stderr as { isTTY?: boolean }).isTTY = originalStderrIsTTY;
  assert.ok(true);
});
