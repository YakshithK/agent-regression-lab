# Memory And Stateful Agents

Memoryful agents are a distinct category in ARL.

Use `type: conversation` scenarios when the agent owns:

- conversation history
- internal memory
- internal tool execution
- session or conversation identifiers

## What ARL Owns

For conversation scenarios, ARL owns:

- the ordered user steps
- the generated `conversation_id`
- per-step and end-of-run evaluation
- trace capture
- run storage and comparison

## What The Agent Owns

For conversation scenarios, the agent owns:

- how it stores conversation state
- how it interprets `conversation_id`
- what internal tools it calls
- how it handles memory and recall across turns

## How To Test Memoryful Agents

Good memory-focused scenarios should cover:

- follow-up recall within one conversation
- refusal to leak identity or state across sessions
- correct handling of repeated turns
- graceful behavior when earlier turns are ambiguous or incomplete

## Recommended Stateful Regression Cases

- follow-up recall after two or more turns
- cross-session contamination
- stale memory overriding fresh input
- memory surviving the right turns but not the wrong sessions

## Design Rule

Use task scenarios when the runner should stay authoritative for tools and turn control.

Use conversation scenarios when the agent itself is being tested for memory, session behavior, or internal orchestration.
