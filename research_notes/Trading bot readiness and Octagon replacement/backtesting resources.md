# Backtesting resources for a Kalshi bot without Octagon AI

Research checked 2026-11-11. These notes distinguish *outcome labels* (what eventually happened), *historical signals* (what a trader could have known), and *execution data* (what could have been bought or sold). No source below supplies all three. The repository already exposes Kalshi historical endpoints and has SQLite, paper trading, and a Brier/edge backtest; see `src/tools/kalshi/historical.ts`, `src/db/`, and `README.md` (local repository evidence).

## What exchange data and replay rules are the foundation?

### Takeaway
Kalshi's own historical markets, candles, and trades are the first dependency. A defensible replay needs timestamped market availability, contemporaneous bid/ask, contract rules, resolution, fees, and the source publication time; candles alone cannot establish an executable fill.

### Cited Findings
- Kalshi partitions live and historical data and publishes separate moving cutoffs for markets/candles, trades, orders, fills, and positions. A complete pull must consult `GET /historical/cutoff` and both endpoint families. [Kalshi historical data guide](https://docs.kalshi.com/getting_started/historical_data)
- Historical market candlesticks accept `start_ts`, `end_ts`, and 1, 60, or 1440 minute intervals. The live candle schema contains separate YES bid, YES ask, and traded price OHLC plus volume/open interest. Those are period aggregates, not archived order-book depth or proof of a fill at the close. [Kalshi historical candle endpoint](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks); [Kalshi live candle endpoint](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)
- Kalshi publishes historical trades, markets, user fills, and orders as distinct endpoints; order-book updates and public trades are available via WebSocket for capture going forward. [Kalshi historical endpoints](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks); [Kalshi WebSocket order-book updates](https://docs.kalshi.com/websockets/orderbook-updates)
- Authenticated API requests use token-based tier budgets; the live `GET /account/endpoint_costs` gives current non-default endpoint costs. Bulk backfills need pacing and checkpoints. [Kalshi API rate limits](https://docs.kalshi.com/getting_started/rate_limits)
- Kalshi fees vary by series and maker/taker treatment; its fee schedule is the maintained reference. [Kalshi fee schedule](https://kalshi.com/fee-schedule)

### Inferences
- Store immutable market metadata and settlement rules, market existence/open/close timestamps, resolution outcome, trade/candle snapshots, and collection time. Simulate crossing the contemporaneous ask to buy YES and bid to exit, with available size, fees, slippage, rejected/no-fill cases, and exposure/risk caps. A candle midpoint or last trade should only be a forecasting baseline, not a fill price.
- For past markets with no depth archive, label results as *signal backtests under assumed fills*; start a WebSocket/order-book collector now for later execution-quality tests. Replay all markets existing at each decision time, including inactive and losing ones, to avoid survivorship bias.

### Gaps
- I did not find an official public historical full-depth order-book archive or a guarantee that historical candle data are complete for every settled market. Validate completeness by market and period before interpreting returns.
- Verify the exact Kalshi developer/data reuse terms for this bot's intended deployment and historical fee schedules for periods tested; the current fee page cannot automatically reconstruct past fees.

## Which official macroeconomic sources support point-in-time features and labels?

### Takeaway
ALFRED is the strongest practical vintage source for common macro series. BLS and BEA are authoritative origins for release definitions and outcome labels, but latest values must not be joined into earlier decision times.

### Cited Findings
- FRED API v1 serves series and release calendars; ALFRED uses the same endpoints with `realtime_start`, `realtime_end`, or `vintage_dates` to obtain what was known on historical dates. The default is today's revised view. [FRED API index](https://fred.stlouisfed.org/docs/api/fred/); [real-time periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html); [observations parameters](https://fred.stlouisfed.org/docs/api/fred/series_observations.html)
- FRED/ALFRED API calls need an account-specific API key; published API error guidance says 429 after up to 120 requests/minute. FRED terms say third-party series retain owners' restrictions and list gambling-related applications among prohibited API uses; the broader FRED service terms also restrict using FRED content in AI/ML development. These terms need review before using FRED/ALFRED in this trading bot. [API keys](https://fred.stlouisfed.org/docs/api/api_key.html); [API limits](https://fred.stlouisfed.org/docs/api/fred/errors.html); [API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html); [FRED service terms](https://fred.stlouisfed.org/legal/terms/)
- BLS Public Data API provides published series values; its API feature page describes v2 as up to 50 series, 20 years, and 500 daily queries with registration, but the page also warns of a one-day posting lag in older v1 notes. BLS values can be revised; the API returns observations and footnotes, not full metadata or vintage snapshots. [BLS API features](https://www.bls.gov/bls/api_features.htm); [BLS revisions](https://www.bls.gov/about-bls/revisions.htm); [BLS API signatures](https://www.bls.gov/developers/api_signature_v2.htm)
- BLS API terms require retrieval-date attribution and note that BLS cannot vouch for downstream analysis. Release calendars and archived releases are needed for timestamp-accurate CPI/jobs signals. [BLS API terms](https://www.bls.gov/developers/termsOfService.htm); [BLS release calendar](https://www.bls.gov/schedule/news_release/)
- BEA API requires registration and exposes a subset of its published statistics plus metadata. Its April 2026 guide lists standard throttles of 100 requests/minute, 100 MB/minute, and 30 errors/minute. [BEA API docs](https://apps.bea.gov/API/docs/); [BEA API guide](https://apps.bea.gov/api/_pdf/bea_web_service_api_user_guide.pdf)
- BEA GDP has advance, second, and third estimates at scheduled release times; prior news releases are archived. BEA warns that linked current data supersede original release values, so the archive or ALFRED is needed for initial-print backtests. [BEA schedule](https://www.bea.gov/index.php/news/schedule); [BEA archive policy](https://www.bea.gov/about/policies-and-information/priorities-and-schedules-posting-content); [BEA GDP release example](https://bea.gov/news/2026/gdp-advance-estimate-4th-quarter-and-year-2025)

### Inferences
- Separate the precise Kalshi contract settlement definition (for example, first CPI print versus later revision) from model features. Use `available_at_utc` based on actual dissemination time, `reference_period`, `vintage_date`, and `retrieved_at` as distinct fields. BLS/BEA release PDFs or tables are the primary fallback if FRED terms preclude use.
- A date-only ALFRED vintage is insufficient to decide whether a value was available *before* an 08:30 release on that date; apply official release timestamps or archived pages, plus a conservative ingestion lag.

### Gaps
- Series-by-series vintage coverage, precise historical release publication timestamps, and rights for each target contract remain to be mapped. The cited BLS API feature page is dated; recheck operational limits during implementation.
- Legal applicability of the FRED/ALFRED API gambling and AI restrictions to private versus distributed bot use requires explicit permission or qualified review. Do not assume public access means permitted trading use.

## Which NOAA data can reproduce weather-market inputs and outcomes?

### Takeaway
NOAA station observations can verify weather outcomes; archived *forecast runs* are needed to reconstruct a genuine pre-event weather signal. Station identity, observation window, quality flags, and later revisions can change the apparent label.

### Cited Findings
- NCEI's GHCN-Daily provides maximum/minimum temperature, precipitation, snowfall, and snow depth, with station metadata and quality/source flags. It is updated daily and reprocessed; near-real-time values may be replaced with archive-quality data 45–60 days later. [NOAA GHCN-Daily](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily)
- NCEI Global Hourly/ISD collects hourly and synoptic observations from more than 20,000 stations; direct HTTPS is recommended for larger downloads. [NOAA Global Hourly/ISD](https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database)
- NCEI Access Data Service can return daily summaries and other datasets as JSON/CSV and other formats. CDO v2 requires a token and documents five requests/second and 10,000/day. [NCEI Access Data Service](https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation); [CDO API](https://www.ncdc.noaa.gov/cdo-web/webservices/v2)
- The NWS API publishes current forecasts, alerts, and observations as open/free data with reasonable, undisclosed rate limits; it is not described as a complete historical forecast-vintage service. NOAA's HRRR page links to archived forecast model output, including a GCP archive since 2014. [NWS API](https://www.weather.gov/documentation/services-web-api); [NOAA HRRR](https://rapidrefresh.noaa.gov/hrrr/)

### Inferences
- For a temperature contract, map its rulebook station, time zone, daily cutoff, units, rounding, and official resolution source exactly. Use historical NWP runs by initialization time as signals, not realized GHCN-Daily values from after the event. Save raw model run identifiers and issued times.
- GHCN-Daily's later archive-ready replacements are valid for a final label when contract rules use corrected official data; the preliminary value may be the right *contemporaneous input*. They must be separate records.

### Gaps
- HRRR grids are large and the exact archive retention, cloud transfer/compute cost, and geographic coverage for a chosen Kalshi weather market need a pilot. NOAA API data access is free in the cited NWS page, but cloud processing/egress may cost money.
- A per-contract settlement station and official preliminary/final revision policy cannot be inferred from generic NOAA documentation.

## Which sports and election sources are usable, and where do rights block them?

### Takeaway
Certified election results are strong labels but arrive after trading. Sports data rights vary sharply: public statistics are not automatically licensed for a prediction-market trading product.

### Cited Findings
- The U.S. House Clerk compiles official presidential and congressional vote totals from state sources, with PDF statistics dating back to 1920. The FEC publishes federal election compilations and points out that state offices certify results and FEC results are not immediate. [House Clerk election statistics](https://clerk.house.gov/Members/ViewElectionInformation); [FEC election results](https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/)
- EAC's Election Administration and Voting Survey covers registration, participation, voting methods, and administration, not candidate vote totals; MIT Election Data and Science Lab offers consolidated county and precinct election returns. These are useful historical covariates/labels, but post-election compilations are not pre-election signals. [EAC EAVS](https://www.eac.gov/news/2025/06/30/us-election-assistance-commission-releases-2024-election-administration-and-voting); [MIT Election Lab data](https://electionlab.mit.edu/data); [MIT precinct project](https://electionlab.mit.edu/articles/inside-2024-precinct-project)
- `nflverse-data` publishes automated NFL schedules, play-by-play, and related releases; its main repository license is CC BY 4.0, while the maintainers identify separately licensed FTN data. Repository licensing does not itself resolve possible upstream league rights. [nflverse data repository](https://github.com/nflverse/nflverse-data); [nflverse license](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md); [nflverse project licensing note](https://github.com/nflverse)
- NBA's published terms limit NBA statistics to news/private noncommercial use and expressly prohibit use with gambling activity; its FAQ says stats are not available for download. Do not use NBA.com statistics as a bot feed without a specific license. [NBA API hub terms](https://api-hub.nba.com/termsofuse); [NBA stats FAQ](https://www.nba.com/stats/help/faq)
- Sportradar provides sports APIs with trial keys, quotas, and separate order-form terms; trials expire. It is a potential licensed route, but production scope and price need a negotiated quote, particularly for prediction-market use. [Sportradar account/trial docs](https://developer.sportradar.com/getting-started/docs/your-account); [Sportradar terms](https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions)

### Inferences
- For elections, use state election-office timestamps/archived snapshots for partial counts, official certified results for labels, and dated polls/forecasts only if licensed. Never use certified final vote share as a pre-election feature.
- NFLverse can support offline baseline research, but freeze dated releases and independently review the rights for commercial/trading deployment. For NBA or other league contracts, budget for licensed feeds or limit the bot's supported categories.

### Gaps
- No single official, open, machine-readable, nationwide timestamped election-night returns archive was confirmed; state-by-state collection and revision tracking may be necessary.
- Public, betting-permitted sports feed pricing and license terms cannot be stated generically; request a written vendor quote for exact leagues, granularity, latency, historical access, and permitted prediction-market use.

## Which news/event archives and forecasting research can replace qualitative context?

### Takeaway
GDELT and Media Cloud can provide dated news/event discovery and baseline context; neither is a turnkey causal probability model. ForecastBench is useful for measuring forecasting methods, while Metaculus data currently present substantial permission barriers.

### Cited Findings
- GDELT offers free/open raw event and Global Knowledge Graph files; GDELT 2.0 updates at 15-minute cadence and includes machine-coded event/mention records. Its analysis service page states that the service currently searches GDELT 1.0, so use raw 2.0 files or supported query paths for exact replay. [GDELT data access](https://gdeltproject.org/data.html); [GDELT 2.0 description](https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/)
- Media Cloud is an open news archive collected mostly from RSS/sitemaps; coverage starts when it begins collecting each source. It can export story URLs and aggregate analysis, but not full text because of copyright. [Media Cloud FAQ](https://www.mediacloud.org/documentation/faqs); [Media Cloud search API](https://www.mediacloud.org/documentation/search-api-guide)
- Common Crawl provides free HTTP downloads of web crawl files, with large-scale processing possible on AWS. Crawl capture time is not the same as article publication or first public availability. [Common Crawl getting started](https://commoncrawl.org/get-started)
- ForecastBench is a dynamic benchmark with regularly refreshed questions and human comparisons. Its code is MIT-licensed, while the separate nightly datasets repository is CC BY-SA 4.0. Its future-event question construction is specifically intended to avoid answer leakage at submission time. [ForecastBench research](https://forecastingresearch.org/research/forecastbench-a-dynamic-benchmark-of-ai-forecasting-capabilities); [ForecastBench code](https://github.com/forecastingresearch/forecastbench); [ForecastBench datasets/license](https://github.com/forecastingresearch/forecastbench-datasets)
- Metaculus's official API documents authenticated access and restricts question text, resolutions, and aggregate histories by account/project. It states that model training/evaluation/development needs prior written permission and commercial use needs a separate agreement. [Metaculus API](https://www.metaculus.com/api/); [Metaculus terms](https://www.metaculus.com/terms-of-use/)

### Inferences
- For news replay, preserve *first observed at*, source publication timestamp, crawl/update timestamp, original URL, headline/metadata, and immutable raw record hash. Filter on first observed time to avoid using later enriched metadata or revised article text. Code/measurement artifacts and content licenses are separate.
- ForecastBench is a calibration/evaluation harness and potential public benchmark, not a Kalshi-specific substitute for market-specific evidence. Compare against market-implied probability and simple category/base-rate models before adding LLM reports.

### Gaps
- GDELT's event extraction errors, source bias, retroactive record changes, and licensing of linked publisher text need source-specific validation; a free event table does not grant article-text rights.
- I did not confirm a general license for turning Media Cloud or Common Crawl publisher material into a commercial trading feature store. Use metadata/links and review each underlying publisher's terms.

## What storage and backtesting frameworks fit the existing Bun/TypeScript bot?

### Takeaway
Keep SQLite as the operational ledger and use Parquet plus DuckDB for immutable bulk historical research. A small event-driven replay in TypeScript is likely a closer fit than importing an equity-oriented Python/C# engine, but external frameworks are useful for cross-checking calculations.

### Cited Findings
- DuckDB reads and writes compressed columnar Parquet, with filter and projection pushdown, and can query files directly. DuckDB is MIT-licensed; Apache Parquet is an open column-oriented file format. [DuckDB Parquet docs](https://duckdb.org/docs/stable/data/parquet/overview); [DuckDB repository/license](https://github.com/duckdb/duckdb); [Apache Parquet](https://parquet.apache.org/)
- SQLite is public-domain software and WAL permits concurrent readers with a writer, but its WAL requires processes on the same host and is unsuitable for network filesystems. [SQLite copyright](https://www.sqlite.org/copyright.html); [SQLite WAL](https://www.sqlite.org/wal.html)
- QuantConnect LEAN is an Apache-2.0 open-source C#/Python trading engine; Zipline Reloaded is Apache-2.0 Python. Both would need custom Kalshi binary-contract data, settlement, fees, and exchange adapters. [LEAN repository](https://github.com/QuantConnect/Lean); [Zipline Reloaded package](https://github.com/stefan-jansen/zipline-reloaded/blob/main/pyproject.toml)
- Backtrader is GPL-3.0; Backtesting.py is AGPL-3.0; vectorbt's open repository uses Apache 2.0 with Commons Clause, which restricts selling a product primarily comprising it. These are research options, not interchangeable permissive dependencies. [Backtrader repository](https://github.com/mementum/backtrader); [Backtesting.py package/license](https://github.com/kernc/backtesting.py/blob/master/setup.py); [vectorbt license note](https://github.com/polakowo/vectorbt/blob/master/README.md)

### Inferences
- Suggested schema: immutable `source_observation(source, series_or_station, reference_time, published_at, first_seen_at, vintage, value, raw_hash, rights_tag)`, `market_snapshot(ticker, observed_at, rules_hash, bid, ask, sizes, status)`, `prediction(model_version, decision_at, ticker, probability, evidence_ids)`, `sim_order/fill`, and `resolution`. Never overwrite a source vintage or mutate earlier model inputs.
- Partition Parquet by source/year (and perhaps series/category), use DuckDB for feature joins and scorecards, and keep SQLite for live order/risk/paper-state transactions. A Bun replay engine should consume the same decision/risk code as live mode, with clock and exchange interfaces injected.
- Evaluate Brier/log loss and calibration against contemporaneous market prices; separately evaluate net P&L, fill rate, spread/fees, drawdown, and capacity. Use walk-forward splits by decision date, grouping related contracts/events to prevent leakage across a ladder.

### Gaps
- DuckDB's current Bun/Node integration support and deployment packaging should be prototyped before choosing an in-process dependency. Parquet/DuckDB eliminate neither source licensing nor point-in-time mistakes.
- None of the listed general-purpose frameworks natively validates Kalshi's binary settlement rules or historical execution assumptions; adapter effort and license implications need a small proof of concept.
