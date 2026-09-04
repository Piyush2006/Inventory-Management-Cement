/**
 * Literal {var} substitution — only for keys actually present in `variables`. An unmatched
 * {token} is left as-is rather than blanked, so a misconfigured rule fails visibly (spec:
 * "do not show empty or fabricated values").
 */
export function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in variables ? variables[key] : match));
}
