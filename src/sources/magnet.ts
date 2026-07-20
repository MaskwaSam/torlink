export function buildMagnet(infoHash: string, name: string): string {
  const dn = encodeURIComponent(name);
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}`;
}

const MAGNET_RE = /xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(b32: string): string | null {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const c of b32.toUpperCase()) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out += ((value >>> bits) & 0xff).toString(16).padStart(2, "0");
      value &= (1 << bits) - 1;
    }
  }
  return out.length === 40 ? out : null;
}

export function normalizeInfoHash(raw: string): string {
  return raw.length === 32 ? (base32ToHex(raw) ?? raw.toLowerCase()) : raw.toLowerCase();
}

const HEX_INFOHASH_RE = /^[a-f0-9]{40}$/;

export function parseInfoHash(input: string): string | null {
  if (!isInfoHash(input)) return null;
  const normalized = normalizeInfoHash(input.trim());
  return HEX_INFOHASH_RE.test(normalized) ? normalized : null;
}

export interface ParsedMagnet {
  infoHash: string;
  name: string;
  magnet: string;
}

export function parseMagnet(input: string): ParsedMagnet | null {
  const s = input.trim();
  if (!/^magnet:\?/i.test(s)) return null;
  const m = MAGNET_RE.exec(s);
  if (!m) return null;
  const infoHash = parseInfoHash(m[1]!);
  if (!infoHash) return null;
  let name = infoHash;
  try {
    const dn = new URL(s).searchParams.get("dn");
    if (dn) name = dn;
  } catch {}
  return { infoHash, name, magnet: s };
}

// Anchored to the whole input so an ordinary search query is never mistaken for a
// hash: only a string that is *nothing but* a 40-char hex or 32-char base32 info
// hash counts. Same character classes as MAGNET_RE's xt group.
const INFOHASH_RE = /^([a-f0-9]{40}|[a-z2-7]{32})$/i;

export function isInfoHash(input: string): boolean {
  return INFOHASH_RE.test(input.trim());
}

// Accepts either a magnet URI or a bare info hash. A bare hash is normalized and
// wrapped as a trackerless magnet. Transmission can still use trackers already
// present in full magnet links. Returns null for anything that is neither.
export function parseInput(input: string): ParsedMagnet | null {
  const s = input.trim();
  const magnet = parseMagnet(s);
  if (magnet) return magnet;
  const infoHash = parseInfoHash(s);
  if (!infoHash) return null;
  return { infoHash, name: infoHash, magnet: buildMagnet(infoHash, infoHash) };
}
