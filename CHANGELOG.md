# Changelog

## 0.3.0 — 2026-09-28

- Add the two-output **EPF planner** node for locked N-of-X cheapest-hour plans.
- Add Friday/Saturday-to-Monday weekend charging plans.
- Keep local block boundaries correct across daylight-saving changes by using each market's IANA time zone.
- Store locked plans in Node-RED context and refuse incomplete active blocks instead of publishing partial schedules.
- Report active state, contiguous active-until time, next selected hour, plan averages and estimated saving.
- Add an importable four-of-24-hours planning example and detailed planner documentation.

## 0.2.0 — 2026-09-28

- Add the two-output **EPF signal** node for best-window states, price and CO2 thresholds, combined score and data freshness.
- Add EUR, DKK, NOK, CZK, PLN and SEK selection to summary and price-series requests.
- Expose complete window, forecast-quality, hourly-accuracy, cheaper-day, source and assumptions blocks through `msg.energypriceforecast`.
- Add an importable cheapest-window control example and expand the README with automation and safety guidance.

## 0.1.0 — 2026-09-28

- Initial release with **EPF summary**, **EPF prices** and secure shared API credentials.
