/**
 * PKCE (Proof Key for Code Exchange) helpers — RFC 7636.
 *
 * Used by the ChatGPT OAuth provider. Both verifier and code challenge
 * are base64url-encoded byte sequences; the verifier is a random 32-byte
 * value, and the challenge is SHA-256(verifier).
 */

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Challenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return base64url(new Uint8Array(hash));
}

export function randomState(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
