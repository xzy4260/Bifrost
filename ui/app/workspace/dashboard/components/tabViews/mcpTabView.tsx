import { useGetMCPHistogramQuery, useGetMCPTopToolsQuery, useLazyGetMCPHistogramQuery, useLazyGetMCPTopToolsQuery } from "@/lib/store";
import type { MCPToolLogFilters } from "@/lib/types/logs";
import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import type { DashboardData } from "../../utils/exportUtils";
import type { ChartType } from "../charts/chartTypeToggle";
import { MCPTab } from "../mcpTab";

export interface MCPTabViewHandle {
	getData: () => Partial<DashboardData>;
	loadData: () => Promise<void>;
}

interface MCPTabViewProps {
	filters: MCPToolLogFilters;
	active: boolean;
	startTime: number;
	endTime: number;
	mcpVolumeChartType: ChartType;
	onMcpVolumeChartToggle: (type: ChartType) => void;
}

export const MCPTabView = forwardRef<MCPTabViewHandle, MCPTabViewProps>(function MCPTabView(
	{ filters, active, startTime, endTime, mcpVolumeChartType, onMcpVolumeChartToggle },
	ref,
) {
	const fetchArg = useMemo(() => ({ filters }), [filters]);
	const skipOpts = useMemo(() => ({ skip: !active }), [active]);

	const { data: mcpHistogramData, isLoading: loadingMcpHistogram } = useGetMCPHistogramQuery(fetchArg, skipOpts);
	const { data: mcpTopToolsData, isLoading: loadingMcpTopTools } = useGetMCPTopToolsQuery(fetchArg, skipOpts);

	const [triggerMcpHistogram] = useLazyGetMCPHistogramQuery();
	const [triggerMcpTopTools] = useLazyGetMCPTopToolsQuery();

	const loadData = useCallback(async () => {
		await Promise.all([triggerMcpHistogram(fetchArg, true), triggerMcpTopTools(fetchArg, true)]);
	}, [fetchArg, triggerMcpHistogram, triggerMcpTopTools]);

	useImperativeHandle(
		ref,
		() => ({
			getData: () => ({
				mcpHistogramData: mcpHistogramData ?? null,
				mcpTopToolsData: mcpTopToolsData ?? null,
			}),
			loadData,
		}),
		[mcpHistogramData, mcpTopToolsData, loadData],
	);

	return (
		<MCPTab
			mcpHistogramData={mcpHistogramData ?? null}
			mcpTopToolsData={mcpTopToolsData ?? null}
			loadingMcpHistogram={loadingMcpHistogram}
			loadingMcpTopTools={loadingMcpTopTools}
			startTime={startTime}
			endTime={endTime}
			mcpVolumeChartType={mcpVolumeChartType}
			onMcpVolumeChartToggle={onMcpVolumeChartToggle}
		/>
	);
});