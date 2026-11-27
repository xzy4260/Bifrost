import PageTitle from "@/components/pageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateCoreConfigMutation } from "@/lib/store";
import {
	DEFAULT_LIVE_MODELS_SYNC_INTERVAL,
	DefaultCoreConfig,
	LIVE_MODELS_SYNC_DISABLED,
	MIN_LIVE_MODELS_SYNC_INTERVAL,
} from "@/lib/types/config";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ModelSettingsFormData {
	routing_chain_max_depth: number;
	/**
	 * Minutes rather than hours: the useful range here starts well below an hour
	 * for anyone fronting a fast-moving upstream. 0 means the background refresh
	 * is off.
	 */
	live_models_sync_interval_minutes: number;
}

const SECONDS_PER_MINUTE = 60;

/** Server seconds to form minutes, falling back to the default when unset. */
function toSyncMinutes(intervalSeconds: number | undefined): number {
	if (intervalSeconds === LIVE_MODELS_SYNC_DISABLED) return 0;
	const effective = intervalSeconds ?? DEFAULT_LIVE_MODELS_SYNC_INTERVAL;
	return Math.round(effective / SECONDS_PER_MINUTE);
}

export default function ModelSettingsView() {
	const { t } = useTranslation("config");
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const frameworkConfig = bifrostConfig?.framework_config;
	const clientConfig = bifrostConfig?.client_config;
	const [updateCoreConfig, { isLoading }] = useUpdateCoreConfigMutation();

	const {
		register,
		handleSubmit,
		formState: { errors, isDirty },
		reset,
		watch,
	} = useForm<ModelSettingsFormData>({
		defaultValues: {
			routing_chain_max_depth: DefaultCoreConfig.routing_chain_max_depth,
			live_models_sync_interval_minutes: DEFAULT_LIVE_MODELS_SYNC_INTERVAL / SECONDS_PER_MINUTE,
		},
	});

	const formValues = watch();

	useEffect(() => {
		if (!bifrostConfig || isDirty) return;
		reset({
			routing_chain_max_depth: clientConfig?.routing_chain_max_depth ?? DefaultCoreConfig.routing_chain_max_depth,
			live_models_sync_interval_minutes: toSyncMinutes(frameworkConfig?.live_models_sync_interval),
		});
	}, [
		frameworkConfig?.live_models_sync_interval,
		clientConfig?.routing_chain_max_depth,
		isDirty,
		reset,
		bifrostConfig,
	]);

	const hasChanges = useMemo(() => {
		if (!bifrostConfig || !isDirty) return false;
		const serverDepth = clientConfig?.routing_chain_max_depth ?? DefaultCoreConfig.routing_chain_max_depth;
		const serverLiveModelsMinutes = toSyncMinutes(frameworkConfig?.live_models_sync_interval);
		return (
			formValues.routing_chain_max_depth !== serverDepth ||
			formValues.live_models_sync_interval_minutes !== serverLiveModelsMinutes
		);
	}, [bifrostConfig, frameworkConfig, clientConfig, formValues, isDirty]);

	const onSubmit = async (data: ModelSettingsFormData) => {
		try {
			await updateCoreConfig({
				...bifrostConfig!,
				framework_config: {
					...frameworkConfig,
					id: bifrostConfig?.framework_config.id || 0,
					// Pricing is no longer configurable from the UI, but the payload is a
					// full config: echo the stored values back untouched.
					pricing_url: frameworkConfig?.pricing_url ?? "",
					pricing_sync_interval: frameworkConfig?.pricing_sync_interval ?? 0,
					model_parameters_url: frameworkConfig?.model_parameters_url ?? "",
					live_models_sync_interval: data.live_models_sync_interval_minutes * SECONDS_PER_MINUTE,
				},
				client_config: {
					...clientConfig!,
					routing_chain_max_depth: data.routing_chain_max_depth,
				},
			}).unwrap();
			toast.success(t("modelSettings.toastSaved"));
			reset(data);
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	return (
		<div className="mx-auto w-full max-w-7xl space-y-4" data-testid="model-settings-view">
			<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
				<PageTitle title={t("modelSettings.title")}>{t("modelSettings.description")}</PageTitle>

				<div className="space-y-4">
					{/* Model Discovery Interval */}
					<div className="space-y-2 rounded-sm border p-4">
						<div className="space-y-0.5">
							<Label htmlFor="live-models-sync-interval">{t("modelSettings.modelDiscoveryInterval")}</Label>
							<p className="text-muted-foreground text-sm">{t("modelSettings.modelDiscoveryIntervalHelp")}</p>
						</div>
						<Input
							id="live-models-sync-interval"
							type="number"
							data-testid="live-models-sync-interval-input"
							className={errors.live_models_sync_interval_minutes ? "border-destructive" : ""}
							{...register("live_models_sync_interval_minutes", {
								required: t("modelSettings.discoveryRequired"),
								validate: (value) => {
									if (value === 0) return true;
									if (value < MIN_LIVE_MODELS_SYNC_INTERVAL / SECONDS_PER_MINUTE) {
										return t("modelSettings.discoveryMin", { min: MIN_LIVE_MODELS_SYNC_INTERVAL / SECONDS_PER_MINUTE });
									}
									if (value > 1440) return t("modelSettings.discoveryMax");
									return true;
								},
								valueAsNumber: true,
							})}
						/>
						{errors.live_models_sync_interval_minutes && (
							<p className="text-destructive text-sm">{errors.live_models_sync_interval_minutes.message}</p>
						)}
						{formValues.live_models_sync_interval_minutes === 0 && !errors.live_models_sync_interval_minutes && (
							<p className="text-muted-foreground text-sm">{t("modelSettings.modelDiscoveryOffHelp")}</p>
						)}
					</div>

					<div className="flex items-center justify-between rounded-sm border p-4">
						<div className="space-y-0.5">
							<Label htmlFor="routing-chain-max-depth">{t("modelSettings.routingChainMaxDepth")}</Label>
							<p className="text-muted-foreground text-sm">{t("modelSettings.routingChainMaxDepthHelp")}</p>
						</div>
						<Input
							id="routing-chain-max-depth"
							type="number"
							className={`w-24 ${errors.routing_chain_max_depth ? "border-destructive" : ""}`}
							data-testid="routing-chain-max-depth-input"
							{...register("routing_chain_max_depth", {
								required: t("modelSettings.routingDepthRequired"),
								min: { value: 1, message: t("modelSettings.routingDepthMin") },
								max: { value: 100, message: t("modelSettings.routingDepthMax") },
								valueAsNumber: true,
							})}
						/>
						{errors.routing_chain_max_depth && <p className="text-destructive text-sm">{errors.routing_chain_max_depth.message}</p>}
					</div>

					<div className="bg-card sticky bottom-0 flex justify-end gap-2 py-2">
						<Button type="submit" disabled={!hasChanges || isLoading || !hasSettingsUpdateAccess} data-testid="model-settings-save-btn">
							{isLoading ? t("saving") : t("saveChanges")}
						</Button>
					</div>
				</div>
			</form>
		</div>
	);
}
