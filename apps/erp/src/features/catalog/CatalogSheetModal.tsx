import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ConfirmDialog, Modal } from "../../components/erp/WorkspaceUi";
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
  catalogSheetSchema,
  checklistLabels,
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
    : raw;
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
  const form = useForm<CatalogSheetValues>({
    resolver: zodResolver(catalogSheetSchema),
    defaultValues: empty,
    shouldFocusError: true,
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, dirtyFields },
  } = form;
  const template = watch("template");
  const brand = watch("brand");
  const model = watch("model");
  const capacity = watch("capacity");
  const [nameEdited, setNameEdited] = useState(false);
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
      document.getElementById(`barcode-${variants.length}`)?.focus(),
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
    if (
      variantsDirty &&
      variants.some(
        (variant) =>
          variant.final_price_mode === "own" &&
          (variant.final_price_ars == null ||
            variant.final_price_ars < 0 ||
            !Number.isFinite(variant.final_price_ars) ||
            Math.abs(
              variant.final_price_ars * 100 -
                Math.round(variant.final_price_ars * 100),
            ) > 0.000001),
      )
    ) {
      setError(
        "Ingresá un precio propio válido con hasta dos decimales para cada color.",
      );
      return;
    }
    setError(null);
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
          if (!line?.quantity?.trim() || !variant || !line.locationId) return [];
          return [{ variant_code: variant.code, quantity: Number(line.quantity), location_id: line.locationId, unit_cost: Number(line.unitCost || 0) }];
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
                `No se pudo subir ${item.file.name}: ${result.error.message}`,
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
  const field = (
    id: keyof CatalogSheetValues,
    label: string,
    child: React.ReactNode,
  ) => (
    <div>
      <label htmlFor={`sheet-${id}`}>{label}</label>
      {child}
      {errors[id] && (
        <p id={`sheet-${id}-error`} role="alert">
          {errors[id]?.message}
        </p>
      )}
    </div>
  );
  const inputProps = (id: keyof CatalogSheetValues) => ({
    id: `sheet-${id}`,
    "aria-invalid": Boolean(errors[id]),
    "aria-describedby": errors[id] ? `sheet-${id}-error` : undefined,
  });
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
        maxWidth="760px"
        scrollBody
      >
        <form
          noValidate
          onSubmit={handleSubmit(save)}
          style={{ display: "grid", gap: 12 }}
        >
          {error && <p role="alert">{error}</p>}
          {missing.length > 0 && (
            <div role="alert">
              <strong>Falta completar para publicar:</strong>
              <ul>
                {missing.map((item) => (
                  <li key={item}>{checklistLabels[item] ?? item}</li>
                ))}
              </ul>
            </div>
          )}
          {loading && <p role="status">Cargando ficha…</p>}
          {field(
            "template",
            "Tipo *",
            <select {...inputProps("template")} {...register("template")}>
              <option value="celular">Celular</option>
              <option value="accesorio">Accesorio</option>
              <option value="funda">Funda</option>
            </select>,
          )}
          {field(
            "category",
            "Categoría *",
            <select {...inputProps("category")} {...register("category")}>
              <option value="">Elegí una categoría</option>
              {categories.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>,
          )}
          {field(
            "brand",
            "Marca *",
            <select {...inputProps("brand")} {...register("brand")}>
              <option value="">Elegí una marca</option>
              {brands.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>,
          )}
          {template === "celular" ? (
            field(
              "model",
              "Modelo *",
              <select {...inputProps("model")} {...register("model")}>
                <option value="">Elegí un modelo</option>
                {models
                  .filter((m) => m.brand_id === brand)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>,
            )
          ) : (
            <div>
              <label htmlFor="sheet-compatible">Sirve para</label>
              <select
                id="sheet-compatible"
                multiple
                value={compatible}
                onChange={(e) => {
                  setCompatible(
                    Array.from(
                      e.target.selectedOptions,
                      (option) => option.value,
                    ),
                  );
                  setCompatibleDirty(true);
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {brands.find((b) => b.id === m.brand_id)?.name} {m.name}
                  </option>
                ))}
              </select>
              <small>Seleccioná uno o más modelos compatibles.</small>
            </div>
          )}
          {field(
            "name",
            "Nombre *",
            <input
              {...inputProps("name")}
              {...register("name", { onChange: () => setNameEdited(true) })}
            />,
          )}
          <button
            type="button"
            className="pag-btn"
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
          {field(
            "cost",
            product
              ? "Costo ARS (solo si lo actualizás)"
              : "Costo estimado ARS *",
            <input
              {...inputProps("cost")}
              inputMode="decimal"
              {...register("cost")}
            />,
          )}
          {field(
            "price",
            "Precio final ARS con IVA incluido *",
            <input
              {...inputProps("price")}
              inputMode="decimal"
              {...register("price")}
            />,
          )}
          <fieldset>
            <legend>Colores</legend>
            <label htmlFor="sheet-color">Color del catálogo</label>
            <select
              id="sheet-color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
            >
              <option value="">Elegí un color</option>
              {colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className="pag-btn" onClick={addColor}>
              Agregar color
            </button>
            <label htmlFor="new-catalog-color">Crear color nuevo</label>
            <input
              id="new-catalog-color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
            />
            <button
              type="button"
              disabled={!newColor.trim() || saving}
              onClick={createColor}
            >
              Crear color
            </button>
            {product && !stockEnabled && <button type="button" onClick={() => setStockEnabled(true)}>Cargar stock inicial</button>}
            {variants.map((v, i) => (
              <div
                key={v.id ?? v.code}
                style={{
                  borderTop: "1px solid var(--border-line)",
                  padding: 8,
                }}
              >
                <strong>{v.name}</strong>
                {stockEnabled && v.is_active !== false && <div>
                  <label htmlFor={`stock-quantity-${i}`}>Cantidad inicial {v.name}</label>
                  <input id={`stock-quantity-${i}`} type="number" min="1" step="1" {...register(`initialStock.${i}.quantity`)} />
                  <label htmlFor={`stock-location-${i}`}>Ubicación inicial {v.name}</label>
                  <select id={`stock-location-${i}`} {...register(`initialStock.${i}.locationId`)}>
                    <option value="">Elegí una ubicación</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                  <label htmlFor={`stock-cost-${i}`}>Costo unitario inicial {v.name}</label>
                  <input id={`stock-cost-${i}`} inputMode="decimal" {...register(`initialStock.${i}.unitCost`)} />
                  {errors.initialStock?.[i] && <p role="alert">Revisá la cantidad, ubicación y costo inicial.</p>}
                </div>}
                <label htmlFor={`barcode-${i}`}>Código de barras</label>
                <input
                  id={`barcode-${i}`}
                  value={v.barcode ?? ""}
                  onChange={(e) =>
                    changeVariant(i, { barcode: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                <label htmlFor={`price-mode-${i}`}>Precio</label>
                <select
                  id={`price-mode-${i}`}
                  value={v.final_price_mode ?? "inherit"}
                  onChange={(e) =>
                    changeVariant(i, {
                      final_price_mode:
                        e.target.value === "own" ? "own" : "inherit",
                      final_price_ars: null,
                    })
                  }
                >
                  <option value="inherit">Heredado</option>
                  <option value="own">Propio</option>
                </select>
                {v.final_price_mode === "own" && (
                  <input
                    aria-label={`Precio propio ${v.name}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.final_price_ars ?? ""}
                    onChange={(e) =>
                      changeVariant(i, {
                        final_price_ars:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={v.is_active !== false}
                    onChange={(e) =>
                      changeVariant(i, { is_active: e.target.checked })
                    }
                  />{" "}
                  Activo
                </label>
              </div>
            ))}
            <small>
              El stock posterior se administra mediante movimientos de Stock.
            </small>
          </fieldset>
          <fieldset>
            <legend>Publicación web</legend>
            {field("internalDescription", "Descripción interna (no se publica)",
              <textarea {...inputProps("internalDescription")} {...register("internalDescription")} />)}
            {field(
              "description",
              "Descripción web",
              <textarea
                {...inputProps("description")}
                {...register("description")}
              />,
            )}
            <label>
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
            {customWeb &&
              field(
                "publicName",
                "Nombre para la web",
                <input
                  {...inputProps("publicName")}
                  {...register("publicName")}
                />,
              )}
            {field(
              "tags",
              "Características (separadas por comas)",
              <input {...inputProps("tags")} {...register("tags")} />,
            )}
            <small>
              Usá características del producto; las campañas no van en tags.
            </small>
            {template === "celular" && (
              <>
                {field(
                  "capacity",
                  "Capacidad",
                  <input
                    {...inputProps("capacity")}
                    {...register("capacity")}
                  />,
                )}
                {field(
                  "condition",
                  "Condición",
                  <select
                    {...inputProps("condition")}
                    {...register("condition")}
                  >
                    <option value="">Sin especificar</option>
                    <option value="nuevo">Nuevo</option>
                    <option value="usado">Usado</option>
                    <option value="reacondicionado">Reacondicionado</option>
                  </select>,
                )}
              </>
            )}
            {product && product.media_initialized === false && (
              <p>
                Las fotos antiguas todavía no están migradas a la ficha. No se
                modificarán hasta completar el backfill.
              </p>
            )}
            <label htmlFor="sheet-photos">Agregar fotos</label>
            <input
              id="sheet-photos"
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
            {media.map((item, i) => (
              <div key={item.id ?? `${item.file?.name}-${i}`}>
                <span>
                  {item.file?.name ?? item.storage_path.split("/").pop()}
                </span>
                <label>
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
                <label htmlFor={`photo-variant-${i}`}>Foto para</label>
                <select
                  id={`photo-variant-${i}`}
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
                <button
                  type="button"
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
                  onClick={() => {
                    setMedia((old) => old.filter((_, j) => j !== i));
                    setMediaDirty(true);
                  }}
                >
                  Quitar
                </button>
              </div>
            ))}
          </fieldset>
          {product && (
            <>
              <div>
                <label htmlFor="sheet-recode">Nuevo código</label>
                <input
                  id="sheet-recode"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
                <button
                  type="button"
                  disabled={saving || !newCode.trim()}
                  onClick={() => setConfirmRecode(true)}
                >
                  Recodificar
                </button>
              </div>
              <button
                type="button"
                className="pag-btn"
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
          <div>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || loading || loadFailed}
            >
              {saving ? "Guardando…" : "Guardar ficha"}
            </button>{" "}
            <button
              type="button"
              className="pag-btn"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </button>
          </div>
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
