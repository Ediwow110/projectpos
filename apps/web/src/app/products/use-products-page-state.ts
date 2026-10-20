"use client";

import { useState } from "react";

export function useProductsPageState() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("true");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [unit, setUnit] = useState("pc");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [trackInventory, setTrackInventory] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  return {
    q, setQ, active, setActive, page, setPage,
    createOpen, setCreateOpen, createError, setCreateError,
    createSuccess, setCreateSuccess, saving, setSaving,
    name, setName, sku, setSku, barcode, setBarcode, imageUrl, setImageUrl, categoryId, setCategoryId,
    price, setPrice, cost, setCost, unit, setUnit,
    reorderLevel, setReorderLevel, trackInventory, setTrackInventory,
    importOpen, setImportOpen, importText, setImportText,
    importError, setImportError, importing, setImporting,
  };
}
