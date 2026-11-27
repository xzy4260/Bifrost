import FullPageLoader from "@/components/fullPageLoader";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alertDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderSelector } from "@/components/ui/providerSelector";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { RenderProviderIcon } from "@/lib/constants/icons";
import { ProviderLabels, ProviderName } from "@/lib/constants/logs";
import { parseAsSafeString } from "@/lib/queryParamsParser";
import { parseAsBoolean } from "nuqs";
import {
	getErrorMessage,
	ModelDetails,
	useGetModelDetailsQuery,
	useDeleteModelCatalogEntryMutation,
	useGetProvidersQuery,
	useUpsertModelCatalogEntriesMutation,
} from "@/lib/store";
import { KnownProvider } from "@/lib/types/config";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { ChevronLeft, ChevronRight, Edit, Plus, Search, Trash2 } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import AttributeSheet from "./attributeSheet";
import { getLocale } from "@/lib/i18n";

// The filter spells "no provider filter" as a sentinel, since the control needs a value to
// show for it. Module level so its identity is stable across renders.
const ALL_PROVIDERS_VALUE = "__all__";

const PAGE_SIZE = 25;

const toTestIdPart = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

function DescriptionCell({ description }: { description?: string }) {
	if (!description) return <span className="text-muted-foreground text-sm">—</span>;
	const truncated = description.length > 80;
	const text = truncated ? `${description.slice(0, 80)}…` : description;
	if (!truncated) return <span className="block truncate text-sm">{text}</span>;
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="block truncate text-sm">{text}</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-md">{description}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function formatTokenCount(value?: number): string {
	if (value === undefined || value === null) return "—";
	return value.toLocaleString(getLocale());
}

// Local row type for the other-attributes editor, mirroring the edit sheet: an
// id that only exists for render stability, and a key/value pair.
interface AttributeRow {
	id: string;
	key: string;
	value: string;
}

let addRowIdCounter = 0;
function newRowId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	addRowIdCounter += 1;
	return `add-row-${addRowIdCounter}`;
}

interface AddModelSheetProps {
	onClose: () => void;
	onSaved?: () => void;
}

/**
 * Adds a (model, provider) entry the datasheet does not know about. Everything
 * it collects lands on the same governance_model_pricing row the catalog reads,
 * so the new model then behaves like any other catalog entry.
 */
function AddModelSheet({ onClose, onSaved }: AddModelSheetProps) {
	const { t } = useTranslation("models");
	const { t: tc } = useTranslation("common");
	const hasUpdateAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const [upsertEntries, { isLoading }] = useUpsertModelCatalogEntriesMutation();

	const [isOpen, setIsOpen] = useState(true);
	const [provider, setProvider] = useState("");
	const [modelId, setModelId] = useState("");
	const [contextWindow, setContextWindow] = useState("");
	const [maxOutput, setMaxOutput] = useState("");
	const [description, setDescription] = useState("");
	const [rows, setRows] = useState<AttributeRow[]>([]);

	const handleClose = () => {
		setIsOpen(false);
		setTimeout(() => onClose(), 150);
	};

	const parseCount = (raw: string): number | undefined => {
		const trimmed = raw.trim();
		if (trimmed === "") return undefined;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
	};

	const handleSubmit = async () => {
		if (!hasUpdateAccess) {
			toast.error(t("modelCatalog.noPermission"));
			return;
		}
		if (!provider || modelId.trim() === "") {
			toast.error(t("modelCatalog.addModelRequired"));
			return;
		}
		const cleaned = rows.map((r) => ({ key: r.key.trim(), value: r.value })).filter((r) => r.key !== "" || r.value !== "");
		if (cleaned.some((r) => r.key === "")) {
			toast.error(t("modelCatalog.rowsNeedKey"));
			return;
		}
		const duplicate = cleaned.find((r, i) => cleaned.findIndex((other) => other.key === r.key) !== i);
		if (duplicate) {
			toast.error(t("modelCatalog.duplicateKey", { key: duplicate.key }));
			return;
		}

		const attributes: Record<string, string> = {};
		const desc = description.trim();
		if (desc !== "") attributes.description = desc;
		for (const row of cleaned) attributes[row.key] = row.value;

		try {
			await upsertEntries([
				{
					model: modelId.trim(),
					provider,
					mode: "chat",
					context_length: parseCount(contextWindow),
					max_output_tokens: parseCount(maxOutput),
					additional_attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
				},
			]).unwrap();
			toast.success(t("modelCatalog.modelAdded"));
			onSaved?.();
			handleClose();
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
			<SheetContent className="flex w-full flex-col overflow-x-hidden pt-4" data-testid="model-catalog-add-model-sheet">
				<SheetHeader className="flex flex-col items-start p-0 py-4" headerClassName="mb-0 sticky -top-4 bg-card z-10 px-4 md:px-8">
					<SheetTitle>{t("modelCatalog.addModel")}</SheetTitle>
					<SheetDescription>{t("modelCatalog.addModelDescription")}</SheetDescription>
				</SheetHeader>

				<div className="flex h-full flex-col gap-6">
					<div className="grow space-y-4 px-4 md:px-8">
						<div>
							<Label className="text-sm font-medium">{t("modelCatalog.provider")}</Label>
							<div className="mt-2">
								<ProviderSelector
									data-testid="model-catalog-add-provider"
									value={provider}
									onChange={setProvider}
									disabled={!hasUpdateAccess}
								/>
							</div>
						</div>

						<div>
							<Label className="text-sm font-medium">{t("modelCatalog.modelId")}</Label>
							<Input
								className="mt-2 font-mono"
								value={modelId}
								onChange={(e) => setModelId(e.target.value)}
								placeholder={t("modelCatalog.modelIdPlaceholder")}
								disabled={!hasUpdateAccess}
								data-testid="model-catalog-add-model-id"
							/>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<Label className="text-sm font-medium">{t("modelCatalog.contextWindow")}</Label>
								<Input
									className="mt-2"
									type="number"
									min={0}
									value={contextWindow}
									onChange={(e) => setContextWindow(e.target.value)}
									placeholder="128000"
									disabled={!hasUpdateAccess}
									data-testid="model-catalog-add-context-window"
								/>
							</div>
							<div>
								<Label className="text-sm font-medium">{t("modelCatalog.maxOutputTokens")}</Label>
								<Input
									className="mt-2"
									type="number"
									min={0}
									value={maxOutput}
									onChange={(e) => setMaxOutput(e.target.value)}
									placeholder="8192"
									disabled={!hasUpdateAccess}
									data-testid="model-catalog-add-max-output"
								/>
							</div>
						</div>

						<div>
							<Label className="text-sm font-medium">{t("modelCatalog.description")}</Label>
							<Textarea
								className="mt-2"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={4}
								placeholder={t("modelCatalog.descriptionPlaceholder")}
								disabled={!hasUpdateAccess}
								data-testid="model-catalog-add-description"
							/>
						</div>

						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<Label className="text-sm font-medium">{t("modelCatalog.otherAttributes")}</Label>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setRows((prev) => [...prev, { id: newRowId(), key: "", value: "" }])}
									disabled={!hasUpdateAccess}
									data-testid="model-catalog-add-attribute-row"
								>
									<Plus className="mr-1 h-3 w-3" />
									{t("modelCatalog.add")}
								</Button>
							</div>
							{rows.length === 0 ? (
								<p className="text-muted-foreground text-xs">{t("modelCatalog.noExtraAttributes")}</p>
							) : (
								<div className="space-y-2">
									{rows.map((row, i) => (
										<div key={row.id} className="flex items-start gap-2">
											<Input
												value={row.key}
												onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
												placeholder={t("modelCatalog.attributeKeyPlaceholder")}
												className="flex-1"
												disabled={!hasUpdateAccess}
												data-testid={`model-catalog-attribute-key-${i}`}
											/>
											<Input
												value={row.value}
												onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
												placeholder={t("modelCatalog.attributeValuePlaceholder")}
												className="flex-1"
												disabled={!hasUpdateAccess}
												data-testid={`model-catalog-attribute-value-${i}`}
											/>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
												disabled={!hasUpdateAccess}
												data-testid={`model-catalog-attribute-remove-${i}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					<div className="bg-card sticky bottom-0 shrink-0 border-t px-4 py-4 md:px-8">
						<div className="flex items-center justify-end gap-3">
							{!hasUpdateAccess && <p className="text-destructive text-sm">{t("modelCatalog.noPermission")}</p>}
							<Button type="button" variant="outline" onClick={handleClose} data-testid="model-catalog-add-model-cancel">
								{tc("cancel")}
							</Button>
							<Button
								type="button"
								onClick={handleSubmit}
								isLoading={isLoading}
								disabled={isLoading || !hasUpdateAccess}
								data-testid="model-catalog-add-model-submit"
							>
								{t("modelCatalog.confirmAdd")}
							</Button>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

interface AttributesTabProps {
	hasAccess: boolean;
}

export default function AttributesTab({ hasAccess }: AttributesTabProps) {
	const { t } = useTranslation("models");
	const { t: tc } = useTranslation("common");
	const allProvidersOption = useMemo(() => ({ value: ALL_PROVIDERS_VALUE, label: t("modelCatalog.allProvidersLower") }), [t]);
	const hasUpdateAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const [deleteModelCatalogEntry, { isLoading: isDeleting }] = useDeleteModelCatalogEntryMutation();

	// Search and provider filter live in the URL so they survive a refresh and
	// can be shared as a link. Replace rather than push so typing doesn't fill
	// browser history with one entry per keystroke.
	const [urlState, setUrlState] = useQueryStates(
		{
			search: parseAsSafeString.withDefault(""),
			provider: parseAsSafeString.withDefault(""),
			missing_context: parseAsBoolean.withDefault(false),
			missing_max_output: parseAsBoolean.withDefault(false),
		},
		{ history: "replace" },
	);
	const { search, provider: providerFilter, missing_context: missingContext, missing_max_output: missingMaxOutput } = urlState;

	const [offset, setOffset] = useState(0);
	const [editing, setEditing] = useState<ModelDetails | null>(null);
	const [adding, setAdding] = useState(false);
	const [deleting, setDeleting] = useState<ModelDetails | null>(null);

	// Only the query is debounced — the input itself stays URL-driven so it
	// echoes keystrokes immediately.
	const debouncedSearch = useDebouncedValue(search, 300);

	// Reset to first page when filters change
	useEffect(() => {
		setOffset(0);
	}, [debouncedSearch, providerFilter, missingContext, missingMaxOutput]);

	const { data: providersData } = useGetProvidersQuery(undefined, { skip: !hasAccess });
	const { data, isLoading, error, refetch } = useGetModelDetailsQuery(
		{
			query: debouncedSearch || undefined,
			provider: providerFilter || undefined,
			limit: PAGE_SIZE,
			offset,
			unfiltered: true,
			missingContextWindow: missingContext,
			missingMaxOutputTokens: missingMaxOutput,
		},
		{ skip: !hasAccess },
	);

	const models = data?.models ?? [];
	const totalCount = data?.total ?? 0;

	// Snap offset back when total shrinks past current page
	useEffect(() => {
		if (offset < totalCount) return;
		setOffset(totalCount === 0 ? 0 : Math.floor((totalCount - 1) / PAGE_SIZE) * PAGE_SIZE);
	}, [totalCount, offset]);

	// Clear the provider filter if the selected provider is no longer in the list
	useEffect(() => {
		if (!providerFilter || !providersData) return;
		if (!providersData.some((p) => p.name === providerFilter)) {
			setUrlState({ provider: null });
		}
	}, [providersData, providerFilter, setUrlState]);

	const handleDelete = async () => {
		if (!deleting) return;
		try {
			await deleteModelCatalogEntry({ model: deleting.name, provider: deleting.provider }).unwrap();
			toast.success(t("modelCatalog.modelDeleted"));
			setDeleting(null);
			// Pull the list again as soon as the row leaves service: the deleted
			// model must disappear without waiting for a manual refresh.
			void refetch();
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	if (isLoading && !data) return <FullPageLoader />;

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 text-center">
				<p className="text-muted-foreground text-sm">{t("modelCatalog.failedLoadModels")}</p>
				<button type="button" onClick={refetch} className="text-sm underline" data-testid="model-catalog-retry-button">
					{t("modelCatalog.retry")}
				</button>
			</div>
		);
	}

	return (
		<>
			{editing && <AttributeSheet model={editing} onClose={() => setEditing(null)} onSaved={() => void refetch()} />}
			{adding && <AddModelSheet onClose={() => setAdding(false)} onSaved={() => void refetch()} />}
			{deleting && (
				<AlertDialog open onOpenChange={(open) => !open && !isDeleting && setDeleting(null)}>
					<AlertDialogContent data-testid="model-catalog-delete-dialog">
						<AlertDialogHeader>
							<AlertDialogTitle>{t("modelCatalog.deleteModelTitle")}</AlertDialogTitle>
							<AlertDialogDescription>{t("modelCatalog.deleteModelDescription")}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isDeleting}>{tc("cancel")}</AlertDialogCancel>
							<AlertDialogAction
								disabled={isDeleting}
								onClick={(e) => {
									e.preventDefault();
									void handleDelete();
								}}
								data-testid="model-catalog-delete-confirm"
							>
								{t("modelCatalog.deleteModel")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}

			<div className="flex min-h-0 w-full grow flex-col overflow-hidden">
				<div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
					<div>
						<h2 className="text-lg font-semibold">{t("modelCatalog.models")}</h2>
						<p className="text-muted-foreground text-sm">{t("modelCatalog.modelsSubtitle")}</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setAdding(true)}
						disabled={!hasUpdateAccess}
						data-testid="model-catalog-add-model-btn"
					>
						<Plus className="mr-1 h-4 w-4" />
						{t("modelCatalog.addModel")}
					</Button>
				</div>

				<div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
					<div className="relative w-full max-w-sm flex-1 basis-full sm:basis-auto">
						<Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
						<Input
							aria-label={t("modelCatalog.searchAria")}
							placeholder={t("modelCatalog.searchByModelName")}
							value={search}
							onChange={(e) => setUrlState({ search: e.target.value || null })}
							className="pl-9"
							data-testid="model-catalog-search-input"
						/>
					</div>
					<ProviderSelector
						data-testid="model-catalog-provider-filter"
						className="w-full sm:w-[200px]"
						allOption={allProvidersOption}
						value={providerFilter || ALL_PROVIDERS_VALUE}
						onChange={(v: string) => setUrlState({ provider: v === ALL_PROVIDERS_VALUE ? null : v })}
					/>
					<div className="flex items-center gap-2">
						<Checkbox
							id="model-catalog-missing-context"
							checked={missingContext}
							onCheckedChange={(checked) => setUrlState({ missing_context: checked === true ? true : null })}
							data-testid="model-catalog-missing-context-checkbox"
						/>
						<Label htmlFor="model-catalog-missing-context" className="cursor-pointer text-sm font-normal">
							{t("modelCatalog.missingContextWindow")}
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id="model-catalog-missing-max-output"
							checked={missingMaxOutput}
							onCheckedChange={(checked) => setUrlState({ missing_max_output: checked === true ? true : null })}
							data-testid="model-catalog-missing-max-output-checkbox"
						/>
						<Label htmlFor="model-catalog-missing-max-output" className="cursor-pointer text-sm font-normal">
							{t("modelCatalog.missingMaxOutput")}
						</Label>
					</div>
				</div>

				<div className="mb-2 min-h-0 grow overflow-hidden rounded-sm border" data-testid="model-catalog-attributes-table">
					<Table containerClassName="h-full overflow-y-auto overflow-x-auto" className="table-fixed">
						<TableHeader className="bg-muted sticky top-0 z-20">
							<TableRow className="hover:bg-transparent">
								<TableHead className="w-[116px] font-medium">{t("modelCatalog.provider")}</TableHead>
								<TableHead className="font-medium">{t("modelCatalog.model")}</TableHead>
								<TableHead className="w-[132px] px-2 text-right font-medium">{t("modelCatalog.colContextWindow")}</TableHead>
								<TableHead className="w-[132px] px-2 text-right font-medium">{t("modelCatalog.colMaxOutput")}</TableHead>
								<TableHead className="font-medium">{t("modelCatalog.colDescription")}</TableHead>
								<TableHead className="w-[68px] font-medium">{t("modelCatalog.colOther")}</TableHead>
								<TableHead className="w-[104px] px-1"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{models.length === 0 ? (
								<TableRow>
									<TableCell colSpan={7} className="h-24 text-center">
										<span className="text-muted-foreground text-sm">
											{!debouncedSearch && !providerFilter ? t("modelCatalog.noModelsLoaded") : t("modelCatalog.noMatchingModels")}
										</span>
									</TableCell>
								</TableRow>
							) : (
								models.map((m) => {
									const attrs = m.additional_attributes ?? {};
									const extraKeys = Object.keys(attrs).filter((k) => k !== "description" && k !== "context_window" && k !== "max_output_tokens");
									const testKey = `${toTestIdPart(m.name)}-${toTestIdPart(m.provider)}`;
									return (
										<TableRow key={`${m.provider}|${m.name}`} data-testid={`model-catalog-row-${testKey}`}>
											<TableCell className="py-3">
												<div className="flex min-w-0 items-center gap-2">
													<RenderProviderIcon provider={m.provider as KnownProvider} size="sm" className="h-4 w-4" />
													<span className="truncate text-sm">{ProviderLabels[m.provider as ProviderName] || m.provider}</span>
												</div>
											</TableCell>
											<TableCell className="truncate py-3 font-mono text-sm" title={m.name}>
												{m.name}
											</TableCell>
											<TableCell className="px-2 py-3 text-right font-mono text-sm" data-testid={`model-catalog-context-window-${testKey}`}>
												{formatTokenCount(m.context_length)}
											</TableCell>
											<TableCell className="px-2 py-3 text-right font-mono text-sm" data-testid={`model-catalog-max-output-${testKey}`}>
												{formatTokenCount(m.max_output_tokens)}
											</TableCell>
											<TableCell className="py-3">
												<DescriptionCell description={attrs.description} />
											</TableCell>
											<TableCell className="py-3">
												{extraKeys.length === 0 ? (
													<span className="text-muted-foreground text-sm">—</span>
												) : (
													<div className="flex flex-wrap gap-1 pr-4">
														<Badge variant="secondary">{t("modelCatalog.attribute", { count: extraKeys.length })}</Badge>
													</div>
												)}
											</TableCell>
											<TableCell className="px-1 py-3">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7"
														disabled={!hasUpdateAccess}
														onClick={() => setEditing(m)}
														aria-label={t("modelCatalog.editAttributesFor", { name: m.name })}
														data-testid={`model-catalog-edit-${testKey}`}
													>
														<Edit className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="text-muted-foreground hover:text-destructive h-7 w-7"
														disabled={!hasUpdateAccess}
														onClick={() => setDeleting(m)}
														aria-label={t("modelCatalog.deleteModelFor", { name: m.name })}
														data-testid={`model-catalog-delete-${testKey}`}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</div>

				{totalCount > 0 && (
					<div className="flex shrink-0 items-center justify-between text-xs" data-testid="model-catalog-pagination">
						<div className="text-muted-foreground">
							{t("modelCatalog.rangeOfEntries", {
								from: (offset + 1).toLocaleString(getLocale()),
								to: Math.min(offset + PAGE_SIZE, totalCount).toLocaleString(getLocale()),
								total: totalCount.toLocaleString(getLocale()),
							})}
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
								disabled={offset === 0}
								data-testid="model-catalog-pagination-prev-btn"
								aria-label={t("modelCatalog.previousPage")}
							>
								<ChevronLeft className="size-3" />
							</Button>
							<div className="flex items-center gap-1">
								<span>{t("modelCatalog.page")}</span>
								<span>{Math.floor(offset / PAGE_SIZE) + 1}</span>
								<span>{t("modelCatalog.pageOf", { total: Math.ceil(totalCount / PAGE_SIZE) })}</span>
							</div>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setOffset(offset + PAGE_SIZE)}
								disabled={offset + PAGE_SIZE >= totalCount}
								data-testid="model-catalog-pagination-next-btn"
								aria-label={t("modelCatalog.nextPage")}
							>
								<ChevronRight className="size-3" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
}
