// utils/parser.js

/**
 * Parses a text string containing a numbered list (e.g., "1. ... \n2. ...").
 * Returns an array of item strings, or null if the pattern is not matched.
 * 
 * @param {string} text The raw text content.
 * @returns {string[]|null}
 */
function parseNumberedList(text) {
  if (!text) return null;

  // Detect if the text contains a numbered list pattern starting with "1." or "1)" at the start of a line
  const hasNumberedPattern = /(?:\r?\n|^)\s*1[\.\)]\s+/.test(text);
  if (!hasNumberedPattern) {
    return null;
  }

  // Split by any number pattern "number. " or "number) " at start of lines or start of string
  const parts = text.split(/(?:\r?\n|^)\s*\d+[\.\)]\s+/);

  // The first element is the text before the first "1.", which is empty if the string starts with "1.".
  // We slice it out because any text before "1." is not part of the numbered items.
  return parts.slice(1).map(item => item.trim()).filter(Boolean);
}

module.exports = {
  parseNumberedList,
};
