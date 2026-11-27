import type { MCPHistogramResponse, MCPTopToolsResponse } from "@/lib/types/logs";
import { COMPACT_NUMBER_FORMAT } from "@/lib/utils/numbers";
import NumberFlow from "@number-flow/react";
import { memo, useMemo } from "react";
import { CHART_COLORS, CHART_HEADER_LEGEND_CLASS } from "../utils/chartUtils";
import { ChartCard } from "./charts/chartCard";
import { type ChartType, ChartTypeToggle } from "./charts/chartTypeToggle";
import { MCPTopToolsChart } from "./charts/mcpTopToolsChart";
import { MCPVolumeChart } from "./charts/mcpVolumeChart";
import { useTranslation } from "react-i18next";
import { getLocale } from "@/lib/i18n";

export interface MCPTabProps {
	// Data
	mcpHistogramData: MCPHistogramResponse | null;
	mcpTopToolsData: MCPTopToolsResponse | null;

	// Loading states
	loadingMcpHistogram: boolean;
	loadingMcpTopTools: boolean;

	// Time range
	startTime: number;
	endTime: number;

	// Chart types
	mcpVolumeChartType: ChartType;

	// Chart type toggle callbacks
	onMcpVolumeChartToggle: (type: ChartType) => void;
}

function MCPTabImpl({
	mcpHistogramData,
	mcpTopToolsData,
	loadingMcpHistogram,
	loadingMcpTopTools,
	startTime,
	endTime,
	mcpVolumeChartType,
	onMcpVolumeChartToggle,
}: MCPTabProps) {
	const { t } = useTranslation("observability");
	const mcpVolumeTotal = useMemo(() => {
		if (!mcpHistogramData?.buckets) return null;
		return mcpHistogramData.buckets.reduce((sum, b) => sum + (b.count ?? 0), 0);
	}, [mcpHistogramData]);

	const mcpTopToolsTotal = useMemo(() => {
		if (!mcpTopToolsData?.tools) return null;
		return mcpTopToolsData.tools.reduce((sum, t) => sum + (t.count ?? 0), 0);
	}, [mcpTopToolsData]);

	return (
		<div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
			{/* MCP Tool Calls Volume */}
			<ChartCard
				title={t("dashboard.charts.mcpToolCalls")}
				loading={loadingMcpHistogram}
				testId="chart-mcp-volume"
				totalLabel={t("labels.total")}
				total={mcpVolumeTotal !== null ? <NumberFlow value={mcpVolumeTotal} format={COMPACT_NUMBER_FORMAT} /> : undefined}
				totalTooltip={mcpVolumeTotal !== null ? mcpVolumeTotal.toLocaleString(getLocale()) : undefined}
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
					</div>
				}
				controls={
					<ChartTypeToggle
						chartType={mcpVolumeChartType}
						onToggle={onMcpVolumeChartToggle}
						data-testid="dashboard-mcp-volume-chart-toggle"
					/>
				}
			>
				<MCPVolumeChart data={mcpHistogramData} chartType={mcpVolumeChartType} startTime={startTime} endTime={endTime} />
			</ChartCard>

			{/* Top 10 MCP Tools */}
			<ChartCard
				title={t("dashboard.charts.topMcpTools")}
				loading={loadingMcpTopTools}
				testId="chart-mcp-top-tools"
				totalLabel={t("labels.total")}
				total={mcpTopToolsTotal !== null ? <NumberFlow value={mcpTopToolsTotal} format={COMPACT_NUMBER_FORMAT} /> : undefined}
				totalTooltip={mcpTopToolsTotal !== null ? mcpTopToolsTotal.toLocaleString(getLocale()) : undefined}
			>
				<MCPTopToolsChart data={mcpTopToolsData} />
			</ChartCard>
		</div>
	);
}
export const MCPTab = memo(MCPTabImpl);