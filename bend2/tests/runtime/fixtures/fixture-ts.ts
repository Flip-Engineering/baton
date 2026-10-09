interface Reading { id: string; value: number }

export function scale(r: Reading, by: number): number {
  const adjusted = r.value * by
  return adjusted
}
