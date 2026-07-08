# terminal-fintual

CLI minimalista para consultar el balance actual de tus objetivos en Fintual desde el terminal.

Autentica, lee `GET /api/goals`, muestra totales/subtotales/tabla, guarda snapshots locales (Δ1D/Δ1M) y puede exportar JSON o CSV.

## Estado actual

**v1.3** (8 de julio de 2026):

- Balance actual con totales, subtotales, `%` de peso y `Δ1D` por objetivo.
- Auth con `USER_TOKEN` (recomendado) o login web + cookie.
- Flags: `--json`, `--csv`, `--sort`, `--type`, `--group`, `--grouped`, `--history`, `--no-snapshot`, `--no-diff`, `--keep-snapshots`, `--no-color`, `--help`.
- Snapshots diarios en `.snapshots/` con poda configurable.
- Grupos por **nombre** y/o **id** de goal.
- Vista `--grouped` (tabla por secciones de subtotal).
- Tests unitarios con fixtures (`npm test`).
- No opera en Fintual ni calcula TWR/MWR formal.

## Uso

```bash
npm install
npm start
npm test
```

```bash
npm start -- --sort weight
npm start -- --type apv
npm start -- --group POCHA
npm start -- --grouped
npm start -- --json
npm start -- --csv > balance.csv
npm start -- --history
npm start -- --keep-snapshots 90
node getBalance.js --help
```

Binario opcional:

```bash
npm link
fintual --help
```

## Opciones CLI

| Flag | Descripción |
|------|-------------|
| `--json` | Salida JSON |
| `--csv` | Salida CSV (no combinar con `--json`) |
| `--sort <campo>` | `nav` (default), `pl`, `ret`, `name`, `weight`, `d1` |
| `--type <tipo>` | Filtrar por `goal_type` |
| `--group <etiqueta>` | Filtrar por grupo personalizado |
| `--grouped` | Tabla agrupada por subtotales (APV → grupos → Sin grupo) |
| `--history` | Listar snapshots (sin API) |
| `--no-snapshot` | No guardar snapshot |
| `--no-diff` | Ocultar Δ1D / Δ1M |
| `--keep-snapshots <n>` | Retención en días (default `400`, `0` = sin poda) |
| `--no-color` | Sin ANSI |
| `-h`, `--help` | Ayuda |

## Snapshots y deltas

Cada run exitoso escribe (salvo `--no-snapshot`):

```text
.snapshots/YYYY-MM-DD.json
```

| Delta | Baseline |
|-------|----------|
| **Δ1D** | Último snapshot con fecha &lt; hoy |
| **Δ1M** | Snapshot más reciente con fecha ≤ hoy − 30 días |

Poda: después de guardar, borra snapshots con fecha &lt; hoy − `keep-snapshots` días.

```bash
# CLI
node getBalance.js --keep-snapshots 180

# o env
SNAPSHOT_KEEP_DAYS=180
```

## Grupos personalizados

Archivo local `.goal-groups.json` (ignorado por git) o env `GOAL_GROUPS`.

### Por nombre (como siempre)

```json
{
  "POCHA": ["💰 Sabatini M"],
  "CAJA": ["Caja", "🏢 Departamento"]
}
```

### Por id

```json
{
  "RISKY": ["#27175", "id:1693010"],
  "APV_EXTRA": [488130]
}
```

### Mixto explícito

```json
{
  "MIXTO": {
    "names": ["Caja"],
    "ids": ["26431"]
  }
}
```

Plantilla: [.goal-groups.example.json](.goal-groups.example.json).

Los ids los puedes ver en la salida `--json` / `--csv` (columna `id`).

## Export CSV

```bash
node getBalance.js --csv --no-snapshot > balance.csv
```

Columnas:

`id,name,type,group,nav,deposited,profit,return_pct,weight_pct,delta1d_nav,delta1d_profit,delta1m_nav,delta1m_profit`

## Autenticación

Orden de intento:

1. `USER_EMAIL` + `USER_TOKEN` (recomendado, no interactivo)
2. Cookie local válida en `.cookie` — **no requiere** `USER_EMAIL`, token ni password
3. Login interactivo con `USER_EMAIL` + `USER_PASSWORD` + código email (solo modo terminal)

Con `--json` / `--csv` el login interactivo está deshabilitado: usa token o cookie vigente. Los mensajes de auth van a **stderr** para no contaminar el payload.

## Configuración local (gitignored)

- `.env`
- `.cookie`
- `.goal-groups.json`
- `.snapshots/`

## Estructura

```text
getBalance.js          CLI (I/O, red, render)
lib/core.js            Lógica pura (testable)
test/core.test.js      Tests
test/fixtures/         Fixtures de API y grupos
.goal-groups.example.json
```

## Tests

```bash
npm test
```

Usa `node:test` (Node 18+). Cubre parseo de args, grupos por id/nombre, map/filter/sort, deltas, CSV, prune y secciones agrupadas.

## Limitaciones

- Endpoints Fintual no versionados por este repo.
- Deltas = diferencia de snapshots, no performance formal.
- Sin retries avanzados.

## Seguridad

No subas `.env`, `.cookie`, `.goal-groups.json` ni `.snapshots/`. Prefiere token sobre password.

## Roadmap

- **v1.1** — flags, limpieza, errores, warnings, binario
- **v1.2** — snapshots, Δ1D/Δ1M, `%`, history
- **v1.3** — CSV, tests, match por id, `--grouped`, poda de snapshots

Posibles siguientes pasos: Raycast, retención más fina (weekly/monthly rollup), CI.

## Licencia

ISC
