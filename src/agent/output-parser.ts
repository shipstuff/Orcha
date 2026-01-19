export interface ParsedOutput {
  type: 'question' | 'progress' | 'completion' | 'error' | 'unknown';
  content: string;
  sessionId?: string;
  prUrl?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

// Pattern to detect Claude Code asking a question
const questionPatterns = [
  /^(?:question|asking|need to ask|asking you):/i,
  /\?$/,
  /(?:would you like|should I|do you want|can you confirm|please clarify)/i,
];

// Pattern to detect PR creation
const prPattern = /(?:created|opened|submitted).*pull request.*?(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/i;
const prUrlPattern = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/;

// Pattern to detect completion
const completionPatterns = [
  /(?:task|work|implementation) (?:is )?(?:complete|done|finished)/i,
  /(?:successfully|completed) (?:created|implemented|fixed)/i,
  /pull request (?:created|submitted|opened)/i,
];

// Pattern to detect errors
const errorPatterns = [
  /error:/i,
  /failed to/i,
  /could not/i,
  /exception/i,
];

// Pattern to extract session ID from Claude Code output
const sessionIdPattern = /session[_\s]?id[:\s]+([a-f0-9-]+)/i;

// Pattern to extract token usage from Claude Code output
const tokenPattern = /(?:tokens?|usage)[:\s]*(?:input[:\s]*)?(\d+).*?(?:output[:\s]*)?(\d+)/i;

export function parseAgentOutput(output: string): ParsedOutput {
  const lines = output.trim().split('\n');
  const lastLines = lines.slice(-20).join('\n'); // Focus on recent output

  // Extract session ID if present
  const sessionMatch = output.match(sessionIdPattern);
  const sessionId = sessionMatch?.[1];

  // Extract token usage if present
  const tokenMatch = output.match(tokenPattern);
  const tokenUsage = tokenMatch ? {
    input: parseInt(tokenMatch[1] ?? '0', 10),
    output: parseInt(tokenMatch[2] ?? '0', 10),
  } : undefined;

  // Check for PR URL
  const prUrlMatch = lastLines.match(prUrlPattern);
  const prUrl = prUrlMatch?.[0];

  // Check for errors
  for (const pattern of errorPatterns) {
    if (pattern.test(lastLines)) {
      return {
        type: 'error',
        content: extractRelevantContent(lastLines, pattern),
        sessionId,
        tokenUsage,
      };
    }
  }

  // Check for completion
  for (const pattern of completionPatterns) {
    if (pattern.test(lastLines)) {
      return {
        type: 'completion',
        content: lastLines,
        sessionId,
        prUrl,
        tokenUsage,
      };
    }
  }

  // Check for questions
  for (const pattern of questionPatterns) {
    if (pattern.test(lastLines)) {
      return {
        type: 'question',
        content: extractQuestion(lastLines),
        sessionId,
        tokenUsage,
      };
    }
  }

  return {
    type: 'progress',
    content: lastLines,
    sessionId,
    tokenUsage,
  };
}

function extractRelevantContent(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (match) {
    // Get some context around the match
    const index = text.indexOf(match[0]);
    const start = Math.max(0, index - 100);
    const end = Math.min(text.length, index + match[0].length + 200);
    return text.slice(start, end).trim();
  }
  return text.slice(-500);
}

function extractQuestion(text: string): string {
  const lines = text.split('\n');

  // Look for lines ending with ?
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line && line.trim().endsWith('?')) {
      // Include some context before the question
      const start = Math.max(0, i - 3);
      return lines.slice(start, i + 1).join('\n').trim();
    }
  }

  // Return the last few lines as the question
  return lines.slice(-5).join('\n').trim();
}

export function isWaitingForInput(output: string): boolean {
  const parsed = parseAgentOutput(output);
  return parsed.type === 'question';
}

export function isCompleted(output: string): boolean {
  const parsed = parseAgentOutput(output);
  return parsed.type === 'completion';
}

export function hasError(output: string): boolean {
  const parsed = parseAgentOutput(output);
  return parsed.type === 'error';
}
