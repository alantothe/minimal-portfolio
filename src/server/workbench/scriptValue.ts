/**
 * Serialises a value embedded in an inline `<script>`.
 *
 * `JSON.stringify` does not escape `<`, so a value containing `</script>` could
 * close the element and turn everything after it into markup. The Unicode
 * escape preserves the JavaScript value while making that parse impossible.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
