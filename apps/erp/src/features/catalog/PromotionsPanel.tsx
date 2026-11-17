import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CheckCircle2, Pencil, Plus, Power, RefreshCw, Search, Tag, X } from "lucide-react";
import { FeedbackAlert, StatePanel, StatusPill } from "../../components/erp/WorkspaceUi";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import {
  buildTargetKey,
  buildUpsertPromotionPayload,
  currentLocalDateTimeInput,
  PROMOTION_CHANNELS,
  promotionSchema,
  toLocalDateTimeInput,
  type CatalogProductOption,
  type PromotionChannel,
  type PromotionFormValues,
  type PromotionTargetInput,
  type PromotionWithTargets,
} from "./promotionsSchema";
import {
  fetchPromotionProductsByIds,
  listPromotions,
  searchPromotionProducts,
  setPromotionActive,
  upsertPromotion,
} from "./promotionsApi";

const CHANNEL_LABELS: Record<PromotionChannel, string> = {
  web: "Web",
  pos: "POS",
};

const defaultFormValues = (): PromotionFormValues => ({
  name: "",
  kind: "porcentaje",
  value: 10,
  startsAt: currentLocalDateTimeInput(),
  endsAt: "",
  isActive: true,
  channels: ["web", "pos"],
  targets: [],
});

export const PromotionsPanel: React.FC = () => {
  const { organizationId, hasPermission } = useErpAuth();
  const canManage = hasPermission("pricing.manage");

  const [promotions, setPromotions] = useState<PromotionWithTargets[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<CatalogProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [productLookup, setProductLookup] = useState<Record<string, CatalogProductOption>>({});

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: defaultFormValues(),
  });

  const watchedKind = form.watch("kind");
  const watchedChannels = form.watch("channels");
  const watchedTargets = form.watch("targets");

  const selectedTargetKeys = useMemo(
    () => new Set(watchedTargets.map((target) => buildTargetKey(target.product_id, target.variant_id))),
    [watchedTargets],
  );

  const registerProducts = useCallback((items: CatalogProductOption[]) => {
    if (items.length === 0) return;
    setProductLookup((prev) => {
      const next = { ...prev };
      for (const item of items) {
        next[item.id] = item;
      }
      return next;
    });
  }, []);

  const loadPromotions = useCallback(async () => {
    if (!organizationId) {
      setError("No hay una organización ERP activa para consultar promociones.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await listPromotions();
      setPromotions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las promociones.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadPromotions();
  }, [loadPromotions]);

  useEffect(() => {
    if (!isFormOpen || !canManage) return;
    let active = true;

    const runSearch = async () => {
      try {
        setLoadingProducts(true);
        setProductSearchError(null);
        const items = await searchPromotionProducts(productSearch);
        if (!active) return;
        setProductResults(items);
        registerProducts(items);
      } catch (err) {
        if (!active) return;
        setProductSearchError(err instanceof Error ? err.message : "No se pudieron buscar productos.");
      } finally {
        if (active) setLoadingProducts(false);
      }
    };

    void runSearch();
    return () => {
      active = false;
    };
  }, [canManage, isFormOpen, productSearch, registerProducts]);

  const openCreateForm = () => {
    if (!canManage) return;
    setEditingId(null);
    setProductSearch("");
    setFeedback(null);
    form.reset(defaultFormValues());
    setIsFormOpen(true);
  };

  const openEditForm = async (promo: PromotionWithTargets) => {
    if (!canManage) return;
    setEditingId(promo.id);
    setProductSearch("");
    setFeedback(null);
    form.reset({
      name: promo.name,
      kind: promo.kind,
      value: promo.value,
      startsAt: toLocalDateTimeInput(promo.starts_at),
      endsAt: toLocalDateTimeInput(promo.ends_at),
      isActive: promo.is_active,
      channels: promo.channels,
      targets: promo.targets.map((target) => ({
        product_id: target.product_id,
        variant_id: target.variant_id,
      })),
    });
    setIsFormOpen(true);

    const missingProductIds = promo.targets
      .map((target) => target.product_id)
      .filter((productId) => !productLookup[productId]);
    if (missingProductIds.length > 0) {
      try {
        const fetched = await fetchPromotionProductsByIds(missingProductIds);
        registerProducts(fetched);
      } catch {
        // Fallback label stays available if lookup fails
      }
    }
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    form.reset(defaultFormValues());
  };

  const handleToggleChannel = (channel: PromotionChannel) => {
    const exists = watchedChannels.includes(channel);
    const nextChannels = exists
      ? watchedChannels.filter((item) => item !== channel)
      : [...watchedChannels, channel];
    form.setValue("channels", nextChannels, { shouldValidate: true });
  };

  const handleAddTarget = (product: CatalogProductOption, variantId: string | null) => {
    registerProducts([product]);
    const key = buildTargetKey(product.id, variantId);
    if (selectedTargetKeys.has(key)) return;
    form.setValue(
      "targets",
      [...watchedTargets, { product_id: product.id, variant_id: variantId }],
      { shouldValidate: true },
    );
  };

  const handleRemoveTarget = (productId: string, variantId?: string | null) => {
    const targetKey = buildTargetKey(productId, variantId);
    form.setValue(
      "targets",
      watchedTargets.filter(
        (target) => buildTargetKey(target.product_id, target.variant_id) !== targetKey,
      ),
      { shouldValidate: true },
    );
  };

  const formatTargetLabel = (target: PromotionTargetInput): string => {
    const product = productLookup[target.product_id];
    if (!product) return `Producto ${target.product_id.slice(0, 8)}`;
    const baseLabel = `${product.internal_code} · ${product.internal_name}`;
    if (!target.variant_id) return `${baseLabel} (Todo el producto)`;
    const variant = product.product_variants.find((item) => item.id === target.variant_id);
    return variant ? `${baseLabel} — ${variant.name}` : `${baseLabel} (Variante)`;
  };

  const onSubmit = async (values: PromotionFormValues) => {
    if (!canManage) {
      setFeedback({ type: "error", message: "Tu rol no tiene permiso para administrar promociones." });
      return;
    }
    const parsed = promotionSchema.safeParse(values);
    if (!parsed.success) {
      setFeedback({
        type: "error",
        message: parsed.error.issues[0]?.message ?? "Revisá los datos de la promoción.",
      });
      return;
    }

    try {
      setSubmitting(true);
      setFeedback(null);
      const payload = buildUpsertPromotionPayload(parsed.data, editingId);
      await upsertPromotion(payload);
      setFeedback({
        type: "success",
        message: editingId
          ? `Promoción "${payload.p_name}" actualizada.`
          : `Promoción "${payload.p_name}" creada.`,
      });
      closeForm();
      await loadPromotions();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "No se pudo guardar la promoción.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (promo: PromotionWithTargets) => {
    if (!canManage) return;
    try {
      setTogglingId(promo.id);
      setFeedback(null);
      const nextActive = !promo.is_active;
      await setPromotionActive(promo.id, nextActive);
      setFeedback({
        type: "success",
        message: nextActive
          ? `Promoción "${promo.name}" activada.`
          : `Promoción "${promo.name}" desactivada.`,
      });
      await loadPromotions();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "No se pudo cambiar el estado de la promoción.",
      });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="flow-card">
      <div className="flow-card__header" style={{ flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 className="flow-card__title">Promociones</h2>
          <p className="flow-card__subtitle">
            Descuentos porcentuales o precios fijos por vigencia y canal, sin sobrescribir el precio de lista.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="pag-btn"
            onClick={() => void loadPromotions()}
            disabled={loading}
            title="Recargar promociones"
            aria-label="Recargar promociones"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {canManage && !isFormOpen && (
            <button type="button" className="btn-primary" onClick={openCreateForm}>
              <Plus size={15} />
              Nueva promoción
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div style={{ marginBottom: "14px" }}>
          <FeedbackAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
        </div>
      )}

      {canManage && isFormOpen && (
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          style={{
            marginBottom: "20px",
            padding: "16px",
            border: "1px solid var(--border-line)",
            borderRadius: "12px",
            background: "var(--surface-subtle)",
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "14px",
          }}
        >
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <strong style={{ fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Tag size={15} />
              {editingId ? "Editar promoción" : "Nueva promoción"}
            </strong>
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={submitting}>
              <X size={14} />
              Cancelar
            </button>
          </div>

          <label className="erp-form-group" style={{ gridColumn: "1 / -1" }}>
            Nombre de la promoción
            <input
              className="erp-form-input"
              placeholder="Ej: Hot Sale Accesorios"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.name.message}
              </span>
            )}
          </label>

          <label className="erp-form-group">
            Tipo de promoción
            <select className="erp-form-input" {...form.register("kind")}>
              <option value="porcentaje">Porcentaje (%)</option>
              <option value="precio_fijo">Precio fijo (ARS)</option>
            </select>
            {form.formState.errors.kind && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.kind.message}
              </span>
            )}
          </label>

          <label className="erp-form-group">
            {watchedKind === "porcentaje" ? "Porcentaje de descuento (%)" : "Precio promocional (ARS)"}
            <input
              className="erp-form-input"
              type="number"
              min="0.01"
              max={watchedKind === "porcentaje" ? "99.99" : undefined}
              step="0.01"
              {...form.register("value")}
            />
            {form.formState.errors.value && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.value.message}
              </span>
            )}
          </label>

          <label className="erp-form-group">
            Inicio de vigencia
            <input className="erp-form-input" type="datetime-local" {...form.register("startsAt")} />
            {form.formState.errors.startsAt && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.startsAt.message}
              </span>
            )}
          </label>

          <label className="erp-form-group">
            Fin de vigencia (opcional)
            <input className="erp-form-input" type="datetime-local" {...form.register("endsAt")} />
            {form.formState.errors.endsAt && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.endsAt.message}
              </span>
            )}
          </label>

          <div className="erp-form-group">
            <span>Canales habilitados</span>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", minHeight: "38px" }}>
              {PROMOTION_CHANNELS.map((channel) => {
                const checked = watchedChannels.includes(channel);
                return (
                  <label
                    key={channel}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleChannel(channel)}
                    />
                    {CHANNEL_LABELS[channel]}
                  </label>
                );
              })}
            </div>
            {form.formState.errors.channels && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.channels.message}
              </span>
            )}
          </div>

          <div className="erp-form-group">
            <span>Estado</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "38px" }}>
              <input type="checkbox" {...form.register("isActive")} />
              Promoción activa
            </label>
          </div>

          <div className="erp-form-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="promo-product-search">Buscar producto o variante</label>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  opacity: 0.6,
                }}
              />
              <input
                id="promo-product-search"
                className="erp-form-input"
                style={{ paddingLeft: "32px" }}
                placeholder="Buscar por nombre o código..."
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
              />
            </div>

            {productSearchError && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {productSearchError}
              </span>
            )}

            <div
              style={{
                maxHeight: "180px",
                overflowY: "auto",
                border: "1px solid var(--border-line)",
                borderRadius: "8px",
                background: "var(--surface-white)",
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {loadingProducts ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Buscando productos…</span>
              ) : productResults.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  No se encontraron productos activos para mostrar.
                </span>
              ) : (
                productResults.map((product) => {
                  const activeVariants = (product.product_variants ?? []).filter((v) => v.is_active);
                  const productKey = buildTargetKey(product.id, null);
                  const productSelected = selectedTargetKeys.has(productKey);

                  return (
                    <div
                      key={product.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        paddingBottom: "8px",
                        borderBottom: "1px solid var(--border-line)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: "13px", fontWeight: 600 }}>
                          {product.internal_code} · {product.internal_name}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ minHeight: "30px", padding: "4px 10px", fontSize: "12px" }}
                          disabled={productSelected}
                          onClick={() => handleAddTarget(product, null)}
                        >
                          {productSelected ? "Agregado" : "Agregar producto"}
                        </button>
                      </div>

                      {activeVariants.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {activeVariants.map((variant) => {
                            const variantKey = buildTargetKey(product.id, variant.id);
                            const variantSelected = selectedTargetKeys.has(variantKey);
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                className="btn-pill"
                                style={{ minHeight: "28px", padding: "4px 10px", fontSize: "12px" }}
                                disabled={variantSelected}
                                onClick={() => handleAddTarget(product, variant.id)}
                              >
                                + {variant.name} ({variant.code})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {watchedTargets.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Todavía no seleccionaste productos ni variantes.
                </span>
              ) : (
                watchedTargets.map((target) => {
                  const key = buildTargetKey(target.product_id, target.variant_id);
                  const label = formatTargetLabel(target);
                  return (
                    <span
                      key={key}
                      className="status-pill status-pill--navy"
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <span>{label}</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${label}`}
                        onClick={() => handleRemoveTarget(target.product_id, target.variant_id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          cursor: "pointer",
                          display: "inline-flex",
                          padding: 0,
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            {form.formState.errors.targets && (
              <span role="alert" style={{ color: "var(--rose-accent)", fontSize: "11px" }}>
                {form.formState.errors.targets.message}
              </span>
            )}
          </div>

          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button type="submit" className="btn-primary" disabled={submitting}>
              <Plus size={15} />
              {submitting ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar promoción"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <StatePanel type="loading" title="Cargando promociones" message="Consultando promociones activas y programadas…" />
      ) : error ? (
        <StatePanel type="error" title="Error al cargar promociones" message={error} />
      ) : promotions.length === 0 ? (
        <StatePanel
          type="empty"
          title="Sin promociones configuradas"
          message={
            canManage
              ? "Creá una promoción para aplicar descuentos por vigencia en Web o POS."
              : "Todavía no hay promociones registradas en esta organización."
          }
        />
      ) : (
        <div className="flow-table-wrapper">
          <table className={`flow-table ${canManage ? "flow-table--actions" : ""}`}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Vigencia</th>
                <th>Canales</th>
                <th>Productos</th>
                <th>Estado</th>
                {canManage && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {promotions.map((promo) => (
                <tr key={promo.id}>
                  <td style={{ fontWeight: 600 }}>{promo.name}</td>
                  <td>{promo.kind === "porcentaje" ? "Porcentaje" : "Precio fijo"}</td>
                  <td style={{ fontWeight: 700 }}>
                    {promo.kind === "porcentaje"
                      ? `${promo.value}%`
                      : formatCurrency(promo.value, "ARS")}
                  </td>
                  <td>
                    <div style={{ fontSize: "12px" }}>
                      <div>Desde: {formatDateTime(promo.starts_at)}</div>
                      <div style={{ color: "var(--text-muted)" }}>
                        {promo.ends_at ? `Hasta: ${formatDateTime(promo.ends_at)}` : "Sin fecha de fin"}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {promo.channels.map((channel) => (
                        <StatusPill key={channel} variant="navy">
                          {CHANNEL_LABELS[channel] ?? channel}
                        </StatusPill>
                      ))}
                    </div>
                  </td>
                  <td>
                    {promo.targets.length} {promo.targets.length === 1 ? "producto" : "productos"}
                  </td>
                  <td>
                    <StatusPill variant={promo.is_active ? "mint" : "slate"}>
                      {promo.is_active ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <CheckCircle2 size={12} />
                          Activa
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <Ban size={12} />
                          Inactiva
                        </span>
                      )}
                    </StatusPill>
                  </td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                          onClick={() => void openEditForm(promo)}
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                          disabled={togglingId === promo.id}
                          onClick={() => void handleToggleActive(promo)}
                        >
                          <Power size={13} />
                          {promo.is_active ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
