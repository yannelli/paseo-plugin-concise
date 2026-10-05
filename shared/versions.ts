const numbers = (version: string) => version.replace(/^v/, "").split(".").map(Number);

export function compareVersions(a: string, b: string): number {
  const left = numbers(a), right = numbers(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
