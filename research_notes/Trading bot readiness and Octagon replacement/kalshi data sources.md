# Kalshi-native data sources for an in-house edge engine

## 1. Official Kalshi API surface and implementation map

### Takeaway

Kalshi’s current REST and WebSocket APIs cover the exchange-native inputs needed for a first-party market-data/edge engine: discovery and contract metadata, current books, public trades, candlesticks, lifecycle events, and settlement state. The API documentation is the source of truth for endpoint names, schemas, base URLs, pagination, authentication, and rolling live-versus-historical partitioning; use the official TypeScript SDK listed by Kalshi where it reduces signing and schema drift, but keep a raw-event recorder in this Bun CLI.

### Cited Findings

- Kalshi publishes an API documentation index with official TypeScript and Python SDK references, production/demo REST environments, WebSocket quick starts, rate limits, pagination, historical data, lifecycle, settlement, market, event, series, incentive, live-data, and multivariate resources. [Official API documentation index](https://docs.kalshi.com/llms.txt)
- Production REST hosts documented by Kalshi include `https://external-api.kalshi.com/trade-api/v2` and `https://api.elections.kalshi.com/trade-api/v2`; demo hosts are also documented. [Market candlesticks API](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md)
- Market discovery supports `unopened`, `open`, `closed`, and `settled` status filters plus created/close/settlement/update timestamp filters; markets beyond the historical cutoff must be read from `/historical/markets`. [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md)
- A single market record includes identity and joins (`ticker`, `event_ticker`), lifecycle timestamps, status, prices, volume/open interest, settlement-related fields, and rules/metadata fields. [Get Market](https://docs.kalshi.com/api-reference/market/get-market.md)
- Events remain addressable even when their nested markets are older than the historical cutoff; an event can return metadata separately from bounded child-market pages. [Get Event](https://docs.kalshi.com/api-reference/events/get-event.md)
- Series are recurring-market templates and define structure, settlement sources, and metadata applied to event instances; series list filtering supports category/tags and optional product metadata/volume. [Get Series](https://docs.kalshi.com/api-reference/market/get-series.md), [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list.md)
- Public trades are available through `GET /markets/trades`; each record includes market ticker, price, quantity, timestamp, and block-trade identification. The endpoint supports cursor pagination, ticker/time filters, and up to 1,000 records per page. [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades.md)
- Current order books expose YES and NO bid levels rather than separate asks; a YES bid at X is economically equivalent to a NO ask at 100-X. Levels include price, quantity, and order count, and the REST endpoint supports depth selection. [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md)
- Candlesticks are officially supported at 1-minute, 1-hour, and 1-day intervals, with explicit start/end timestamps; settled markets past the cutoff use the historical candlestick endpoint. [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md)
- Kalshi’s WebSocket endpoint streams order-book changes, trade executions, market-status updates, and fill notifications. Public market-data channels include `ticker`, `trade`, and lifecycle channels; `orderbook_delta` is documented as a private channel, so production capture should use a properly authenticated session. [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md)
- Kalshi requires authenticated WebSocket handshake headers and documents the signed message as timestamp + `GET` + `/trade-api/ws/v2`; the same RSA-PSS signing pattern is used for REST authentication. [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md)
- API usage is token-bucket based, with independent read/write budgets; most authenticated requests cost 10 tokens, while the non-default endpoint-cost list is authoritative. [Rate limits and tiers](https://docs.kalshi.com/getting_started/rate_limits.md)

### Inferences

- Add a `kalshi-native` ingestion layer beside the existing Octagon pipeline: REST backfill/discovery, WebSocket live capture, normalized storage, and feature computation. The existing `src/tools/kalshi/` signed client and `src/scan/` edge pipeline are natural integration points.
- Store raw JSON/WebSocket envelopes before normalization. This preserves forward compatibility when Kalshi adds fields, makes replay/debugging possible, and lets the engine reproduce the exact source observation used for an edge.
- Treat the historical cutoff as dynamic state, not a hard-coded lookback. A scheduled job should read `/historical/cutoff` and query both live and historical endpoints until the union is complete.
- Use cursor pagination with checkpointed cursors and idempotent keys (`trade_id`, ticker + bar interval + end timestamp, event/lifecycle message id where supplied). This is necessary for restart-safe Bun workers and avoids silently losing pages.
- For real-time fair-value features, combine `ticker`/trade events with book deltas and periodically reconcile against REST snapshots. WebSocket deltas are the low-latency path; REST snapshots are the recovery path after disconnects or sequence gaps.

### Gaps

- The API index identifies official TypeScript SDK documentation but does not, in the pages reviewed, specify SDK package version pinning or a long-term compatibility policy. Confirm the package/repository and pin versions during implementation. [Official API documentation index](https://docs.kalshi.com/llms.txt)
- The reviewed official docs do not promise a complete replayable historical WebSocket feed or a public historical order-book endpoint. Do not assume that current REST order books can reconstruct prior depth.

## 2. Historical trades, books, candles, settlements, rules, and public archives

### Takeaway

Kalshi’s official historical tier is useful for backfills, but it is a rolling archive partitioned by data type rather than a permanent all-time warehouse. It explicitly covers markets, market candlesticks, public trades, user fills, orders, and positions; it does not list historical order-book snapshots/deltas. Build research around official trades/candles/market outcomes, then begin prospective L2 capture immediately. Treat third-party archives and datasets as accelerators or validation sources—not substitutes for a legally reviewed, first-party recorder.

### Cited Findings

- Kalshi partitions data into live and historical tiers so the live API remains responsive. The partition applies to markets, market candlesticks, trades, orders, and market positions; events and series remain available through their original endpoints. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- Kalshi publishes moving cutoff timestamps through `GET /historical/cutoff`; each data type has its own cutoff and the windows can differ. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- The documented cutoff semantics are: markets/candles by market settlement time, trades/fills by trade creation time, orders by cancellation/execution update time, and positions by last update/handoff. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- Official historical endpoints are `/historical/cutoff`, `/historical/markets`, `/historical/markets/{ticker}`, `/historical/markets/{ticker}/candlesticks`, `/historical/trades`, `/historical/fills`, `/historical/orders`, and `/historical/positions`. The list contains no historical orderbook endpoint. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- A settled market’s outcome resolves positions automatically; YES or NO contract holders receive $1 per contract for the winning side, with net positions settled after netting. Timing can vary based on market type, source availability, and manual review. [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement.md)
- Market records expose `rules_primary` and `rules_secondary` fields alongside settlement value/timestamp and lifecycle fields, making the market object a required contract-definition snapshot. [Get Market](https://docs.kalshi.com/api-reference/market/get-market.md)
- Kalshi’s help documentation says weather market rules identify the official settlement source; examples distinguish NWS climate reports from The Weather Company readings, and warn that preliminary readings can differ from final values. [Weather Markets](https://help.kalshi.com/en/articles/13823837-weather-markets)
- Kalshi’s crypto-market documentation says rules govern the exact CF Benchmarks index and averaging method; it also says the API can pass through CF Benchmarks data and that post-expiry values may reflect later provider revisions. [Crypto Markets](https://help.kalshi.com/en/articles/13823838-crypto-markets)
- The official API includes an event forecast-percentile-history endpoint for historical raw and formatted forecast numbers at requested percentiles and time ranges. This is useful for structured forecast products, but it is not a substitute for market price/trade history. [Get Event Forecast Percentile History](https://docs.kalshi.com/api-reference/events/get-event-forecast-percentile-history.md)
- A non-official public Hugging Face dataset advertises trade-level and market-level Kalshi data from June 2021 through January 2026, with 154,505,005 trades and 17,464,713 market rows at the time of its page snapshot. Treat these counts, provenance, coverage, and redistribution rights as claims of that dataset publisher, not Kalshi guarantees. [TrevorJS/kalshi-trades dataset](https://huggingface.co/datasets/TrevorJS/kalshi-trades)
- A non-official Kalshi Eye archive says it has recorded public market-feed data, including order-book changes, trades, and settlements, since October 12, 2026 and publishes Parquet files with manifests/checksums. This is a possible external backfill/validation source, but it is not an official Kalshi archive and its license/coverage should be reviewed before use. [Kalshi Eye data archive](https://kalshieye.com/data/kalshi/), [Kalshi Eye license](https://kalshieye.com/legal/license/)
- Kalshi’s data terms define website data broadly to include volume, bid/ask prices, range prices, high/low prices, settlement prices, indexes, open interest, and market descriptions; the terms restrict commercial/non-personal uses such as software development, AI/ML development, and providing archived/cached datasets without written consent. This is a legal/compliance gate for any in-house engine, especially if distributed or commercial. [Kalshi Data Terms of Use](https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf)
- Kalshi’s Developer Agreement requires efficient/responsible API use and recommends exponential backoff on rate-limit errors; it also prohibits API use that undermines market integrity or disrupts the API/exchange. [Kalshi Developer Agreement](https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf)

### Inferences

- For backtesting, the minimum official dataset is: market/event/series metadata; rules fields; settled outcome and settlement timestamp; public trade tape; 1-minute candles; and the live+historical cutoff union. This supports price-based calibration, liquidity/volume features, event-time alignment, and settlement-aware labels.
- A realistic historical order-book backtest cannot be reconstructed exactly from candles, trades, and today’s book. At best, those sources support approximate spread/liquidity proxies. The engine should label such backtests as “trade/candle replay” versus “L2 replay.”
- Prospective storage should include: periodic full book snapshots; every `orderbook_delta`; ticker updates; public trades; lifecycle messages; REST market/event/series responses; cutoff responses; and settlement/market-status observations. Add collector timestamps and source sequence/message identifiers to distinguish exchange time from ingestion time.
- Rules and source metadata need versioned snapshots, not just current rows. At minimum persist every observed change to market/event/series objects and the exact rules text/URLs, because current rules can be insufficient to explain historical settlement interpretation.
- Settlement labels should record both `settlement_value_dollars`/settlement timestamp and the market’s rule/source metadata. For source-dependent markets, separately capture the external official source when legally and operationally permitted; Kalshi’s own rules identify which source controls.

### Gaps

- Official documentation does not provide a public historical L2 order-book archive in the endpoint inventory reviewed. This is the most material data gap for microstructure/backtesting and must be filled prospectively or through a separately licensed archive. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- The official historical docs do not specify one fixed retention duration; they say cutoffs advance and differ by data type. A collector must read the live cutoff response and persist its own snapshots. [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
- I found no official Kalshi bulk-download/open-data catalog in the reviewed documentation. Third-party datasets exist, but their completeness, timestamp semantics, corrections, licensing, and continuity require independent validation before they enter a production research corpus. [Official API documentation index](https://docs.kalshi.com/llms.txt)
- Public APIs expose exchange trades, but they do not expose counterparties’ private orders, fills, queue history, cancellations, or intent. The documented private WebSocket channels are user-specific for fills/positions/communications; do not design features that assume trader identity or full participant-level order history. [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md)
- The reviewed sources do not establish whether every historical rules revision, clarification/banner, or external settlement-source revision is available through a stable API. Preserve observed versions prospectively and retain raw response bodies.

## 3. Recommended Octagon replacement architecture and research priorities

### Takeaway

Replace Octagon’s exchange-data dependency in stages: first build a reliable Kalshi-native data plane, then add market-specific external evidence adapters, then compute transparent edge/risk features. Kalshi-native data can supply the market-implied side of the engine and settlement labels; it cannot by itself supply the external forecasting/evidence layer that Octagon may have provided.

### Cited Findings

- Kalshi’s own API exposes current market data, order books, public trades, portfolio data, and a limited set of market statistics; Kalshi describes the API as REST-based in its help center. [Kalshi API help](https://help.kalshi.com/en/articles/13823854-kalshi-api)
- The WebSocket API provides real-time ticker, trade, lifecycle, and order-book update mechanisms, with public market-data channels and private user channels separated in the documentation. [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md)
- Events aggregate one or more outcome markets, while series define recurring templates and settlement-source metadata. [Get Event](https://docs.kalshi.com/api-reference/events/get-event.md), [Get Series](https://docs.kalshi.com/api-reference/market/get-series.md)
- Candlestick intervals are constrained to 1 minute, 1 hour, or 1 day, so sub-minute research requires raw WebSocket/trade capture rather than an official sub-minute candle endpoint. [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md)
- Orderbook responses provide price levels, quantities, and order counts, while WebSocket orderbook deltas provide the prospective event stream needed to reconstruct depth. [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md), [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md)

### Inferences

- Suggested data model for this TypeScript/Bun CLI:
  - `series_snapshot`: series ticker, category/tags, product metadata, rules/source descriptors, observed_at, raw payload hash.
  - `event_snapshot`: event ticker, series ticker, title/subtitle, exclusivity, child-market membership, observed_at, raw payload hash.
  - `market_snapshot`: ticker, event/series joins, yes/no subtitles, rule fields, strike/expiration fields, lifecycle/status, prices, volume/open interest, settlement fields, observed_at, raw payload hash.
  - `trade`: trade id, ticker, created time, price(s), count, taker side, block-trade flag, ingestion time, source endpoint/channel.
  - `book_snapshot` and `book_delta`: ticker, exchange timestamp, sequence/message id, side, price, quantity/order count if supplied, snapshot/delta kind, ingestion time.
  - `candle`: ticker, interval, end timestamp, OHLC/price fields, bid/ask, volume/open interest fields, source endpoint.
  - `lifecycle_event`: ticker/event, status transition, close/settlement timestamps, raw message.
  - `settlement_observation`: ticker, outcome/value, settlement timestamp, rules/source snapshot id, first-seen and last-seen times.
  - `cutoff_snapshot`: all cutoff fields and retrieval time.
- Phase 1 collector: REST discovery/backfill plus a durable WebSocket daemon. Reconnect with exponential backoff, resubscribe, take a fresh REST book snapshot, and mark a gap whenever the stream cannot be proven continuous.
- Phase 2 feature layer: mid/mark price, spread, depth imbalance, executable slippage, trade intensity, signed flow, price momentum/reversal, time-to-close, open interest/volume changes, event-level cross-market consistency, and settlement-label calibration. Every feature should carry an as-of timestamp and a data-quality flag.
- Phase 3 evidence adapters: map `series/event/market` rules to authoritative external sources (for example NWS/Weather Company for weather, CF Benchmarks for specified crypto indexes, official sports feeds, BLS/BEA/Fed releases, election authorities). Keep source-specific parsing and revision handling separate from generic edge computation.
- Replace opaque “edge” output with an auditable decomposition: market-implied probability, external estimate, uncertainty interval, fee/slippage adjustment, liquidity capacity, data freshness, rule/source confidence, and final risk-gated expected value. This makes Octagon replacement testable rather than a one-for-one black-box substitution.
- Backtest evaluation should have separate tracks: official trade/candle history; prospective L2 replay after recorder launch; and external-evidence nowcasts. Do not mix them without a feature-availability timestamp to prevent look-ahead bias.
- In this repository, the collector can reuse `fetchWithDeadline` for REST, add a Bun WebSocket worker under `src/scan/` or `src/daemon/`, write normalized rows through `src/db/`, and expose edge features through the existing `src/tools/registry.ts`/`edge_query` path. Keep order placement behind existing risk gates.

### Gaps

- Kalshi-native data does not provide the external forecast, news retrieval, domain model, or source-specific nowcast that an Octagon-backed analysis layer may have supplied. Those capabilities require separate authoritative-source adapters and likely a web/search/evidence subsystem.
- The reviewed API pages do not document a universal exchange-side event sequence/replay guarantee for all WebSocket channels. Implement gap detection and reconciliation defensively, and measure dropped/reconnected intervals in the database.
- The reviewed sources do not provide a complete historical catalog of rule revisions, data-provider corrections, or manual-review decisions. Prospective capture is required if the engine must explain “what was knowable then” rather than merely reproduce today’s final record.
- Before commercial deployment or redistribution, obtain legal review of the Kalshi Developer Agreement and Data Terms and confirm that the intended in-house ML/research use is authorized. [Developer Agreement](https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf), [Data Terms](https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf)
