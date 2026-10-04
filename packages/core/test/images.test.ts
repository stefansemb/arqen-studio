import { describe, expect, it } from "vitest";
import { isFreeCommonsLicense, isRelevant, plainText, specificWords, stockFits } from "../src/providers/images";
import { composeDescription } from "../src/publish";
import { acceptedImages } from "../src/providers/imagePick";

describe("isFreeCommonsLicense", () => {
  it("accepts public domain marks and CC0 only", () => {
    for (const ok of ["pd", "pd-old-100", "PD", "cc0", "cc-zero"]) expect(isFreeCommonsLicense(ok)).toBe(true);
    for (const no of ["cc-by-sa-4.0", "cc-by-2.0", "gfdl", "", undefined]) expect(isFreeCommonsLicense(no)).toBe(false);
  });
});

describe("museum relevance", () => {
  it("ignores picture-type words, ordinals and regnal numbers", () => {
    expect(specificWords("Vlad III portrait painting 15th century")).toEqual(["vlad"]);
    expect(specificWords("medieval siege engraving")).toEqual(["siege"]);
  });

  it("keeps only results that mention the subject", () => {
    expect(isRelevant("Vlad III portrait painting", ["Portrait of a Man", "Anton Raphael Mengs"])).toBe(false);
    expect(isRelevant("Vlad III portrait painting", ["Vlad Tepes, Prince of Wallachia"])).toBe(true);
    expect(isRelevant("Viking longships", ["Viking ship carving"])).toBe(true);
  });

  it("accepts anything when the query is only generic words", () => {
    expect(isRelevant("medieval painting", ["Anything"])).toBe(true);
  });
});

describe("stockFits", () => {
  it("allows a photo of a place the query names", () => {
    expect(stockFits("Brasov medieval town painting", "Aerial view of Brasov old town")).toBe(true);
  });

  it("rejects people, costumes and queries without a proper name", () => {
    expect(stockFits("Vlad III portrait painting dramatic", "Man in vampire makeup with hat")).toBe(false);
    expect(stockFits("woodcut Vlad dining among impaled victims", "Men in balaclavas at a dinner table")).toBe(false);
    expect(stockFits("medieval castle painting", "Castle on a hill")).toBe(false);
    expect(stockFits("Transylvania castle", undefined)).toBe(false);
  });

  it("does not read people words inside other words", () => {
    expect(stockFits("Romania Carpathian mountains", "Carpathian mountains in Romania at dawn")).toBe(true);
  });
});

describe("plainText", () => {
  it("strips HTML and hidden spans and shortens", () => {
    expect(plainText('<bdi><a href="x">Anonymous</a></bdi><span style="display: none;">Anonymous</span>')).toBe("Anonymous");
    expect(plainText("a".repeat(80), 10)).toHaveLength(10);
  });
});

describe("image credits in the description", () => {
  it("lists archives and stock sites on their own lines", () => {
    const d = composeDescription({
      summary: "S",
      chapters: [],
      archiveSources: ["Wikimedia Commons", "The Metropolitan Museum of Art"],
      stockSources: ["Pexels"],
      hashtags: [],
    });
    expect(d).toContain("Archive images (public domain / CC0): Wikimedia Commons, The Metropolitan Museum of Art");
    expect(d).toContain("Stock images: Pexels");
  });

  it("keeps the old Pexels line when only stockCredit is given", () => {
    expect(composeDescription({ summary: "S", chapters: [], stockCredit: true, hashtags: [] })).toContain("Stock images: Pexels");
  });
});

describe("acceptedImages", () => {
  const img = (n: number, madeYear: number, fits = true) => ({ n, shows: "", madeYear, fits });

  it("drops images made in or after 1900 for earlier events, keeping later paintings of them", () => {
    const r = { narrationYear: 1462, images: [img(1, 1992), img(2, 1850), img(3, 1499), img(4, 1916)], best: [1, 2, 3, 4] };
    expect(acceptedImages(r, 4)).toEqual([2, 3]);
  });

  it("allows modern images when the narration is about modern times", () => {
    expect(acceptedImages({ narrationYear: 1946, images: [img(1, 1946)], best: [1] }, 1)).toEqual([1]);
  });

  it("keeps Claude's order, adds fitting images it left out of best, and ignores rejected or unknown numbers", () => {
    const r = { narrationYear: 1500, images: [img(1, 1500), img(2, 1600), img(3, 1500, false)], best: [2, 3, 9] };
    expect(acceptedImages(r, 3)).toEqual([2, 1]);
  });
});
