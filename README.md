# Drift V2 Exporter

Collect and export metrics from Drift V2 to Prometheus. This is the same codebase that powers
the metrics at https://metrics.drift.trade

This is a node.js server that exposes a `/metrics` endpoint serving Prometheus metrics. It
periodically scrapes market metrics from the on chain Drift V2 program via the [drift sdk](https://www.npmjs.com/package/@drift-labs/sdk).

You will require a reliable RPC source since some metrics involve fetching all the
users and their open orders / positions.

Main programs hit:
* Drift v2 program: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`

# Development

Developed using Node v20.12.2

First set environment variables in a `.env` file.

| Variable       | Description                                              |
|----------------|----------------------------------------------------------|
| `ENDPOINT`     | A RPC-http URL                                           |
| `WS_ENDPOINT`  | (optional) A specific RPC-websocket URL                  |
| `ENV`          | (default: `mainnet-beta`) The Drift environment to use   |
| `METRICS_PORT` | (default: `9464`)The port to serve Prometheus metrics on |

```
yarn
yarn run dev
```
