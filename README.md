# Energy Price Forecast EU for Node-RED

Native Node-RED nodes for electricity-price and consumption-based CO2 forecasts from [Energy Price Forecast EU](https://energypriceforecast.eu/).

Published day-ahead prices are used where available. Forecast values extend the remaining horizon, so a flow can plan beyond the currently published market prices. The package provides the complete API responses as well as automation-ready fields and Boolean routes.

## What is included

| Node | Purpose |
| --- | --- |
| **EPF summary** | Current price and CO2, cheapest/greenest/combined windows, quality measurements and access diagnostics |
| **EPF prices** | Full price series for charts, thresholds and custom scheduling |
| **EPF signal** | Two-output decision node for window states, thresholds, combined score and data freshness |

The API key is optional and stored through Node-RED's credential system. It is never placed in `msg`, a URL or an exported flow.

## Installation

Install the package from **Menu → Manage palette → Install** by searching for:

```text
@backupbattery/node-red-energypriceforecast
```

Or install it in the Node-RED user directory:

```shell
cd ~/.node-red
npm install @backupbattery/node-red-energypriceforecast
```

Restart Node-RED after a command-line installation. Node.js 20 or newer and Node-RED 4 or newer are required.

## First flow

1. Add an **Inject** node and set it to repeat every 15 or 30 minutes.
2. Connect it to **EPF summary**.
3. Create an Energy Price Forecast connection in the node editor.
4. Select the electricity market, horizon and continuous window length.
5. Connect a **Debug** node and deploy.

Importable examples:

- [`examples/basic-summary.json`](examples/basic-summary.json) — inspect the complete summary
- [`examples/cheapest-window-control.json`](examples/cheapest-window-control.json) — route active and inactive cheapest-window states separately

## EPF summary

The summary contains:

- current electricity price, unit and source
- current modelled grid CO2 intensity
- cheapest continuous price window and remaining minutes
- greenest continuous CO2 window and remaining minutes
- combined price/CO2 window and the combined score for the current moment
- measured forecast quality, hourly accuracy and cheaper-day decision quality
- API-key state, allowed horizon and used horizon
- source and CO2-assumption metadata

The complete API response is written to `msg.payload`. Common automation values are also available in `msg.energypriceforecast`:

```javascript
msg.energypriceforecast.currentPrice
msg.energypriceforecast.currentPriceUnit
msg.energypriceforecast.currentPriceSource
msg.energypriceforecast.currentCo2GPerKwh

msg.energypriceforecast.cheapestWindowStart
msg.energypriceforecast.cheapestWindowEnd
msg.energypriceforecast.cheapestWindowAveragePrice
msg.energypriceforecast.isCheapestWindowNow
msg.energypriceforecast.cheapestWindowRemainingMinutes

msg.energypriceforecast.greenestWindowStart
msg.energypriceforecast.greenestWindowEnd
msg.energypriceforecast.greenestWindowAverageCo2GPerKwh
msg.energypriceforecast.isGreenestWindowNow
msg.energypriceforecast.greenestWindowRemainingMinutes

msg.energypriceforecast.combinedWindowStart
msg.energypriceforecast.combinedWindowEnd
msg.energypriceforecast.combinedScoreNow

msg.energypriceforecast.forecastQuality
msg.energypriceforecast.hourlyAccuracy
msg.energypriceforecast.cheaperDayDecision
msg.energypriceforecast.allowedHorizonHours
msg.energypriceforecast.usedHorizonHours
```

## EPF signal

Connect **EPF summary → EPF signal** to turn forecast data into a clear Boolean route:

```text
                    ┌─ true output  → start or allow
EPF summary → signal
                    └─ false output → stop or block
```

Available rules:

- cheapest window is active
- greenest window is active
- combined price/CO2 window is active
- current price is below or above a threshold
- current CO2 intensity is below or above a threshold
- combined score is at least a threshold
- forecast data age is at most a configured number of minutes

The original API response remains in `msg.payload`. The result is added under:

```javascript
msg.energypriceforecast.signal = {
  rule: "combined_score_at_least",
  active: true,
  value: 86,
  threshold: 80,
  previous: false,
  changed: true,
  evaluatedAt: "2026-09-28T12:00:00.000Z"
};
```

Choose **On every input** when the downstream device should be synchronized on each poll. Choose **Only when state changes** for start/stop events. In change-only mode, the first input establishes the state without firing unless **Emit the initial state** is enabled.

For physical loads, connect both outputs or add explicit failure handling. A `Catch` node should always move the controlled device to your chosen safe state if fresh data is mandatory.

## EPF prices

The complete price series is returned in `msg.payload.entries`. It supports:

- published day-ahead prices followed by forecast values
- forecast-only mode
- native or unified 15-minute resolution
- market prices or an available household-price estimate
- EUR, DKK, NOK, CZK, PLN and SEK where supported by the API

Hourly forecast values shown at 15-minute resolution are repeated across four slots and never interpolated. Every entry says whether it came from day-ahead data or a forecast and includes its native resolution.

## Currency and household prices

**Market default** chooses the normal currency for the selected market. A different supported currency can be selected explicitly.

The household-price option is an assumption-based estimate, not an exact bill. Germany requires a postal code. If an exact contract formula, time-of-use grid charge or other local billing rule is important, keep the market-price series and implement the formula explicitly in a Function node so its assumptions remain visible.

## API key and public access

Public access currently supports up to 48 hours. An entitled key can unlock a longer horizon, up to the package's 120-hour product range. The response is authoritative:

```javascript
msg.payload.meta.api_key_state
msg.payload.meta.allowed_horizon_hours
msg.payload.meta.used_horizon_hours
```

An invalid, expired or revoked key does not make the API unavailable. The server falls back to public access, reports the reason in `meta.api_key_state`, and the request node shows a yellow status.

## Dynamic requests

Editor settings can be overridden for one message with `msg.epf`. Connection details and the API key deliberately cannot be overridden.

```javascript
msg.epf = {
  market: "NL",
  hours: 72,
  windowHours: 3,
  currency: "EUR",
  priceMode: "retail",
  postalCode: "1012"
};
return msg;
```

For **EPF prices**, the additional overrides are `mode` (`mixed` or `forecast_only`) and `resolution` (`15m` or `native`).

## How this compares with Home Assistant and Homey

The Node-RED package now covers the shared forecast and automation core: current values, continuous best windows, combined score, quality diagnostics, full price series, threshold conditions, data-freshness checks, secure credentials and local-currency selection.

It deliberately does not pretend to provide every platform-specific feature:

- Home Assistant entities, recorder behaviour and Lovelace attributes belong in the HACS integration.
- Homey capabilities and Flow cards belong in the Homey app.
- Locked “N cheapest individual hours in every X-hour block”, weekend EV plans, custom retail formulas and time-of-use grid charges are not yet native Node-RED nodes. They require persistent, DST-safe planning and must not reshuffle a running plan after every forecast update. The full price series is available for custom flows in the meantime.

## Error handling

Network errors, timeouts, invalid settings, incomplete signal input and non-successful API responses are emitted as Node-RED errors and can be handled with a **Catch** node. A failed request never emits an old success message.

## Supported markets

AT, BE, BG, CH, CZ, DE, DK1, DK2, ES, FI, FR, GR, NL, NO1–NO5, PL, PT, RO, SE1–SE4, SK and the seven Italian zones ITN, IT_CNOR, IT_CSUD, IT_SUD, IT_CALA, IT_SICI and IT_SARD.

Household-price estimates are only available in supported retail markets. Some markets do not currently provide CO2 data; a signal that needs missing data fails explicitly instead of returning a guessed `false` value.

## Development

```shell
npm install
npm test
npm run pack:check
```

The optional live smoke test calls the public production API without an API key:

```shell
npm run test:live
```

## License

MIT
