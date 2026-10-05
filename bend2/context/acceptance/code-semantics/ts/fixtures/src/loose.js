/**
 * Untyped JavaScript boundary fixture. With allowJs off, this file is not part
 * of the program and TS7016 is reported at its import site in js-edge.ts.
 */
module.exports.helper = function helper(input) {
  return input * 2;
};
