const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const core = require("../lib/core");

const fixturesDir = path.join(__dirname, "fixtures");
const goalsApi = JSON.parse(fs.readFileSync(path.join(fixturesDir, "goals-api.json"), "utf-8"));
const groupsJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, "groups.json"), "utf-8"));

describe("parseArgs", () => {
  it("defaults", () => {
    const opts = core.parseArgs([]);
    assert.equal(opts.sort, "nav");
    assert.equal(opts.json, false);
    assert.equal(opts.csv, false);
    assert.equal(opts.grouped, false);
    assert.equal(opts.keepSnapshots, null);
  });

  it("parses flags", () => {
    const opts = core.parseArgs([
      "--csv",
      "--grouped",
      "--sort",
      "weight",
      "--type=apv",
      "--group",
      "POCHA",
      "--keep-snapshots",
      "90",
      "--no-diff",
    ]);
    assert.equal(opts.csv, true);
    assert.equal(opts.grouped, true);
    assert.equal(opts.sort, "weight");
    assert.equal(opts.type, "apv");
    assert.equal(opts.group, "POCHA");
    assert.equal(opts.keepSnapshots, 90);
    assert.equal(opts.noDiff, true);
  });

  it("rejects json+csv", () => {
    assert.throws(() => core.parseArgs(["--json", "--csv"]), /No combines/);
  });

  it("rejects unknown sort", () => {
    assert.throws(() => core.parseArgs(["--sort", "foo"]), /--sort inválido/);
  });
});

describe("normalizeGoalGroups + match by id/name", () => {
  it("supports names, #ids and object form", () => {
    const groups = core.normalizeGoalGroups(groupsJson);
    assert.equal(groups.length, 3);

    const goals = core.mapGoals(goalsApi);
    const pocha = groups.find((g) => g.label === "POCHA");
    const risky = groups.find((g) => g.label === "RISKY");
    const caja = groups.find((g) => g.label === "CAJA");

    assert.equal(
      core.goalMatchesGroup(
        goals.find((g) => g.id === "999001"),
        pocha
      ),
      true
    );
    assert.equal(
      core.goalMatchesGroup(
        goals.find((g) => g.id === "27175"),
        risky
      ),
      true
    );
    assert.equal(
      core.goalMatchesGroup(
        goals.find((g) => g.id === "26431"),
        caja
      ),
      true
    );
  });

  it("reports unmatched names and ids", () => {
    const groups = core.normalizeGoalGroups({
      X: ["Missing Name", "#999999"],
    });
    const goals = core.mapGoals(goalsApi);
    const warnings = core.findUnmatchedGroupRefs(goals, groups);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0].unmatchedNames, ["Missing Name"]);
    assert.deepEqual(warnings[0].unmatchedIds, ["999999"]);
  });
});

describe("mapGoals / summarize / filter / sort", () => {
  const goals = core.mapGoals(goalsApi);
  const groups = core.normalizeGoalGroups(groupsJson);

  it("maps API payload", () => {
    assert.equal(goals.length, 5);
    assert.equal(goals[0].id, "15937");
    assert.ok(goals[0].navRaw > 0);
    assert.ok(goals[0].profit_ratio.endsWith("%"));
  });

  it("summarizes totals", () => {
    const sum = core.summarizeGoals(goals);
    assert.equal(sum.sumNav, 2100000);
    assert.equal(sum.sumProfit, 355000);
  });

  it("filters by type and group", () => {
    const apv = core.filterGoals(goals, groups, { type: "apv", group: null });
    assert.equal(apv.length, 2);

    const risky = core.filterGoals(goals, groups, { type: null, group: "RISKY" });
    assert.equal(risky.length, 1);
    assert.equal(risky[0].id, "27175");
  });

  it("sorts by nav desc", () => {
    const sorted = core.sortGoals(goals, "nav");
    assert.equal(sorted[0].id, "15937");
    assert.equal(sorted[sorted.length - 1].id, "26431");
  });
});

describe("weights, deltas, baselines", () => {
  it("attaches weight and day delta", () => {
    const goals = core.mapGoals(goalsApi);
    const balance = core.summarizeGoals(goals);

    const daySnapshot = {
      date: "2026-07-07",
      nav: balance.sumNav - 10000,
      profit: balance.sumProfit - 1000,
      deposited: balance.sumDeposited,
      snapshot: {
        goals: goals.map((g) => ({
          id: g.id,
          name: g.goal,
          type: g.type,
          nav: g.navRaw - 1000,
          deposited: g.depositedRaw,
          profit: g.profitRaw - 100,
        })),
      },
    };

    const withMeta = core.attachWeightsAndDeltas(goals, balance.sumNav, daySnapshot, null, {
      noDiff: false,
    });

    assert.ok(Math.abs(withMeta[0].weightRaw - (1000000 / 2100000) * 100) < 0.01);
    assert.equal(withMeta[0].d1NavRaw, 1000);

    const deltas = core.computeSummaryDeltas(balance, daySnapshot, null);
    assert.equal(deltas.day.nav, 10000);
    assert.equal(deltas.day.profit, 1000);
    assert.equal(deltas.month, null);
  });

  it("finds day and month baselines", () => {
    const snaps = [
      { date: "2026-07-08" },
      { date: "2026-07-07" },
      { date: "2026-06-01" },
    ];
    assert.equal(core.findDayBaseline("2026-07-08", snaps).date, "2026-07-07");
    assert.equal(core.findMonthBaseline("2026-07-08", snaps).date, "2026-06-01");
  });
});

describe("grouped sections", () => {
  it("orders APV, custom groups, then Sin grupo", () => {
    const goals = core.mapGoals(goalsApi);
    const groups = core.normalizeGoalGroups(groupsJson);
    const sections = core.buildGroupedSections(goals, groups, {});

    assert.equal(sections[0].label, "APV");
    assert.equal(sections[0].count, 2);
    assert.ok(sections.some((s) => s.label === "POCHA"));
    assert.ok(sections.some((s) => s.label === "RISKY"));
    assert.ok(sections.some((s) => s.label === "CAJA"));

    const allIds = sections.flatMap((s) => s.goals.map((g) => g.id));
    assert.equal(allIds.length, goals.length);
    assert.equal(new Set(allIds).size, goals.length);
  });
});

describe("csv + prune", () => {
  it("renders csv with headers", () => {
    const goals = core.mapGoals(goalsApi);
    const groups = core.normalizeGoalGroups(groupsJson);
    const balance = core.summarizeGoals(goals);
    const withMeta = core.attachWeightsAndDeltas(goals, balance.sumNav, null, null, { noDiff: true });
    const csv = core.renderCsv(withMeta, groups, { noDiff: true });

    assert.match(csv, /^id,name,type,group,nav,/);
    assert.match(csv, /15937,/);
    assert.match(csv, /APV/);
    assert.match(csv, /#27175|RISKY/);
  });

  it("prunes dates older than keep window", () => {
    const dates = ["2026-07-08", "2026-07-07", "2025-01-01", "2024-06-01"];
    const pruned = core.datesToPrune(dates, "2026-07-08", 90);
    assert.deepEqual(pruned, ["2025-01-01", "2024-06-01"]);
    assert.deepEqual(core.datesToPrune(dates, "2026-07-08", 0), []);
  });
});

describe("format helpers", () => {
  it("formats currency and signed deltas", () => {
    assert.equal(core.formatCurrency(1000), "$1.000");
    assert.equal(core.formatSignedCurrency(1000), "+$1.000");
    assert.equal(core.formatSignedCurrency(-500), "-$500");
    assert.equal(core.formatPercent(12.345), "12.35%");
  });

  it("normalizes goal names stripping emoji", () => {
    assert.equal(core.normalizeGoalName("💰 Sabatini M"), "sabatini m");
  });
});

describe("cookie jar", () => {
  const NOW = new Date("2026-07-13T20:00:00.000Z");

  function fakeJwt(expSeconds) {
    const b64url = (obj) =>
      Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${b64url({ alg: "none" })}.${b64url({ exp: expSeconds })}.sig`;
  }

  it("parses Set-Cookie headers with expires and max-age", () => {
    const parsed = core.parseSetCookies(
      [
        "monolith_token=abc; path=/; expires=Mon, 13 Jul 2026 20:05:00 GMT; secure; HttpOnly",
        "auth_refresh_token=xyz; path=/; max-age=1209600; HttpOnly",
        "email=nico%40mail.com; path=/",
        "malformed",
      ],
      NOW
    );

    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed[0], {
      name: "monolith_token",
      value: "abc",
      expires: "2026-07-13T20:05:00.000Z",
    });
    assert.equal(parsed[1].expires, new Date(NOW.getTime() + 1209600 * 1000).toISOString());
    assert.equal(parsed[2].expires, null);
  });

  it("max-age takes precedence over expires", () => {
    const [cookie] = core.parseSetCookies(
      ["a=1; expires=Mon, 13 Jul 2026 20:05:00 GMT; max-age=60"],
      NOW
    );
    assert.equal(cookie.expires, new Date(NOW.getTime() + 60 * 1000).toISOString());
  });

  it("merges cookies into a jar, deleting expired/empty ones", () => {
    let jar = core.mergeCookieJar(null, core.parseSetCookies(["a=1; max-age=100", "b=2"], NOW), NOW);
    assert.equal(jar.version, core.COOKIE_JAR_VERSION);
    assert.equal(jar.cookies.a.value, "1");
    assert.equal(jar.cookies.b.expires, null);

    jar = core.mergeCookieJar(
      jar,
      core.parseSetCookies(["a=9; max-age=100", "b=; expires=Thu, 01 Jan 1970 00:00:00 GMT"], NOW),
      NOW
    );
    assert.equal(jar.cookies.a.value, "9");
    assert.equal(jar.cookies.b, undefined);
  });

  it("falls back to the JWT exp claim when the cookie has no expiry", () => {
    const exp = Math.floor(NOW.getTime() / 1000) + 300;
    const jar = core.mergeCookieJar(
      null,
      core.parseSetCookies([`monolith_token=${fakeJwt(exp)}; path=/; HttpOnly`], NOW),
      NOW
    );
    assert.equal(jar.cookies.monolith_token.expires, new Date(exp * 1000).toISOString());
  });

  it("upgrades legacy v1 .cookie payloads", () => {
    const legacy = {
      cookie: "monolith_token=abc; auth_refresh_token=xyz; email=nico",
      expires: "2026-07-13T20:05:00.000Z",
    };
    const jar = core.upgradeCookieJar(legacy);
    assert.equal(jar.version, core.COOKIE_JAR_VERSION);
    assert.equal(jar.cookies.monolith_token.expires, "2026-07-13T20:05:00.000Z");
    assert.equal(jar.cookies.auth_refresh_token.value, "xyz");
    assert.equal(jar.cookies.auth_refresh_token.expires, null);

    assert.equal(core.upgradeCookieJar(null), null);
    assert.equal(core.upgradeCookieJar({}), null);
    const v2 = { version: core.COOKIE_JAR_VERSION, cookies: {} };
    assert.equal(core.upgradeCookieJar(v2), v2);
  });

  it("builds a Cookie header excluding expired cookies", () => {
    const jar = {
      version: core.COOKIE_JAR_VERSION,
      cookies: {
        monolith_token: { value: "old", expires: "2026-07-13T19:00:00.000Z" },
        auth_refresh_token: { value: "xyz", expires: null },
        email: { value: "nico", expires: "2026-08-01T00:00:00.000Z" },
      },
    };
    assert.equal(core.cookieHeaderFromJar(jar, NOW), "auth_refresh_token=xyz; email=nico");
    assert.equal(core.cookieHeaderFromJar(null, NOW), "");
  });

  it("reports jar status with skew margin on the access token", () => {
    const soon = new Date(NOW.getTime() + 10 * 1000).toISOString(); // dentro del margen de 30s
    const later = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();

    let status = core.cookieJarStatus(
      { version: 2, cookies: { monolith_token: { value: "a", expires: later } } },
      NOW
    );
    assert.equal(status.hasFreshAccess, true);
    assert.equal(status.hasRefresh, false);

    status = core.cookieJarStatus(
      {
        version: 2,
        cookies: {
          monolith_token: { value: "a", expires: soon },
          auth_refresh_token: { value: "r", expires: null },
        },
      },
      NOW
    );
    assert.equal(status.hasFreshAccess, false);
    assert.equal(status.hasRefresh, true);

    assert.deepEqual(core.cookieJarStatus(null, NOW), { hasFreshAccess: false, hasRefresh: false });
  });

  it("recognizes refresh responses that require a new login", () => {
    for (const status of [400, 401, 403, 422]) {
      assert.equal(core.isSessionRefreshRejection(status), true);
    }

    for (const status of [404, 429, 500, undefined]) {
      assert.equal(core.isSessionRefreshRejection(status), false);
    }
  });
});
