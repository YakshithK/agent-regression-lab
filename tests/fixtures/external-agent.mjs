import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const event = JSON.parse(line);

  if (event.type === "run_started") {
    console.log(JSON.stringify({ type: "tool_call", toolName: "support.test_tool", input: { foo: "bar" } }));
    return;
  }

  if (event.type === "tool_result") {
    console.log(JSON.stringify({ type: "final", output: `Done after ${JSON.stringify(event.result)}` }));
    return;
  }

  console.log(JSON.stringify({ type: "error", message: "unexpected event" }));
});
