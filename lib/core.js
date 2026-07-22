/**
 * Pure helpers for terminal-fintual (testable, no I/O / network).
 */

const SORT_FIELDS = new Set(["nav", "pl", "ret", "name", "weight", "d1"]);
const SNAPSHOT_VERSION = 1;
const DEFAULT_SNAPSHOT_KEEP_DAYS = 400;

const COOKIE_JAR_VERSION = 2;
// Fintual entrega un access token JWT de ~5 min (monolith_token) y un
// refresh token (auth_refresh_token) que renueva el access vía POST /auth/jwt.
const ACCESS_COOKIE = "monolith_token";
const REFRESH_COOKIE = "auth_refresh_token";
const ACCESS_EXPIRY_SKEW_MS = 30 * 1000;
const SESSION_REFRESH_REJECTION_STATUSES = new Set([400, 401, 403, 422]);

function isSessionRefreshRejection(status) {
  return SESSION_REFRESH_REJECTION_STATUSES.has(status);
}

function normalizeGoalName(name) {
  return String(name)
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function parseIdToken(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const prefixed = trimmed.match(/^(?:#|id:)\s*(.+)$/i);
  if (prefixed) return prefixed[1].trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

function parseGroupMembers(entries, label) {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    const names = Array.isArray(entries.names) ? entries.names : [];
    const ids = Array.isArray(entries.ids) ? entries.ids : [];
    return {
      label,
      names: new Set(
        names
          .filter((n) => typeof n === "string" && n.trim())
          .map((n) => normalizeGoalName(n))
      ),
      ids: new Set(ids.map((id) => String(id).trim()).filter(Boolean)),
      rawNames: names.filter((n) => typeof n === "string" && n.trim()),
      rawIds: ids.map((id) => String(id).trim()).filter(Boolean),
    };
  }

  if (!Array.isArray(entries)) {
    throw new Error(`GOAL_GROUPS.${label} debe ser un arreglo o { names, ids }`);
  }

  const names = [];
  const ids = [];

  for (const entry of entries) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      ids.push(String(Math.trunc(entry)));
      continue;
    }
    if (typeof entry !== "string" || !entry.trim()) continue;

    const asId = parseIdToken(entry);
    // Bare numeric strings count as ids; plain names as names.
    // Prefixed #id / id:xxx always count as ids.
    if (asId != null && (/^(?:#|id:)/i.test(entry.trim()) || /^\d+$/.test(entry.trim()))) {
      ids.push(asId);
    } else {
      names.push(entry.trim());
    }
  }

  return {
    label,
    names: new Set(names.map((n) => normalizeGoalName(n))),
    ids: new Set(ids),
    rawNames: names,
    rawIds: ids,
  };
}

function normalizeGoalGroups(source) {
  if (!source) return [];

  const parsed = typeof source === "string" ? JSON.parse(source) : source;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GOAL_GROUPS debe ser un objeto JSON");
  }

  return Object.entries(parsed).flatMap(([label, entries]) => {
    const group = parseGroupMembers(entries, label);
    if (!group.names.size && !group.ids.size) return [];
    return [group];
  });
}

function tryNormalizeGoalGroups(source) {
  try {
    return { groups: normalizeGoalGroups(source), error: null };
  } catch (error) {
    return { groups: [], error };
  }
}

function goalMatchesGroup(goal, group) {
  if (goal.id != null && group.ids.has(String(goal.id))) return true;
  if (group.names.has(normalizeGoalName(goal.goal))) return true;
  return false;
}

function findUnmatchedGroupRefs(goals, customGoalGroups) {
  const warnings = [];
  if (!customGoalGroups.length) return warnings;

  const goalNames = new Set(goals.map((goal) => normalizeGoalName(goal.goal)));
  const goalIds = new Set(goals.filter((g) => g.id != null).map((g) => String(g.id)));

  for (const group of customGoalGroups) {
    const unmatchedNames = group.rawNames.filter((name) => !goalNames.has(normalizeGoalName(name)));
    const unmatchedIds = group.rawIds.filter((id) => !goalIds.has(String(id)));
    if (unmatchedNames.length || unmatchedIds.length) {
      warnings.push({
        label: group.label,
        unmatchedNames,
        unmatchedIds,
      });
    }
  }

  return warnings;
}

function parseArgs(argv) {
  const options = {
    json: false,
    csv: false,
    sort: "nav",
    type: null,
    group: null,
    help: false,
    noColor: false,
    history: false,
    noSnapshot: false,
    noDiff: false,
    grouped: false,
    keepSnapshots: null, // null = use env / default later
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--csv") {
      options.csv = true;
      continue;
    }
    if (arg === "--no-color") {
      options.noColor = true;
      continue;
    }
    if (arg === "--history") {
      options.history = true;
      continue;
    }
    if (arg === "--no-snapshot") {
      options.noSnapshot = true;
      continue;
    }
    if (arg === "--no-diff") {
      options.noDiff = true;
      continue;
    }
    if (arg === "--grouped") {
      options.grouped = true;
      continue;
    }
    if (arg === "--sort") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("Falta valor para --sort. Usa: nav | pl | ret | name | weight | d1");
      }
      const sort = value.toLowerCase();
      if (!SORT_FIELDS.has(sort)) {
        throw new Error(`--sort inválido: "${value}". Usa: nav | pl | ret | name | weight | d1`);
      }
      options.sort = sort;
      continue;
    }
    if (arg.startsWith("--sort=")) {
      const sort = arg.slice("--sort=".length).toLowerCase();
      if (!SORT_FIELDS.has(sort)) {
        throw new Error(`--sort inválido: "${sort}". Usa: nav | pl | ret | name | weight | d1`);
      }
      options.sort = sort;
      continue;
    }
    if (arg === "--type") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("Falta valor para --type (ej: --type apv)");
      }
      options.type = value.toLowerCase();
      continue;
    }
    if (arg.startsWith("--type=")) {
      options.type = arg.slice("--type=".length).toLowerCase();
      continue;
    }
    if (arg === "--group") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("Falta valor para --group (ej: --group FAMILIA)");
      }
      options.group = value;
      continue;
    }
    if (arg.startsWith("--group=")) {
      options.group = arg.slice("--group=".length);
      continue;
    }
    if (arg === "--keep-snapshots") {
      const value = argv[++i];
      if (value == null || value.startsWith("-")) {
        throw new Error("Falta valor para --keep-snapshots (días, 0 = sin poda)");
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--keep-snapshots inválido: "${value}". Usa un entero >= 0`);
      }
      options.keepSnapshots = n;
      continue;
    }
    if (arg.startsWith("--keep-snapshots=")) {
      const value = arg.slice("--keep-snapshots=".length);
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--keep-snapshots inválido: "${value}". Usa un entero >= 0`);
      }
      options.keepSnapshots = n;
      continue;
    }

    throw new Error(`Opción desconocida: ${arg}. Usa --help para ver las opciones.`);
  }

  if (options.json && options.csv) {
    throw new Error("No combines --json y --csv. Elige un solo formato de salida.");
  }

  return options;
}

function formatNumber(n) {
  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatCurrency(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(n))}`;
}

function formatSignedCurrency(n) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return formatCurrency(0);
  const sign = n > 0 ? "+" : "-";
  return `${sign}$${formatNumber(Math.abs(n))}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

function formatWeight(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function pad(value, width, alignment = "left") {
  const text = String(value);
  if (text.length >= width) return text;
  return alignment === "right" ? text.padStart(width, " ") : text.padEnd(width, " ");
}

function mapGoals(data) {
  if (!Array.isArray(data)) {
    throw new Error("Respuesta inesperada de Fintual: se esperaba un arreglo de goals.");
  }

  return data.map((d) => {
    const attrs = d?.attributes;
    if (!attrs) {
      throw new Error("Respuesta inesperada de Fintual: goal sin attributes.");
    }

    const { name, goal_type, nav, profit, deposited } = attrs;
    const ratio = deposited ? (profit / deposited) * 100 : NaN;

    return {
      id: d.id != null ? String(d.id) : null,
      goal: name,
      type: goal_type,
      nav: formatCurrency(nav),
      deposited: formatCurrency(deposited),
      profit: formatCurrency(profit),
      profit_ratio: formatPercent(ratio),
      navRaw: Number(nav) || 0,
      profitRaw: Number(profit) || 0,
      depositedRaw: Number(deposited) || 0,
      profitRatioRaw: ratio,
    };
  });
}

function summarizeGoals(goals) {
  const totals = goals.reduce(
    (acc, goal) => {
      acc.sumNav += goal.navRaw;
      acc.sumDeposited += goal.depositedRaw;
      acc.sumProfit += goal.profitRaw;
      return acc;
    },
    { sumNav: 0, sumDeposited: 0, sumProfit: 0 }
  );

  return {
    ...totals,
    profitRatioRaw: totals.sumDeposited ? (totals.sumProfit / totals.sumDeposited) * 100 : NaN,
  };
}

function sortGoals(goals, sortField) {
  const sorted = [...goals];
  const desc = sortField !== "name";

  sorted.sort((a, b) => {
    let cmp = 0;

    if (sortField === "name") {
      cmp = a.goal.localeCompare(b.goal, "es", { sensitivity: "base" });
    } else if (sortField === "nav") {
      cmp = a.navRaw - b.navRaw;
    } else if (sortField === "pl") {
      cmp = a.profitRaw - b.profitRaw;
    } else if (sortField === "ret") {
      const aRet = Number.isFinite(a.profitRatioRaw) ? a.profitRatioRaw : -Infinity;
      const bRet = Number.isFinite(b.profitRatioRaw) ? b.profitRatioRaw : -Infinity;
      cmp = aRet - bRet;
    } else if (sortField === "weight") {
      const aW = Number.isFinite(a.weightRaw) ? a.weightRaw : -Infinity;
      const bW = Number.isFinite(b.weightRaw) ? b.weightRaw : -Infinity;
      cmp = aW - bW;
    } else if (sortField === "d1") {
      const aD = a.d1NavRaw == null ? -Infinity : a.d1NavRaw;
      const bD = b.d1NavRaw == null ? -Infinity : b.d1NavRaw;
      cmp = aD - bD;
    }

    return desc ? -cmp : cmp;
  });

  return sorted;
}

function filterGoals(goals, customGoalGroups, options) {
  let filtered = goals;

  if (options.type) {
    filtered = filtered.filter((goal) => String(goal.type).toLowerCase() === options.type);
  }

  if (options.group) {
    const group = customGoalGroups.find((g) => g.label.toLowerCase() === options.group.toLowerCase());
    if (!group) {
      const available = customGoalGroups.map((g) => g.label).join(", ") || "(ninguno definido)";
      throw new Error(`Grupo no encontrado: "${options.group}". Disponibles: ${available}`);
    }
    filtered = filtered.filter((goal) => goalMatchesGroup(goal, group));
  }

  return filtered;
}

function buildSubtotal(goals, label, predicate) {
  const matchingGoals = goals.filter(predicate);
  const totals = matchingGoals.reduce(
    (acc, goal) => {
      acc.sumNav += goal.navRaw;
      acc.sumDeposited += goal.depositedRaw;
      acc.sumProfit += goal.profitRaw;
      return acc;
    },
    { sumNav: 0, sumDeposited: 0, sumProfit: 0 }
  );

  return {
    label,
    count: matchingGoals.length,
    goals: matchingGoals,
    ...totals,
    profitRatioRaw: totals.sumDeposited ? (totals.sumProfit / totals.sumDeposited) * 100 : NaN,
  };
}

function buildSubtotals(goals, customGoalGroups, options) {
  const subtotals = [];

  if (!options.group) {
    const apvSubtotal = buildSubtotal(goals, "APV", (goal) => goal.type === "apv");
    if (apvSubtotal.count > 0) {
      subtotals.push(apvSubtotal);
    }
  }

  for (const group of customGoalGroups) {
    if (options.group && group.label.toLowerCase() !== options.group.toLowerCase()) {
      continue;
    }

    const subtotal = buildSubtotal(goals, group.label, (goal) => goalMatchesGroup(goal, group));
    if (subtotal.count > 0) {
      subtotals.push(subtotal);
    }
  }

  return subtotals;
}

/**
 * Build ordered sections for --grouped view.
 * Order: APV (if any), custom groups (config order), then "Sin grupo".
 */
function buildGroupedSections(goals, customGoalGroups, options) {
  const assigned = new Set();
  const sections = [];

  const take = (label, predicate) => {
    const sectionGoals = goals.filter((g) => {
      if (assigned.has(g)) return false;
      return predicate(g);
    });
    for (const g of sectionGoals) assigned.add(g);
    if (sectionGoals.length === 0) return;
    const totals = summarizeGoals(sectionGoals);
    sections.push({
      label,
      count: sectionGoals.length,
      goals: sectionGoals,
      ...totals,
    });
  };

  if (!options.group) {
    take("APV", (g) => g.type === "apv");
  }

  for (const group of customGoalGroups) {
    if (options.group && group.label.toLowerCase() !== options.group.toLowerCase()) continue;
    take(group.label, (g) => goalMatchesGroup(g, group));
  }

  take("Sin grupo", () => true);

  return sections;
}

function assignPrimaryGroupLabel(goal, customGoalGroups) {
  if (goal.type === "apv") return "APV";
  for (const group of customGoalGroups) {
    if (goalMatchesGroup(goal, group)) return group.label;
  }
  return "";
}

function indexSnapshotGoals(snapshot) {
  const byId = new Map();
  const byName = new Map();

  for (const goal of snapshot.goals) {
    if (goal.id != null) byId.set(String(goal.id), goal);
    if (goal.name) byName.set(normalizeGoalName(goal.name), goal);
  }

  return { byId, byName };
}

function matchSnapshotGoal(goal, index) {
  if (goal.id != null && index.byId.has(String(goal.id))) {
    return index.byId.get(String(goal.id));
  }
  return index.byName.get(normalizeGoalName(goal.goal)) || null;
}

function attachWeightsAndDeltas(goals, totalNav, dayBaseline, monthBaseline, options) {
  const dayIndex = dayBaseline ? indexSnapshotGoals(dayBaseline.snapshot) : null;
  const monthIndex = monthBaseline ? indexSnapshotGoals(monthBaseline.snapshot) : null;

  return goals.map((goal) => {
    const weightRaw = totalNav ? (goal.navRaw / totalNav) * 100 : NaN;
    const dayMatch = dayIndex ? matchSnapshotGoal(goal, dayIndex) : null;
    const monthMatch = monthIndex ? matchSnapshotGoal(goal, monthIndex) : null;

    const d1Nav = dayMatch ? goal.navRaw - dayMatch.nav : null;
    const d1Profit = dayMatch ? goal.profitRaw - dayMatch.profit : null;
    const d1MNav = monthMatch ? goal.navRaw - monthMatch.nav : null;
    const d1MProfit = monthMatch ? goal.profitRaw - monthMatch.profit : null;

    return {
      ...goal,
      weightRaw,
      weight: formatWeight(weightRaw),
      d1NavRaw: d1Nav,
      d1ProfitRaw: d1Profit,
      d1Nav: options.noDiff ? "—" : d1Nav == null ? "—" : formatSignedCurrency(d1Nav),
      m1NavRaw: d1MNav,
      m1ProfitRaw: d1MProfit,
    };
  });
}

function computeSummaryDeltas(balance, dayBaseline, monthBaseline) {
  const day =
    dayBaseline == null
      ? null
      : {
          date: dayBaseline.date,
          nav: balance.sumNav - (dayBaseline.nav ?? 0),
          profit: balance.sumProfit - (dayBaseline.profit ?? 0),
          deposited: balance.sumDeposited - (dayBaseline.deposited ?? 0),
        };

  const month =
    monthBaseline == null
      ? null
      : {
          date: monthBaseline.date,
          nav: balance.sumNav - (monthBaseline.nav ?? 0),
          profit: balance.sumProfit - (monthBaseline.profit ?? 0),
          deposited: balance.sumDeposited - (monthBaseline.deposited ?? 0),
        };

  return { day, month };
}

function recomputeFilteredDeltas(goals, balance, dayBaseline, monthBaseline) {
  const recalc = (baselineMeta) => {
    if (!baselineMeta) return null;
    const index = indexSnapshotGoals(baselineMeta.snapshot);
    let baseNav = 0;
    let baseProfit = 0;
    let baseDeposited = 0;
    let matched = 0;
    for (const g of goals) {
      const m = matchSnapshotGoal(g, index);
      if (!m) continue;
      matched += 1;
      baseNav += m.nav;
      baseProfit += m.profit;
      baseDeposited += m.deposited;
    }
    if (!matched) return null;
    return {
      date: baselineMeta.date,
      nav: balance.sumNav - baseNav,
      profit: balance.sumProfit - baseProfit,
      deposited: balance.sumDeposited - baseDeposited,
    };
  };

  return {
    day: recalc(dayBaseline),
    month: recalc(monthBaseline),
  };
}

function findDayBaseline(todayKey, snapshots) {
  return snapshots.find((s) => s.date < todayKey) || null;
}

function findMonthBaseline(todayKey, snapshots) {
  const target = addDays(todayKey, -30);
  const candidates = snapshots.filter((s) => s.date <= target);
  return candidates[0] || null;
}

function buildSnapshot(goals, balance, { email = null, dateKey = localDateKey(), capturedAt = new Date().toISOString() } = {}) {
  return {
    version: SNAPSHOT_VERSION,
    email,
    date: dateKey,
    capturedAt,
    summary: {
      nav: balance.sumNav,
      deposited: balance.sumDeposited,
      profit: balance.sumProfit,
      returnPct: Number.isFinite(balance.profitRatioRaw) ? balance.profitRatioRaw : null,
    },
    goals: goals.map((g) => ({
      id: g.id,
      name: g.goal,
      type: g.type,
      nav: g.navRaw,
      deposited: g.depositedRaw,
      profit: g.profitRaw,
    })),
  };
}

/**
 * Given sorted newest-first snapshot dates and keepDays, return dates to delete.
 * keepDays=0 means keep all (return []).
 */
function datesToPrune(snapshotDatesNewestFirst, todayKey, keepDays) {
  if (!keepDays || keepDays <= 0) return [];
  const cutoff = addDays(todayKey, -keepDays);
  return snapshotDatesNewestFirst.filter((date) => date < cutoff);
}

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function renderCsv(goals, customGoalGroups, options) {
  const headers = [
    "id",
    "name",
    "type",
    "group",
    "nav",
    "deposited",
    "profit",
    "return_pct",
    "weight_pct",
    "delta1d_nav",
    "delta1d_profit",
    "delta1m_nav",
    "delta1m_profit",
  ];

  const lines = [headers.join(",")];

  for (const g of goals) {
    const row = [
      csvEscape(g.id),
      csvEscape(g.goal),
      csvEscape(g.type),
      csvEscape(assignPrimaryGroupLabel(g, customGoalGroups)),
      g.navRaw,
      g.depositedRaw,
      g.profitRaw,
      Number.isFinite(g.profitRatioRaw) ? g.profitRatioRaw.toFixed(4) : "",
      Number.isFinite(g.weightRaw) ? g.weightRaw.toFixed(4) : "",
      options.noDiff || g.d1NavRaw == null ? "" : g.d1NavRaw,
      options.noDiff || g.d1ProfitRaw == null ? "" : g.d1ProfitRaw,
      options.noDiff || g.m1NavRaw == null ? "" : g.m1NavRaw,
      options.noDiff || g.m1ProfitRaw == null ? "" : g.m1ProfitRaw,
    ];
    lines.push(row.join(","));
  }

  return `${lines.join("\n")}\n`;
}

function decodeJwtExp(value) {
  const segments = String(value).split(".");
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
    );
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return new Date(payload.exp * 1000).toISOString();
    }
  } catch {}
  return null;
}

function parseSetCookieHeader(header, now = new Date()) {
  const [pair, ...attrs] = String(header).split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  let expires = null;
  let maxAge = null;
  for (const attr of attrs) {
    const attrEq = attr.indexOf("=");
    const key = (attrEq < 0 ? attr : attr.slice(0, attrEq)).trim().toLowerCase();
    const val = attrEq < 0 ? "" : attr.slice(attrEq + 1).trim();
    if (key === "expires" && val) {
      const date = new Date(val);
      if (!Number.isNaN(date.getTime())) expires = date.toISOString();
    } else if (key === "max-age" && val !== "") {
      const seconds = Number(val);
      if (Number.isFinite(seconds)) maxAge = seconds;
    }
  }

  // Max-Age tiene precedencia sobre Expires (RFC 6265 §4.1.2.2).
  if (maxAge != null) {
    expires = new Date(now.getTime() + maxAge * 1000).toISOString();
  }

  return { name, value, expires };
}

function parseSetCookies(headers, now = new Date()) {
  if (!Array.isArray(headers)) return [];
  return headers.map((h) => parseSetCookieHeader(h, now)).filter(Boolean);
}

/**
 * Merge parsed Set-Cookie records into a jar { version, cookies: { name: { value, expires } } }.
 * A cookie with empty value or past expiry is a deletion.
 * JWT-valued cookies without expiry attribute fall back to their exp claim.
 */
function mergeCookieJar(jar, parsedCookies, now = new Date()) {
  const cookies = { ...(jar && jar.cookies ? jar.cookies : {}) };

  for (const cookie of parsedCookies) {
    const isDeletion =
      cookie.value === "" || (cookie.expires != null && new Date(cookie.expires) <= now);
    if (isDeletion) {
      delete cookies[cookie.name];
      continue;
    }
    cookies[cookie.name] = {
      value: cookie.value,
      expires: cookie.expires != null ? cookie.expires : decodeJwtExp(cookie.value),
    };
  }

  return { version: COOKIE_JAR_VERSION, cookies };
}

/**
 * Normalize a persisted .cookie payload to the v2 jar format.
 * Legacy v1 was { cookie: "a=1; b=2", expires } where expires venía del
 * primer atributo expires= del login (el access token de 5 min).
 */
function upgradeCookieJar(data) {
  if (!data || typeof data !== "object") return null;

  if (data.version === COOKIE_JAR_VERSION && data.cookies && typeof data.cookies === "object") {
    return data;
  }

  if (typeof data.cookie === "string" && data.cookie) {
    const cookies = {};
    for (const part of data.cookie.split("; ")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq);
      const value = part.slice(eq + 1);
      cookies[name] = { value, expires: decodeJwtExp(value) };
    }
    if (cookies[ACCESS_COOKIE] && !cookies[ACCESS_COOKIE].expires && data.expires) {
      cookies[ACCESS_COOKIE].expires = data.expires;
    }
    if (!Object.keys(cookies).length) return null;
    return { version: COOKIE_JAR_VERSION, cookies };
  }

  return null;
}

function cookieHeaderFromJar(jar, now = new Date()) {
  if (!jar || !jar.cookies) return "";
  return Object.entries(jar.cookies)
    .filter(([, cookie]) => cookie.expires == null || new Date(cookie.expires) > now)
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join("; ");
}

/**
 * hasFreshAccess: access token vigente (con margen anti-skew) o de vida desconocida.
 * hasRefresh: refresh token presente y no vencido (expiración desconocida cuenta
 * como usable; el servidor decide con un 401).
 */
function cookieJarStatus(jar, now = new Date()) {
  const cookies = jar && jar.cookies ? jar.cookies : {};
  const usable = (cookie, skewMs) =>
    cookie != null &&
    cookie.value !== "" &&
    (cookie.expires == null || new Date(cookie.expires).getTime() - skewMs > now.getTime());

  return {
    hasFreshAccess: usable(cookies[ACCESS_COOKIE], ACCESS_EXPIRY_SKEW_MS),
    hasRefresh: usable(cookies[REFRESH_COOKIE], 0),
  };
}

function httpErrorMessage(err, context) {
  if (err.response) {
    const status = err.response.status;
    if (status === 401) {
      return `${context}: no autorizado (401). Revisa USER_TOKEN o vuelve a iniciar sesión.`;
    }
    if (status === 403) {
      return `${context}: acceso denegado (403).`;
    }
    if (status === 404) {
      return `${context}: endpoint no encontrado (404). La API de Fintual puede haber cambiado.`;
    }
    if (status >= 500) {
      return `${context}: error del servidor Fintual (${status}). Intenta más tarde.`;
    }
    return `${context}: HTTP ${status}.`;
  }

  if (err.code === "ECONNABORTED") {
    return `${context}: timeout de red.`;
  }
  if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
    return `${context}: sin conexión a Fintual (${err.code}).`;
  }

  return err.message || String(err);
}

module.exports = {
  SORT_FIELDS,
  SNAPSHOT_VERSION,
  DEFAULT_SNAPSHOT_KEEP_DAYS,
  COOKIE_JAR_VERSION,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  decodeJwtExp,
  parseSetCookieHeader,
  parseSetCookies,
  mergeCookieJar,
  upgradeCookieJar,
  cookieHeaderFromJar,
  cookieJarStatus,
  isSessionRefreshRejection,
  normalizeGoalName,
  localDateKey,
  parseDateKey,
  addDays,
  parseIdToken,
  parseGroupMembers,
  normalizeGoalGroups,
  tryNormalizeGoalGroups,
  goalMatchesGroup,
  findUnmatchedGroupRefs,
  parseArgs,
  formatNumber,
  formatCurrency,
  formatSignedCurrency,
  formatPercent,
  formatWeight,
  pad,
  mapGoals,
  summarizeGoals,
  sortGoals,
  filterGoals,
  buildSubtotal,
  buildSubtotals,
  buildGroupedSections,
  assignPrimaryGroupLabel,
  indexSnapshotGoals,
  matchSnapshotGoal,
  attachWeightsAndDeltas,
  computeSummaryDeltas,
  recomputeFilteredDeltas,
  findDayBaseline,
  findMonthBaseline,
  buildSnapshot,
  datesToPrune,
  csvEscape,
  renderCsv,
  httpErrorMessage,
};
