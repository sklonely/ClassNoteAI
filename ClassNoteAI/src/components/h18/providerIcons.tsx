/**
 * Provider brand icons for PCloud cards.
 *
 * Inline SVG approximations of each provider's mark.
 * Sized 28×28 by default (size prop overrides).
 */

import type { CSSProperties } from 'react';

interface IconProps {
    size?: number;
    style?: CSSProperties;
}

export function OpenAIIcon({ size = 28, style }: IconProps) {
    // OpenAI hexafoil — 6-petal rosette (simplified)
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
            <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.774-2.757a.78.78 0 0 0 .392-.681v-6.737l2.018 1.168a.071.071 0 0 1 .039.057v5.583a4.504 4.504 0 0 1-4.489 4.488zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.778 2.756a.777.777 0 0 0 .78 0l5.842-3.369v2.33a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.018 1.168a.075.075 0 0 1-.071 0L4 13.954a4.504 4.504 0 0 1-1.66-6.057zm16.59 3.86l-5.85-3.387L15.075 7.2a.07.07 0 0 1 .07 0l4.83 2.79a4.495 4.495 0 0 1-.676 8.105v-5.678a.766.766 0 0 0-.39-.66zm2.01-3.023l-.142-.085-4.77-2.776a.776.776 0 0 0-.785 0L9.4 9.241V6.911a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.062V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.78.78 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3l-2.605 1.5-2.604-1.5Z" />
        </svg>
    );
}

export function AnthropicIcon({ size = 28, style }: IconProps) {
    // Anthropic — three vertical strokes / 'A' wordmark abstracted
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
            <path d="M13.827 3.52h3.603L24 20.477h-3.603l-6.57-16.957zm-7.258 0h3.767L17.06 20.477H3.5l4.069-16.957zM5.36 18.07h6.717l-3.358-8.94L5.36 18.07Z" />
        </svg>
    );
}

export function GeminiIcon({ size = 28, style }: IconProps) {
    // Gemini — 4-pointed sparkle/star
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
            <path d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12" />
        </svg>
    );
}

export function GitHubIcon({ size = 28, style }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    );
}

export function AzureIcon({ size = 28, style }: IconProps) {
    // Azure — triangular cyan logo (simplified)
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
            <path d="M5.483 21.3H24L13.847 3.7l-3.165 8.522 5.945 7.05L5.483 21.3zM10.3 4.45L0 19.65l4.667-.4L13.4 4.5z" />
        </svg>
    );
}

/** Generic fallback for unknown provider. */
export function GenericProviderIcon({ size = 28, style }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={style}>
            <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z" />
        </svg>
    );
}
