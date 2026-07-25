export type NameMatchStatus = "exact" | "partial" | "none";

export type NameMatchResult = {
  status: NameMatchStatus;
  percent: number;
};

function tokens(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function isInitialMatch(left: string, right: string) {
  return (left.length === 1 && right.startsWith(left)) ||
    (right.length === 1 && left.startsWith(right));
}

export function matchNames(left: string, right: string): NameMatchResult {
  const registered = tokens(left);
  const verified = tokens(right);
  if (!registered.length || !verified.length) {
    return { status: "none", percent: 0 };
  }

  const exact = registered.length === verified.length &&
    registered.every((part, index) => part === verified[index]);
  if (exact) {
    return { status: "exact", percent: 100 };
  }

  const used = new Set<number>();
  let matchedWeight = 0;
  for (const part of registered) {
    let index = verified.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && candidate === part
    );
    if (index >= 0) {
      used.add(index);
      matchedWeight += 1;
      continue;
    }

    index = verified.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && isInitialMatch(part, candidate)
    );
    if (index >= 0) {
      used.add(index);
      matchedWeight += 0.5;
    }
  }

  if (matchedWeight === 0) {
    return { status: "none", percent: 0 };
  }

  return {
    status: "partial",
    percent: Math.round((matchedWeight / Math.max(registered.length, verified.length)) * 100)
  };
}
