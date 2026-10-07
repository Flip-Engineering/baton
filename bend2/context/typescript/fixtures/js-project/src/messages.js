/**
 * @typedef {{ name: string, count: number }} Item
 */

/**
 * @param {Item} item
 * @param {string} prefix
 * @returns {string}
 */
function label(item, prefix) {
  return `${prefix}: ${item.name}`;
}

/**
 * @param {Item} item
 * @returns {string}
 */
function describe(item) {
  return `${item.name} x${item.count}`;
}

export { label, describe };
