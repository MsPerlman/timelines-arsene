const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const pathToFileUrl = (p) => require("node:url").pathToFileURL(p).href;
const load = () => import(pathToFileUrl(path.join(__dirname, "..", "src", "utils", "csvImport.js")));

const LABELS = { title: "Title", date: "Date / Start", end: "End", group: "Group", tags: "Tags" };

test("parseCsv handles BOM, quoted commas, embedded newlines and blank lines", async () => {
  const { parseCsv } = await load();
  const text = '\uFEFF"Title","Date / Start"\r\n"Fall of Rome, West","476"\r\n\r\n"Multi\nline","1066"\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepStrictEqual(headers, ["Title", "Date / Start"]);
  assert.deepStrictEqual(rows, [["Fall of Rome, West", "476"], ["Multi\nline", "1066"]]);
});

test("parseCsv detects semicolon and tab delimiters and pads short rows", async () => {
  const { parseCsv } = await load();
  assert.deepStrictEqual(parseCsv("Name;Year\nA;1\n").rows, [["A", "1"]]);
  assert.deepStrictEqual(parseCsv("Name\tYear\tEnd\nA\t1\n").rows, [["A", "1", ""]]);
});

test("guessMapping matches the app's own export labels and common aliases, once per field", async () => {
  const { guessMapping } = await load();
  assert.deepStrictEqual(
    guessMapping(["Type", "Title", "Date / Start", "End", "Group", "Tags", "Parent"], LABELS),
    ["", "title", "date", "end", "group", "tags", ""]
  );
  assert.deepStrictEqual(
    guessMapping(["Name", "Start Date", "End Date", "Category", "Notes?", "Name"], {}),
    ["title", "date", "end", "tags", "", ""]
  );
});

test("buildTimelineFromRows infers types, skips unusable rows and pads the bounds", async () => {
  const { buildTimelineFromRows } = await load();
  const mapping = ["title", "date", "end"];
  const rows = [
    ["Battle", "1066", ""],
    ["Reign", "1066", "1087"],
    ["", "1100", ""],
    ["Undated", "someday", ""],
    ["Backwards", "1200", "1150"],
  ];
  const result = buildTimelineFromRows(rows, mapping);
  assert.deepStrictEqual(result.elements.map((e) => [e.title, e.type]), [
    ["Battle", "event"], ["Reign", "span"], ["Backwards", "event"],
  ]);
  assert.deepStrictEqual(result.skipped, [{ row: 4, reason: "noTitle" }, { row: 5, reason: "noDate" }]);
  assert.strictEqual(result.start, 1059);
  assert.strictEqual(result.end, 1207);
  assert.strictEqual(result.useCalendar, false);
  assert.strictEqual(new Set(result.elements.map((e) => e.id)).size, 3);
});

test("buildTimelineFromRows makes ranges spans, creates groups and applies tags, colors and descriptions", async () => {
  const { buildTimelineFromRows } = await load();
  const mapping = ["title", "date", "end", "group", "tags", "color", "description"];
  const rows = [
    ["Dynasty", "120", "300", "Rulers", "royal, old", "#336699", "A long line of kings"],
    ["Successor", "300", "400", "rulers", "", "", ""],
    ["Coronation", "121", "", "Main", "", "", "Ignored on events"],
  ];
  const { elements, groups } = buildTimelineFromRows(rows, mapping);
  const [dynasty, successor, coronation] = elements;
  assert.deepStrictEqual(elements.map((e) => e.type), ["span", "span", "event"]);
  assert.deepStrictEqual(groups.map((g) => [g.id, g.title]), [["g-2", "Rulers"]]);
  assert.strictEqual(dynasty.groupId, "g-2");
  assert.strictEqual(successor.groupId, "g-2");
  assert.strictEqual(coronation.groupId, "g-main");
  assert.deepStrictEqual(dynasty.tags, ["royal", "old"]);
  assert.strictEqual(dynasty.color, "#336699");
  assert.strictEqual(dynasty.description, "A long line of kings");
  assert.strictEqual(coronation.description, undefined);
});

test("buildTimelineFromRows honours the chosen slash date order and flags calendar data", async () => {
  const { buildTimelineFromRows } = await load();
  const rows = [["Landing", "04/03/2024"]];
  const dmy = buildTimelineFromRows(rows, ["title", "date"], { dateFormat: "DMY" });
  const mdy = buildTimelineFromRows(rows, ["title", "date"], { dateFormat: "MDY" });
  assert.strictEqual(dmy.elements[0].dateLabel, "2024-03-04");
  assert.strictEqual(mdy.elements[0].dateLabel, "2024-04-03");
  assert.strictEqual(dmy.useCalendar, true);
});
