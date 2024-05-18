import { Meter } from '@opentelemetry/api-metrics';
import {
	ExplicitBucketHistogramAggregation,
	MeterProvider,
	View,
} from '@opentelemetry/sdk-metrics-base';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { logger } from './logger';
import { PublicKey } from '@solana/web3.js';
import { UserAccount } from '@drift-labs/sdk';
import {
	BatchObservableResult,
	Attributes,
	ObservableGauge,
	Histogram,
	Counter,
} from '@opentelemetry/api';

export type RuntimeSpec = {
	rpcEndpoint: string;
	driftEnv: string;
	commit: string;
	driftPid: string;
	walletAuthority: string;
};

export function metricAttrFromUserAccount(
	userAccountKey?: PublicKey,
	ua?: UserAccount,
	userName?: string,
	market?: string,
	venue?: string
): any {
	return {
		subaccount_id: ua?.subAccountId,
		public_key: userAccountKey?.toBase58(),
		authority: ua?.authority.toBase58(),
		delegate: ua?.delegate.toBase58(),
		userName,
		market,
		venue,
	};
}

/**
 * Creates {count} buckets of size {increment} starting from {start}. Each bucket stores the count of values within its "size".
 * @param start
 * @param increment
 * @param count
 * @returns
 */
export function createHistogramBuckets(
	start: number,
	increment: number,
	count: number
) {
	return new ExplicitBucketHistogramAggregation(
		Array.from(new Array(count), (_, i) => start + i * increment)
	);
}

export class GaugeValue {
	private latestGaugeValues: Map<Attributes, number>;
	private gauge: ObservableGauge;

	constructor(gauge: ObservableGauge) {
		this.gauge = gauge;
		this.latestGaugeValues = new Map<Attributes, number>();
	}

	setLatestValue(value: number, attributes: Attributes) {
		this.latestGaugeValues.set(attributes, value);
	}

	getLatestValue(attributes: Attributes): number | undefined {
		return this.latestGaugeValues.get(attributes);
	}

	getGauge(): ObservableGauge {
		return this.gauge;
	}

	entries(): IterableIterator<[Attributes, number]> {
		return this.latestGaugeValues.entries();
	}
}

export class HistogramValue {
	private histogram: Histogram;
	constructor(histogram: Histogram) {
		this.histogram = histogram;
	}

	record(value: number, attributes: Attributes) {
		this.histogram.record(value, attributes);
	}
}

export class CounterValue {
	private counter: Counter;
	constructor(counter: Counter) {
		this.counter = counter;
	}

	add(value: number, attributes: Attributes) {
		this.counter.add(value, attributes);
	}
}

export class Metrics {
	private exporter: PrometheusExporter;
	private meterProvider: MeterProvider;
	private meters: Map<string, Meter>;
	private gauges: Array<GaugeValue>;

	constructor(meterName?: string, views?: Array<View>, metricsPort?: number) {
		const { endpoint: defaultEndpoint, port: defaultPort } =
			PrometheusExporter.DEFAULT_OPTIONS;
		const port = metricsPort ?? defaultPort;
		this.exporter = new PrometheusExporter(
			{
				port: port,
				endpoint: defaultEndpoint,
			},
			() => {
				logger.info(
					`prometheus scrape endpoint started: http://localhost:${port}${defaultEndpoint}`
				);
			}
		);

		this.meterProvider = new MeterProvider({ views });
		this.meterProvider.addMetricReader(this.exporter);
		this.gauges = new Array<GaugeValue>();
		this.meters = new Map<string, Meter>();
		if (meterName) {
			this.getMeter(meterName);
		}
	}

	getMeter(name: string): Meter {
		if (this.meters.has(name)) {
			return this.meters.get(name) as Meter;
		} else {
			const meter = this.meterProvider.getMeter(name);
			this.meters.set(name, meter);
			return meter;
		}
	}

	addGauge(
		meterName: string,
		metricName: string,
		description: string
	): GaugeValue {
		const meter = this.getMeter(meterName);
		const newGauge = meter.createObservableGauge(metricName, {
			description: description,
		});
		const gauge = new GaugeValue(newGauge);
		this.gauges.push(gauge);
		return gauge;
	}

	addHistogram(
		meterName: string,
		metricName: string,
		description: string
	): HistogramValue {
		const meter = this.getMeter(meterName);
		return new HistogramValue(
			meter.createHistogram(metricName, {
				description: description,
			})
		);
	}

	addCounter(
		meterName: string,
		metricName: string,
		description: string
	): CounterValue {
		const meter = this.getMeter(meterName);
		return new CounterValue(
			meter.createCounter(metricName, {
				description: description,
			})
		);
	}

	finalizeObservables() {
		for (const meter of this.meters.values()) {
			meter.addBatchObservableCallback(
				(observerResult: BatchObservableResult) => {
					for (const gauge of this.gauges) {
						for (const [attributes, value] of gauge.entries()) {
							observerResult.observe(gauge.getGauge(), value, attributes);
						}
					}
				},
				this.gauges.map((gauge) => gauge.getGauge())
			);
		}
	}
}
