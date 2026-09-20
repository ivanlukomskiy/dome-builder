import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createTranslator } from "./i18n";
import { ru } from "./translations/ru";

describe("createTranslator", () => {
  const en = createTranslator("en", () => {});
  const tr = createTranslator("ru", () => {});

  it("returns the English text itself for English, filling in {placeholders}", () => {
    expect(en.t("Apply")).toBe("Apply");
    expect(en.t("{value} (default)", { value: 5 })).toBe("5 (default)");
  });

  it("translates for Russian and falls back to the English text when there is no entry", () => {
    expect(tr.t("Apply")).toBe("Применить");
    expect(tr.t("{value} mm", { value: 12 })).toBe("12 мм");
    expect(tr.t("Some text nobody translated {x}", { x: 1 })).toBe("Some text nobody translated 1");
  });

  it("picks English singular/plural by count", () => {
    expect(en.tn(1, "{n} edge selected", "{n} edges selected")).toBe("1 edge selected");
    expect(en.tn(0, "{n} edge selected", "{n} edges selected")).toBe("0 edges selected");
    expect(en.tn(7, "{n} edge selected", "{n} edges selected")).toBe("7 edges selected");
  });

  it("picks the Russian one/few/many form by count", () => {
    const forms = (n: number) => tr.tn(n, "{n} face", "{n} faces");
    expect(forms(1)).toBe("1 грань");
    expect(forms(21)).toBe("21 грань");
    expect(forms(2)).toBe("2 грани");
    expect(forms(24)).toBe("24 грани");
    expect(forms(5)).toBe("5 граней");
    expect(forms(11)).toBe("11 граней");
    expect(forms(12)).toBe("12 граней");
    expect(forms(0)).toBe("0 граней");
  });
});

describe("Russian dictionary", () => {
  it("has three forms for every plural entry", () => {
    for (const [key, entry] of Object.entries(ru)) {
      if (typeof entry !== "string") expect([key, entry.length]).toEqual([key, 3]);
    }
  });

  it("covers every literal t('...') / tn(n, '...') used by the UI components", () => {
    const dir = new URL("../components/", import.meta.url);
    const literal = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"`;
    const tCall = new RegExp(`\\bt\\(\\s*(?:${literal})`, "g");
    const tnCall = new RegExp(`\\btn\\([^,]+,\\s*(?:${literal})`, "g");
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const re of [tCall, tnCall]) {
        for (const m of source.matchAll(re)) {
          const key = (m[1] ?? m[2]).replace(/\\(.)/g, "$1");
          if (!(key in ru)) missing.push(`${file}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
