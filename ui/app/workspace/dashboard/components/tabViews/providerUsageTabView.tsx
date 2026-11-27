import {
	useGetLogsProviderLatencyHistogramQuery,
	useGetLogsProviderThroughputHistogramQuery,
	useGetLogsProviderTokenHistogramQuery,
	useLazyGetLogsProviderLatencyHistogramQuery,
	useLazyGetLogsProviderThroughputHistogramQuery,
	useLazyGetLogsProviderTokenHistogramQuery,
} from "@/lib/store";
import type { LogFilters } from "@/lib/types/logs";
import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import { computeDisplaySeries } from "../../utils/chartUtils";
import type { DashboardData } from "../../utils/exportUtils";
import type { ChartType } from "../charts/chartTypeToggle";
import { ProviderUsageTab } from "../providerUsageTab";

export interface ProviderUsageTabViewHandle {
	getData: () => Partial<DashboardData>;
	loadData: () => Promise<void>;
}

const sanitizeSeriesLabels = (values?: string[]): string[] => {
	if (!values) return [];
	const trimmed = values.map((v) => v.trim()).filter((v) => v.length > 0);
	return [...new Set(trimmed)];
};

interface ProviderUsageTabViewProps {
	filters: LogFilters;
	active: boolean;
	startTime: number;
	endTime: number;
	providerTokenChartType: ChartType;
	providerLatencyChartType: ChartType;
	providerThroughputChartType: ChartType;
	providerTokenProvider: string;
	providerLatencyProvider: string;
	providerThroughputProvider: string;
	onProviderTokenChartToggle: (type: ChartType) => void;
	onProviderLatencyChartToggle: (type: ChartType) => void;
	onProviderThroughputChartToggle: (type: ChartType) => void;
	onProviderTokenProviderChange: (provider: string) => void;
	onProviderLatencyProviderChange: (provider: string) => void;
	onProviderThroughputProviderChange: (provider: string) => void;
}

export const ProviderUsageTabView = forwardRef<ProviderUsageTabViewHandle, ProviderUsageTabViewProps>(function ProviderUsageTabView(
	{
		filters,
		active,
		startTime,
		endTime,
		providerTokenChartType,
		providerLatencyChartType,
		providerThroughputChartType,
		providerTokenProvider,
		providerLatencyProvider,
		providerThroughputProvider,
		onProviderTokenChartToggle,
		onProviderLatencyChartToggle,
		onProviderThroughputChartToggle,
		onProviderTokenProviderChange,
		onProviderLatencyProviderChange,
		onProviderThroughputProviderChange,
	},
	ref,
) {
	const fetchArg = useMemo(() => ({ filters }), [filters]);
	const skipOpts = useMemo(() => ({ skip: !active }), [active]);

	const { data: providerTokenData, isLoading: loadingProviderTokens } = useGetLogsProviderTokenHistogramQuery(fetchArg, skipOpts);
	const { data: providerLatencyData, isLoading: loadingProviderLatency } = useGetLogsProviderLatencyHistogramQuery(fetchArg, skipOpts);
	const { data: providerThroughputData, isLoading: loadingProviderThroughput } = useGetLogsProviderThroughputHistogramQuery(
		fetchArg,
		skipOpts,
	);

	const [triggerProviderTokens] = useLazyGetLogsProviderTokenHistogramQuery();
	const [triggerProviderLatency] = useLazyGetLogsProviderLatencyHistogramQuery();
	const [triggerProviderThroughput] = useLazyGetLogsProviderThroughputHistogramQuery();

	const loadData = useCallback(async () => {
		await Promise.all([
			triggerProviderTokens(fetchArg, true),
			triggerProviderLatency(fetchArg, true),
			triggerProviderThroughput(fetchArg, true),
		]);
	}, [fetchArg, triggerProviderTokens, triggerProviderLatency, triggerProviderThroughput]);

	useImperativeHandle(
		ref,
		() => ({
			getData: () => ({
				providerTokenData: providerTokenData ?? null,
				providerLatencyData: providerLatencyData ?? null,
			}),
			loadData,
		}),
		[providerTokenData, providerLatencyData, loadData],
	);

	const availableProviders = useMemo(
		() =>
			sanitizeSeriesLabels([
				...(providerTokenData?.providers ?? []),
				...(providerLatencyData?.providers ?? []),
				...(providerThroughputData?.providers ?? []),
			]),
		[providerTokenData?.providers, providerLatencyData?.providers, providerThroughputData?.providers],
	);
	// Legend lists mirror each chart's display order (top-N by its own ranking
	// metric, plus "Other" where the chart rolls up the tail) — index-based
	// colors must match the drawn series, not the API's alphabetical order.
	const providerTokenProviders = useMemo(
		() => computeDisplaySeries(providerTokenData?.buckets, providerTokenData?.providers, (b, p) => b.by_provider?.[p]?.total_tokens ?? 0),
		[providerTokenData],
	);
	const providerLatencyProviders = useMemo(
		() =>
			computeDisplaySeries(
				providerLatencyData?.buckets,
				providerLatencyData?.providers,
				(b, p) => b.by_provider?.[p]?.total_requests ?? 0,
				false,
			),
		[providerLatencyData],
	);
	const providerThroughputProviders = useMemo(
		() =>
			computeDisplaySeries(
				providerThroughputData?.buckets,
				providerThroughputData?.providers,
				(b, p) => b.by_provider?.[p]?.total_requests ?? 0,
				false,
			),
		[providerThroughputData],
	);

	return (
		<ProviderUsageTab
			providerTokenData={providerTokenData ?? null}
			providerLatencyData={providerLatencyData ?? null}
			providerThroughputData={providerThroughputData ?? null}
			loadingProviderTokens={loadingProviderTokens}
			loadingProviderLatency={loadingProviderLatency}
			loadingProviderThroughput={loadingProviderThroughput}
			startTime={startTime}
			endTime={endTime}
			providerTokenChartType={providerTokenChartType}
			providerLatencyChartType={providerLatencyChartType}
			providerThroughputChartType={providerThroughputChartType}
			providerTokenProvider={providerTokenProvider}
			providerLatencyProvider={providerLatencyProvider}
			providerThroughputProvider={providerThroughputProvider}
			availableProviders={availableProviders}
			providerTokenProviders={providerTokenProviders}
			providerLatencyProviders={providerLatencyProviders}
			providerThroughputProviders={providerThroughputProviders}
			onProviderTokenChartToggle={onProviderTokenChartToggle}
			onProviderLatencyChartToggle={onProviderLatencyChartToggle}
			onProviderThroughputChartToggle={onProviderThroughputChartToggle}
			onProviderTokenProviderChange={onProviderTokenProviderChange}
			onProviderLatencyProviderChange={onProviderLatencyProviderChange}
			onProviderThroughputProviderChange={onProviderThroughputProviderChange}
		/>
	);
});
