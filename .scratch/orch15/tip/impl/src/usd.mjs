export const USD_NANO_SCALE = 1_000_000_000;

export function usdToNanos(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu);
  if (!match) return null;
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = BigInt(`${match[1]}${fraction}`);
  const shift = exponent - fraction.length + 9;
  let nanos;
  if (shift >= 0) nanos = digits * (10n ** BigInt(shift));
  else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) return null;
    nanos = digits / divisor;
  }
  return nanos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(nanos) : null;
}

export function usdFromNanos(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const usd = value / USD_NANO_SCALE;
  return usdToNanos(usd) === value ? usd : null;
}

export function addUsd(left, right) {
  const leftNanos = usdToNanos(left);
  const rightNanos = usdToNanos(right);
  if (leftNanos === null || rightNanos === null || !Number.isSafeInteger(leftNanos + rightNanos)) return null;
  return usdFromNanos(leftNanos + rightNanos);
}

export function subtractUsdFloor(left, right) {
  const leftNanos = usdToNanos(left);
  const rightNanos = usdToNanos(right);
  return leftNanos === null || rightNanos === null ? null : usdFromNanos(Math.max(0, leftNanos - rightNanos));
}
