#!/usr/bin/env node
require("dotenv").config();
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const core = require("./lib/core");

const email = process.env.USER_EMAIL;
const token = process.env.USER_TOKEN;
const password = process.env.USER_PASSWORD;
const COOKIE_FILE = path.join(__dirname, ".cookie");
const GOAL_GROUPS_FILE = path.join(__dirname, ".goal-groups.json");
const SNAPSHOTS_DIR = path.join(__dirname, ".snapshots");

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  white: "\x1b[97m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

let useColor = process.stdout.isTTY !== false;

function paint(code, text) {
  if (!useColor) return text;
  return `${code}${text}${ANSI.reset}`;
}

function colorizeProfit(value, text) {
  if (value > 0) return paint(ANSI.green, text);
  if (value < 0) return paint(ANSI.red, text);
  return paint(ANSI.white, text);
}

function renderRule(width = 110) {
  return paint(ANSI.dim, "─".repeat(width));
}

function loadGoalGroups() {
  if (process.env.GOAL_GROUPS) {
    const { groups, error } = core.tryNormalizeGoalGroups(process.env.GOAL_GROUPS);
    if (error) {
      console.warn(paint(ANSI.yellow, "Aviso:") + " configuración de grupos inválida. Se omitirán grupos personalizados.");
    }
    return groups;
  }

  try {
    const fileContents = fs.readFileSync(GOAL_GROUPS_FILE, "utf-8");
    const { groups, error } = core.tryNormalizeGoalGroups(JSON.parse(fileContents));
    if (error) {
      console.warn(paint(ANSI.yellow, "Aviso:") + " configuración de grupos inválida. Se omitirán grupos personalizados.");
    }
    return groups;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(paint(ANSI.yellow, "Aviso:") + ` no se pudo leer ${path.basename(GOAL_GROUPS_FILE)}.`);
    }
    return [];
  }
}

function printHelp() {
  console.log(`
terminal-fintual — balance de objetivos Fintual

Uso:
  npm start -- [opciones]
  node getBalance.js [opciones]
  fintual [opciones]

Opciones:
  --json                 Salida en JSON
  --csv                  Salida en CSV
  --sort <campo>         nav | pl | ret | name | weight | d1  (default: nav)
  --type <tipo>          Filtrar por goal_type (ej: apv)
  --group <etiqueta>     Filtrar por grupo personalizado
  --grouped              Tabla agrupada por subtotales
  --history              Listar snapshots locales (sin API)
  --no-snapshot          No guardar snapshot
  --no-diff              Ocultar deltas Δ1D / Δ1M
  --keep-snapshots <n>   Días de retención de snapshots (default: ${core.DEFAULT_SNAPSHOT_KEEP_DAYS}, 0 = sin poda)
  --no-color             Desactivar colores ANSI
  -h, --help             Mostrar esta ayuda

Snapshots:
  Cada run guarda .snapshots/YYYY-MM-DD.json (portfolio completo).
  Δ1D vs último snapshot de un día anterior.
  Δ1M vs snapshot más cercano a hace ~30 días.
  Poda automática de snapshots más antiguos que --keep-snapshots.

Grupos (.goal-groups.json):
  Nombres: ["Objetivo 1"]
  IDs:     ["#488130"] o ["id:488130"] o números
  Mixto:   { "names": ["Casa"], "ids": ["123"] }

Autenticación (en orden):
  1. USER_EMAIL + USER_TOKEN
  2. Sesión local en .cookie (access token de ~5 min; se renueva solo
     con el refresh token vía POST /auth/jwt, sin pedir código)
  3. Login interactivo con USER_EMAIL + USER_PASSWORD (solo terminal; no con --json/--csv)

Variables de entorno:
  USER_EMAIL, USER_TOKEN, USER_PASSWORD, GOAL_GROUPS
  SNAPSHOT_KEEP_DAYS   (alternativa a --keep-snapshots)
`.trim());
}

function resolveKeepSnapshots(options) {
  if (options.keepSnapshots != null) {
    return options.keepSnapshots;
  }
  if (process.env.SNAPSHOT_KEEP_DAYS != null && process.env.SNAPSHOT_KEEP_DAYS !== "") {
    const n = Number(process.env.SNAPSHOT_KEEP_DAYS);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`SNAPSHOT_KEEP_DAYS inválido: "${process.env.SNAPSHOT_KEEP_DAYS}"`);
    }
    return n;
  }
  return core.DEFAULT_SNAPSHOT_KEEP_DAYS;
}

function authStatus(message) {
  // Always stderr so --json / --csv stdout stays machine-readable.
  console.error(message);
}

function validateCredentials() {
  // Cookie-only: API call uses Cookie header; email is optional for display/snapshots.
  const jar = loadCookieJar();
  if (jar) {
    const status = core.cookieJarStatus(jar);
    if (status.hasFreshAccess || status.hasRefresh) return;
  }

  if (token) {
    if (!email) {
      throw new Error(
        "Falta USER_EMAIL. Es requerido junto con USER_TOKEN."
      );
    }
    return;
  }

  if (password) {
    if (!email) {
      throw new Error(
        "Falta USER_EMAIL. Es requerido junto con USER_PASSWORD para login interactivo."
      );
    }
    return;
  }

  throw new Error(
    "Faltan credenciales. Usa una cookie válida en .cookie, o define USER_EMAIL + USER_TOKEN (recomendado), o USER_EMAIL + USER_PASSWORD."
  );
}

function askCode() {
  // Prompt on stderr so structured stdout (--json/--csv) is never polluted.
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(paint(ANSI.yellow, "Ingresa el código enviado a tu email: "), (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

function ensureSnapshotsDir() {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true, mode: 0o700 });
}

function snapshotPath(dateKey) {
  return path.join(SNAPSHOTS_DIR, `${dateKey}.json`);
}

function saveSnapshot(snapshot) {
  ensureSnapshotsDir();
  const file = snapshotPath(snapshot.date);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function loadSnapshotFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!data || !data.date || !Array.isArray(data.goals)) return null;
    return data;
  } catch {
    return null;
  }
}

function listSnapshotMeta() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];

  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => {
      const date = name.replace(/\.json$/, "");
      const snapshot = loadSnapshotFile(path.join(SNAPSHOTS_DIR, name));
      if (!snapshot) return null;
      if (email && snapshot.email && snapshot.email !== email) return null;
      return {
        date,
        email: snapshot.email,
        nav: snapshot.summary?.nav ?? null,
        profit: snapshot.summary?.profit ?? null,
        deposited: snapshot.summary?.deposited ?? null,
        goalCount: snapshot.goals.length,
        capturedAt: snapshot.capturedAt,
        snapshot,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function pruneSnapshots(todayKey, keepDays) {
  if (!keepDays || keepDays <= 0) return [];

  const metas = listSnapshotMeta();
  const toDelete = core.datesToPrune(
    metas.map((m) => m.date),
    todayKey,
    keepDays
  );

  for (const date of toDelete) {
    try {
      fs.unlinkSync(snapshotPath(date));
    } catch {
      // ignore missing files
    }
  }

  return toDelete;
}

function warnUnmatchedGroups(goals, customGoalGroups) {
  for (const warning of core.findUnmatchedGroupRefs(goals, customGoalGroups)) {
    const parts = [];
    if (warning.unmatchedNames.length) {
      parts.push(`nombres: ${warning.unmatchedNames.map((n) => `"${n}"`).join(", ")}`);
    }
    if (warning.unmatchedIds.length) {
      parts.push(`ids: ${warning.unmatchedIds.map((id) => `#${id}`).join(", ")}`);
    }
    console.warn(
      paint(ANSI.yellow, "Aviso:") + ` grupo "${warning.label}" sin match — ${parts.join("; ")}`
    );
  }
}

function loadCookieJar() {
  try {
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    return core.upgradeCookieJar(data);
  } catch {}
  return null;
}

function saveCookieJar(jar) {
  fs.writeFileSync(COOKIE_FILE, `${JSON.stringify(jar, null, 2)}\n`, { mode: 0o600 });
  // mode solo aplica al crear; asegura 0600 también cuando el archivo ya existía.
  fs.chmodSync(COOKIE_FILE, 0o600);
}

// Persiste las cookies rotadas que llegan en cualquier respuesta (el refresh
// entrega un monolith_token nuevo; el refresh token también puede rotar).
function absorbSetCookies(jar, res) {
  const parsed = core.parseSetCookies(res.headers?.["set-cookie"]);
  if (!parsed.length) return jar;
  const merged = core.mergeCookieJar(jar, parsed);
  saveCookieJar(merged);
  return merged;
}

async function login({ structured = false } = {}) {
  if (structured) {
    throw new Error(
      "Login interactivo no disponible con --json/--csv. Usa USER_TOKEN o una cookie válida en .cookie."
    );
  }

  if (!email || !password) {
    throw new Error(
      "Faltan USER_EMAIL o USER_PASSWORD para iniciar sesión interactiva. Usa USER_TOKEN o una cookie válida en .cookie."
    );
  }

  try {
    await axios.post(
      "https://fintual.cl/auth/sessions/initiate_login",
      { email, password },
      { timeout: 15000 }
    );
  } catch (err) {
    throw new Error(core.httpErrorMessage(err, "No se pudo iniciar el login"));
  }

  authStatus(paint(ANSI.cyan, "Se envió un código de verificación a tu email."));
  const code = await askCode();

  if (!code) {
    throw new Error("Código vacío. Cancela con Ctrl+C o reintenta con un código válido.");
  }

  let res;
  try {
    res = await axios.post(
      "https://fintual.cl/auth/sessions/finalize_login_web",
      { email, password, code },
      { withCredentials: true, timeout: 15000 }
    );
  } catch (err) {
    throw new Error(core.httpErrorMessage(err, "No se pudo completar el login"));
  }

  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("No se recibió cookie de sesión tras el login");
  const jar = core.mergeCookieJar(null, core.parseSetCookies(setCookie));
  saveCookieJar(jar);
  return jar;
}

/**
 * Renueva el access token (monolith_token, ~5 min) usando el refresh token,
 * igual que la web de Fintual: POST /auth/jwt con las cookies de sesión.
 * Devuelve el jar actualizado, o null si el refresh token fue rechazado
 * (ahí corresponde login completo).
 */
async function refreshSession(jar) {
  let res;
  try {
    res = await axios.post(
      "https://fintual.cl/auth/jwt",
      { aud: "" },
      {
        headers: {
          Cookie: core.cookieHeaderFromJar(jar),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const status = err.response?.status;
    if (core.isSessionRefreshRejection(status)) return null;
    throw new Error(core.httpErrorMessage(err, "No se pudo refrescar la sesión"));
  }

  const updated = absorbSetCookies(jar, res);
  return core.cookieJarStatus(updated).hasFreshAccess ? updated : null;
}

async function getSessionJar({ structured = false } = {}) {
  const jar = loadCookieJar();
  if (jar) {
    const status = core.cookieJarStatus(jar);
    if (status.hasFreshAccess) return jar;
    if (status.hasRefresh) {
      const refreshed = await refreshSession(jar);
      if (refreshed) return refreshed;
      authStatus(paint(ANSI.yellow, "Aviso:") + " refresh token rechazado. Se requiere login.");
    }
  }
  return login({ structured });
}

async function fetchGoalsWithJar(jar) {
  try {
    const res = await axios.get("https://fintual.cl/api/goals", {
      headers: { Cookie: core.cookieHeaderFromJar(jar) },
      timeout: 15000,
    });
    absorbSetCookies(jar, res);
    return res.data.data;
  } catch (err) {
    if (err.response?.status === 401) throw err;
    throw new Error(core.httpErrorMessage(err, "Error al leer goals con cookie"));
  }
}

async function fetchGoalsWithToken() {
  try {
    const res = await axios.get("https://fintual.cl/api/goals", {
      params: {
        user_email: email,
        user_token: token,
      },
      timeout: 15000,
    });
    return res.data.data;
  } catch (err) {
    // Propagate 401 so callers can fall back to cookie / interactive login.
    if (err.response?.status === 401) throw err;
    throw new Error(core.httpErrorMessage(err, "Error al leer goals con token"));
  }
}

async function fetchGoals(options = {}) {
  const structured = Boolean(options.json || options.csv);
  validateCredentials();

  if (email && token) {
    try {
      return await fetchGoalsWithToken();
    } catch (err) {
      if (err.response?.status !== 401) {
        throw err;
      }

      const savedJar = loadCookieJar();
      const savedStatus = savedJar ? core.cookieJarStatus(savedJar) : null;
      const canFallback = Boolean(
        password || (savedStatus && (savedStatus.hasFreshAccess || savedStatus.hasRefresh))
      );
      if (!canFallback) {
        throw new Error(core.httpErrorMessage(err, "Error al leer goals con token"));
      }

      authStatus(paint(ANSI.yellow, "Aviso:") + " token rechazado (401). Intentando sesión web...");
    }
  }

  let jar = await getSessionJar({ structured });

  try {
    return await fetchGoalsWithJar(jar);
  } catch (err) {
    if (err.response?.status !== 401) {
      throw err;
    }

    // Access token rechazado pese a verse vigente: un refresh puede salvarlo.
    const refreshed = await refreshSession(jar);
    if (refreshed) {
      try {
        return await fetchGoalsWithJar(refreshed);
      } catch (retryErr) {
        if (retryErr.response?.status !== 401) throw retryErr;
      }
    }

    authStatus(paint(ANSI.yellow, "Sesión expirada. Iniciando login..."));
    jar = await login({ structured });
    return fetchGoalsWithJar(jar);
  }
}

function renderSummary(balance) {
  const summary = [
    `NAV ${paint(ANSI.white, core.formatCurrency(balance.sumNav))}`,
    `APORTE ${paint(ANSI.white, core.formatCurrency(balance.sumDeposited))}`,
    `P/L ${colorizeProfit(balance.sumProfit, core.formatCurrency(balance.sumProfit))}`,
    `RET ${colorizeProfit(balance.profitRatioRaw, core.formatPercent(balance.profitRatioRaw))}`,
  ];

  return summary.join(` ${paint(ANSI.dim, "|")} `);
}

function renderDeltaLine(label, delta) {
  if (!delta) {
    return `${paint(ANSI.dim, label)} ${paint(ANSI.dim, "— (sin snapshot base)")}`;
  }

  const parts = [
    `NAV ${colorizeProfit(delta.nav, core.formatSignedCurrency(delta.nav))}`,
    `P/L ${colorizeProfit(delta.profit, core.formatSignedCurrency(delta.profit))}`,
  ];

  return `${paint(ANSI.dim, label)} ${parts.join(` ${paint(ANSI.dim, "|")} `)} ${paint(ANSI.dim, `(vs ${delta.date})`)}`;
}

function renderSubtotal(subtotal, totalNav) {
  const weight = totalNav ? (subtotal.sumNav / totalNav) * 100 : NaN;
  const left = `${paint(ANSI.white, subtotal.label)} ${paint(ANSI.dim, `(${subtotal.count})`)} ${paint(ANSI.dim, core.formatWeight(weight))}`;
  const right = [
    `NAV ${paint(ANSI.white, core.formatCurrency(subtotal.sumNav))}`,
    `APORTE ${paint(ANSI.white, core.formatCurrency(subtotal.sumDeposited))}`,
    `P/L ${colorizeProfit(subtotal.sumProfit, core.formatCurrency(subtotal.sumProfit))}`,
    `RET ${colorizeProfit(subtotal.sumProfit, core.formatPercent(subtotal.profitRatioRaw))}`,
  ].join(` ${paint(ANSI.dim, "|")} `);

  return `${left}  ${paint(ANSI.dim, "|")}  ${right}`;
}

function goalTableHeaders(options) {
  const headers = [
    { key: "goal", label: "GOAL", align: "left" },
    { key: "type", label: "TYPE", align: "left" },
    { key: "nav", label: "NAV", align: "right" },
    { key: "weight", label: "%", align: "right" },
    { key: "deposited", label: "APORTE", align: "right" },
    { key: "profit", label: "P/L", align: "right" },
    { key: "profit_ratio", label: "RET", align: "right" },
  ];

  if (!options.noDiff) {
    headers.push({ key: "d1Nav", label: "Δ1D", align: "right" });
  }

  return headers;
}

function computeWidths(headers, goals) {
  return headers.map(({ key, label }) =>
    goals.reduce((max, goal) => Math.max(max, String(goal[key] ?? "").length), label.length)
  );
}

function renderGoalRow(goal, headers, widths) {
  return headers
    .map((header, index) => {
      const rawValue = String(goal[header.key] ?? "");
      const aligned = core.pad(rawValue, widths[index], header.align);

      if (header.key === "profit" || header.key === "profit_ratio") {
        return colorizeProfit(goal.profitRaw, aligned);
      }
      if (header.key === "d1Nav") {
        if (goal.d1NavRaw == null) return paint(ANSI.dim, aligned);
        return colorizeProfit(goal.d1NavRaw, aligned);
      }
      if (header.key === "weight") {
        return paint(ANSI.dim, aligned);
      }

      return header.key === "goal" ? paint(ANSI.white, aligned) : aligned;
    })
    .join("  ");
}

function renderGoalsTable(goals, options) {
  if (goals.length === 0) {
    return paint(ANSI.dim, "(sin objetivos que coincidan con los filtros)");
  }

  const headers = goalTableHeaders(options);
  const widths = computeWidths(headers, goals);
  const headerLine = headers
    .map((header, index) => paint(ANSI.dim, core.pad(header.label, widths[index], header.align)))
    .join("  ");

  const rows = goals.map((goal) => renderGoalRow(goal, headers, widths));
  return [headerLine, ...rows].join("\n");
}

function renderGroupedGoals(goals, customGoalGroups, options) {
  const sections = core.buildGroupedSections(goals, customGoalGroups, options);
  if (sections.length === 0) {
    return paint(ANSI.dim, "(sin objetivos que coincidan con los filtros)");
  }

  const headers = goalTableHeaders(options);
  const widths = computeWidths(headers, goals);
  const headerLine = headers
    .map((header, index) => paint(ANSI.dim, core.pad(header.label, widths[index], header.align)))
    .join("  ");

  const lines = [headerLine];

  for (const section of sections) {
    const weight = goals.length
      ? core.formatWeight((section.sumNav / core.summarizeGoals(goals).sumNav) * 100)
      : "—";
    lines.push(
      paint(
        ANSI.cyan,
        `▸ ${section.label} (${section.count}) ${weight}  NAV ${core.formatCurrency(section.sumNav)}`
      )
    );
    for (const goal of section.goals) {
      lines.push(renderGoalRow(goal, headers, widths));
    }
  }

  return lines.join("\n");
}

function renderHistory() {
  const snapshots = listSnapshotMeta();
  const today = core.localDateKey();

  console.log("");
  console.log(`${paint(ANSI.cyan, "FINTUAL")} ${paint(ANSI.dim, "SNAPSHOTS")}`);
  console.log(paint(ANSI.dim, path.relative(process.cwd(), SNAPSHOTS_DIR) || ".snapshots"));
  console.log(renderRule(72));

  if (snapshots.length === 0) {
    console.log(paint(ANSI.dim, "(sin snapshots aún — ejecuta el CLI una vez para crear el de hoy)"));
    console.log(renderRule(72));
    console.log("");
    return;
  }

  for (const snap of snapshots) {
    const tag = snap.date === today ? paint(ANSI.cyan, "hoy") : paint(ANSI.dim, snap.date);
    const nav = snap.nav == null ? "—" : core.formatCurrency(snap.nav);
    const pl = snap.profit == null ? "—" : core.formatCurrency(snap.profit);
    const line = [
      paint(ANSI.white, snap.date),
      tag,
      `NAV ${nav}`,
      `P/L ${pl}`,
      paint(ANSI.dim, `${snap.goalCount} goals`),
    ].join(`  ${paint(ANSI.dim, "|")}  `);
    console.log(line);
  }

  console.log(renderRule(72));
  console.log(paint(ANSI.dim, `${snapshots.length} snapshot(s)`));
  console.log("");
}

function renderJson({ goals, balance, subtotals, options, deltas, snapshotInfo, customGoalGroups }) {
  const payload = {
    email,
    generatedAt: new Date().toISOString(),
    filters: {
      type: options.type,
      group: options.group,
      sort: options.sort,
      grouped: options.grouped,
    },
    summary: {
      nav: balance.sumNav,
      deposited: balance.sumDeposited,
      profit: balance.sumProfit,
      returnPct: Number.isFinite(balance.profitRatioRaw) ? balance.profitRatioRaw : null,
    },
    deltas: options.noDiff
      ? null
      : {
          day: deltas.day,
          month: deltas.month,
        },
    snapshot: snapshotInfo,
    subtotals: subtotals.map((s) => ({
      label: s.label,
      count: s.count,
      nav: s.sumNav,
      deposited: s.sumDeposited,
      profit: s.sumProfit,
      returnPct: Number.isFinite(s.profitRatioRaw) ? s.profitRatioRaw : null,
      weightPct: balance.sumNav ? (s.sumNav / balance.sumNav) * 100 : null,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.goal,
      type: g.type,
      group: core.assignPrimaryGroupLabel(g, customGoalGroups),
      nav: g.navRaw,
      deposited: g.depositedRaw,
      profit: g.profitRaw,
      returnPct: Number.isFinite(g.profitRatioRaw) ? g.profitRatioRaw : null,
      weightPct: Number.isFinite(g.weightRaw) ? g.weightRaw : null,
      delta1d: options.noDiff
        ? null
        : {
            nav: g.d1NavRaw,
            profit: g.d1ProfitRaw,
          },
      delta1m: options.noDiff
        ? null
        : {
            nav: g.m1NavRaw,
            profit: g.m1ProfitRaw,
          },
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
}

function renderTerminal({
  goals,
  balance,
  subtotals,
  options,
  deltas,
  snapshotInfo,
  customGoalGroups,
}) {
  const title = `${paint(ANSI.cyan, "FINTUAL")} ${paint(ANSI.dim, "TERMINAL")}`;
  const subtitle = paint(ANSI.dim, email || "");
  const updatedAt = paint(ANSI.dim, new Date().toLocaleString("es-CL"));

  console.log("");
  console.log(title);
  console.log(`${subtitle}  ${paint(ANSI.dim, "|")}  ${updatedAt}`);
  console.log(renderRule());
  console.log(renderSummary(balance));

  if (!options.noDiff) {
    console.log(renderDeltaLine("Δ1D", deltas.day));
    console.log(renderDeltaLine("Δ1M", deltas.month));
  }

  if (subtotals.length > 0 && !options.grouped) {
    console.log(renderRule());
    for (const subtotal of subtotals) {
      console.log(renderSubtotal(subtotal, balance.sumNav));
    }
  }

  console.log(renderRule());
  if (options.grouped) {
    console.log(renderGroupedGoals(goals, customGoalGroups, options));
  } else {
    console.log(renderGoalsTable(goals, options));
  }
  console.log(renderRule());

  if (snapshotInfo.saved) {
    let msg = `snapshot ${snapshotInfo.date} guardado`;
    if (snapshotInfo.pruned?.length) {
      msg += ` · podados ${snapshotInfo.pruned.length}`;
    }
    console.log(paint(ANSI.dim, msg));
  } else if (snapshotInfo.skipped) {
    console.log(paint(ANSI.dim, "snapshot omitido (--no-snapshot)"));
  }

  if (!options.noDiff && !deltas.day) {
    console.log(paint(ANSI.dim, "Δ1D disponible a partir del próximo día con un snapshot previo"));
  }

  console.log("");
}

async function main() {
  const options = core.parseArgs(process.argv.slice(2));
  options.keepSnapshots = resolveKeepSnapshots(options);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.noColor || options.json || options.csv || process.env.NO_COLOR != null) {
    useColor = false;
  }

  if (options.history) {
    renderHistory();
    return;
  }

  const customGoalGroups = loadGoalGroups();
  const data = await fetchGoals(options);
  const allGoals = core.mapGoals(data);

  warnUnmatchedGroups(allGoals, customGoalGroups);

  const fullBalance = core.summarizeGoals(allGoals);
  const todayKey = core.localDateKey();
  const existingSnapshots = listSnapshotMeta();
  const dayBaseline = core.findDayBaseline(todayKey, existingSnapshots);
  const monthBaseline = core.findMonthBaseline(todayKey, existingSnapshots);

  const snapshotInfo = {
    date: todayKey,
    saved: false,
    skipped: options.noSnapshot,
    dayBaseline: dayBaseline?.date ?? null,
    monthBaseline: monthBaseline?.date ?? null,
    path: snapshotPath(todayKey),
    keepDays: options.keepSnapshots,
    pruned: [],
  };

  if (!options.noSnapshot) {
    const snapshot = core.buildSnapshot(allGoals, fullBalance, {
      email: email || null,
      dateKey: todayKey,
    });
    saveSnapshot(snapshot);
    snapshotInfo.saved = true;
    snapshotInfo.pruned = pruneSnapshots(todayKey, options.keepSnapshots);
  }

  const filtered = core.filterGoals(allGoals, customGoalGroups, options);
  const balance = core.summarizeGoals(filtered);
  const withMeta = core.attachWeightsAndDeltas(
    filtered,
    balance.sumNav,
    dayBaseline,
    monthBaseline,
    options
  );
  const goals = core.sortGoals(withMeta, options.sort);
  const subtotals = core.buildSubtotals(goals, customGoalGroups, options);

  let deltas = core.computeSummaryDeltas(balance, dayBaseline, monthBaseline);
  if ((options.type || options.group) && !options.noDiff) {
    deltas = core.recomputeFilteredDeltas(goals, balance, dayBaseline, monthBaseline);
  }

  if (options.json) {
    renderJson({ goals, balance, subtotals, options, deltas, snapshotInfo, customGoalGroups });
  } else if (options.csv) {
    process.stdout.write(core.renderCsv(goals, customGoalGroups, options));
  } else {
    renderTerminal({
      goals,
      balance,
      subtotals,
      options,
      deltas,
      snapshotInfo,
      customGoalGroups,
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(paint(ANSI.red, "Error:"), error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, loadGoalGroups, listSnapshotMeta, pruneSnapshots };
