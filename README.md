# terminal-fintual

CLI minimalista para consultar el balance actual de tus objetivos en Fintual desde el terminal.

Hoy el proyecto se enfoca en una sola tarea: autenticarse, leer `GET /api/goals` y mostrar una vista compacta estilo terminal financiera con totales, subtotales opcionales y detalle por objetivo.

## Estado actual

Estado del proyecto al 28 de marzo de 2026:

- Funciona como CLI de consulta de balance actual.
- Soporta autenticación no interactiva con `USER_EMAIL` + `USER_TOKEN`.
- Soporta autenticación interactiva con `USER_EMAIL` + `USER_PASSWORD` + código enviado por email.
- Guarda una cookie local para reutilizar la sesión web cuando aplica.
- Muestra un resumen total, subtotal automático de `APV` y subtotales personalizados configurables por usuario.
- No calcula rentabilidad mes a mes.
- No guarda historial.
- No tiene tests automatizados.
- No tiene pipeline de CI ni empaquetado formal.

## Qué muestra

La salida actual incluye:

- Encabezado compacto con email y hora de ejecución.
- Resumen total:
  `NAV`, `APORTE`, `P/L`, `RET`.
- Subtotal automático para objetivos con `goal_type === "apv"`.
- Subtotales opcionales definidos localmente por el usuario.
- Tabla de objetivos con:
  `GOAL`, `TYPE`, `NAV`, `APORTE`, `P/L`, `RET`.

Los valores positivos se muestran en verde y los negativos en rojo.

## Qué no hace

Este proyecto no:

- reconstruye rentabilidad histórica;
- calcula ganancia/pérdida por mes;
- descarga movimientos;
- exporta CSV o JSON;
- modifica objetivos ni realiza operaciones en Fintual.

## Requisitos

- Node.js
- npm
- una cuenta de Fintual
- credenciales válidas para uno de los modos de autenticación descritos abajo

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

También puedes ejecutarlo directamente:

```bash
node -r dotenv getBalance.js
```

## Modos de autenticación

El CLI intenta autenticarse en este orden.

### 1. Token API

Si existen `USER_EMAIL` y `USER_TOKEN`, el script usa primero la ruta no interactiva contra `/api/goals`.

Este es el modo recomendado si quieres ejecutar el CLI desde:

- scripts;
- cron;
- Raycast;
- atajos o aliases del shell.

Ejemplo:

```env
USER_EMAIL="tu-email@ejemplo.com"
USER_TOKEN="tu-token"
```

### 2. Sesión web con cookie

Si no hay token, el CLI intenta reutilizar una cookie local guardada en `.cookie`.

Si la cookie está vencida o el servidor responde `401`, el script intenta renovar sesión.

### 3. Login interactivo

Si existen `USER_EMAIL` y `USER_PASSWORD`, el script puede iniciar sesión vía flujo web:

1. solicita el envío de un código;
2. pide el código en terminal;
3. obtiene una cookie nueva;
4. la guarda en `.cookie`.

Ejemplo:

```env
USER_EMAIL="tu-email@ejemplo.com"
USER_PASSWORD="tu-password"
```

### Qué pasa cuando vence la cookie

- Si usas `USER_TOKEN`, la cookie no es necesaria.
- Si usas cookie y sigue vigente, se reutiliza.
- Si la cookie está vencida o Fintual responde `401`, el CLI intenta reloguearse.
- Si no hay `USER_PASSWORD`, la renovación interactiva no puede ocurrir y el comando falla.

## Configuración local

El repositorio ignora por git:

- `.env`
- `.cookie`
- `.goal-groups.json`

Eso permite que cada usuario tenga su configuración privada sin exponerla en el repositorio público.

## Grupos personalizados

Además del subtotal automático de `APV`, puedes definir subtotales personalizados para conjuntos de objetivos.

Hay dos formas de hacerlo.

### Opción 1. Variable de entorno `GOAL_GROUPS`

```env
GOAL_GROUPS={"FAMILIA":["Objetivo 1","Objetivo 2"],"LARGO_PLAZO":["Casa","Jubilacion"]}
```

### Opción 2. Archivo local `.goal-groups.json`

```json
{
  "FAMILIA": ["Objetivo 1", "Objetivo 2"],
  "LARGO_PLAZO": ["Casa", "Jubilacion"]
}
```

El archivo `.goal-groups.json` es local e ignorado por git. En el repo existe una plantilla pública en [.goal-groups.example.json](/Users/nsaporiti/DevNS/terminal-fintual/.goal-groups.example.json).

Reglas actuales:

- Si existe `GOAL_GROUPS`, esa configuración tiene prioridad.
- Si no existe, el script intenta leer `.goal-groups.json`.
- Si ninguna configuración está presente, solo se muestra el subtotal automático de `APV`.
- Si la configuración está mal formada, el script omite los grupos personalizados y muestra un aviso.

## Estructura del proyecto

- [getBalance.js](/Users/nsaporiti/DevNS/terminal-fintual/getBalance.js)
  CLI principal. Autenticación, lectura de goals, cálculos y render en terminal.
- [package.json](/Users/nsaporiti/DevNS/terminal-fintual/package.json)
  Dependencias y scripts.
- [.goal-groups.example.json](/Users/nsaporiti/DevNS/terminal-fintual/.goal-groups.example.json)
  Ejemplo público de agrupación local.

## Dependencias

Dependencias actuales:

- `axios`
- `dotenv`
- `console.table`

Nota:
`console.table` quedó como dependencia heredada, pero la salida actual ya no depende de esa librería.

## Limitaciones conocidas

- El proyecto depende de endpoints y comportamientos no versionados por este repositorio.
- No hay validación formal de esquema para las respuestas de Fintual.
- No hay manejo avanzado de rate limits ni retries.
- Los subtotales personalizados dependen del nombre exacto de cada objetivo.
- La rentabilidad mostrada es la entregada por Fintual en `profit` y `deposited`; el CLI no recalcula performance propia.
- No hay soporte para snapshots históricos.

## Seguridad

Recomendaciones mínimas:

- No subas `.env`, `.cookie` ni `.goal-groups.json` al repositorio.
- Si usas `USER_PASSWORD`, mantenla solo en tu entorno local.
- Prefiere `USER_TOKEN` para ejecuciones no interactivas.
- Si sospechas que una credencial fue expuesta, rótala antes de volver a usar el CLI.

## Desarrollo

El proyecto hoy es pequeño y no tiene tooling adicional. El flujo básico es:

```bash
npm install
npm start
```

No hay suite de tests actualmente.

## Roadmap sugerido

Posibles mejoras futuras:

- snapshots diarios o mensuales;
- cálculo de P/L por período;
- exportación CSV/JSON;
- filtros por tipo de objetivo;
- agrupación visual de la tabla por subtotal;
- migración a configuración tipada;
- tests de formato y autenticación.

## Licencia

ISC
