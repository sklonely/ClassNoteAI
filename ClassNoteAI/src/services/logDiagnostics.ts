interface RedactRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

const REDACT_RULES: RedactRule[] = [
  {
    label: 'openaiKey',
    pattern: /\bsk-[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED_OPENAI_KEY]',
  },
  {
    label: 'githubPat',
    pattern: /\bghp_[A-Za-z0-9]+\b/g,
    replacement: '[REDACTED_GITHUB_PAT]',
  },
  {
    label: 'githubOAuth',
    pattern: /\bgho_[A-Za-z0-9]+\b/g,
    replacement: '[REDACTED_GITHUB_OAUTH]',
  },
  {
    label: 'googleApiKey',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: '[REDACTED_GOOGLE_API_KEY]',
  },
  {
    label: 'bearerToken',
    pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
    replacement: 'Bearer [REDACTED_BEARER_TOKEN]',
  },
  {
    label: 'windowsUserPath',
    pattern: /C:\\Users\\[^\\/\s]+/g,
    replacement: 'C:\\Users\\[REDACTED_USER]',
  },
  {
    label: 'macosUserPath',
    pattern: /\/Users\/[^/\s]+/g,
    replacement: '/Users/[REDACTED_USER]',
  },
  {
    label: 'linuxUserPath',
    pattern: /\/home\/[^/\s]+/g,
    replacement: '/home/[REDACTED_USER]',
  },
];

export function redactLogContent(raw: string): {
  redacted: string;
  hits: Record<string, number>;
} {
  const hits: Record<string, number> = {};
  let redacted = raw;

  for (const rule of REDACT_RULES) {
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    const matches = redacted.match(pattern);
    if (!matches || matches.length === 0) continue;

    hits[rule.label] = (hits[rule.label] ?? 0) + matches.length;
    redacted = redacted.replace(pattern, rule.replacement);
  }

  return { redacted, hits };
}

export function buildGithubIssueUrl(logSnippet: string, appVersion: string): string {
  const params = new URLSearchParams({
    title: '[Bug] ',
    body: [
      '## Environment',
      `- App version: ${appVersion}`,
      `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
      '',
      '## Steps to Reproduce',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Expected Behavior',
      '- ',
      '',
      '## Actual Behavior',
      '- ',
      '',
      '## Redacted Diagnostics Log',
      '```text',
      logSnippet || '(empty)',
      '```',
    ].join('\n'),
  });

  return `https://github.com/sklonely/ClassNoteAI/issues/new?${params.toString()}`;
}
