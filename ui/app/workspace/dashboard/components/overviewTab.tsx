import { StartTruncatedLabel } from "@/components/ui/truncatedLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGetConcurrencyQuery } from "@/lib/store";
import type {
	LatencyHistogramResponse,
	LogStats,
	LogsHistogramResponse,
	ModelHistogramResponse,
	ThroughputHistogramResponse,
	TokenHistogramResponse,
} from "@/lib/types/logs";
import { COMPACT_NUMBER_FORMAT } from "@/lib/utils/numbers";
import NumberFlow from "@number-flow/react";
import { type ReactNode, memo, useMemo } from "react";
import {
	CHART_COLORS,
	CHART_HEADER_LEGEND_CLASS,
	LATENCY_COLORS,
	OTHER_SERIES_COLOR,
	OTHER_SERIES_KEY,
	getOtherSeriesLabel,
	THROUGHPUT_COLOR,
	formatTokensPerSecond,
	getModelColor,
} from "../utils/chartUtils";
import { ChartCard } from "./charts/chartCard";
import { type ChartType, ChartTypeToggle } from "./charts/chartTypeToggle";
import ExternalCacheTokenMeterChart from "./charts/externalCacheTokenMeterChart";
import { LatencyChart } from "./charts/latencyChart";
import { OverheadChart } from "./charts/overheadChart";
import { ThroughputChart } from "./charts/throughputChart";
import LocalCacheTokenMeterChart from "./charts/localCacheTokenMeterChart";
import { LogVolumeChart } from "./charts/logVolumeChart";
import { ModelFilterSelect } from "./charts/modelFilterSelect";
import { ModelUsageChart } from "./charts/modelUsageChart";
import { TokenUsageChart } from "./charts/tokenUsageChart";
import { useTranslation } from "react-i18next";
import { getLocale } from "@/lib/i18n";

export interface OverviewTabProps {
	// Data
	histogramData: LogsHistogramResponse | null;
	tokenData: TokenHistogramResponse | null;
	modelData: ModelHistogramResponse | null;
	latencyData: LatencyHistogramResponse | null;
	throughputData: ThroughputHistogramResponse | null;
	logsStats: LogStats | null;

	// Loading states
	loadingHistogram: boolean;
	loadingTokens: boolean;
	loadingModels: boolean;
	loadingLatency: boolean;
	loadingThroughput: boolean;
	loadingStats: boolean;

	// Time range
	startTime: number;
	endTime: number;

	// Chart types
	volumeChartType: ChartType;
	tokenChartType: ChartType;
	modelChartType: ChartType;
	latencyChartType: ChartType;
	overheadChartType: ChartType;
	throughputChartType: ChartType;

	// Model selections
	usageModel: string;

	// Derived model lists
	usageModels: string[];
	availableModels: string[];

	// Chart type toggle callbacks
	onVolumeChartToggle: (type: ChartType) => void;
	onTokenChartToggle: (type: ChartType) => void;
	onModelChartToggle: (type: ChartType) => void;
	onLatencyChartToggle: (type: ChartType) => void;
	onOverheadChartToggle: (type: ChartType) => void;
	onThroughputChartToggle: (type: ChartType) => void;

	// Filter callbacks
	onUsageModelChange: (model: string) => void;

	// Charts registered by a downstream build, drawn at the end of the chart grid
	extraCharts?: ReactNode;
}

function OverviewTabImpl({
	histogramData,
	tokenData,
	modelData,
	latencyData,
	throughputData,
	logsStats,
	loadingHistogram,
	loadingTokens,
	loadingModels,
	loadingLatency,
	loadingThroughput,
	loadingStats,
	startTime,
	endTime,
	volumeChartType,
	tokenChartType,
	modelChartType,
	latencyChartType,
	overheadChartType,
	throughputChartType,
	usageModel,
	usageModels,
	availableModels,
	onVolumeChartToggle,
	onTokenChartToggle,
	onModelChartToggle,
	onLatencyChartToggle,
	onOverheadChartToggle,
	onThroughputChartToggle,
	onUsageModelChange,
	extraCharts,
}: OverviewTabProps) {
	const { t } = useTranslation("observability");
	// Live figure, not a histogram: the tracker only ever knows what is in flight
	// right now, so it is polled rather than derived from the selected range.
	const { data: concurrency, isLoading: loadingConcurrency } = useGetConcurrencyQuery(undefined, {
		pollingInterval: 2000,
	});
	const concurrencyKeys = concurrency?.keys ?? [];

	const volumeTotal = useMemo(() => {
		if (!histogramData?.buckets) return null;
		return histogramData.buckets.reduce((sum, b) => sum + (b.count ?? 0), 0);
	}, [histogramData]);

	const tokenTotal = useMemo(() => {
		if (!tokenData?.buckets) return null;
		return tokenData.buckets.reduce((sum, b) => sum + (b.total_tokens ?? 0), 0);
	}, [tokenData]);

	const modelUsageTotal = useMemo(() => {
		if (!modelData?.buckets) return null;
		if (usageModel === "all") {
			let sum = 0;
			for (const b of modelData.buckets) {
				if (!b.by_model) continue;
				for (const m of modelData.models) sum += b.by_model[m]?.total ?? 0;
			}
			return sum;
		}
		return modelData.buckets.reduce((sum, b) => sum + (b.by_model?.[usageModel]?.total ?? 0), 0);
	}, [modelData, usageModel]);

	const latencyAvg = useMemo(() => {
		if (!latencyData?.buckets || latencyData.buckets.length === 0) return null;
		let weighted = 0;
		let count = 0;
		for (const b of latencyData.buckets) {
			const reqs = b.total_requests ?? 0;
			if (reqs === 0) continue;
			weighted += (b.avg_latency ?? 0) * reqs;
			count += reqs;
		}
		return count > 0 ? weighted / count : null;
	}, [latencyData]);

	// Request-weighted average Bifrost overhead across buckets, mirroring latencyAvg.
	const overheadAvg = useMemo(() => {
		if (!latencyData?.buckets || latencyData.buckets.length === 0) return null;
		let weighted = 0;
		let count = 0;
		for (const b of latencyData.buckets) {
			const reqs = b.total_requests ?? 0;
			if (reqs === 0) continue;
			weighted += (b.avg_overhead ?? 0) * reqs;
			count += reqs;
		}
		return count > 0 ? weighted / count : null;
	}, [latencyData]);

	// Weighted-average throughput across buckets (weighted by request count) so
	// the header figure matches how the aggregate rate is computed per bucket.
	const throughputAvg = useMemo(() => {
		if (!throughputData?.buckets || throughputData.buckets.length === 0) return null;
		let weighted = 0;
		let count = 0;
		for (const b of throughputData.buckets) {
			const reqs = b.total_requests ?? 0;
			if (reqs === 0) continue;
			weighted += (b.tokens_per_second ?? 0) * reqs;
			count += reqs;
		}
		return count > 0 ? weighted / count : null;
	}, [throughputData]);

	return (
		<>
			{/* Charts Grid */}
			<div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
				{/* Current concurrency: first so the live load is the first thing the page answers. */}
				<ChartCard
					title={t("dashboard.charts.concurrency")}
					loading={loadingConcurrency}
					testId="chart-concurrency"
					totalLabel={t("labels.total")}
					total={
						concurrency ? (
							<span className="flex items-baseline gap-2">
								<NumberFlow value={concurrency.total} format={COMPACT_NUMBER_FORMAT} />
								<span className="text-muted-foreground text-xs font-normal">{formatTokensPerSecond(concurrency.tokens_per_second)}</span>
							</span>
						) : undefined
					}
					totalTooltip={concurrency ? concurrency.total.toLocaleString(getLocale()) : undefined}
				>
					{concurrencyKeys.length === 0 ? (
						<div className="text-muted-foreground flex h-full items-center justify-center text-sm" data-testid="concurrency-empty">
							{t("dashboard.charts.concurrencyIdle")}
						</div>
					) : (
						<div className="flex h-full flex-col gap-1 overflow-y-auto" data-testid="concurrency-key-list">
							{concurrencyKeys.map((key) => (
								<div
									key={key.id || key.value || "unknown"}
									className="bg-muted/40 flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm"
									data-testid="concurrency-key-row"
								>
									<span className="flex min-w-0 items-center gap-2">
										<span className="text-primary max-w-[150px] truncate">
											{key.name || t("dashboard.charts.concurrencyUnnamedKey")}
										</span>
										{key.value && <span className="text-muted-foreground truncate font-mono text-xs">{key.value}</span>}
									</span>
									<span className="flex shrink-0 items-baseline gap-2">
										<span className="font-semibold tabular-nums">{key.active}</span>
										<span className="text-muted-foreground text-xs tabular-nums">{formatTokensPerSecond(key.tokens_per_second)}</span>
									</span>
								</div>
							))}
						</div>
					)}
				</ChartCard>

				{/* Log Volume Chart */}
				<ChartCard
					title={t("dashboard.charts.requestVolume")}
					loading={loadingHistogram}
					testId="chart-log-volume"
					totalLabel={t("labels.total")}
					total={volumeTotal !== null ? <NumberFlow value={volumeTotal} format={COMPACT_NUMBER_FORMAT} /> : undefined}
					totalTooltip={volumeTotal !== null ? volumeTotal.toLocaleString(getLocale()) : undefined}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.success }} />
								<span className="text-muted-foreground">{t("labels.success")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.error }} />
								<span className="text-muted-foreground">{t("labels.error")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cancelled }} />
								<span className="text-muted-foreground">{t("labels.cancelled")}</span>
							</span>
						</div>
					}
					controls={
						<ChartTypeToggle chartType={volumeChartType} onToggle={onVolumeChartToggle} data-testid="dashboard-volume-chart-toggle" />
					}
				>
					<LogVolumeChart data={histogramData} chartType={volumeChartType} startTime={startTime} endTime={endTime} />
				</ChartCard>

				{/* Token Usage Chart */}
				<ChartCard
					title={t("dashboard.charts.tokenUsage")}
					loading={loadingTokens}
					testId="chart-token-usage"
					totalLabel={t("labels.total")}
					total={tokenTotal !== null ? <NumberFlow value={tokenTotal} format={COMPACT_NUMBER_FORMAT} /> : undefined}
					totalTooltip={tokenTotal !== null ? tokenTotal.toLocaleString(getLocale()) : undefined}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.promptTokens }} />
								<span className="text-muted-foreground">{t("labels.input")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.completionTokens }} />
								<span className="text-muted-foreground">{t("labels.output")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cachedReadTokens }} />
								<span className="text-muted-foreground">{t("labels.cached")}</span>
							</span>
						</div>
					}
					controls={<ChartTypeToggle chartType={tokenChartType} onToggle={onTokenChartToggle} data-testid="dashboard-token-chart-toggle" />}
				>
					<TokenUsageChart data={tokenData} chartType={tokenChartType} startTime={startTime} endTime={endTime} />
				</ChartCard>

				{/* External Cache Hit Rate Meter */}
				<ChartCard title={t("dashboard.charts.externalCacheHitRate")} loading={loadingTokens} testId="chart-cache-external">
					<ExternalCacheTokenMeterChart data={tokenData} />
				</ChartCard>

				{/* Local Cache Hit Rate Meter */}
				<ChartCard title={t("dashboard.charts.localCacheHitRate")} loading={loadingStats} testId="chart-cache-local">
					<LocalCacheTokenMeterChart data={logsStats} />
				</ChartCard>

				{/* Model Usage Chart */}
				<ChartCard
					title={t("dashboard.charts.modelUsage")}
					loading={loadingModels}
					testId="chart-model-usage"
					totalLabel={t("labels.total")}
					total={modelUsageTotal !== null ? <NumberFlow value={modelUsageTotal} format={COMPACT_NUMBER_FORMAT} /> : undefined}
					totalTooltip={modelUsageTotal !== null ? modelUsageTotal.toLocaleString(getLocale()) : undefined}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							{usageModel === "all" ? (
								usageModels.length > 0 && (
									<>
										<Tooltip>
											<TooltipTrigger asChild>
												<span tabIndex={0} data-testid="usage-legend-trigger" className="flex items-center gap-1">
													<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getModelColor(0) }} />
													<StartTruncatedLabel className="text-muted-foreground max-w-[160px]">{usageModels[0]}</StartTruncatedLabel>
												</span>
											</TooltipTrigger>
											<TooltipContent>{usageModels[0]}</TooltipContent>
										</Tooltip>
										{usageModels.length > 1 && (
											<Tooltip>
												<TooltipTrigger asChild>
													<span tabIndex={0} data-testid="usage-legend-more-trigger" className="text-muted-foreground cursor-default">
														{t("dashboard.charts.moreCount", { count: usageModels.length - 1 })}
													</span>
												</TooltipTrigger>
												<TooltipContent>
													<div className="flex flex-col gap-1">
														{usageModels.slice(1).map((model, idx) => (
															<span key={model} className="flex items-center gap-1">
																<span
																	className="h-2 w-2 shrink-0 rounded-full"
																	style={{
																		backgroundColor: model === OTHER_SERIES_KEY ? OTHER_SERIES_COLOR : getModelColor(idx + 1),
																	}}
																/>
																{model === OTHER_SERIES_KEY ? getOtherSeriesLabel() : model}
															</span>
														))}
													</div>
												</TooltipContent>
											</Tooltip>
										)}
									</>
								)
							) : (
								<>
									<span className="flex items-center gap-1">
										<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.success }} />
										<span className="text-muted-foreground">{t("labels.success")}</span>
									</span>
									<span className="flex items-center gap-1">
										<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.error }} />
										<span className="text-muted-foreground">{t("labels.error")}</span>
									</span>
									<span className="flex items-center gap-1">
										<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cancelled }} />
										<span className="text-muted-foreground">{t("labels.cancelled")}</span>
									</span>
								</>
							)}
						</div>
					}
					controls={
						<>
							<ModelFilterSelect
								models={availableModels}
								selectedModel={usageModel}
								onModelChange={onUsageModelChange}
								data-testid="dashboard-usage-model-filter"
							/>
							<ChartTypeToggle chartType={modelChartType} onToggle={onModelChartToggle} data-testid="dashboard-usage-chart-toggle" />
						</>
					}
				>
					<ModelUsageChart data={modelData} chartType={modelChartType} startTime={startTime} endTime={endTime} selectedModel={usageModel} />
				</ChartCard>

				{/* Latency Chart */}
				<ChartCard
					title={t("dashboard.charts.latency")}
					loading={loadingLatency}
					testId="chart-latency"
					totalLabel="Avg"
					total={
						latencyAvg !== null ? (
							<NumberFlow value={latencyAvg} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="ms" />
						) : undefined
					}
					totalTooltip={latencyAvg !== null ? `${latencyAvg.toLocaleString(getLocale(), { maximumFractionDigits: 6 })}ms` : undefined}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.avg }} />
								<span className="text-muted-foreground">{t("labels.avg")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p90 }} />
								<span className="text-muted-foreground">P90</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p95 }} />
								<span className="text-muted-foreground">P95</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p99 }} />
								<span className="text-muted-foreground">P99</span>
							</span>
						</div>
					}
					controls={
						<ChartTypeToggle chartType={latencyChartType} onToggle={onLatencyChartToggle} data-testid="dashboard-latency-chart-toggle" />
					}
				>
					<LatencyChart data={latencyData} chartType={latencyChartType} startTime={startTime} endTime={endTime} />
				</ChartCard>

				{/* Bifrost Overhead Chart */}
				<ChartCard
					title={t("dashboard.charts.bifrostOverhead")}
					loading={loadingLatency}
					testId="chart-overhead"
					totalLabel="Avg"
					total={
						overheadAvg !== null ? (
							<NumberFlow value={overheadAvg} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="ms" />
						) : undefined
					}
					totalTooltip={overheadAvg !== null ? `${overheadAvg.toLocaleString(getLocale(), { maximumFractionDigits: 6 })}ms` : undefined}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.avg }} />
								<span className="text-muted-foreground">{t("labels.avg")}</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p90 }} />
								<span className="text-muted-foreground">P90</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p95 }} />
								<span className="text-muted-foreground">P95</span>
							</span>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p99 }} />
								<span className="text-muted-foreground">P99</span>
							</span>
						</div>
					}
					controls={
						<ChartTypeToggle chartType={overheadChartType} onToggle={onOverheadChartToggle} data-testid="dashboard-overhead-chart-toggle" />
					}
				>
					<OverheadChart data={latencyData} chartType={overheadChartType} startTime={startTime} endTime={endTime} />
				</ChartCard>

				{/* Throughput (tokens/sec) Chart */}
				<ChartCard
					title={t("dashboard.charts.throughput")}
					loading={loadingThroughput}
					testId="chart-throughput"
					totalLabel="Avg"
					total={
						throughputAvg !== null ? <span className="truncate whitespace-nowrap">{formatTokensPerSecond(throughputAvg)}</span> : undefined
					}
					totalTooltip={
						throughputAvg !== null
							? t("dashboard.charts.tokensPerSecValue", { value: throughputAvg.toLocaleString(getLocale(), { maximumFractionDigits: 2 }) })
							: undefined
					}
					legend={
						<div className={CHART_HEADER_LEGEND_CLASS}>
							<span className="flex items-center gap-1">
								<span className="h-2 w-2 rounded-full" style={{ backgroundColor: THROUGHPUT_COLOR }} />
								<span className="text-muted-foreground">{t("labels.tokensPerSec")}</span>
							</span>
						</div>
					}
					controls={
						<ChartTypeToggle
							chartType={throughputChartType}
							onToggle={onThroughputChartToggle}
							data-testid="dashboard-throughput-chart-toggle"
						/>
					}
				>
					<ThroughputChart data={throughputData} chartType={throughputChartType} startTime={startTime} endTime={endTime} />
				</ChartCard>

				{extraCharts}
			</div>
		</>
	);
}
export const OverviewTab = memo(OverviewTabImpl);
