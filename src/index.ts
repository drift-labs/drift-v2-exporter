import {
	AMM_RESERVE_PRECISION,
	BASE_PRECISION,
	BN,
	convertToNumber,
	DRIFT_PROGRAM_ID,
	DriftClient,
	DriftEnv,
	FUNDING_RATE_PRECISION,
	getSignedTokenAmount,
	getTokenAmount,
	MARGIN_PRECISION,
	OraclePriceData,
	PEG_PRECISION,
	PEG_PRECISION_EXP,
	PERCENTAGE_PRECISION,
	PerpMarkets,
	PRICE_PRECISION,
	QUOTE_PRECISION,
	QUOTE_PRECISION_EXP,
	SPOT_MARKET_WEIGHT_PRECISION,
	SpotBalanceType,
	SpotMarkets,
	TEN,
	Wallet,
} from '@drift-labs/sdk';
import { Commitment, Connection, Keypair } from '@solana/web3.js';
import { logger } from './logger';
import { Metrics } from './metrics';
import { program } from 'commander';

program
	.option('-d, --dlob', 'Include dlob metrics')
	.option(
		'-u, --update-interval <update-interval>',
		'Update interval in milliseconds',
		'15000'
	)
	.parse();

const opts = program.opts();

const stateCommitment: Commitment = 'confirmed';

const endpoint = process.env.ENDPOINT;
const wsEndpoint = process.env.WS_ENDPOINT;
const metricsPort = Number(process.env.METRICS_PORT ?? '9464');
const metricsUpdateIntervalMs = Number(opts.updateInterval);
const driftEnv = (process.env.ENV ?? 'mainnet-beta') as DriftEnv;

logger.info(`RPC endpoint: ${endpoint}`);
logger.info(`WS endpoint:  ${wsEndpoint}`);
logger.info(`DriftEnv:     ${driftEnv}`);
logger.info(`Prometheus metrics port: ${metricsPort}`);
logger.info(`MetricsUpdateInterval: ${metricsUpdateIntervalMs}`);

if (!endpoint) {
	throw new Error('ENDPOINT is not set');
}

const main = async () => {
	/**
	 * Initialize metrics
	 */

	const metricsMeterName = 'drift-v2';
	const metrics = new Metrics(metricsMeterName, [], metricsPort);

	/// dlob metrics
	const dlobBidPrice = opts.dlob
		? metrics.addGauge(metricsMeterName, 'dlob_bid_price', 'DLOB bid price')
		: null;
	const dlobAskPrice = opts.dlob
		? metrics.addGauge(metricsMeterName, 'dlob_ask_price', 'DLOB ask price')
		: null;
	const dlobBids = opts.dlob
		? metrics.addGauge(metricsMeterName, 'dlob_bids', 'count of DLOB bids')
		: null;
	const dlobAsks = opts.dlob
		? metrics.addGauge(metricsMeterName, 'dlob_asks', 'count of DLOB asks')
		: null;
	const dlobBidLiquidity = opts.dlob
		? metrics.addGauge(
				metricsMeterName,
				'dlob_bid_liquidity',
				'DLOB bid liquidity'
		  )
		: null;
	const dlobAskLiquidity = opts.dlob
		? metrics.addGauge(
				metricsMeterName,
				'dlob_ask_liquidity',
				'DLOB ask liquidity'
		  )
		: null;

	/// drift state account
	const stateAccountExchangeStatus = metrics.addGauge(
		metricsMeterName,
		'state_account_exchange_status',
		'State account exchange status'
	);
	const stateAccountOracleGuardRailsPriceDivergenceMarketOraclePercent =
		metrics.addGauge(
			metricsMeterName,
			'state_account_oracle_guard_rails_price_divergence_market_oracle_percent',
			'State account oracle guard rails price divergence market oracle percent'
		);
	const stateAccountOracleGuardRailsPriceDivergenceOracleTwap5Min =
		metrics.addGauge(
			metricsMeterName,
			'state_account_oracle_guard_rails_price_divergence_oracle_twap_5min',
			'State account oracle guard rails price divergence oracle 5min TWAP'
		);
	const stateAccountOracleGuardRailsValiditySlotsBeforeStaleForAmm =
		metrics.addGauge(
			metricsMeterName,
			'state_account_oracle_guard_rails_validity_slots_before_stale_for_amm',
			'State account oracle guard rails validity slots before stale for AMM'
		);
	const stateAccountOracleGuardRailsValiditySlotsBeforeStaleForMargin =
		metrics.addGauge(
			metricsMeterName,
			'state_account_oracle_guard_rails_validity_slots_before_stale_for_margin',
			'State account oracle guard rails validity slots before stale for margin'
		);
	const stateAccountOracleGuardRailsValidityConfidenceIntervalMaxSize =
		metrics.addGauge(
			metricsMeterName,
			'state_account_oracle_guard_rails_validity_confidence_interval_max_size',
			'State account oracle guard rails validity confidence interval max size'
		);
	const stateAccountOracleGuardRailsValidityTooVolatileRatio = metrics.addGauge(
		metricsMeterName,
		'state_account_oracle_guard_rails_validity_too_volatile_ratio',
		'State account oracle guard rails validity too volatile ratio'
	);
	const stateAccountNumberOfAuthorities = metrics.addGauge(
		metricsMeterName,
		'state_account_number_of_authorities',
		'State account number of authorities'
	);
	const stateAccountNumberOfSubaccounts = metrics.addGauge(
		metricsMeterName,
		'state_account_number_of_subaccounts',
		'State account number of subaccounts'
	);
	const stateAccountNumberOfMarkets = metrics.addGauge(
		metricsMeterName,
		'state_account_number_of_markets',
		'State account number of markets'
	);
	const stateAccountNumberOfSpotMarkets = metrics.addGauge(
		metricsMeterName,
		'state_account_number_of_spot_markets',
		'State account number of spot markets'
	);
	const stateAccountMinPerpAuctionDuration = metrics.addGauge(
		metricsMeterName,
		'state_account_min_perp_auction_duration',
		'State account min perp auction duration'
	);
	const stateAccountDefaultMarketOrderTimeInForce = metrics.addGauge(
		metricsMeterName,
		'state_account_default_market_order_time_in_force',
		'State account default market order time in force'
	);
	const stateAccountDefaultSpotAuctionDuration = metrics.addGauge(
		metricsMeterName,
		'state_account_default_spot_auction_duration',
		'State account default spot auction duration'
	);
	const stateAccountLiquidationMarginBufferRatio = metrics.addGauge(
		metricsMeterName,
		'state_account_liquidation_margin_buffer_ratio',
		'State account liquidation margin buffer ratio'
	);
	const stateAccountSettlementDuration = metrics.addGauge(
		metricsMeterName,
		'state_account_settlement_duration',
		'State account settlement duration'
	);
	const stateAccountMaxNumberOfSubaccounts = metrics.addGauge(
		metricsMeterName,
		'state_account_max_number_of_subaccounts',
		'State account max number of subaccounts'
	);
	const stateAccountInitialPctToLiquidate = metrics.addGauge(
		metricsMeterName,
		'state_account_initial_pct_to_liquidate',
		'State account initial pct to liquidate'
	);
	const stateAccountLiquidationDuration = metrics.addGauge(
		metricsMeterName,
		'state_account_liquidation_duration',
		'State account liquidation duration'
	);
	const stateAccountMaxInitializeUserFee = metrics.addGauge(
		metricsMeterName,
		'state_account_max_initialize_user_fee',
		'State account max initialize user fee'
	);

	/// perp market accounts
	const perpMarketExpiryTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_expiry_ts',
		'Perp market expiry timestamp'
	);
	const perpMarketExpiryPrice = metrics.addGauge(
		metricsMeterName,
		'perp_market_expiry_price',
		'Perp market expiry price'
	);

	const perpMarketAmmBaseAssetReserve = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_reserve',
		'Perp market AMM base asset reserve'
	);
	const perpMarketAmmSqrtK = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_sqrt_k',
		'Perp market AMM sqrt K'
	);
	const perpMarketAmmCumulativeFundingRate = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_cumulative_funding_rate',
		'Perp market AMM cumulative funding rate'
	);
	const perpMarketAmmLastFundingRate = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_funding_rate',
		'Perp market AMM last funding rate'
	);
	const perpMarketAmmLastFundingRateTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_funding_rate_ts',
		'Perp market AMM last funding rate timestamp'
	);
	const perpMarketAmmLastMarkPriceTwap = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_mark_price_twap',
		'Perp market AMM last mark price TWAP'
	);
	const perpMarketAmmLastMarkPriceTwap5Min = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_mark_price_twap_5min',
		'Perp market AMM last mark price 5min TWAP'
	);
	const perpMarketAmmLastMarkPriceTwapTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_mark_price_twap_ts',
		'Perp market AMM last mark price TWAP timestamp'
	);
	const perpMarketAmmLastTradeTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_trade_ts',
		'Perp market AMM last trade timestamp'
	);

	const perpMarketAmmHistoricalOracleDataPrice = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_price',
		'Perp market AMM historical oracle data price'
	);
	const perpMarketAmmHistoricalOracleDataDelay = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_delay',
		'Perp market AMM historical oracle data delay'
	);
	const perpMarketAmmHistoricalOracleDataConf = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_conf',
		'Perp market AMM historical oracle data conf'
	);
	const perpMarketAmmHistoricalOracleDataPriceTwap = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_price_twap',
		'Perp market AMM historical oracle data price TWAP'
	);
	const perpMarketAmmHistoricalOracleDataPriceTwap5Min = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_price_twap_5min',
		'Perp market AMM historical oracle data price 5min TWAP'
	);
	const perpMarketAmmHistoricalOracleDataPriceTwapTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_historical_oracle_data_price_twap_ts',
		'Perp market AMM historical oracle data price TWAP timestamp'
	);

	const perpMarketAmmLastOracleReservePriceSpreadPct = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_oracle_reserve_price_spread_pct',
		'Perp market AMM last oracle reserve price spread percentage'
	);
	const perpMarketAmmLastOracleConfPct = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_oracle_conf_pct',
		'Perp market AMM last oracle conf percentage'
	);

	const perpMarketAmmFundingPeriod = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_funding_period',
		'Perp market AMM funding period'
	);
	const perpMarketAmmQuoteAssetReserve = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_asset_reserve',
		'Perp market AMM quote asset reserve'
	);
	const perpMarketAmmPegMultiplier = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_peg_multiplier',
		'Perp market AMM peg multiplier'
	);
	const perpMarketAmmCumulativeFundingRateLong = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_cumulative_funding_rate_long',
		'Perp market AMM cumulative funding rate long'
	);
	const perpMarketAmmCumulativeFundingRateShort = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_cumulative_funding_rate_short',
		'Perp market AMM cumulative funding rate short'
	);
	const perpMarketAmmLast24HAvgFundingRate = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_24h_avg_funding_rate',
		'Perp market AMM last 24h average funding rate'
	);
	const perpMarketAmmLastFundingRateShort = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_funding_rate_short',
		'Perp market AMM last funding rate short'
	);
	const perpMarketAmmLastFundingRateLong = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_funding_rate_long',
		'Perp market AMM last funding rate long'
	);

	const perpMarketAmmTotalLiquidationFee = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_liquidation_fee',
		'Perp market AMM total liquidation fee'
	);
	const perpMarketAmmTotalFeeMinusDistributions = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_fee_minus_distributions',
		'Perp market AMM total fee minus distributions'
	);
	const perpMarketAmmTotalFeeWithdrawn = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_fee_withdrawn',
		'Perp market AMM total fee withdrawn'
	);
	const perpMarketAmmTotalFee = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_fee',
		'Perp market AMM total fee'
	);
	const perpMarketAmmTotalFeeEarnedPerLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_fee_earned_per_lp',
		'Perp market AMM total fee earned per LP'
	);
	const perpMarketAmmUserLpShares = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_user_lp_shares',
		'Perp market AMM user LP shares'
	);
	const perpMarketAmmBaseAssetAmountWithUnsettledLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_amount_with_unsettled_lp',
		'Perp market AMM base asset amount with unsettled LP'
	);
	const perpMarketAmmOrderStepSize = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_order_step_size',
		'Perp market AMM order step size'
	);
	const perpMarketAmmOrderTickSize = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_order_tick_size',
		'Perp market AMM order tick size'
	);
	const perpMarketAmmMaxFillReserveFraction = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_fill_reserve_fraction',
		'Perp market AMM max fill reserve fraction'
	);
	const perpMarketAmmMaxSlippageRatio = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_slippage_ratio',
		'Perp market AMM max slippage ratio'
	);
	const perpMarketAmmBaseSpread = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_spread',
		'Perp market AMM base spread'
	);
	const perpMarketAmmCurveUpdateIntensity = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_curve_update_intensity',
		'Perp market AMM curve update intensity'
	);
	const perpMarketAmmBaseAssetAmountWithAmm = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_amount_with_amm',
		'Perp market AMM base asset amount with AMM'
	);
	const perpMarketAmmBaseAssetAmountLong = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_amount_long',
		'Perp market AMM base asset amount long'
	);
	const perpMarketAmmBaseAssetAmountShort = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_amount_short',
		'Perp market AMM base asset amount short'
	);
	const perpMarketAmmQuoteAssetAmount = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_asset_amount',
		'Perp market AMM quote asset amount'
	);
	const perpMarketAmmTerminalQuoteAssetReserve = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_terminal_quote_asset_reserve',
		'Perp market AMM terminal quote asset reserve'
	);
	const perpMarketAmmConcentrationCoef = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_concentration_coef',
		'Perp market AMM concentration coefficient'
	);
	const perpMarketAmmFeePool = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_fee_pool',
		'Perp market AMM fee pool'
	);
	const perpMarketAmmTotalExchangeFee = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_exchange_fee',
		'Perp market AMM total exchange fee'
	);
	const perpMarketAmmTotalMmFee = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_mm_fee',
		'Perp market AMM total MM fee'
	);
	const perpMarketAmmNetRevenueSinceLastFunding = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_net_revenue_since_last_funding',
		'Perp market AMM net revenue since last funding'
	);
	const perpMarketAmmLastUpdateSlot = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_update_slot',
		'Perp market AMM last update slot'
	);
	const perpMarketAmmLastOracleNormalisedPrice = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_oracle_normalised_price',
		'Perp market AMM last oracle normalised price'
	);
	const perpMarketAmmLastOracleValid = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_oracle_valid',
		'Perp market AMM last oracle valid'
	);
	const perpMarketAmmLastBidPriceTwap = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_bid_price_twap',
		'Perp market AMM last bid price TWAP'
	);
	const perpMarketAmmLastAskPriceTwap = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_last_ask_price_twap',
		'Perp market AMM last ask price TWAP'
	);
	const perpMarketAmmLongSpread = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_long_spread',
		'Perp market AMM long spread'
	);
	const perpMarketAmmShortSpread = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_short_spread',
		'Perp market AMM short spread'
	);
	const perpMarketAmmMaxSpread = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_spread',
		'Perp market AMM max spread'
	);

	const perpMarketAmmBaseAssetAmountPerLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_base_asset_amount_per_lp',
		'Perp market AMM base asset amount per LP'
	);
	const perpMarketAmmQuoteAssetAmountPerLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_asset_amount_per_lp',
		'Perp market AMM quote asset amount per LP'
	);
	const perpMarketAmmTargetBaseAssetAmountPerLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_target_base_asset_amount_per_lp',
		'Perp market AMM target base asset amount per LP'
	);

	const perpMarketAmmAmmJitIntensity = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_amm_jit_intensity',
		'Perp market AMM JIT intensity'
	);
	const perpMarketAmmMaxOpenInterest = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_open_interest',
		'Perp market AMM max open interest'
	);
	const perpMarketAmmMaxBaseAssetReserve = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_base_asset_reserve',
		'Perp market AMM max base asset reserve'
	);
	const perpMarketAmmMinBaseAssetReserve = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_min_base_asset_reserve',
		'Perp market AMM min base asset reserve'
	);
	const perpMarketAmmTotalSocialLoss = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_total_social_loss',
		'Perp market AMM total social loss'
	);

	const perpMarketAmmQuoteBreakEvenAmountLong = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_break_even_amount_long',
		'Perp market AMM quote break even amount long'
	);
	const perpMarketAmmQuoteBreakEvenAmountShort = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_break_even_amount_short',
		'Perp market AMM quote break even amount short'
	);
	const perpMarketAmmQuoteEntryAmountLong = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_entry_amount_long',
		'Perp market AMM quote entry amount long'
	);
	const perpMarketAmmQuoteEntryAmountShort = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_entry_amount_short',
		'Perp market AMM quote entry amount short'
	);

	const perpMarketAmmMarkStd = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_mark_std',
		'Perp market AMM mark std'
	);
	const perpMarketAmmOracleStd = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_oracle_std',
		'Perp market AMM oracle std'
	);
	const perpMarketAmmLongIntensityCount = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_long_intensity_count',
		'Perp market AMM long intensity count'
	);
	const perpMarketAmmLongIntensityVolume = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_long_intensity_volume',
		'Perp market AMM long intensity volume'
	);
	const perpMarketAmmShortIntensityCount = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_short_intensity_count',
		'Perp market AMM short intensity count'
	);
	const perpMarketAmmShortIntensityVolume = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_short_intensity_volume',
		'Perp market AMM short intensity volume'
	);
	const perpMarketAmmVolume24H = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_volume_24h',
		'Perp market AMM 24h volume'
	);
	const perpMarketAmmMinOrderSize = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_min_order_size',
		'Perp market AMM min order size'
	);
	const perpMarketAmmMaxPositionSize = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_max_position_size',
		'Perp market AMM max position size'
	);

	const perpMarketAmmPerLpBase = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_per_lp_base',
		'Perp market AMM per LP base'
	);
	const perpMarketAmmNetUnsettledFundingPnl = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_net_unsettled_funding_pnl',
		'Perp market AMM net unsettled funding PnL'
	);
	const perpMarketAmmQuoteAssetAmountWithUnsettledLp = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_quote_asset_amount_with_unsettled_lp',
		'Perp market AMM quote asset amount with settled LP'
	);
	const perpMarketAmmReferencePriceOffset = metrics.addGauge(
		metricsMeterName,
		'perp_market_amm_reference_price_offset',
		'Perp market AMM reference price offset'
	);

	const perpMarketNumberOfUsersWithBaseGauge = metrics.addGauge(
		metricsMeterName,
		'perp_market_number_of_users_with_base',
		'Number of users with base'
	);
	const perpMarketNumberOfUsers = metrics.addGauge(
		metricsMeterName,
		'perp_market_number_of_users',
		'Number of users'
	);
	const perpMarketMarginRatioInitial = metrics.addGauge(
		metricsMeterName,
		'perp_market_margin_ratio_initial',
		'Initial margin ratio'
	);
	const perpMarketMarginRatioMaintenance = metrics.addGauge(
		metricsMeterName,
		'perp_market_margin_ratio_maintenance',
		'Maintenance margin ratio'
	);
	const perpMarketNextFillRecordId = metrics.addGauge(
		metricsMeterName,
		'perp_market_next_fill_record_id',
		'Next fill record id'
	);
	const perpMarketNextFundingRateRecordId = metrics.addGauge(
		metricsMeterName,
		'perp_market_next_funding_rate_record_id',
		'Next funding rate record id'
	);
	const perpMarketNextCurveRecordId = metrics.addGauge(
		metricsMeterName,
		'perp_market_next_curve_record_id',
		'Next curve record id'
	);
	const perpMarketPnlPoolScaledBalance = metrics.addGauge(
		metricsMeterName,
		'perp_market_pnl_pool_scaled_balance',
		'PnL pool scaled balance'
	);
	const perpMarketLiquidatorFee = metrics.addGauge(
		metricsMeterName,
		'perp_market_liquidator_fee',
		'Liquidator fee'
	);
	const perpMarketImfFactor = metrics.addGauge(
		metricsMeterName,
		'perp_market_imf_factor',
		'IMF factor'
	);
	const perpMarketUnrealizedPnlImfFactor = metrics.addGauge(
		metricsMeterName,
		'perp_market_unrealized_pnl_imf_factor',
		'Unrealized PnL IMF factor'
	);
	const perpMarketUnrealizedPnlMaxImbalance = metrics.addGauge(
		metricsMeterName,
		'perp_market_unrealized_pnl_max_imbalance',
		'Unrealized PnL max imbalance'
	);
	const perpMarketUnrealizedPnlInitialAssetWeight = metrics.addGauge(
		metricsMeterName,
		'perp_market_unrealized_pnl_initial_asset_weight',
		'Unrealized PnL initial asset weight'
	);
	const perpMarketUnrealizedPnlMaintenanceAssetWeight = metrics.addGauge(
		metricsMeterName,
		'perp_market_unrealized_pnl_maintenance_asset_weight',
		'Unrealized PnL maintenance asset weight'
	);
	const perpMarketInsuranceClaimRevenueWithdrawSinceLastSettle =
		metrics.addGauge(
			metricsMeterName,
			'perp_market_insurance_claim_revenue_withdraw_since_last_settle',
			'Insurance claim revenue withdraw since last settle'
		);
	const perpMarketInsuranceClaimMaxRevenueWithdrawPerPeriod = metrics.addGauge(
		metricsMeterName,
		'perp_market_insurance_claim_max_revenue_withdraw_per_period',
		'Insurance claim max revenue withdraw per period'
	);
	const perpMarketInsuranceClaimLastRevenueWithdrawTs = metrics.addGauge(
		metricsMeterName,
		'perp_market_insurance_claim_last_revenue_withdraw_ts',
		'Insurance claim last revenue withdraw timestamp'
	);
	const perpMarketInsuranceClaimQuoteSettledInsurance = metrics.addGauge(
		metricsMeterName,
		'perp_market_insurance_claim_quote_settled_insurance',
		'Insurance claim quote settled insurance'
	);
	const perpMarketInsuranceClaimQuoteMaxInsurance = metrics.addGauge(
		metricsMeterName,
		'perp_market_insurance_claim_quote_max_insurance',
		'Insurance claim quote max insurance'
	);
	const perpMarketFeeAdjustment = metrics.addGauge(
		metricsMeterName,
		'perp_market_fee_adjustment',
		'Fee adjustment'
	);
	const perpMarketPausedOperations = metrics.addGauge(
		metricsMeterName,
		'perp_market_paused_operations',
		'Paused operations'
	);

	/// spot market accounts
	const spotMarketHistoricalOracleDataPrice = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_price',
		'Spot market historical oracle data price'
	);
	const spotMarketHistoricalOracleDataDelay = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_delay',
		'Spot market historical oracle data delay'
	);
	const spotMarketHistoricalOracleDataConf = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_conf',
		'Spot market historical oracle data conf'
	);
	const spotMarketHistoricalOracleDataPriceTwap = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_price_twap',
		'Spot market historical oracle data price TWAP'
	);
	const spotMarketHistoricalOracleDataPriceTwap5Min = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_price_twap_5min',
		'Spot market historical oracle data price 5min TWAP'
	);
	const spotMarketHistoricalOracleDataPriceTwapTs = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_oracle_data_price_twap_ts',
		'Spot market historical oracle data price TWAP timestamp'
	);

	const spotMarketHistoricalIndexDataBidPrice = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_index_data_bid_price',
		'Spot market historical index data bid price'
	);
	const spotMarketHistoricalIndexDataAskPrice = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_index_data_ask_price',
		'Spot market historical index data ask price'
	);
	const spotMarketHistoricalIndexDataPriceTwap = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_index_data_price_twap',
		'Spot market historical index data price TWAP'
	);
	const spotMarketHistoricalIndexDataPriceTwap5Min = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_index_data_price_twap_5min',
		'Spot market historical index data price 5min TWAP'
	);
	const spotMarketHistoricalIndexDataPriceTwapTs = metrics.addGauge(
		metricsMeterName,
		'spot_market_historical_index_data_price_twap_ts',
		'Spot market historical index data price TWAP timestamp'
	);

	const spotMarketInsuranceFundTotalShares = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_total_shares',
		'Spot market insurance fund total shares'
	);
	const spotMarketInsuranceFundUserShares = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_user_shares',
		'Spot market insurance fund user shares'
	);
	const spotMarketInsuranceFundSharesBase = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_shares_base',
		'Spot market insurance fund shares base'
	);
	const spotMarketInsuranceFundUnstakingPeriod = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_unstaking_period',
		'Spot market insurance fund unstaking period'
	);
	const spotMarketInsuranceFundLastRevenueSettleTs = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_last_revenue_settle_ts',
		'Spot market insurance fund last revenue settle timestamp'
	);
	const spotMarketInsuranceFundRevenueSettlePeriod = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_revenue_settle_period',
		'Spot market insurance fund revenue settle period'
	);
	const spotMarketInsuranceFundTotalFactor = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_total_factor',
		'Spot market insurance fund total factor'
	);
	const spotMarketInsuranceFundUserFactor = metrics.addGauge(
		metricsMeterName,
		'spot_market_insurance_fund_user_factor',
		'Spot market insurance fund user factor'
	);

	const spotMarketRevenuePool = metrics.addGauge(
		metricsMeterName,
		'spot_market_revenue_pool',
		'Spot market revenue pool'
	);

	const spotMarketIfLiquidationFee = metrics.addGauge(
		metricsMeterName,
		'spot_market_if_liquidation_fee',
		'Spot market insurance fund liquidation fee'
	);

	const spotMarketDecimals = metrics.addGauge(
		metricsMeterName,
		'spot_market_decimals',
		'Spot market decimals'
	);
	const spotMarketOptimalUtilization = metrics.addGauge(
		metricsMeterName,
		'spot_market_optimal_utilization',
		'Spot market optimal utilization'
	);
	const spotMarketOptimalBorrowRate = metrics.addGauge(
		metricsMeterName,
		'spot_market_optimal_borrow_rate',
		'Spot market optimal borrow rate'
	);
	const spotMarketMaxBorrowRate = metrics.addGauge(
		metricsMeterName,
		'spot_market_max_borrow_rate',
		'Spot market max borrow rate'
	);
	const spotMarketCumulativeDepositInterest = metrics.addGauge(
		metricsMeterName,
		'spot_market_cumulative_deposit_interest',
		'Spot market cumulative deposit interest'
	);
	const spotMarketCumulativeBorrowInterest = metrics.addGauge(
		metricsMeterName,
		'spot_market_cumulative_borrow_interest',
		'Spot market cumulative borrow interest'
	);
	const spotMarketTotalSocialLoss = metrics.addGauge(
		metricsMeterName,
		'spot_market_total_social_loss',
		'Spot market total social loss'
	);
	const spotMarketTotalQuoteSocialLoss = metrics.addGauge(
		metricsMeterName,
		'spot_market_total_quote_social_loss',
		'Spot market total quote social loss'
	);
	const spotMarketDepositBalance = metrics.addGauge(
		metricsMeterName,
		'spot_market_deposit_balance',
		'Spot market deposit balance'
	);
	const spotMarketBorrowBalance = metrics.addGauge(
		metricsMeterName,
		'spot_market_borrow_balance',
		'Spot market borrow balance'
	);
	const spotMarketMaxTokenDeposits = metrics.addGauge(
		metricsMeterName,
		'spot_market_max_token_deposits',
		'Spot market max token deposits'
	);

	const spotMarketLastInterestTs = metrics.addGauge(
		metricsMeterName,
		'spot_market_last_interest_ts',
		'Spot market last interest timestamp'
	);
	const spotMarketLastTwapTs = metrics.addGauge(
		metricsMeterName,
		'spot_market_last_twap_ts',
		'Spot market last TWAP timestamp'
	);
	const spotMarketInitialAssetWeight = metrics.addGauge(
		metricsMeterName,
		'spot_market_initial_asset_weight',
		'Spot market initial asset weight'
	);
	const spotMarketMaintenanceAssetWeight = metrics.addGauge(
		metricsMeterName,
		'spot_market_maintenance_asset_weight',
		'Spot market maintenance asset weight'
	);
	const spotMarketInitialLiabilityWeight = metrics.addGauge(
		metricsMeterName,
		'spot_market_initial_liability_weight',
		'Spot market initial liability weight'
	);
	const spotMarketMaintenanceLiabilityWeight = metrics.addGauge(
		metricsMeterName,
		'spot_market_maintenance_liability_weight',
		'Spot market maintenance liability weight'
	);
	const spotMarketLiquidatorFee = metrics.addGauge(
		metricsMeterName,
		'spot_market_liquidator_fee',
		'Spot market liquidator fee'
	);
	const spotMarketImfFactor = metrics.addGauge(
		metricsMeterName,
		'spot_market_imf_factor',
		'Spot market IMF factor'
	);
	const spotMarketScaleInitialAssetWeightStart = metrics.addGauge(
		metricsMeterName,
		'spot_market_scale_initial_asset_weight_start',
		'Spot market scale initial asset weight start'
	);

	const spotMarketWithdrawGuardThreshold = metrics.addGauge(
		metricsMeterName,
		'spot_market_withdraw_guard_threshold',
		'Spot market withdraw guard threshold'
	);
	const spotMarketDepositTokenTwap = metrics.addGauge(
		metricsMeterName,
		'spot_market_deposit_token_twap',
		'Spot market deposit token TWAP'
	);
	const spotMarketBorrowTokenTwap = metrics.addGauge(
		metricsMeterName,
		'spot_market_borrow_token_twap',
		'Spot market borrow token TWAP'
	);
	const spotMarketUtilizationTwap = metrics.addGauge(
		metricsMeterName,
		'spot_market_utilization_twap',
		'Spot market utilization TWAP'
	);
	const spotMarketNextDepositRecordId = metrics.addGauge(
		metricsMeterName,
		'spot_market_next_deposit_record_id',
		'Spot market next deposit record ID'
	);

	const spotMarketOrderStepSize = metrics.addGauge(
		metricsMeterName,
		'spot_market_order_step_size',
		'Spot market order step size'
	);
	const spotMarketOrderTickSize = metrics.addGauge(
		metricsMeterName,
		'spot_market_order_tick_size',
		'Spot market order tick size'
	);
	const spotMarketMinOrderSize = metrics.addGauge(
		metricsMeterName,
		'spot_market_min_order_size',
		'Spot market min order size'
	);
	const spotMarketMaxPositionSize = metrics.addGauge(
		metricsMeterName,
		'spot_market_max_position_size',
		'Spot market max position size'
	);
	const spotMarketNextFillRecordId = metrics.addGauge(
		metricsMeterName,
		'spot_market_next_fill_record_id',
		'Spot market next fill record ID'
	);
	const spotMarketFeePool = metrics.addGauge(
		metricsMeterName,
		'spot_market_fee_pool',
		'Spot market fee pool'
	);
	const spotMarketTotalSpotFee = metrics.addGauge(
		metricsMeterName,
		'spot_market_total_spot_fee',
		'Spot market total spot fee'
	);
	const spotMarketTotalSwapFee = metrics.addGauge(
		metricsMeterName,
		'spot_market_total_swap_fee',
		'Spot market total swap fee'
	);

	const spotMarketFlashLoanAmount = metrics.addGauge(
		metricsMeterName,
		'spot_market_flash_loan_amount',
		'Spot market flash loan amount'
	);
	const spotMarketFlashLoanInitialTokenAmount = metrics.addGauge(
		metricsMeterName,
		'spot_market_flash_loan_initial_token_amount',
		'Spot market flash loan initial token amount'
	);

	const spotMarketOrdersEnabled = metrics.addGauge(
		metricsMeterName,
		'spot_market_orders_enabled',
		'Spot market orders enabled'
	);
	const spotMarketPausedOperations = metrics.addGauge(
		metricsMeterName,
		'spot_market_paused_operations',
		'Spot market paused operations'
	);
	const spotMarketIfPausedOperations = metrics.addGauge(
		metricsMeterName,
		'spot_market_if_paused_operations',
		'Spot market insurance fund paused operations'
	);

	/// oracle accounts
	const oraclePriceDataPrice = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_price',
		'Oracle price data price'
	);
	const oraclePriceDataSlot = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_slot',
		'Oracle price data slot'
	);
	const oraclePriceDataConfidence = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_confidence',
		'Oracle price data confidence'
	);
	const oraclePriceDataHasSufficientNumberOfDataPoints = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_has_sufficient_number_of_data_points',
		'Oracle price data has sufficient number of data points'
	);
	const oraclePriceDataTwap = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_twap',
		'Oracle price data TWAP'
	);
	const oraclePriceDataTwapConfidence = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_twap_confidence',
		'Oracle price data TWAP confidence'
	);
	const oraclePriceDataMaxPrice = metrics.addGauge(
		metricsMeterName,
		'oracle_price_data_max_price',
		'Oracle price data max price'
	);

	metrics.finalizeObservables();

	/**
	 * Initialize DriftClient
	 */
	const wallet = new Wallet(new Keypair());
	const connection = new Connection(endpoint, {
		wsEndpoint: wsEndpoint,
		commitment: stateCommitment,
	});
	const driftClient = new DriftClient({
		connection,
		wallet,
		env: 'mainnet-beta',
		opts: {
			commitment: stateCommitment,
			skipPreflight: false,
			preflightCommitment: stateCommitment,
		},
		authority: wallet.publicKey,
		activeSubAccountId: 0,
		subAccountIds: [0],
	});
	const driftClientSubscribeStart = Date.now();
	await driftClient.subscribe();
	logger.info(
		`DriftClient subscribe took ${Date.now() - driftClientSubscribeStart}ms`
	);

	const updateMetrics = async () => {
		// TODO: update dlob

		// update state account
		const stateAccountPubkey = (
			await driftClient.getStatePublicKey()
		).toBase58();
		const stateAccount = driftClient.getStateAccount();

		const perpMarketAccounts = driftClient.getPerpMarketAccounts();
		const spotMarketAccounts = driftClient.getSpotMarketAccounts();

		if (
			stateAccount.numberOfMarkets !== perpMarketAccounts.length ||
			stateAccount.numberOfSpotMarkets !== spotMarketAccounts.length
		) {
			logger.warn(
				`State account has ${stateAccount.numberOfMarkets} markets, but ${perpMarketAccounts.length} perp markets and ${spotMarketAccounts.length} spot markets, possibly new market, restarting...`
			);
			process.exit(1);
		}

		const stateAccountAttrs = {
			stateAccountPubkey,
			programId: DRIFT_PROGRAM_ID,
		};
		stateAccountExchangeStatus.setLatestValue(
			stateAccount.exchangeStatus,
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsPriceDivergenceMarketOraclePercent.setLatestValue(
			stateAccount.oracleGuardRails.priceDivergence.oracleTwap5MinPercentDivergence.toNumber(),
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsPriceDivergenceOracleTwap5Min.setLatestValue(
			stateAccount.oracleGuardRails.priceDivergence.oracleTwap5MinPercentDivergence.toNumber(),
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsValiditySlotsBeforeStaleForAmm.setLatestValue(
			stateAccount.oracleGuardRails.validity.slotsBeforeStaleForAmm.toNumber(),
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsValiditySlotsBeforeStaleForMargin.setLatestValue(
			stateAccount.oracleGuardRails.validity.slotsBeforeStaleForMargin.toNumber(),
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsValidityConfidenceIntervalMaxSize.setLatestValue(
			stateAccount.oracleGuardRails.validity.confidenceIntervalMaxSize.toNumber(),
			stateAccountAttrs
		);
		stateAccountOracleGuardRailsValidityTooVolatileRatio.setLatestValue(
			stateAccount.oracleGuardRails.validity.tooVolatileRatio.toNumber(),
			stateAccountAttrs
		);
		stateAccountNumberOfAuthorities.setLatestValue(
			stateAccount.numberOfAuthorities.toNumber(),
			stateAccountAttrs
		);
		stateAccountNumberOfSubaccounts.setLatestValue(
			stateAccount.numberOfSubAccounts.toNumber(),
			stateAccountAttrs
		);
		stateAccountNumberOfMarkets.setLatestValue(
			stateAccount.numberOfMarkets,
			stateAccountAttrs
		);
		stateAccountNumberOfSpotMarkets.setLatestValue(
			stateAccount.numberOfSpotMarkets,
			stateAccountAttrs
		);
		stateAccountMinPerpAuctionDuration.setLatestValue(
			stateAccount.minPerpAuctionDuration,
			stateAccountAttrs
		);
		stateAccountDefaultMarketOrderTimeInForce.setLatestValue(
			stateAccount.defaultMarketOrderTimeInForce,
			stateAccountAttrs
		);
		stateAccountDefaultSpotAuctionDuration.setLatestValue(
			stateAccount.defaultSpotAuctionDuration,
			stateAccountAttrs
		);
		stateAccountLiquidationMarginBufferRatio.setLatestValue(
			stateAccount.liquidationMarginBufferRatio,
			stateAccountAttrs
		);
		stateAccountSettlementDuration.setLatestValue(
			stateAccount.settlementDuration,
			stateAccountAttrs
		);
		stateAccountMaxNumberOfSubaccounts.setLatestValue(
			stateAccount.maxNumberOfSubAccounts,
			stateAccountAttrs
		);
		stateAccountInitialPctToLiquidate.setLatestValue(
			stateAccount.initialPctToLiquidate,
			stateAccountAttrs
		);
		stateAccountLiquidationDuration.setLatestValue(
			stateAccount.liquidationDuration,
			stateAccountAttrs
		);
		stateAccountMaxInitializeUserFee.setLatestValue(
			stateAccount.maxInitializeUserFee,
			stateAccountAttrs
		);

		const oraclePriceData = new Map<string, OraclePriceData>();

		// update perp market accounts
		for (const perpMarket of perpMarketAccounts) {
			const oracleData = driftClient.getOraclePriceDataAndSlot(
				perpMarket.amm.oracle
			);
			if (!oracleData) {
				logger.error(
					`Oracle data not found for perp marketIndex: ${perpMarket.marketIndex}`
				);
				continue;
			}
			oraclePriceData.set(perpMarket.amm.oracle.toBase58(), oracleData.data);

			perpMarketExpiryTs.setLatestValue(perpMarket.expiryTs.toNumber(), {
				stateAccountPubkey,
				marketIndex: perpMarket.marketIndex,
			});
			perpMarketExpiryPrice.setLatestValue(
				convertToNumber(perpMarket.expiryPrice, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseAssetReserve.setLatestValue(
				convertToNumber(perpMarket.amm.baseAssetReserve, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteAssetReserve.setLatestValue(
				convertToNumber(perpMarket.amm.quoteAssetReserve, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmSqrtK.setLatestValue(
				convertToNumber(perpMarket.amm.sqrtK, AMM_RESERVE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmCumulativeFundingRate.setLatestValue(
				convertToNumber(
					perpMarket.amm.cumulativeFundingRate,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastFundingRate.setLatestValue(
				convertToNumber(perpMarket.amm.lastFundingRate, FUNDING_RATE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastFundingRateTs.setLatestValue(
				perpMarket.amm.lastFundingRateTs.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastMarkPriceTwap.setLatestValue(
				convertToNumber(perpMarket.amm.lastMarkPriceTwap, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastMarkPriceTwap5Min.setLatestValue(
				convertToNumber(perpMarket.amm.lastMarkPriceTwap5Min, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastMarkPriceTwapTs.setLatestValue(
				perpMarket.amm.lastMarkPriceTwapTs.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastTradeTs.setLatestValue(
				perpMarket.amm.lastTradeTs.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmHistoricalOracleDataPrice.setLatestValue(
				convertToNumber(
					perpMarket.amm.historicalOracleData.lastOraclePrice,
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmHistoricalOracleDataDelay.setLatestValue(
				perpMarket.amm.historicalOracleData.lastOracleDelay.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmHistoricalOracleDataConf.setLatestValue(
				convertToNumber(
					perpMarket.amm.historicalOracleData.lastOracleConf,
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmHistoricalOracleDataPriceTwap.setLatestValue(
				convertToNumber(
					perpMarket.amm.historicalOracleData.lastOraclePriceTwap,
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmHistoricalOracleDataPriceTwap5Min.setLatestValue(
				convertToNumber(
					perpMarket.amm.historicalOracleData.lastOraclePriceTwap5Min,
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmHistoricalOracleDataPriceTwapTs.setLatestValue(
				perpMarket.amm.historicalOracleData.lastOraclePriceTwapTs.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmLastOracleReservePriceSpreadPct.setLatestValue(
				convertToNumber(
					perpMarket.amm.lastOracleReservePriceSpreadPct,
					PERCENTAGE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastOracleConfPct.setLatestValue(
				convertToNumber(perpMarket.amm.lastOracleConfPct, PERCENTAGE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmFundingPeriod.setLatestValue(
				perpMarket.amm.fundingPeriod.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmPegMultiplier.setLatestValue(
				convertToNumber(perpMarket.amm.pegMultiplier, PEG_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmCumulativeFundingRateLong.setLatestValue(
				convertToNumber(
					perpMarket.amm.cumulativeFundingRateLong,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmCumulativeFundingRateShort.setLatestValue(
				convertToNumber(
					perpMarket.amm.cumulativeFundingRateShort,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLast24HAvgFundingRate.setLatestValue(
				convertToNumber(
					perpMarket.amm.last24HAvgFundingRate,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastFundingRateShort.setLatestValue(
				convertToNumber(
					perpMarket.amm.lastFundingRateShort,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastFundingRateLong.setLatestValue(
				convertToNumber(
					perpMarket.amm.lastFundingRateLong,
					FUNDING_RATE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmTotalLiquidationFee.setLatestValue(
				convertToNumber(perpMarket.amm.totalLiquidationFee, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTotalFeeMinusDistributions.setLatestValue(
				convertToNumber(
					perpMarket.amm.totalFeeMinusDistributions,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmTotalFeeWithdrawn.setLatestValue(
				convertToNumber(perpMarket.amm.totalFeeWithdrawn, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTotalFee.setLatestValue(
				convertToNumber(perpMarket.amm.totalFee, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTotalFeeEarnedPerLp.setLatestValue(
				convertToNumber(perpMarket.amm.totalFeeEarnedPerLp, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmUserLpShares.setLatestValue(
				convertToNumber(perpMarket.amm.userLpShares, AMM_RESERVE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmBaseAssetAmountWithUnsettledLp.setLatestValue(
				convertToNumber(
					perpMarket.amm.baseAssetAmountWithUnsettledLp,
					BASE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmOrderStepSize.setLatestValue(
				convertToNumber(perpMarket.amm.orderStepSize, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmOrderTickSize.setLatestValue(
				convertToNumber(perpMarket.amm.orderTickSize, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxFillReserveFraction.setLatestValue(
				perpMarket.amm.maxFillReserveFraction,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxSlippageRatio.setLatestValue(
				perpMarket.amm.maxSlippageRatio,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseSpread.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.baseSpread),
					PERCENTAGE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmCurveUpdateIntensity.setLatestValue(
				perpMarket.amm.curveUpdateIntensity,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseAssetAmountWithAmm.setLatestValue(
				convertToNumber(perpMarket.amm.baseAssetAmountWithAmm, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseAssetAmountLong.setLatestValue(
				convertToNumber(perpMarket.amm.baseAssetAmountLong, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseAssetAmountShort.setLatestValue(
				convertToNumber(perpMarket.amm.baseAssetAmountShort, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteAssetAmount.setLatestValue(
				convertToNumber(perpMarket.amm.quoteAssetAmount, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTerminalQuoteAssetReserve.setLatestValue(
				convertToNumber(
					perpMarket.amm.terminalQuoteAssetReserve,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmConcentrationCoef.setLatestValue(
				convertToNumber(perpMarket.amm.concentrationCoef, PERCENTAGE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			const quoteMarket = driftClient.getSpotMarketAccount(0);
			perpMarketAmmFeePool.setLatestValue(
				convertToNumber(
					getTokenAmount(
						perpMarket.amm.feePool.scaledBalance,
						quoteMarket!,
						SpotBalanceType.DEPOSIT
					),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmTotalExchangeFee.setLatestValue(
				convertToNumber(perpMarket.amm.totalExchangeFee, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTotalMmFee.setLatestValue(
				convertToNumber(perpMarket.amm.totalMmFee, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmNetRevenueSinceLastFunding.setLatestValue(
				convertToNumber(
					perpMarket.amm.netRevenueSinceLastFunding,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastUpdateSlot.setLatestValue(
				perpMarket.amm.lastUpdateSlot.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastOracleNormalisedPrice.setLatestValue(
				convertToNumber(
					perpMarket.amm.lastOracleNormalisedPrice,
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastOracleValid.setLatestValue(
				perpMarket.amm.lastOracleValid ? 1 : 0,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastBidPriceTwap.setLatestValue(
				convertToNumber(perpMarket.amm.lastBidPriceTwap, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLastAskPriceTwap.setLatestValue(
				convertToNumber(perpMarket.amm.lastAskPriceTwap, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLongSpread.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.longSpread),
					PERCENTAGE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmShortSpread.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.shortSpread),
					PERCENTAGE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxSpread.setLatestValue(
				convertToNumber(new BN(perpMarket.amm.maxSpread), PERCENTAGE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmBaseAssetAmountPerLp.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.baseAssetAmountPerLp),
					BASE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteAssetAmountPerLp.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.quoteAssetAmountPerLp),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTargetBaseAssetAmountPerLp.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.targetBaseAssetAmountPerLp),
					BASE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmAmmJitIntensity.setLatestValue(
				perpMarket.amm.ammJitIntensity,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxOpenInterest.setLatestValue(
				convertToNumber(perpMarket.amm.maxOpenInterest, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxBaseAssetReserve.setLatestValue(
				convertToNumber(perpMarket.amm.maxBaseAssetReserve, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMinBaseAssetReserve.setLatestValue(
				convertToNumber(perpMarket.amm.minBaseAssetReserve, BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmTotalSocialLoss.setLatestValue(
				convertToNumber(perpMarket.amm.totalSocialLoss, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmQuoteBreakEvenAmountLong.setLatestValue(
				convertToNumber(
					perpMarket.amm.quoteBreakEvenAmountLong,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteBreakEvenAmountShort.setLatestValue(
				convertToNumber(
					perpMarket.amm.quoteBreakEvenAmountShort,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteEntryAmountLong.setLatestValue(
				convertToNumber(perpMarket.amm.quoteEntryAmountLong, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteEntryAmountShort.setLatestValue(
				convertToNumber(perpMarket.amm.quoteEntryAmountShort, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmMarkStd.setLatestValue(
				convertToNumber(perpMarket.amm.markStd, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmOracleStd.setLatestValue(
				convertToNumber(perpMarket.amm.oracleStd, PRICE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLongIntensityCount.setLatestValue(
				perpMarket.amm.longIntensityCount,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmLongIntensityVolume.setLatestValue(
				convertToNumber(perpMarket.amm.longIntensityVolume, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmShortIntensityCount.setLatestValue(
				perpMarket.amm.shortIntensityCount,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmShortIntensityVolume.setLatestValue(
				convertToNumber(perpMarket.amm.shortIntensityVolume, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmVolume24H.setLatestValue(
				convertToNumber(perpMarket.amm.volume24H, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMinOrderSize.setLatestValue(
				convertToNumber(perpMarket.amm.minOrderSize, AMM_RESERVE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmMaxPositionSize.setLatestValue(
				convertToNumber(perpMarket.amm.maxPositionSize, AMM_RESERVE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketAmmPerLpBase.setLatestValue(
				convertToNumber(new BN(perpMarket.amm.perLpBase), BASE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmNetUnsettledFundingPnl.setLatestValue(
				convertToNumber(perpMarket.amm.netUnsettledFundingPnl, QUOTE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmQuoteAssetAmountWithUnsettledLp.setLatestValue(
				convertToNumber(
					perpMarket.amm.quoteAssetAmountWithUnsettledLp,
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketAmmReferencePriceOffset.setLatestValue(
				convertToNumber(
					new BN(perpMarket.amm.referencePriceOffset),
					PRICE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketNumberOfUsersWithBaseGauge.setLatestValue(
				perpMarket.numberOfUsersWithBase,
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketNumberOfUsers.setLatestValue(perpMarket.numberOfUsers, {
				stateAccountPubkey,
				marketIndex: perpMarket.marketIndex,
			});
			perpMarketMarginRatioInitial.setLatestValue(
				convertToNumber(
					new BN(perpMarket.marginRatioInitial),
					MARGIN_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketMarginRatioMaintenance.setLatestValue(
				convertToNumber(
					new BN(perpMarket.marginRatioMaintenance),
					MARGIN_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketNextFillRecordId.setLatestValue(
				perpMarket.nextFillRecordId.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketNextFundingRateRecordId.setLatestValue(
				perpMarket.nextFundingRateRecordId.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketNextCurveRecordId.setLatestValue(
				perpMarket.nextCurveRecordId.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketPnlPoolScaledBalance.setLatestValue(
				convertToNumber(
					getTokenAmount(
						perpMarket.pnlPool.scaledBalance,
						quoteMarket!,
						SpotBalanceType.DEPOSIT
					),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketLiquidatorFee.setLatestValue(
				convertToNumber(new BN(perpMarket.liquidatorFee), PERCENTAGE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketImfFactor.setLatestValue(
				convertToNumber(new BN(perpMarket.imfFactor), PERCENTAGE_PRECISION),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketUnrealizedPnlImfFactor.setLatestValue(
				convertToNumber(
					new BN(perpMarket.unrealizedPnlImfFactor),
					PERCENTAGE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);

			perpMarketUnrealizedPnlMaxImbalance.setLatestValue(
				convertToNumber(
					new BN(perpMarket.unrealizedPnlMaxImbalance),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketUnrealizedPnlInitialAssetWeight.setLatestValue(
				convertToNumber(
					new BN(perpMarket.unrealizedPnlInitialAssetWeight),
					SPOT_MARKET_WEIGHT_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketUnrealizedPnlMaintenanceAssetWeight.setLatestValue(
				convertToNumber(
					new BN(perpMarket.unrealizedPnlMaintenanceAssetWeight),
					SPOT_MARKET_WEIGHT_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketInsuranceClaimRevenueWithdrawSinceLastSettle.setLatestValue(
				convertToNumber(
					new BN(perpMarket.insuranceClaim.revenueWithdrawSinceLastSettle),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketInsuranceClaimMaxRevenueWithdrawPerPeriod.setLatestValue(
				convertToNumber(
					new BN(perpMarket.insuranceClaim.maxRevenueWithdrawPerPeriod),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketInsuranceClaimLastRevenueWithdrawTs.setLatestValue(
				perpMarket.insuranceClaim.lastRevenueWithdrawTs.toNumber(),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketInsuranceClaimQuoteSettledInsurance.setLatestValue(
				convertToNumber(
					new BN(perpMarket.insuranceClaim.quoteSettledInsurance),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketInsuranceClaimQuoteMaxInsurance.setLatestValue(
				convertToNumber(
					new BN(perpMarket.insuranceClaim.quoteMaxInsurance),
					QUOTE_PRECISION
				),
				{
					stateAccountPubkey,
					marketIndex: perpMarket.marketIndex,
				}
			);
			perpMarketFeeAdjustment.setLatestValue(perpMarket.feeAdjustment, {
				stateAccountPubkey,
				marketIndex: perpMarket.marketIndex,
			});
			perpMarketPausedOperations.setLatestValue(perpMarket.pausedOperations, {
				stateAccountPubkey,
				marketIndex: perpMarket.marketIndex,
			});
		}

		// update spot market accounts
		for (const spotMarket of spotMarketAccounts) {
			const oracleData = driftClient.getOraclePriceDataAndSlot(
				spotMarket.oracle
			);
			if (!oracleData) {
				logger.error(
					`Oracle data not found for spot marketIndex: ${spotMarket.marketIndex}`
				);
				continue;
			}
			oraclePriceData.set(spotMarket.oracle.toBase58(), oracleData.data);
		}
	};

	// update oracle markets

	await updateMetrics();
	setTimeout(async () => {
		try {
			await updateMetrics();
		} catch (e) {
			const err = e as Error;
			logger.error(`Error updating metrics: ${err.message}\n${err.stack}`);
		} finally {
			setTimeout(async () => {
				await updateMetrics();
			}, metricsUpdateIntervalMs);
		}
	}, metricsUpdateIntervalMs);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
