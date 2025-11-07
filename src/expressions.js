/**
 * Safe expression engine for dimension calculations
 * Supports: variables (w, h, trimW, trimH), functions (max, min, floor, ceil), arithmetic
 * Compiles to ImageMagick fx: expressions or numeric values
 */

const ALLOWED_VARS = new Set(['w', 'h', 'trimW', 'trimH', 'padW', 'padH', 'targetW', 'targetH']);
const ALLOWED_FUNCS = new Set(['max', 'min', 'floor', 'ceil', 'round', 'abs']);

/**
 * Parse and validate expression
 * Returns { valid: boolean, error?: string, ast?: object }
 */
export function parseExpression(expr) {
  if (typeof expr !== 'string') {
    return { valid: false, error: 'Expression must be a string' };
  }

  // Simple tokenizer: numbers, vars, funcs, ops, parens
  const tokens = expr.match(/(\d+\.?\d*|\w+|[+\-*/()])/g) || [];
  
  for (const token of tokens) {
    // Number
    if (/^\d+\.?\d*$/.test(token)) continue;
    
    // Operator
    if (['+', '-', '*', '/', '(', ')'].includes(token)) continue;
    
    // Variable or function
    const isFunc = tokens[tokens.indexOf(token) + 1] === '(';
    if (isFunc) {
      if (!ALLOWED_FUNCS.has(token)) {
        return { valid: false, error: `Unknown function: ${token}` };
      }
    } else {
      if (!ALLOWED_VARS.has(token)) {
        return { valid: false, error: `Unknown variable: ${token}` };
      }
    }
  }

  // Basic paren balance check
  let depth = 0;
  for (const t of tokens) {
    if (t === '(') depth++;
    if (t === ')') depth--;
    if (depth < 0) return { valid: false, error: 'Unbalanced parentheses' };
  }
  if (depth !== 0) return { valid: false, error: 'Unbalanced parentheses' };

  return { valid: true, ast: tokens };
}

/**
 * Compile expression to ImageMagick fx: format
 * Example: "max(padW, padH*0.75)" → "max(padW,padH*0.75)"
 */
export function compileToFx(expr) {
  const parsed = parseExpression(expr);
  if (!parsed.valid) throw new Error(parsed.error);
  
  // Remove spaces for fx: compatibility
  return expr.replace(/\s+/g, '');
}

/**
 * Evaluate expression with known values (for simple cases)
 * Returns numeric result if all variables are known, otherwise returns fx: string
 */
export function evaluateExpression(expr, vars = {}) {
  const parsed = parseExpression(expr);
  if (!parsed.valid) throw new Error(parsed.error);

  // Check if all vars are present
  const exprVars = new Set();
  for (const token of parsed.ast) {
    if (ALLOWED_VARS.has(token)) exprVars.add(token);
  }

  for (const v of exprVars) {
    if (vars[v] === undefined) {
      // Cannot evaluate; return fx expression
      return { type: 'fx', value: compileToFx(expr) };
    }
  }

  // All vars known; attempt eval
  try {
    const code = expr.replace(/(\w+)/g, (m) => {
      if (ALLOWED_VARS.has(m)) return `vars.${m}`;
      if (ALLOWED_FUNCS.has(m)) return `Math.${m}`;
      return m;
    });
    
    // eslint-disable-next-line no-new-func
    const result = Function('vars', 'Math', `return ${code}`)(vars, Math);
    
    if (typeof result === 'number' && !isNaN(result)) {
      return { type: 'number', value: Math.round(result) };
    }
    
    throw new Error('Expression did not evaluate to a number');
  } catch (e) {
    throw new Error(`Expression evaluation failed: ${e.message}`);
  }
}

/**
 * Substitute template variables in strings
 * Example: "${runId}/final/${base}.jpg" + {runId: '123', base: 'chair'} → "123/final/chair.jpg"
 */
export function substituteVars(template, vars) {
  if (typeof template !== 'string') return template;
  
  return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (vars[varName] !== undefined) return String(vars[varName]);
    return match; // Leave unresolved
  });
}

