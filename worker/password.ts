const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: 100_000,
    salt: new Uint8Array(salt).buffer,
  }, material, 256);
  return new Uint8Array(bits);
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: encode(await derive(password, salt)), salt: encode(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const actual = await derive(password, Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)));
  const expected = Uint8Array.from(atob(hash), (character) => character.charCodeAt(0));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index]! ^ expected[index]!;
  return difference === 0;
}
