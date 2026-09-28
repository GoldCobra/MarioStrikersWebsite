import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  MSBL_SAVE,
  MSC_SAVE_NTSC_U,
  MSC_SAVE_PAL,
  ONLINE_PROFILES,
  buildOnlineFile,
  friendCode,
  msblSaveWithoutGear,
} from "../lib/save-files.ts";

// Save tools A/B: each flow runs on the reference and the candidate site. Every step records the status
// line, the editor markup and every exported file (SHA-256), and both runs must match exactly.
const REF_URL = process.env.REF_URL ?? "";
const CAND_URL = process.env.CAND_URL ?? "";

type Entry = Record<string, unknown>;

interface Flow {
  readonly name: string;
  readonly path: string;
  readonly downloads: number;
  readonly run: (page: Page, log: (entry: Entry) => void) => Promise<void>;
}

const MSBL = {
  status: "#msbl-save-editor-status",
  file: "#msbl-save-editor-file-input",
  gear: "#msbl-save-editor-gear-input",
  coins: "#msbl-save-editor-coins",
  panel: ".msbl-save-editor-panel",
};
const MSC = {
  status: "#save-editor-status",
  file: "#save-editor-file-input",
  xml: "#save-editor-xml-input",
  panel: ".save-editor-panel",
};
const ONLINE = { status: "#online-editor-status", file: "#online-editor-file-input" };

const [PAL_PROFILE, NTSC_PROFILE] = ONLINE_PROFILES;

/** Runs an action that ends in a new status message (the old one is cleared first) and records the page. */
async function step(
  page: Page,
  statusSelector: string,
  snapshotSelector: string,
  label: string,
  log: (entry: Entry) => void,
  action: () => Promise<unknown>,
): Promise<void> {
  await page.locator(statusSelector).evaluate((node) => {
    node.textContent = "";
  });
  await action();
  await expect(page.locator(statusSelector)).not.toHaveText("");
  log({ step: label, ...(await snapshot(page, snapshotSelector)) });
}

async function snapshot(page: Page, selector: string): Promise<Entry> {
  return page.locator(selector).evaluate((node) => ({
    // Download links keep the object URL of the last export, which is random per run.
    html: node.outerHTML.replace(/blob:[^"]*/g, "blob:<url>"),
    values: Array.from(
      node.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"),
    ).map(
      (field) =>
        `${field.id || field.getAttribute("name") || field.tagName}=${field.value}${field.disabled ? " (disabled)" : ""}`,
    ),
    bodyClass: document.body.className,
  }));
}

async function download(page: Page, selector: string, log: (entry: Entry) => void): Promise<void> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
  const bytes = await readFile(await file.path());
  log({
    download: file.suggestedFilename(),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function binary(name: string, buffer: Buffer): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/octet-stream", buffer };
}

function xml(name: string, text: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "text/xml", buffer: Buffer.from(text, "utf8") };
}

const GEAR_PRESET = [
  '<msbl-gear-presets version="1">',
  '  <character id="1" name="Mario" build="1234" />',
  '  <character id="5" name="Rosalina" build="6061" />',
  '  <character id="16" name="Birdo" build="9870" />',
  "</msbl-gear-presets>",
].join("\n");

function mscPresetXml(captains: number): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<msc-presets version="1" region="R4QP01">'];
  for (let id = 1; id <= captains; id += 1) {
    lines.push(
      `  <captain id="${id}" name="C${id}" top="${((id + 1) % 8) + 1}" bottom="${((id + 3) % 8) + 1}" back="${(id % 8) + 1}" />`,
    );
  }
  lines.push("</msc-presets>");
  return lines.join("\n");
}

const FLOWS: readonly Flow[] = [
  {
    name: "msbl: load, coins, cups, all gear, export",
    path: "/msbl-save-editor",
    downloads: 2,
    async run(page, log) {
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, MSBL.status, MSBL.panel, label, log, action);
      await logStep("load", () => page.setInputFiles(MSBL.file, binary("strkrs.save", MSBL_SAVE)));
      await download(page, "#msbl-save-editor-export", log);
      await logStep("coins", () => page.fill(MSBL.coins, "123456789"));
      await logStep("coins too high", () => page.fill(MSBL.coins, "4294967296"));
      await logStep("coins fixed", () => page.fill(MSBL.coins, "4294967295"));
      await logStep("complete cups", () => page.click("#msbl-save-editor-complete-cups"));
      await logStep("complete cups again", () => page.click("#msbl-save-editor-complete-cups"));
      await logStep("have all gear", () => page.click("#msbl-save-editor-have-all"));
      await logStep("have all gear again", () => page.click("#msbl-save-editor-have-all"));
      await download(page, "#msbl-save-editor-export", log);
    },
  },
  {
    name: "msbl: gear presets and invalid files",
    path: "/msbl-save-editor",
    downloads: 1,
    async run(page, log) {
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, MSBL.status, MSBL.panel, label, log, action);
      await logStep("invalid save", () => page.setInputFiles(MSBL.file, binary("broken.save", Buffer.alloc(100))));
      await logStep("load", () => page.setInputFiles(MSBL.file, binary("strkrs.save", MSBL_SAVE)));
      await logStep("preset", () => page.setInputFiles(MSBL.gear, xml("presets.xml", GEAR_PRESET)));
      await logStep("same preset", () => page.setInputFiles(MSBL.gear, xml("presets.xml", GEAR_PRESET)));
      await logStep("duplicate id", () =>
        page.setInputFiles(MSBL.gear, xml("dup.xml", GEAR_PRESET.replace('id="16"', 'id="1"'))),
      );
      await logStep("bad build", () =>
        page.setInputFiles(MSBL.gear, xml("bad.xml", GEAR_PRESET.replace("9870", "98x0"))),
      );
      await logStep("wrong root", () => page.setInputFiles(MSBL.gear, xml("root.xml", '<presets version="1" />')));
      await logStep("broken xml", () => page.setInputFiles(MSBL.gear, xml("syntax.xml", "<msbl-gear-presets")));
      await download(page, "#msbl-save-editor-export", log);
    },
  },
  {
    name: "msbl: gear on a save without gear",
    path: "/msbl-save-editor",
    downloads: 2,
    async run(page, log) {
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, MSBL.status, MSBL.panel, label, log, action);
      const save = binary("strkrs.save", msblSaveWithoutGear());
      await logStep("load", () => page.setInputFiles(MSBL.file, save));
      await logStep("preset", () => page.setInputFiles(MSBL.gear, xml("presets.xml", GEAR_PRESET)));
      await download(page, "#msbl-save-editor-export", log);
      await logStep("reload", () => page.setInputFiles(MSBL.file, save));
      await logStep("have all gear", () => page.click("#msbl-save-editor-have-all"));
      await download(page, "#msbl-save-editor-export", log);
    },
  },
  {
    name: "msc save: edit presets, apply, export save and xml",
    path: "/msc-save-editor",
    downloads: 3,
    async run(page, log) {
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, MSC.status, MSC.panel, label, log, action);
      await logStep("wrong size", () =>
        page.setInputFiles(MSC.file, binary("Strikers2", MSC_SAVE_PAL.subarray(0, 1000))),
      );
      await logStep("load ntsc-u", () => page.setInputFiles(MSC.file, binary("Strikers2", MSC_SAVE_NTSC_U)));
      await logStep("captain peach", () => page.selectOption("#save-editor-captain", "2"));
      await page.selectOption("#save-editor-top", "5");
      await page.click("#save-editor-slot-back");
      await page.click('#save-editor-picker-grid button[data-picker-value="7"]');
      log({ step: "sidekicks", ...(await snapshot(page, MSC.panel)) });
      await page.click("#save-editor-slot-captain");
      await logStep("picker captain dk", () => page.click('#save-editor-picker-grid button[data-picker-value="3"]'));
      await logStep("back to peach draft", () => page.selectOption("#save-editor-captain", "2"));
      await logStep("apply", () => page.click("#save-editor-apply"));
      await download(page, "#save-editor-xml-export", log);
      await download(page, "#save-editor-save", log);
      log({ step: "after save", ...(await snapshot(page, MSC.panel)) });
      await download(page, "#save-editor-save", log);
    },
  },
  {
    name: "msc save: xml import",
    path: "/msc-save-editor",
    downloads: 1,
    async run(page, log) {
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, MSC.status, MSC.panel, label, log, action);
      await logStep("load pal", () => page.setInputFiles(MSC.file, binary("Strikers2", MSC_SAVE_PAL)));
      await logStep("11 captains", () => page.setInputFiles(MSC.xml, xml("p.xml", mscPresetXml(11))));
      await logStep("bad version", () =>
        page.setInputFiles(MSC.xml, xml("p.xml", mscPresetXml(12).replace('version="1"', 'version="2"'))),
      );
      await logStep("import", () => page.setInputFiles(MSC.xml, xml("p.xml", mscPresetXml(12))));
      await logStep("captain bowser", () => page.selectOption("#save-editor-captain", "7"));
      await download(page, "#save-editor-save", log);
    },
  },
  {
    name: "msc friendlist: add, delete, profiles, export",
    path: "/msc-save-editor",
    downloads: 2,
    async run(page, log) {
      const panel = ".save-editor-panel";
      const logStep = (label: string, action: () => Promise<unknown>) =>
        step(page, ONLINE.status, panel, label, log, action);
      await page.click("#save-editor-mode-friendlist");
      await logStep("not an online file", () => page.setInputFiles(ONLINE.file, binary("Online", Buffer.alloc(64))));
      await logStep("load", () => page.setInputFiles(ONLINE.file, binary("Online", buildOnlineFile())));

      await page.click("#online-editor-add");
      await page.fill("#online-editor-friend-code", "1234");
      await page.click("#online-editor-add-submit");
      log({ step: "add error", ...(await snapshot(page, panel)) });
      await page.fill(
        "#online-editor-friend-code",
        [
          friendCode(444_444_444, PAL_PROFILE.gameId),
          friendCode(444_444_444, PAL_PROFILE.gameId).replace(/-/g, ""),
          friendCode(PAL_PROFILE.profileId, PAL_PROFILE.gameId),
          friendCode(111_111_111, PAL_PROFILE.gameId),
          "",
          friendCode(555_555_555, PAL_PROFILE.gameId)
            .replace(/-/g, "")
            .replace(/^(\d{6})/, "$1 "),
        ].join("\n"),
      );
      await logStep("add batch", () => page.click("#online-editor-add-submit"));

      await page.click("#online-editor-delete");
      await page.check('#online-editor-delete-list input[value="1"]');
      await page.check('#online-editor-delete-list input[value="3"]');
      await logStep("delete two", () => page.click("#online-editor-delete-submit"));
      await download(page, "#online-editor-export", log);

      await page.click("#online-editor-profile-trigger");
      log({ step: "profile menu", ...(await snapshot(page, panel)) });
      await page.click('#online-editor-profile-menu [data-profile-index="1"]');
      log({ step: "second profile", ...(await snapshot(page, panel)) });
      await page.click("#online-editor-add");
      await page.fill(
        "#online-editor-friend-code",
        `${friendCode(666_666_666, NTSC_PROFILE.gameId)}\n${friendCode(777_777_777, PAL_PROFILE.gameId)}`,
      );
      await page.click("#online-editor-add-submit");
      log({ step: "wrong region", ...(await snapshot(page, panel)) });
      await page.fill("#online-editor-friend-code", friendCode(666_666_666, NTSC_PROFILE.gameId));
      await logStep("add to second", () => page.click("#online-editor-add-submit"));
      await download(page, "#online-editor-export", log);
    },
  },
];

async function record(baseUrl: string, flow: Flow, page: Page): Promise<Entry[]> {
  const entries: Entry[] = [];
  await page.goto(new URL(flow.path, baseUrl).href);
  await flow.run(page, (entry) => entries.push(entry));
  return entries;
}

for (const flow of FLOWS) {
  test(`save tools: ${flow.name}`, async ({ browser }) => {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const reference = await record(REF_URL, flow, await context.newPage());
      const candidate = await record(CAND_URL, flow, await context.newPage());
      if (process.env.SAVE_TOOLS_DUMP) {
        appendFileSync(
          process.env.SAVE_TOOLS_DUMP,
          `${JSON.stringify({ flow: flow.name, reference })}
`,
        );
      }
      expect(reference.filter((entry) => "download" in entry)).toHaveLength(flow.downloads);
      expect(candidate).toEqual(reference);
    } finally {
      await context.close();
    }
  });
}
