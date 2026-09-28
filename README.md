# Energy Price Forecast EU for Node-RED

Native Node-RED nodes for electricity-price and consumption-based CO2 forecasts from [Energy Price Forecast EU](https://energypriceforecast.eu/).

Published day-ahead prices are used where available. Forecast values extend the remaining horizon, so a flow can plan beyond the currently published market prices.

## Nodes

### EPF summary

Returns the compact automation view:

- current electricity price and source
- current grid CO2 intensity
- cheapest and greenest continuous window
- whether either window is active now
- combined price/CO2 score
- measured forecast quality and hourly accuracy
- API-key and horizon metadata

The complete API response is written to `msg.payload`. Common automation values are also available in `msg.energypriceforecast`, for example:

```javascript
msg.energypriceforecast.currentPrice
msg.energypriceforecast.currentCo2GPerKwh
msg.energypriceforecast.isCheapestWindowNow
msg.energypriceforecast.cheapestWindowRemainingMinutes
msg.energypriceforecast.combinedScoreNow
```

### EPF prices

Returns the complete price series in `msg.payload.entries`. It supports:

- published day-ahead prices followed by forecast values
- forecast-only mode
- native or unified 15-minute resolution
- wholesale prices or an available household-price estimate

Hourly forecast values shown at 15-minute resolution are repeated across four slots and never interpolated.

## Installation

After publication, install the package from **Manage palette → Install**, or in the Node-RED user directory:

```shell
npm install @backupbattery/node-red-energypriceforecast
```

For local development, install this directory instead:

```shell
npm install /path/to/node-red
```

Restart Node-RED after installation.

## First flow

1. Add an **Inject** node.
2. Connect it to **EPF summary**.
3. Create an Energy Price Forecast connection in the node editor.
4. Select the electricity market, horizon and window length.
5. Connect a **Debug** node and deploy.

An importable flow is available in [`examples/basic-summary.json`](examples/basic-summary.json).

## API key and public access

The API key is optional. Public access currently supports up to 48 hours. An entitled key can unlock a longer horizon; the response is authoritative through:

```javascript
msg.payload.meta.api_key_state
msg.payload.meta.allowed_horizon_hours
msg.payload.meta.used_horizon_hours
```

The key is stored through Node-RED's credential system and is not included when a flow is exported. Do not put the key in `msg`, a Function node or a URL.

## Dynamic requests

Editor settings can be overridden for one message with `msg.epf`. Connection details and the API key deliberately cannot be overridden.

```javascript
msg.epf = {
  market: "NL",
  hours: 72,
  windowHours: 3,
  priceMode: "retail",
  postalCode: "1012"
};
return msg;
```

For **EPF prices**, the additional overrides are `mode` (`mixed` or `forecast_only`) and `resolution` (`15m` or `native`).

## Error handling

Network errors, timeouts, invalid settings and non-successful API responses are emitted as Node-RED errors and can be handled with a **Catch** node. A failed request does not emit a stale success message.

An invalid, expired or revoked API key does not make the API unavailable. The server falls back to public access and reports the reason in `meta.api_key_state`; the node then shows a yellow status.

## Supported markets

AT, BE, BG, CH, CZ, DE, DK1, DK2, ES, FI, FR, GR, NL, NO1–NO5, PL, PT, RO, SE1–SE4, SK and the seven Italian zones ITN, IT_CNOR, IT_CSUD, IT_SUD, IT_CALA, IT_SICI and IT_SARD.

Household-price estimates are only available in supported retail markets. Germany requires a postal code.

## Development

Requires Node.js 20 or newer.

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
