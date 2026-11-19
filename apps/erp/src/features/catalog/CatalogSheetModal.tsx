import React, { useEffect, useId, useRef, useState } from "react";
import { Package } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, FormError } from "../../components/erp/FormFeedback";
import { ConfirmDialog, Modal } from "../../components/erp/WorkspaceUi";
import { toUserMessage } from "../../lib/errors";
import { supabase, type CatalogSheetPayload } from "../../lib/supabase";
import {
  type DbCatalogProduct,
  type MasterBrand,
  type MasterCategory,
  type MasterModel,
  type MasterLocation,
  getActiveBarcode,
  getErrorMessage,
} from "./schemas";
import {
  createCatalogSheetSchema,
  checklistLabels,
  getSellableLocations,
  hasInitialStockEntry,
  isZeroStockCost,
  suggestCatalogName,
  type CatalogSheetValues,
} from "./sheetSchema";

type Color = { id: string; name: string };
type Variant = NonNullable<CatalogSheetPayload["variants"]>[number];
type Media = NonNullable<CatalogSheetPayload["media"]>[number] & {
  file?: File;
};
type SheetProduct = DbCatalogProduct & {
  sheet_template?: "celular" | "accesorio" | "funda";
  web_status?: "draft" | "published" | "paused";
  public_description?: string | null;
  internal_description?: string | null;
  tags?: string[];
  condition?: "nuevo" | "usado" | "reacondicionado" | null;
  capacity?: string | null;
  media_initialized?: boolean;
  sheet_fields_initialized?: boolean;
};
interface Props {
  isOpen: boolean;
  onClose: () => void;
  product: SheetProduct | null;
  categories: MasterCategory[];
  brands: MasterBrand[];
  models: MasterModel[];
  locations?: MasterLocation[];
  onSuccess: (message: string) => void;
}
const empty: CatalogSheetValues = {
  isNew: true,
  template: "accesorio",
  name: "",
  category: "",
  brand: "",
  model: "",
  cost: "",
  price: "0",
  description: "",
  internalDescription: "",
  initialStock: [],
  publicName: "",
  tags: "",
  capacity: "",
  condition: "",
};
const dbMessage = (err: unknown) => {
  const raw = getErrorMessage(err, "No se pudo completar la operación.");
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(err.code)
      : "";
  return /^(PGRST202|PGRST205|42703|42883|42P01)$/.test(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(raw)
    ? "La ficha nueva requiere actualizar la base."
    : toUserMessage(err, "No se pudo completar la operación. Reintentá.");
};

const hasInvalidOwnPrice = (variant: Variant) => {
  if (variant.final_price_mode !== "own") return false;
  const price = variant.final_price_ars;
  return price == null || price < 0 || !Number.isFinite(price)
    || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001;
};

export const CatalogSheetModal: React.FC<Props> = ({
  isOpen,
  onClose,
  product,
  categories,
  brands,
  models,
  locations = [],
  onSuccess,
}) => {
  const formId = useId();
  const sellableLocations = getSellableLocations(locations);
  const defaultLocationId = sellableLocations.length === 1 ? sellableLocations[0].id : "";
  const form = useForm<CatalogSheetValues>({
    resolver: zodResolver(createCatalogSheetSchema(sellableLocations.map((location) => location.id))),
    defaultValues: empty,
    shouldFocusError: true,
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    unregister,
    reset,
    formState: { errors, dirtyFields, submitCount },
  } = form;
  const template = watch("template");
  const brand = watch("brand");
  const model = watch("model");
  const capacity = watch("capacity");
  const initialStock = watch("initialStock");
  const [nameEdited, setNameEdited] = useState(false);
  const barcodeInputs = useRef<Array<HTMLInputElement | null>>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantsDirty, setVariantsDirty] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaDirty, setMediaDirty] = useState(false);
  const [compatible, setCompatible] = useState<string[]>([]);
  const [compatibleDirty, setCompatibleDirty] = useState(false);
  const [customWeb, setCustomWeb] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [stockEnabled, setStockEnabled] = useState(false);
  const [selectedColor, setSelectedColor] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmRecode, setConfirmRecode] = useState(false);
  const [newColor, setNewColor] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    reset(
      product
        ? {
            isNew: false,
            template: product.sheet_template ?? "accesorio",
            name: product.internal_name,
            category: product.category_id ?? "",
            brand: product.brand_id ?? "",
            model: product.model_id ?? "",
            cost: "",
            price: String(product.base_sale_price),
            description: product.public_description ?? "",
            internalDescription: product.internal_description ?? "",
            initialStock: [],
            publicName: product.public_name ?? "",
            tags: (product.tags ?? []).join(", "),
            capacity: product.capacity ?? "",
            condition: product.condition ?? "",
          }
        : empty,
    );
    setCustomWeb(Boolean(product?.public_name));
    setNameEdited(Boolean(product));
    setVariantsDirty(false);
    setMediaDirty(false);
    setCompatibleDirty(false);
    setError(null);
    setMissing([]);
    setSelectedColor("");
    setStockEnabled(!product);
    setNewCode("");
    setNewColor("");
    setConfirmRecode(false);
    setLoadFailed(false);
    setVariants(
      (product?.product_variants ?? []).map((v) => ({
        id: v.id,
        code: v.code,
        name: v.name,
        barcode: getActiveBarcode(v.product_identifiers) || null,
        color_id: v.color_id ?? null,
        is_active: v.is_active,
        final_price_mode: v.final_price_ars == null ? "inherit" : "own",
        final_price_ars: v.final_price_ars ?? null,
      })),
    );
    setMedia([]);
    setCompatible([]);
    setLoading(true);
    const load = async () => {
      try {
        const colorResult = await supabase
          .from("colors")
          .select("id,name")
          .eq("is_active", true)
          .order("name");
        if (colorResult.error) throw colorResult.error;
        let loadedMedia: Media[] = [];
        let loadedModels: string[] = [];
        if (product) {
          const [mediaResult, modelResult] = await Promise.all([
            supabase
              .from("product_media")
              .select(
                "id,variant_id,storage_path,sort_order,is_primary,alt_text",
              )
              .eq("product_id", product.id)
              .eq("is_active", true)
              .order("sort_order"),
            supabase
              .from("product_compatible_models")
              .select("model_id")
              .eq("product_id", product.id)
              .eq("is_active", true),
          ]);
          if (mediaResult.error) throw mediaResult.error;
          if (modelResult.error) throw modelResult.error;
          loadedMedia = mediaResult.data ?? [];
          loadedModels = (modelResult.data ?? []).map((item) => item.model_id);
        }
        if (alive) {
          setColors(colorResult.data ?? []);
          setMedia(loadedMedia);
          setCompatible(loadedModels);
        }
      } catch (err) {
        if (alive) {
          setError(dbMessage(err));
          setLoadFailed(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [isOpen, product, reset]);
  useEffect(() => {
    if (!isOpen || product || nameEdited) return;
    setValue(
      "name",
      suggestCatalogName(
        template === "celular"
          ? "Celular"
          : template === "funda"
            ? "Funda"
            : "Accesorio",
        brands.find((item) => item.id === brand)?.name,
        models.find((item) => item.id === model)?.name,
        capacity,
      ),
      { shouldDirty: true },
    );
  }, [
    isOpen,
    product,
    nameEdited,
    template,
    brand,
    model,
    capacity,
    brands,
    models,
    setValue,
  ]);
  const changeVariant = (index: number, patch: Partial<Variant>) => {
    setVariants((old) =>
      old.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
    setVariantsDirty(true);
  };
  const addColor = () => {
    const color = colors.find((item) => item.id === selectedColor);
    if (!color || variants.some((item) => item.color_id === color.id)) {
      setError("Elegí un color que todavía no esté agregado.");
      return;
    }
    setError(null);
    setVariants((old) => [
      ...old,
      {
        code: `COL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name: color.name,
        color_id: color.id,
        final_price_mode: "inherit",
        is_active: true,
      },
    ]);
    setVariantsDirty(true);
    setSelectedColor("");
    requestAnimationFrame(() =>
      barcodeInputs.current[variants.length]?.focus(),
    );
  };
  const createColor = async () => {
    const name = newColor.trim().replace(/\s+/g, " ");
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await supabase.rpc("save_catalog_color", { p_name: name });
      if (result.error) throw result.error;
      setColors((old) =>
        [...old, result.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedColor(result.data.id);
      setNewColor("");
    } catch (err) {
      setError(dbMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const save = async (values: CatalogSheetValues) => {
    if (saving || loading) return;
    if (
      values.template === "celular" &&
      (!product ||
        dirtyFields.model ||
        dirtyFields.brand ||
        dirtyFields.template) &&
      !models.some(
        (model) => model.id === values.model && model.brand_id === values.brand,
      )
    ) {
      form.setError(
        "model",
        { message: "Elegí un modelo de la marca seleccionada." },
        { shouldFocus: true },
      );
      return;
    }
    setError(null);
    if (variantsDirty && variants.some(hasInvalidOwnPrice)) return;
    setSaving(true);
    try {
      const payload: CatalogSheetPayload = product ? { id: product.id } : {};
      if (!product || dirtyFields.name) payload.internal_name = values.name;
      if (!product || dirtyFields.category)
        payload.category_id = values.category;
      if (!product || dirtyFields.brand) payload.brand_id = values.brand;
      if (!product || dirtyFields.template)
        payload.sheet_template = values.template;
      if (!product || dirtyFields.model || dirtyFields.template)
        payload.model_id = values.template === "celular" ? values.model : null;
      if (!product || dirtyFields.price)
        payload.base_sale_price = Number(values.price);
      if (values.cost.trim()) payload.base_cost = Number(values.cost);
      if (!product || dirtyFields.internalDescription)
        payload.internal_description = values.internalDescription?.trim() || null;
      if (stockEnabled) {
        const stock = (values.initialStock ?? []).flatMap((line, index) => {
          const variant = variants[index];
          if (!line || !hasInitialStockEntry(line) || !variant || variant.is_active === false) return [];
          return [{
            variant_code: variant.code,
            quantity: Number(line.quantity),
            location_id: line.locationId || defaultLocationId,
            unit_cost: Number(line.unitCost),
          }];
        });
        if (stock.length) payload.initial_stock = stock;
      }
      if (!product || dirtyFields.description)
        payload.public_description = values.description.trim() || null;
      if (!product || dirtyFields.publicName)
        payload.public_name = customWeb
          ? values.publicName.trim() || null
          : null;
      if (!product || dirtyFields.tags)
        payload.tags = values.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
      if (!product || dirtyFields.capacity)
        payload.capacity = values.capacity.trim() || null;
      if (!product || dirtyFields.condition)
        payload.condition = values.condition || null;
      if (
        compatibleDirty ||
        (dirtyFields.template && values.template === "celular")
      )
        payload.compatible_model_ids =
          values.template === "celular" ? [] : compatible;
      if (variantsDirty) payload.variants = variants;
      if (!product && !mediaDirty) payload.media = [];
      if (mediaDirty) {
        const uploaded: NonNullable<CatalogSheetPayload["media"]> = [];
        for (const [index, item] of media.entries()) {
          let path = item.storage_path;
          if (item.file) {
            const ext =
              item.file.name
                .split(".")
                .pop()
                ?.replace(/[^a-zA-Z0-9]/g, "")
                .toLowerCase() || "jpg";
            const objectPath = `erp/${crypto.randomUUID()}.${ext}`;
            const result = await supabase.storage
              .from("product_images")
              .upload(objectPath, item.file, { contentType: item.file.type });
            if (result.error)
              throw new Error(
                `No se pudo subir ${item.file.name}. Reintentá o elegí otra foto.`,
              );
            path = supabase.storage
              .from("product_images")
              .getPublicUrl(objectPath).data.publicUrl;
          }
          uploaded.push({
            id: item.id,
            variant_id: item.variant_id,
            variant_code: item.variant_code,
            storage_path: path,
            sort_order: index,
            is_primary: item.is_primary,
            alt_text: item.alt_text,
          });
        }
        payload.media = uploaded;
      }
      const { error: saveError } = await supabase.rpc(
        "save_catalog_product_sheet",
        { payload, p_expected_updated_at: product?.updated_at ?? null },
      );
      if (saveError) throw saveError;
      onSuccess(
        product
          ? (payload.initial_stock ? "Ficha y stock inicial guardados." : "Ficha guardada sin modificar existencias.")
          : "Producto creado en borrador.",
      );
      onClose();
    } catch (err) {
      setError(dbMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    if (!product || saving) return;
    if (
      Object.keys(dirtyFields).length ||
      variantsDirty ||
      mediaDirty ||
      compatibleDirty
    ) {
      setError("Guardá los cambios antes de publicar o pausar.");
      return;
    }
    setSaving(true);
    setError(null);
    setMissing([]);
    try {
      if (product.web_status === "published") {
        const result = await supabase.rpc("unpublish_catalog_product", {
          p_product_id: product.id,
        });
        if (result.error) throw result.error;
        onSuccess("Publicación pausada.");
        onClose();
        return;
      }
      const check = await supabase.rpc("get_catalog_publish_checklist", {
        p_product_id: product.id,
      });
      if (check.error) throw check.error;
      if (!check.data.ready) {
        setMissing(check.data.missing);
        return;
      }
      const result = await supabase.rpc("publish_catalog_product", {
        p_product_id: product.id,
      });
      if (result.error) throw result.error;
      onSuccess("Producto publicado.");
      onClose();
    } catch (err) {
      setError(dbMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const recode = async () => {
    if (!product || !newCode.trim()) return;
    setConfirmRecode(false);
    setSaving(true);
    setError(null);
    try {
      const result = await supabase.rpc("recode_catalog_product", {
        p_product_id: product.id,
        p_new_code: newCode.trim(),
      });
      if (result.error) throw result.error;
      onSuccess("Código actualizado.");
      onClose();
    } catch (err) {
      setError(dbMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          if (!saving) onClose();
        }}
        title={product ? "Ficha de producto" : "Nuevo producto"}
        subtitle={
          product
            ? `Código ${product.internal_code} · ${product.web_status === "published" ? "Publicado" : product.web_status === "paused" ? "Pausado" : "Borrador"}`
            : "Se crea en borrador. El código se asigna automáticamente."
        }
        icon={Package}
        maxWidth="760px"
        scrollBody
        footer={
          <div style={{ width: "100%", display: "grid", gap: 10 }}>
            <FormError message={error} onDismiss={() => setError(null)} />
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" form={formId} className="btn-primary" disabled={saving || loading || loadFailed}>
                {saving ? "Guardando…" : "Guardar ficha"}
              </button>
            </div>
          </div>
        }
      >
        <form
          id={formId}
          noValidate
          onSubmit={handleSubmit(save, () => setError(null))}
          style={{ display: "grid", gap: 14, padding: 4 }}
        >
          {missing.length > 0 && (
            <div role="alert" style={{ color: "var(--rose-accent)" }}>
              <strong>Falta completar para publicar:</strong>
              <ul>
                {missing.map((item) => (
                  <li key={item}>{checklistLabels[item] ?? item}</li>
                ))}
              </ul>
            </div>
          )}
          {loading && <p role="status">Cargando ficha…</p>}
          <div className="erp-form-row">
            <Field label="Tipo" required error={errors.template?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-select" {...register("template")} required>
                  <option value="celular">Celular</option>
                  <option value="accesorio">Accesorio</option>
                  <option value="funda">Funda</option>
                </select>
              )}
            </Field>
            <Field label="Categoría" required={!product} error={errors.category?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-select" {...register("category")} required={!product}>
                  <option value="">Elegí una categoría</option>
                  {categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Marca" required={!product} error={errors.brand?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-select" {...register("brand")} required={!product}>
                  <option value="">Elegí una marca</option>
                  {brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </Field>
          </div>
          {template === "celular" ? (
            <Field label="Modelo" required={!product} error={errors.model?.message}>
              {(a11y) => (
                <select {...a11y} className="erp-form-select" {...register("model")} required={!product}>
                  <option value="">Elegí un modelo</option>
                  {models.filter((m) => m.brand_id === brand).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <Field label="Sirve para" hint={models.length ? "Seleccioná uno o más modelos compatibles." : "No hay modelos para seleccionar."}>
              {(a11y) => (
                <select
                  {...a11y}
                  className="erp-form-select"
                  multiple
                  size={Math.min(4, Math.max(2, models.length))}
                  disabled={!models.length}
                  value={compatible}
                  onChange={(e) => {
                    setCompatible(Array.from(e.target.selectedOptions, (option) => option.value));
                    setCompatibleDirty(true);
                  }}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {brands.find((b) => b.id === m.brand_id)?.name} {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Nombre" required error={errors.name?.message}>
            {(a11y) => (
              <input
                {...a11y}
                className="erp-form-input"
                required
                {...register("name", { onChange: () => setNameEdited(true) })}
              />
            )}
          </Field>
          <button
            type="button"
            className="pag-btn"
            style={{ justifySelf: "start" }}
            onClick={() =>
              setValue(
                "name",
                suggestCatalogName(
                  template === "celular"
                    ? "Celular"
                    : template === "funda"
                      ? "Funda"
                      : "Accesorio",
                  brands.find((b) => b.id === brand)?.name,
                  models.find((m) => m.id === watch("model"))?.name,
                  watch("capacity"),
                ),
                { shouldDirty: true },
              )
            }
          >
            Usar nombre sugerido
          </button>
          <div className="erp-form-row">
            <Field
              label={product ? "Costo ARS (solo si lo actualizás)" : "Costo estimado ARS"}
              required={!product}
              error={errors.cost?.message}
            >
              {(a11y) => (
                <input {...a11y} className="erp-form-input" inputMode="decimal" {...register("cost")} required={!product} />
              )}
            </Field>
            <Field label="Precio final ARS con IVA incluido" required error={errors.price?.message}>
              {(a11y) => (
                <input {...a11y} className="erp-form-input" inputMode="decimal" {...register("price")} required />
              )}
            </Field>
          </div>
          <fieldset className="form-fieldset" style={{ gridColumn: "1 / -1", minWidth: 0 }}>
            <legend>Colores</legend>
            <div className="erp-form-row">
              <div>
                <Field label="Color del catálogo">
                  {(a11y) => (
                    <select
                      {...a11y}
                      className="erp-form-select"
                      value={selectedColor}
                      onChange={(e) => setSelectedColor(e.target.value)}
                    >
                      <option value="">Elegí un color</option>
                      {colors.filter((color) => !variants.some((variant) => variant.color_id === color.id)).map((color) => (
                        <option key={color.id} value={color.id}>{color.name}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <button type="button" className="pag-btn" disabled={!selectedColor || saving} onClick={addColor}>
                  Agregar color
                </button>
              </div>
              <div>
                <Field label="Crear color nuevo">
                  {(a11y) => (
                    <input
                      {...a11y}
                      className="erp-form-input"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                    />
                  )}
                </Field>
                <button type="button" className="pag-btn" disabled={!newColor.trim() || saving} onClick={createColor}>
                  Crear color
                </button>
              </div>
            </div>
            {product && !stockEnabled && (
              <button type="button" className="pag-btn" style={{ marginTop: 12 }} onClick={() => setStockEnabled(true)}>
                Cargar stock inicial
              </button>
            )}
            {stockEnabled && variants.some((variant) => variant.is_active !== false) && (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {sellableLocations.length
                  ? "Para cargar stock inicial, completá la cantidad, la ubicación y el costo."
                  : "No hay ubicaciones activas habilitadas para cargar stock inicial."}
              </p>
            )}
            {variants.map((v, i) => {
              const showStock = stockEnabled && v.is_active !== false;
              const stockErrors = errors.initialStock?.[i];
              const priceError = submitCount > 0 && variantsDirty && hasInvalidOwnPrice(v)
                ? "Ingresá un precio propio válido con hasta dos decimales."
                : null;

              return (
                <section
                  key={v.id ?? v.code}
                  aria-label={v.name}
                  style={{ borderTop: "1px solid var(--border-line)", marginTop: 12, paddingTop: 12 }}
                >
                  <h4 style={{ margin: "0 0 12px" }}>{v.name}</h4>
                  {showStock && (
                    <div className="erp-form-row">
                      <Field label={`Cantidad inicial ${v.name}`} error={stockErrors?.quantity?.message}>
                        {(a11y) => (
                          <input
                            {...a11y}
                            className="erp-form-input"
                            type="number"
                            min="1"
                            step="1"
                            {...register(`initialStock.${i}.quantity`)}
                          />
                        )}
                      </Field>
                      <Field label={`Ubicación inicial ${v.name}`} error={stockErrors?.locationId?.message}>
                        {(a11y) => (
                          <Controller
                            name={`initialStock.${i}.locationId`}
                            control={form.control}
                            defaultValue=""
                            render={({ field }) => (
                              <select
                                {...a11y}
                                {...field}
                                className="erp-form-select"
                                value={field.value || defaultLocationId}
                              >
                                <option value="" disabled={Boolean(defaultLocationId)}>Elegí una ubicación…</option>
                                {sellableLocations.map((location) => (
                                  <option key={location.id} value={location.id}>{location.name}</option>
                                ))}
                              </select>
                            )}
                          />
                        )}
                      </Field>
                    </div>
                  )}
                  <div className="erp-form-row">
                    {showStock && (
                      <div>
                        <Field label={`Costo unitario inicial ${v.name}`} error={stockErrors?.unitCost?.message}>
                          {(a11y) => (
                            <input
                              {...a11y}
                              className="erp-form-input"
                              inputMode="decimal"
                              {...register(`initialStock.${i}.unitCost`, {
                                onChange: () => setValue(`initialStock.${i}.confirmZeroCost`, false),
                              })}
                            />
                          )}
                        </Field>
                        {isZeroStockCost(initialStock?.[i]?.unitCost) && (
                          <Field label="Confirmo que el costo es cero" error={stockErrors?.confirmZeroCost?.message}>
                            {(a11y) => (
                              <input
                                {...a11y}
                                type="checkbox"
                                required
                                style={{ alignSelf: "flex-start" }}
                                {...register(`initialStock.${i}.confirmZeroCost`)}
                              />
                            )}
                          </Field>
                        )}
                      </div>
                    )}
                    <div>
                      <Field label={`Precio ${v.name}`}>
                        {(a11y) => (
                          <select
                            {...a11y}
                            className="erp-form-select"
                            value={v.final_price_mode ?? "inherit"}
                            onChange={(e) => changeVariant(i, {
                              final_price_mode: e.target.value === "own" ? "own" : "inherit",
                              final_price_ars: null,
                            })}
                          >
                            <option value="inherit">Heredado</option>
                            <option value="own">Propio</option>
                          </select>
                        )}
                      </Field>
                      {v.final_price_mode === "own" && (
                        <Field label={`Precio propio ${v.name}`} error={priceError}>
                          {(a11y) => (
                            <input
                              {...a11y}
                              className="erp-form-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={v.final_price_ars ?? ""}
                              onChange={(e) => changeVariant(i, {
                                final_price_ars: e.target.value === "" ? null : Number(e.target.value),
                              })}
                            />
                          )}
                        </Field>
                      )}
                    </div>
                  </div>
                  <div className="erp-form-row" style={{ alignItems: "center" }}>
                    <Field label="Código de barras">
                      {(a11y) => (
                        <input
                          {...a11y}
                          ref={(input) => { barcodeInputs.current[i] = input; }}
                          className="erp-form-input"
                          value={v.barcode ?? ""}
                          onChange={(e) => changeVariant(i, { barcode: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                        />
                      )}
                    </Field>
                    <label className="erp-form-label">
                      <input
                        type="checkbox"
                        checked={v.is_active !== false}
                        onChange={(e) => {
                          if (!e.target.checked) unregister(`initialStock.${i}`);
                          changeVariant(i, { is_active: e.target.checked });
                        }}
                      />{" "}
                      Activo
                    </label>
                  </div>
                </section>
              );
            })}
            <small>
              El stock posterior se administra mediante movimientos de Stock.
            </small>
          </fieldset>
          <fieldset className="form-fieldset" style={{ gridColumn: "1 / -1", minWidth: 0 }}>
            <legend>Publicación web</legend>
            <Field label="Descripción interna (no se publica)" error={errors.internalDescription?.message}>
              {(a11y) => <textarea {...a11y} className="erp-form-textarea" {...register("internalDescription")} />}
            </Field>
            <Field label="Descripción web" error={errors.description?.message}>
              {(a11y) => <textarea {...a11y} className="erp-form-textarea" {...register("description")} />}
            </Field>
            <label className="erp-form-label" style={{ display: "block", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={customWeb}
                onChange={(e) => {
                  setCustomWeb(e.target.checked);
                  if (!e.target.checked)
                    setValue("publicName", "", { shouldDirty: true });
                }}
              />{" "}
              Personalizar nombre para la web
            </label>
            {customWeb && (
              <Field label="Nombre para la web" error={errors.publicName?.message}>
                {(a11y) => <input {...a11y} className="erp-form-input" {...register("publicName")} />}
              </Field>
            )}
            <Field
              label="Características"
              hint="Separá las características del producto con comas. No incluyas campañas."
              error={errors.tags?.message}
            >
              {(a11y) => <input {...a11y} className="erp-form-input" {...register("tags")} />}
            </Field>
            {template === "celular" && (
              <div className="erp-form-row">
                <Field label="Capacidad" error={errors.capacity?.message}>
                  {(a11y) => <input {...a11y} className="erp-form-input" {...register("capacity")} />}
                </Field>
                <Field label="Condición" error={errors.condition?.message}>
                  {(a11y) => (
                    <select {...a11y} className="erp-form-select" {...register("condition")}>
                      <option value="">Sin especificar</option>
                      <option value="nuevo">Nuevo</option>
                      <option value="usado">Usado</option>
                      <option value="reacondicionado">Reacondicionado</option>
                    </select>
                  )}
                </Field>
              </div>
            )}
            <Field
              label="Agregar fotos"
              hint={product?.media_initialized === false ? "Todavía no podés editar las fotos de este producto." : null}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  className="erp-form-input"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={product?.media_initialized === false}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setMedia((old) => [
                      ...old,
                      ...files.map((file, i) => ({
                        file,
                        storage_path: "",
                        sort_order: old.length + i,
                        is_primary: old.length === 0 && i === 0,
                      })),
                    ]);
                    setMediaDirty(true);
                    e.target.value = "";
                  }}
                />
              )}
            </Field>
            {media.map((item, i) => (
              <div
                key={item.id ?? `${item.file?.name}-${i}`}
                style={{ borderTop: "1px solid var(--border-line)", marginTop: 12, paddingTop: 12 }}
              >
                <p style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>
                  {item.file?.name ?? item.storage_path.split("/").pop()}
                </p>
                <label className="erp-form-label" style={{ display: "block", marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="primary-photo"
                    checked={Boolean(
                      item.is_primary && !item.variant_id && !item.variant_code,
                    )}
                    onChange={() => {
                      setMedia((old) =>
                        old.map((m, j) => ({
                          ...m,
                          is_primary:
                            j === i
                              ? true
                              : m.variant_id || m.variant_code
                                ? m.is_primary
                                : false,
                          variant_id: j === i ? null : m.variant_id,
                          variant_code: j === i ? undefined : m.variant_code,
                        })),
                      );
                      setMediaDirty(true);
                    }}
                  />{" "}
                  Principal
                </label>
                <Field label="Foto para">
                  {(a11y) => (
                    <select
                      {...a11y}
                      className="erp-form-select"
                      value={
                        item.variant_code ??
                        (item.variant_id
                          ? (variants.find((v) => v.id === item.variant_id)?.code ??
                            "")
                          : "")
                      }
                      onChange={(event) => {
                        const code = event.target.value;
                        setMedia((old) =>
                          old.map((m, j) =>
                            j === i
                              ? {
                                  ...m,
                                  variant_id: null,
                                  variant_code: code || undefined,
                                  is_primary: Boolean(code),
                                }
                              : code &&
                                  (m.variant_code === code ||
                                    m.variant_id ===
                                      variants.find((v) => v.code === code)?.id)
                                ? { ...m, is_primary: false }
                                : m,
                          ),
                        );
                        setMediaDirty(true);
                      }}
                    >
                      <option value="">Producto</option>
                      {variants.map((v) => (
                        <option key={v.code} value={v.code}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    className="pag-btn"
                    disabled={i === 0}
                    onClick={() => {
                      setMedia((old) => {
                        const next = [...old];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        return next;
                      });
                      setMediaDirty(true);
                    }}
                  >
                    Subir
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    disabled={i === media.length - 1}
                    onClick={() => {
                      setMedia((old) => {
                        const next = [...old];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        return next;
                      });
                      setMediaDirty(true);
                    }}
                  >
                    Bajar
                  </button>
                  <button
                    type="button"
                    className="pag-btn"
                    onClick={() => {
                      setMedia((old) => old.filter((_, j) => j !== i));
                      setMediaDirty(true);
                    }}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </fieldset>
          {product && (
            <>
              <div className="erp-form-row" style={{ alignItems: "center" }}>
                <Field label="Nuevo código">
                  {(a11y) => (
                    <input
                      {...a11y}
                      className="erp-form-input"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                    />
                  )}
                </Field>
                <button
                  type="button"
                  className="pag-btn"
                  style={{ justifySelf: "start" }}
                  disabled={saving || !newCode.trim()}
                  onClick={() => setConfirmRecode(true)}
                >
                  Recodificar
                </button>
              </div>
              <button
                type="button"
                className="pag-btn"
                style={{ justifySelf: "start" }}
                disabled={saving || loading || loadFailed}
                onClick={publish}
              >
                {product.web_status === "published"
                  ? "Pausar"
                  : product.web_status === "paused"
                    ? "Reanudar"
                    : "Publicar"}
              </button>
              <small>
                Publicar usa los datos guardados. Guardá los cambios antes de
                publicar.
              </small>
            </>
          )}
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={confirmRecode}
        title="Recodificar producto"
        message={`¿Recodificar ${product?.internal_code ?? ""} a ${newCode.trim()}?`}
        confirmLabel="Recodificar"
        variant="warning"
        onConfirm={recode}
        onCancel={() => setConfirmRecode(false)}
        isPending={saving}
      />
    </>
  );
};
