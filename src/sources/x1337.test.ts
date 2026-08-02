import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchResilient } from "../util/net";
import { parseUploadDate, rotateHosts, x1337Movies } from "./x1337";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const detail = (span: string) =>
  `<ul class="list"><li><strong>Date uploaded</strong><span>${span}</span> </li></ul>`;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("parseUploadDate", () => {
  it("parses the 'Mon. Dayth \\'YY' format to a UTC unix timestamp", () => {
    const ts = parseUploadDate(detail("Jun. 26th  '26"));
    expect(ts).toBe(Math.floor(Date.UTC(2026, 5, 26) / 1000));
  });

  it("handles single-digit days and other ordinals", () => {
    expect(parseUploadDate(detail("Jan. 1st '24"))).toBe(Math.floor(Date.UTC(2024, 0, 1) / 1000));
    expect(parseUploadDate(detail("Mar. 3rd '25"))).toBe(Math.floor(Date.UTC(2025, 2, 3) / 1000));
    expect(parseUploadDate(detail("Dec. 22nd '23"))).toBe(Math.floor(Date.UTC(2023, 11, 22) / 1000));
  });

  it("returns undefined when the field is missing or unparseable", () => {
    expect(parseUploadDate("<div>no date here</div>")).toBeUndefined();
    expect(parseUploadDate(detail("sometime"))).toBeUndefined();
  });
});

describe("rotateHosts", () => {
  const hosts = ["primary", "backup-a", "backup-b", "backup-c"];

  it("starts with the last working host without dropping fallbacks", () => {
    expect(rotateHosts(hosts, 2)).toEqual(["backup-b", "backup-c", "primary", "backup-a"]);
  });

  it("normalizes wrapped indexes and preserves the original list", () => {
    expect(rotateHosts(hosts, 5)).toEqual(["backup-a", "backup-b", "backup-c", "primary"]);
    expect(hosts).toEqual(["primary", "backup-a", "backup-b", "backup-c"]);
  });
});

describe("1337x host reuse", () => {
  const listPage = (count: number): string =>
    `<div class="table-list"><table>${Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return `<tr><td><a href="/torrent/${id}/item-${id}">Item ${id}</a></td>` +
        `<td class="coll-2 seeds">${20 - id}</td>` +
        `<td class="coll-3 leeches">${id}</td>` +
        `<td class="coll-4 size">${id} GB</td></tr>`;
    }).join("")}</table></div>`;

  const ok = (html: string): Response => new Response(html, { status: 200 });

  it("reuses a successful fallback without reducing local retries or the 8-detail cap", async () => {
    mockFetch.mockImplementation(async (raw, options) => {
      const url = String(raw);
      if (url.includes("1337x.to/popular-movies")) throw new Error("primary unavailable");
      if (url.includes("1337x.st/popular-movies")) return ok(listPage(10));
      const id = Number(url.match(/\/torrent\/(\d+)\//)?.[1] ?? 0);
      const hash = String(id).padStart(40, "a");
      return ok(`<a href="magnet:?xt=urn:btih:${hash}&dn=item-${id}">magnet</a>`);
    });

    const results = await x1337Movies.search("");
    expect(results).toHaveLength(8);

    const listCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes("/popular-movies"),
    );
    expect(listCalls.map(([url]) => String(url))).toEqual([
      "https://1337x.to/popular-movies",
      "https://1337x.st/popular-movies",
    ]);
    expect(listCalls.every(([, options]) => options?.retries === 2)).toBe(true);

    const detailCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes("/torrent/"),
    );
    expect(detailCalls).toHaveLength(8);
    expect(detailCalls.every(([, options]) => options?.retries === 1)).toBe(true);

    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok(listPage(0)));
    await x1337Movies.search("");
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe("https://1337x.st/popular-movies");
  });
});
