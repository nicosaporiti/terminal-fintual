require("dotenv").config();
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const email = process.env.USER_EMAIL;
const token = process.env.USER_TOKEN;
const password = process.env.USER_PASSWORD;
const COOKIE_FILE = path.join(__dirname, ".cookie");
const POCHA_GOAL_NAMES = new Set(["Pocha M", "Pocha C"]);
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  white: "\x1b[97m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function askCode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\x1b[33mIngresa el código enviado a tu email: \x1b[0m", (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

function formatNumber(n) {
  return new Intl.NumberFormat("es-ES").format(n).split(",")[0];
}

function formatCurrency(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(n))}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

function pad(value, width, alignment = "left") {
  const text = String(value);
  if (text.length >= width) return text;
  return alignment === "right" ? text.padStart(width, " ") : text.padEnd(width, " ");
}

function colorizeProfit(value, text) {
  if (value > 0) return `${ANSI.green}${text}${ANSI.reset}`;
  if (value < 0) return `${ANSI.red}${text}${ANSI.reset}`;
  return `${ANSI.white}${text}${ANSI.reset}`;
}

function renderRule(width = 95) {
  return `${ANSI.dim}${"─".repeat(width)}${ANSI.reset}`;
}

function renderSummary(balance) {
  const summary = [
    `NAV ${ANSI.white}${formatCurrency(balance.sumNav)}${ANSI.reset}`,
    `APORTE ${ANSI.white}${formatCurrency(balance.sumDeposited)}${ANSI.reset}`,
    `P/L ${colorizeProfit(balance.sumProfit, formatCurrency(balance.sumProfit))}`,
    `RET ${colorizeProfit(balance.profitRatioRaw, formatPercent(balance.profitRatioRaw))}`,
  ];

  return summary.join(` ${ANSI.dim}|${ANSI.reset} `);
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
    ...totals,
    profitRatioRaw: totals.sumDeposited ? (totals.sumProfit / totals.sumDeposited) * 100 : NaN,
  };
}

function renderSubtotal(subtotal) {
  const left = `${ANSI.white}${subtotal.label}${ANSI.reset} ${ANSI.dim}(${subtotal.count})${ANSI.reset}`;
  const right = [
    `NAV ${ANSI.white}${formatCurrency(subtotal.sumNav)}${ANSI.reset}`,
    `APORTE ${ANSI.white}${formatCurrency(subtotal.sumDeposited)}${ANSI.reset}`,
    `P/L ${colorizeProfit(subtotal.sumProfit, formatCurrency(subtotal.sumProfit))}`,
    `RET ${colorizeProfit(subtotal.sumProfit, formatPercent(subtotal.profitRatioRaw))}`,
  ].join(` ${ANSI.dim}|${ANSI.reset} `);

  return `${left}  ${ANSI.dim}|${ANSI.reset}  ${right}`;
}

function renderGoals(goals) {
  const headers = [
    { key: "goal", label: "GOAL", align: "left" },
    { key: "type", label: "TYPE", align: "left" },
    { key: "nav", label: "NAV", align: "right" },
    { key: "deposited", label: "APORTE", align: "right" },
    { key: "profit", label: "P/L", align: "right" },
    { key: "profit_ratio", label: "RET", align: "right" },
  ];

  const widths = headers.map(({ key, label }) =>
    goals.reduce((max, goal) => Math.max(max, String(goal[key]).length), label.length)
  );

  const headerLine = headers
    .map((header, index) => `${ANSI.dim}${pad(header.label, widths[index], header.align)}${ANSI.reset}`)
    .join("  ");

  const rows = goals.map((goal) =>
    headers
      .map((header, index) => {
        const rawValue = String(goal[header.key]);
        const aligned = pad(rawValue, widths[index], header.align);

        if (header.key === "profit" || header.key === "profit_ratio") {
          return colorizeProfit(goal.profitRaw, aligned);
        }

        return header.key === "goal" ? `${ANSI.white}${aligned}${ANSI.reset}` : aligned;
      })
      .join("  ")
  );

  return [headerLine, ...rows].join("\n");
}

function loadCookie() {
  try {
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    if (new Date(data.expires) > new Date()) return data.cookie;
  } catch {}
  return null;
}

function saveCookie(setCookieHeaders) {
  const cookie = setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
  const expiresMatch = setCookieHeaders.join("; ").match(/expires=([^;]+)/i);
  const expires = expiresMatch ? new Date(expiresMatch[1]).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie, expires }));
  return cookie;
}

async function login() {
  if (!email || !password) {
    throw new Error("Faltan USER_EMAIL o USER_PASSWORD para iniciar sesión interactiva");
  }

  await axios.post("https://fintual.cl/auth/sessions/initiate_login", { email, password });
  console.log("\x1b[36mSe envió un código de verificación a tu email.\x1b[0m");
  const code = await askCode();

  const res = await axios.post(
    "https://fintual.cl/auth/sessions/finalize_login_web",
    { email, password, code },
    { withCredentials: true }
  );

  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("No se recibió cookie de sesión");
  return saveCookie(setCookie);
}

async function getCookie() {
  const saved = loadCookie();
  if (saved) return saved;
  return login();
}

async function fetchGoalsWithCookie(cookie) {
  const res = await axios.get("https://fintual.cl/api/goals", {
    headers: { Cookie: cookie },
  });
  return res.data.data;
}

async function fetchGoalsWithToken() {
  const res = await axios.get("https://fintual.cl/api/goals", {
    params: {
      user_email: email,
      user_token: token,
    },
  });
  return res.data.data;
}

async function fetchGoals() {
  if (email && token) {
    try {
      return await fetchGoalsWithToken();
    } catch (err) {
      if (!password || err.response?.status !== 401) {
        throw err;
      }
    }
  }

  const cookie = await getCookie();

  try {
    return await fetchGoalsWithCookie(cookie);
  } catch (err) {
    if (err.response?.status !== 401) {
      throw err;
    }

    console.log("\x1b[33mSesión expirada. Iniciando login...\x1b[0m");
    const refreshedCookie = await login();
    return fetchGoalsWithCookie(refreshedCookie);
  }
}

async function main() {
  const data = await fetchGoals();

  const goals = data.map((d) => {
    const { name, goal_type, nav, profit, deposited } = d.attributes;
    const ratio = deposited ? (profit / deposited) * 100 : NaN;
    return {
      goal: name,
      type: goal_type,
      nav: formatCurrency(nav),
      deposited: formatCurrency(deposited),
      profit: formatCurrency(profit),
      profit_ratio: formatPercent(ratio),
      navRaw: nav,
      profitRaw: profit,
      depositedRaw: deposited,
      profitRatioRaw: ratio,
    };
  });

  let sumNav = 0;
  let sumProfit = 0;
  let sumDeposited = 0;

  for (let i = 0; i < goals.length; i++) {
    sumNav += goals[i].navRaw;
    sumProfit += goals[i].profitRaw;
    sumDeposited += goals[i].depositedRaw;
  }

  const balance = {
    sumNav,
    sumDeposited,
    sumProfit,
    profitRatioRaw: sumDeposited ? (sumProfit / sumDeposited) * 100 : NaN,
  };
  const apvSubtotal = buildSubtotal(goals, "APV", (goal) => goal.type === "apv");
  const pochaSubtotal = buildSubtotal(goals, "POCHA", (goal) => POCHA_GOAL_NAMES.has(goal.goal));

  const title = `${ANSI.cyan}FINTUAL${ANSI.reset} ${ANSI.dim}TERMINAL${ANSI.reset}`;
  const subtitle = `${ANSI.dim}${email}${ANSI.reset}`;
  const updatedAt = `${ANSI.dim}${new Date().toLocaleString("es-CL")}${ANSI.reset}`;

  console.log("");
  console.log(title);
  console.log(`${subtitle}  ${ANSI.dim}|${ANSI.reset}  ${updatedAt}`);
  console.log(renderRule());
  console.log(renderSummary(balance));
  console.log(renderRule());
  console.log(renderSubtotal(apvSubtotal));
  console.log(renderSubtotal(pochaSubtotal));
  console.log(renderRule());
  console.log(renderGoals(goals));
  console.log(renderRule());
  console.log("");
}

main().catch((error) => console.log("\x1b[31mError:\x1b[0m", error.message));
