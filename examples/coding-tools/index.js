export async function readRepoHint(input) {
  const path = String(input?.path ?? "");
  if (!path) {
    throw new Error("path is required");
  }

  return {
    path,
    hint: "Check the target file before editing.",
  };
}
