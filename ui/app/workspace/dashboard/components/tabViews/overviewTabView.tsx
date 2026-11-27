import {
	useGetLogsHistogramQuery,
	useGetLogsLatencyHistogramQuery,
	useGetLogsModelHistogramQuery,
	useGetLogsStatsQuery,
	useGetLogsThroughputHistogramQuery,
	useGetLogsTokenHistogramQuery,
	useLazyGetLogsHistogramQuery,
	useLazyGetLogsLatencyHistogramQuery,
	useLazyGetLogsModelHistogramQuery,
	useLazyGetLogsStatsQuery,
	useLazyGetLogsThroughputHistogramQuery,
	useLazyGetLogsTokenHistogramQuery,
} from "@/lib/store";
import { getOverviewCharts } from "@/lib/registries/dashboard";
import type { LogFilters } from "@/lib/types/logs";
import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import { computeDisplaySeries } from "../../utils/chartUtils";
import type { DashboardData } from "../../utils/exportUtils";
import type { ChartType } from "../charts/chartTypeToggle";
import { OverviewTab } from "../overviewTab";

export interface OverviewTabViewHandle {
	getData: () => Partial<DashboardData>;
	loadData: () => Promise<void>;
}

const sanitizeSeriesLabels = (values?: string[]): string[] => {
	if (!values) return [];
	const trimmed = values.map((v) => v.trim()).filter((v) => v.length > 0);
	return [...new Set(trimmed)];
};

interface OverviewTabViewProps {
	filters: LogFilters;
	active: boolean;
	startTime: number;
	endTime: number;
	volumeChartType: ChartType;
	tokenChartType: ChartType;
	modelChartType: ChartType;
	latencyChartType: ChartType;
	overheadChartType: ChartType;
	throughputChartType: ChartType;
	usageModel: string;
	onVolumeChartToggle: (type: ChartType) => void;
	onTokenChartToggle: (type: ChartType) => void;
	onModelChartToggle: (type: ChartType) => void;
	onLatencyChartToggle: (type: ChartType) => void;
	onOverheadChartToggle: (type: ChartType) => void;
	onThroughputChartToggle: (type: ChartType) => void;
	onUsageModelChange: (model: string) => void;
}

export const OverviewTabView = forwardRef<OverviewTabViewHandle, OverviewTabViewProps>(function OverviewTabView(
	{
		filters,
		active,
		startTime,
		endTime,
		volumeChartType,
		tokenChartType,
		modelChartType,
		latencyChartType,
		overheadChartType,
		throughputChartType,
		usageModel,
		onVolumeChartToggle,
		onTokenChartToggle,
		onModelChartToggle,
		onLatencyChartToggle,
		onOverheadChartToggle,
		onThroughputChartToggle,
		onUsageModelChange,
	},
	ref,
) {
	const fetchArg = useMemo(() => ({ filters }), [filters]);
	const skipOpts = useMemo(() => ({ skip: !active }), [active]);

	const { data: histogramData, isLoading: loadingHistogram } = useGetLogsHistogramQuery(fetchArg, skipOpts);
	const { data: tokenData, isLoading: loadingTokens } = useGetLogsTokenHistogramQuery(fetchArg, skipOpts);
	const { data: modelData, isLoading: loadingModels } = useGetLogsModelHistogramQuery(fetchArg, skipOpts);
	const { data: latencyData, isLoading: loadingLatency } = useGetLogsLatencyHistogramQuery(fetchArg, skipOpts);
	const { data: throughputData, isLoading: loadingThroughput } = useGetLogsThroughputHistogramQuery(fetchArg, skipOpts);
	const { data: logsStats, isLoading: loadingStats } = useGetLogsStatsQuery(fetchArg, skipOpts);

	const [triggerHistogram] = useLazyGetLogsHistogramQuery();
	const [triggerTokens] = useLazyGetLogsTokenHistogramQuery();
	const [triggerModels] = useLazyGetLogsModelHistogramQuery();
	const [triggerLatency] = useLazyGetLogsLatencyHistogramQuery();
	const [triggerThroughput] = useLazyGetLogsThroughputHistogramQuery();
	const [triggerStats] = useLazyGetLogsStatsQuery();

	const loadData = useCallback(async () => {
		await Promise.all([
			triggerHistogram(fetchArg, true),
			triggerTokens(fetchArg, true),
			triggerModels(fetchArg, true),
			triggerLatency(fetchArg, true),
			triggerThroughput(fetchArg, true),
			triggerStats(fetchArg, true),
		]);
	}, [fetchArg, triggerHistogram, triggerTokens, triggerModels, triggerLatency, triggerThroughput, triggerStats]);

	useImperativeHandle(
		ref,
		() => ({
			getData: () => ({
				histogramData: histogramData ?? null,
				tokenData: tokenData ?? null,
				modelData: modelData ?? null,
				latencyData: latencyData ?? null,
			}),
			loadData,
		}),
		[histogramData, tokenData, modelData, latencyData, loadData],
	);

	// Legend lists mirror the charts' display order (top-N by volume + "Other"),
	// not the API's alphabetical order — index-based colors must match the bars.
	const usageModels = useMemo(
		() => computeDisplaySeries(modelData?.buckets, modelData?.models, (b, m) => b.by_model?.[m]?.total ?? 0),
		[modelData],
	);
	const availableModels = useMemo(() => sanitizeSeriesLabels(modelData?.models ?? []), [modelData?.models]);

	const extraCharts = useMemo(() => {
		const charts = getOverviewCharts();
		if (charts.length === 0) return undefined;
		return charts.map(({ id, component: Chart }) => (
			<Chart key={id} filters={filters} startTime={startTime} endTime={endTime} active={active} />
		));
	}, [filters, startTime, endTime, active]);

	return (
		<OverviewTab
			histogramData={histogramData ?? null}
			tokenData={tokenData ?? null}
			modelData={modelData ?? null}
			latencyData={latencyData ?? null}
			throughputData={throughputData ?? null}
			logsStats={logsStats ?? null}
			loadingHistogram={loadingHistogram}
			loadingTokens={loadingTokens}
			loadingModels={loadingModels}
			loadingLatency={loadingLatency}
			loadingThroughput={loadingThroughput}
			loadingStats={loadingStats}
			startTime={startTime}
			endTime={endTime}
			volumeChartType={volumeChartType}
			tokenChartType={tokenChartType}
			modelChartType={modelChartType}
			latencyChartType={latencyChartType}
			overheadChartType={overheadChartType}
			throughputChartType={throughputChartType}
			usageModel={usageModel}
			usageModels={usageModels}
			availableModels={availableModels}
			onVolumeChartToggle={onVolumeChartToggle}
			onTokenChartToggle={onTokenChartToggle}
			onModelChartToggle={onModelChartToggle}
			onLatencyChartToggle={onLatencyChartToggle}
			onOverheadChartToggle={onOverheadChartToggle}
			onThroughputChartToggle={onThroughputChartToggle}
			onUsageModelChange={onUsageModelChange}
			extraCharts={extraCharts}
		/>
	);
});
