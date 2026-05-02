const elements = {
  chooseFileButton: document.querySelector("#chooseFileButton"),
  chooseFolderButton: document.querySelector("#chooseFolderButton"),
  clipboardButton: document.querySelector("#clipboardButton"),
  fileInput: document.querySelector("#fileInput"),
  folderInput: document.querySelector("#folderInput"),
  dropZone: document.querySelector("#dropZone"),
  imageCollectionMeta: document.querySelector("#imageCollectionMeta"),
  imagePicker: document.querySelector("#imagePicker"),
  canvasFrame: document.querySelector("#canvasFrame"),
  canvasViewport: document.querySelector("#canvasViewport"),
  previewCanvas: document.querySelector("#previewCanvas"),
  clearImageButton: document.querySelector("#clearImageButton"),
  selectionX: document.querySelector("#selectionX"),
  selectionY: document.querySelector("#selectionY"),
  selectionWidth: document.querySelector("#selectionWidth"),
  selectionHeight: document.querySelector("#selectionHeight"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  ocrSelectionButton: document.querySelector("#ocrSelectionButton"),
  ocrFullButton: document.querySelector("#ocrFullButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  ocrOutput: document.querySelector("#ocrOutput"),
  translateOutputButton: document.querySelector("#translateOutputButton"),
  copyOutputButton: document.querySelector("#copyOutputButton"),
  clearOutputButton: document.querySelector("#clearOutputButton"),
  translationTitle: document.querySelector("#translationTitle"),
  translationMeta: document.querySelector("#translationMeta"),
  translationOutput: document.querySelector("#translationOutput"),
  copyTranslationButton: document.querySelector("#copyTranslationButton"),
  clearTranslationButton: document.querySelector("#clearTranslationButton"),
  notice: document.querySelector("#notice"),
  modelStatusBadge: document.querySelector("#modelStatusBadge"),
  modelStatusText: document.querySelector("#modelStatusText"),
  requestMeta: document.querySelector("#requestMeta"),
};

const state = {
  image: null,
  imageBlob: null,
  imageName: "",
  objectUrl: "",
  imageEntries: [],
  activeImageIndex: -1,
  selection: null,
  draftSelection: null,
  dragStart: null,
  displayBounds: null,
  zoomLevel: 1,
  busy: false,
  modelReady: false,
  modelLoading: true,
  modelError: null,
  translationReady: false,
  translationLoading: true,
  translationError: null,
  translationTargetLabel: "Español",
};

const DEFAULT_COLLECTION_META = "Sin lote activo";
const DEFAULT_REQUEST_META = "Sin peticiones";
const DEFAULT_TRANSLATION_META = "Sin traducciones";
const DEFAULT_NOTICE = "Carga una imagen o carpeta para empezar.";
const STATUS_POLL_INTERVAL_MS = 4000;
const BASE_PADDING = 28;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const canvasContext = elements.previewCanvas.getContext("2d");
let statusPollTimerId = null;

bootstrap();

function bootstrap() {
  bindEvents();
  updateZoomReadout();
  drawCanvas();
  ensureStatusPolling();
  void refreshModelStatus();

  new ResizeObserver(() => {
    if (!state.image) {
      drawCanvas();
      return;
    }

    const focus = getViewportFocus();
    drawCanvas();
    restoreViewportFocus(focus);
  }).observe(elements.canvasViewport);
}

function bindEvents() {
  elements.chooseFileButton.addEventListener("click", () => elements.fileInput.click());
  elements.chooseFolderButton.addEventListener("click", () => elements.folderInput.click());
  elements.clipboardButton.addEventListener("click", handleClipboardButton);
  elements.fileInput.addEventListener("change", handleFileInputChange);
  elements.folderInput.addEventListener("change", handleFolderInputChange);
  elements.imagePicker.addEventListener("change", handleImagePickerChange);
  elements.clearImageButton.addEventListener("click", clearLoadedImage);
  elements.zoomOutButton.addEventListener("click", () => changeZoom(-ZOOM_STEP));
  elements.zoomResetButton.addEventListener("click", () => setZoom(1));
  elements.zoomInButton.addEventListener("click", () => changeZoom(ZOOM_STEP));

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      if (state.busy) {
        return;
      }

      event.preventDefault();
      elements.dropZone.classList.add("is-active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "drop") {
        void handleDrop(event);
      }
      elements.dropZone.classList.remove("is-active");
    });
  });

  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  window.addEventListener("paste", handlePasteEvent);

  elements.previewCanvas.addEventListener("pointerdown", handleCanvasPointerDown);
  elements.previewCanvas.addEventListener("pointermove", handleCanvasPointerMove);
  elements.previewCanvas.addEventListener("pointerup", handleCanvasPointerUp);
  elements.previewCanvas.addEventListener("pointerleave", handleCanvasPointerUp);

  elements.clearSelectionButton.addEventListener("click", clearSelection);
  elements.ocrSelectionButton.addEventListener("click", () => void submitOcrRequest({ selectionOnly: true }));
  elements.ocrFullButton.addEventListener("click", () => void submitOcrRequest({ selectionOnly: false }));
  elements.translateOutputButton.addEventListener("click", () => void submitTranslationRequest());
  elements.ocrOutput.addEventListener("input", handleOcrOutputInput);
  elements.copyOutputButton.addEventListener("click", () => void copyOutput());
  elements.clearOutputButton.addEventListener("click", () => {
    elements.ocrOutput.value = "";
    clearTranslationOutput({ keepNotice: true });
    setNotice("neutral", "La caja de texto quedó vacía.");
  });
  elements.copyTranslationButton.addEventListener("click", () => void copyTranslationOutput());
  elements.clearTranslationButton.addEventListener("click", () => {
    clearTranslationOutput({ keepNotice: true });
    setNotice("neutral", "La traducción se limpió.");
  });
}

function ensureStatusPolling() {
  if (statusPollTimerId !== null) {
    return;
  }

  statusPollTimerId = window.setInterval(() => {
    void refreshModelStatus();
  }, STATUS_POLL_INTERVAL_MS);
}

function stopStatusPolling() {
  if (statusPollTimerId === null) {
    return;
  }

  window.clearInterval(statusPollTimerId);
  statusPollTimerId = null;
}

async function refreshModelStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) {
      throw new Error("No se pudo consultar el estado del backend.");
    }

    const payload = await response.json();
    state.modelReady = Boolean(payload.ready);
    state.modelLoading = Boolean(payload.loading);
    state.modelError = payload.error ?? null;
    state.translationReady = Boolean(payload.translation?.ready);
    state.translationLoading = Boolean(payload.translation?.loading);
    state.translationError = payload.translation?.error ?? null;
    state.translationTargetLabel = payload.translation?.targetLabel ?? "Español";
    elements.translationTitle.textContent = `Traducción al ${state.translationTargetLabel.toLowerCase()}`;
    elements.translateOutputButton.textContent = `Traducir al ${state.translationTargetLabel.toLowerCase()}`;

    if (state.modelError) {
      elements.modelStatusBadge.textContent = "Error de OCR";
      elements.modelStatusBadge.className = "status-badge status-error";
      elements.modelStatusText.textContent = state.modelError;
    } else if (state.modelReady && state.translationError) {
      elements.modelStatusBadge.textContent = "Traductor con error";
      elements.modelStatusBadge.className = "status-badge status-error";
      elements.modelStatusText.textContent = `OCR listo. El traductor al ${state.translationTargetLabel.toLowerCase()} falló: ${state.translationError}`;
    } else if (state.modelReady && state.translationReady) {
      elements.modelStatusBadge.textContent = "Modelos listos";
      elements.modelStatusBadge.className = "status-badge status-ready";
      elements.modelStatusText.textContent = `OCR y traducción al ${state.translationTargetLabel.toLowerCase()} disponibles.`;
    } else if (state.modelReady) {
      elements.modelStatusBadge.textContent = "OCR listo";
      elements.modelStatusBadge.className = "status-badge status-loading";
      elements.modelStatusText.textContent = `OCR listo. El traductor al ${state.translationTargetLabel.toLowerCase()} sigue cargando.`;
    } else {
      elements.modelStatusBadge.textContent = "Preparando modelos";
      elements.modelStatusBadge.className = "status-badge status-loading";
      elements.modelStatusText.textContent = "La primera inicialización puede tardar varios minutos.";
    }

    if (!state.modelLoading && !state.translationLoading) {
      stopStatusPolling();
    } else {
      ensureStatusPolling();
    }
  } catch (error) {
    state.modelReady = false;
    state.modelLoading = false;
    state.modelError = error instanceof Error ? error.message : "Backend no disponible.";
    state.translationReady = false;
    state.translationLoading = false;
    state.translationError = null;
    elements.translateOutputButton.textContent = "Traducir";
    elements.modelStatusBadge.textContent = "Backend caído";
    elements.modelStatusBadge.className = "status-badge status-error";
    elements.modelStatusText.textContent = state.modelError;
    ensureStatusPolling();
  }

  updateControlState();
}

async function handleDrop(event) {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  const entries = await extractDroppedImageEntries(event.dataTransfer);
  if (!entries.length) {
    setNotice("error", "No se detectaron imágenes compatibles en el arrastre.");
    return;
  }

  await loadImageEntries(entries, {
    noticeMessage: entries.length > 1
      ? `Se cargaron ${entries.length} imágenes desde el arrastre. Ya puedes cambiar entre ellas cuando quieras.`
      : null,
  });
}

async function extractDroppedImageEntries(dataTransfer) {
  const entriesFromItems = await extractDroppedImageEntriesFromItems(dataTransfer?.items);
  if (entriesFromItems.length) {
    return sortImageEntries(entriesFromItems);
  }

  const files = Array.from(dataTransfer?.files ?? [])
    .filter((file) => file.type.startsWith("image/"))
    .map((file, index) => createImageEntry(
      file,
      file.name || `imagen-arrastrada-${index + 1}`,
    ));

  return sortImageEntries(files);
}

async function extractDroppedImageEntriesFromItems(items) {
  const droppedItems = Array.from(items ?? []);
  const droppedEntries = droppedItems
    .map((item) => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (!droppedEntries.length) {
    return [];
  }

  const nestedEntries = await Promise.all(droppedEntries.map((entry) => readDroppedEntry(entry)));
  return nestedEntries.flat();
}

async function readDroppedEntry(entry, parentPath = "") {
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => {
          if (!file.type.startsWith("image/")) {
            resolve([]);
            return;
          }

          resolve([createImageEntry(file, entryPath)]);
        },
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory) {
    const childEntries = await readAllDirectoryEntries(entry);
    const nestedEntries = await Promise.all(childEntries.map((childEntry) => readDroppedEntry(childEntry, entryPath)));
    return nestedEntries.flat();
  }

  return [];
}

async function readAllDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader();
  const entries = [];

  while (true) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (!batch.length) {
      return entries;
    }

    entries.push(...batch);
  }
}

async function handleFileInputChange(event) {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const [file] = Array.from(target.files ?? []);
  if (!file) {
    return;
  }

  await loadImageEntries([
    createImageEntry(file, file.name || "imagen-local"),
  ]);
  target.value = "";
}

async function handleFolderInputChange(event) {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const files = Array.from(target.files ?? []);
  if (!files.length) {
    return;
  }

  const entries = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file, index) => createImageEntry(
      file,
      file.webkitRelativePath || file.name || `imagen-${index + 1}`,
    ))
    ;

  if (!entries.length) {
    setNotice("error", "La carpeta seleccionada no contiene imágenes compatibles.");
    target.value = "";
    return;
  }

  await loadImageEntries(entries, {
    noticeMessage: `Se cargaron ${entries.length} imágenes. Ya puedes cambiar entre ellas cuando quieras.`,
  });
  target.value = "";
}

async function handleImagePickerChange(event) {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  const target = event.currentTarget;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  const nextIndex = Number.parseInt(target.value, 10);
  if (!Number.isInteger(nextIndex) || nextIndex === state.activeImageIndex) {
    return;
  }

  await activateImageIndex(nextIndex, {
    noticeMessage: `Imagen ${nextIndex + 1} de ${state.imageEntries.length} lista para trabajar.`,
  });
}

async function handleClipboardButton() {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  if (!navigator.clipboard?.read) {
    setNotice("error", "Tu navegador no permite leer imágenes del clipboard con este botón. Usa Ctrl + V como alternativa.");
    return;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) {
        continue;
      }

      const blob = await item.getType(imageType);
      await loadImageEntries([
        createImageEntry(blob, "clipboard.png"),
      ]);
      return;
    }

    setNotice("error", "El clipboard no contiene una imagen.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el clipboard.";
    setNotice("error", message);
  }
}

async function handlePasteEvent(event) {
  if (state.busy) {
    setNotice("neutral", "Espera a que termine la petición actual.");
    return;
  }

  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    return;
  }

  event.preventDefault();
  const blob = imageItem.getAsFile();
  if (!blob) {
    setNotice("error", "La imagen pegada no pudo convertirse en archivo.");
    return;
  }

  await loadImageEntries([
    createImageEntry(blob, "clipboard.png"),
  ]);
}

function createImageEntry(blob, label) {
  return { blob, label };
}

function sortImageEntries(entries) {
  return [...entries].sort((left, right) => left.label.localeCompare(right.label, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

async function loadImageEntries(entries, { initialIndex = 0, noticeMessage = null } = {}) {
  const validEntries = entries.filter((entry) => entry.blob?.type?.startsWith("image/"));
  if (!validEntries.length) {
    setNotice("error", "No se encontraron imágenes compatibles para cargar.");
    return;
  }

  state.imageEntries = validEntries;
  state.activeImageIndex = -1;
  updateImageCollectionControls();

  await activateImageIndex(clamp(initialIndex, 0, validEntries.length - 1), { noticeMessage });
}

async function activateImageIndex(index, { noticeMessage = null } = {}) {
  const entry = state.imageEntries[index];
  if (!entry) {
    setNotice("error", "La imagen seleccionada ya no está disponible.");
    return;
  }

  revokeObjectUrl();
  const objectUrl = URL.createObjectURL(entry.blob);

  try {
    const image = await loadHtmlImage(objectUrl);

    state.objectUrl = objectUrl;
    state.image = image;
    state.imageBlob = entry.blob;
    state.imageName = entry.label;
    state.activeImageIndex = index;
    state.selection = null;
    state.draftSelection = null;
    state.dragStart = null;
    state.zoomLevel = 1;

    elements.requestMeta.textContent = DEFAULT_REQUEST_META;
    elements.ocrOutput.value = "";
    clearTranslationOutput({ keepNotice: true });
    updateImageCollectionControls();
    setNotice(
      "success",
      noticeMessage ?? "Imagen cargada. Arrastra sobre la preview para seleccionar el área a reconocer.",
    );
    updateSelectionReadout(null);
    updateZoomReadout();
    updateControlState();
    drawCanvas();
    centerViewport();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    state.activeImageIndex = -1;
    resetLoadedImage({
      clearOutput: true,
      noticeTone: "error",
      noticeMessage: null,
      preserveCollection: true,
    });
    updateImageCollectionControls();
    const message = error instanceof Error ? error.message : "No se pudo abrir la imagen.";
    setNotice("error", message);
  }
}

function loadHtmlImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo decodificar la imagen seleccionada."));
    image.src = objectUrl;
  });
}

function drawCanvas() {
  const width = Math.max(280, Math.floor(elements.canvasViewport.clientWidth));
  const height = Math.max(280, Math.floor(elements.canvasViewport.clientHeight));
  const devicePixelRatio = window.devicePixelRatio || 1;

  if (!state.image) {
    state.displayBounds = null;
    resizeCanvas(width, height, devicePixelRatio);
    drawPlaceholder(width, height);
    return;
  }

  const availableWidth = width - BASE_PADDING * 2;
  const availableHeight = height - BASE_PADDING * 2;
  const fitScale = Math.min(availableWidth / state.image.naturalWidth, availableHeight / state.image.naturalHeight);
  const scale = fitScale * state.zoomLevel;

  const drawWidth = Math.max(1, Math.floor(state.image.naturalWidth * scale));
  const drawHeight = Math.max(1, Math.floor(state.image.naturalHeight * scale));
  const canvasWidth = Math.max(width, drawWidth + BASE_PADDING * 2);
  const canvasHeight = Math.max(height, drawHeight + BASE_PADDING * 2);
  const drawX = canvasWidth === width ? Math.floor((canvasWidth - drawWidth) / 2) : BASE_PADDING;
  const drawY = canvasHeight === height ? Math.floor((canvasHeight - drawHeight) / 2) : BASE_PADDING;

  resizeCanvas(canvasWidth, canvasHeight, devicePixelRatio);
  state.displayBounds = { x: drawX, y: drawY, width: drawWidth, height: drawHeight };

  canvasContext.save();
  canvasContext.fillStyle = "rgba(255, 250, 241, 0.9)";
  roundRectPath(canvasContext, drawX - 12, drawY - 12, drawWidth + 24, drawHeight + 24, 18);
  canvasContext.fill();
  canvasContext.drawImage(state.image, drawX, drawY, drawWidth, drawHeight);

  const activeSelection = state.draftSelection ?? state.selection;
  if (activeSelection) {
    const displayRect = imageRectToDisplayRect(activeSelection);
    canvasContext.fillStyle = "rgba(20, 99, 86, 0.18)";
    canvasContext.strokeStyle = "rgba(20, 99, 86, 0.95)";
    canvasContext.lineWidth = 2;
    canvasContext.setLineDash([10, 8]);
    canvasContext.fillRect(displayRect.x, displayRect.y, displayRect.width, displayRect.height);
    canvasContext.strokeRect(displayRect.x, displayRect.y, displayRect.width, displayRect.height);
    canvasContext.setLineDash([]);
  }
  canvasContext.restore();
}

function resizeCanvas(displayWidth, displayHeight, devicePixelRatio) {
  elements.previewCanvas.width = Math.floor(displayWidth * devicePixelRatio);
  elements.previewCanvas.height = Math.floor(displayHeight * devicePixelRatio);
  elements.previewCanvas.style.width = `${displayWidth}px`;
  elements.previewCanvas.style.height = `${displayHeight}px`;

  canvasContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  canvasContext.clearRect(0, 0, displayWidth, displayHeight);
}

function drawPlaceholder(width, height) {
  canvasContext.save();
  canvasContext.fillStyle = "rgba(255, 250, 241, 0.58)";
  roundRectPath(canvasContext, 28, 28, width - 56, height - 56, 22);
  canvasContext.fill();
  canvasContext.strokeStyle = "rgba(92, 78, 61, 0.24)";
  canvasContext.lineWidth = 2;
  canvasContext.setLineDash([12, 10]);
  canvasContext.stroke();
  canvasContext.setLineDash([]);
  canvasContext.fillStyle = "#5c4e3d";
  canvasContext.textAlign = "center";
  canvasContext.font = '700 24px "Palatino Linotype", serif';
  canvasContext.fillText("Tu preview aparecerá aquí", width / 2, height / 2 - 8);
  canvasContext.font = '16px "Yu Gothic UI", sans-serif';
  canvasContext.fillText("Carga una imagen, una carpeta o pega una captura desde el clipboard.", width / 2, height / 2 + 22);
  canvasContext.restore();
}

function handleCanvasPointerDown(event) {
  if (!state.image || event.button !== 0) {
    return;
  }

  const point = displayPointToImagePoint(getCanvasPoint(event));
  if (!point) {
    return;
  }

  elements.previewCanvas.setPointerCapture(event.pointerId);
  state.dragStart = point;
  state.draftSelection = { x: point.x, y: point.y, width: 1, height: 1 };
  drawCanvas();
}

function handleCanvasPointerMove(event) {
  if (!state.dragStart) {
    return;
  }

  const point = displayPointToImagePoint(getCanvasPoint(event));
  if (!point) {
    return;
  }

  state.draftSelection = normalizeRect(state.dragStart, point);
  updateSelectionReadout(state.draftSelection);
  drawCanvas();
}

function handleCanvasPointerUp(event) {
  if (!state.dragStart) {
    return;
  }

  if (elements.previewCanvas.hasPointerCapture(event.pointerId)) {
    elements.previewCanvas.releasePointerCapture(event.pointerId);
  }

  const finalized = sanitizeRect(state.draftSelection);
  state.dragStart = null;
  state.draftSelection = null;
  state.selection = finalized;
  updateSelectionReadout(finalized);
  updateControlState();
  drawCanvas();

  if (finalized) {
    setNotice("success", "Selección lista. Ya puedes ejecutar OCR sobre el recorte.");
  }
}

function clearSelection() {
  state.selection = null;
  state.draftSelection = null;
  state.dragStart = null;
  updateSelectionReadout(null);
  updateControlState();
  drawCanvas();
  setNotice("neutral", "La selección se limpió. Puedes definir un recorte nuevo.");
}

function clearLoadedImage() {
  resetLoadedImage({
    clearOutput: true,
    noticeTone: "neutral",
    noticeMessage: "La imagen o lote cargado se quitó.",
  });
}

function resetLoadedImage({ clearOutput, noticeTone, noticeMessage, preserveCollection = false } = {}) {
  revokeObjectUrl();

  state.image = null;
  state.imageBlob = null;
  state.imageName = "";
  if (!preserveCollection) {
    state.imageEntries = [];
    state.activeImageIndex = -1;
  }
  state.selection = null;
  state.draftSelection = null;
  state.dragStart = null;
  state.displayBounds = null;
  state.zoomLevel = 1;

  elements.imageCollectionMeta.textContent = DEFAULT_COLLECTION_META;
  elements.requestMeta.textContent = DEFAULT_REQUEST_META;
  updateSelectionReadout(null);
  updateZoomReadout();
  updateImageCollectionControls();

  if (clearOutput) {
    elements.ocrOutput.value = "";
    clearTranslationOutput({ keepNotice: true });
  }

  elements.canvasViewport.scrollTo({ left: 0, top: 0 });
  updateControlState();
  drawCanvas();

  if (noticeMessage) {
    setNotice(noticeTone ?? "neutral", noticeMessage);
  }
}

function updateSelectionReadout(rect) {
  const safeRect = rect ?? { x: 0, y: 0, width: 0, height: 0 };
  elements.selectionX.textContent = String(Math.round(safeRect.x));
  elements.selectionY.textContent = String(Math.round(safeRect.y));
  elements.selectionWidth.textContent = String(Math.round(safeRect.width));
  elements.selectionHeight.textContent = String(Math.round(safeRect.height));
  elements.selectionX.closest('dl').classList.toggle('is-active', rect != null && safeRect.width > 0);
}

function updateZoomReadout() {
  elements.zoomValue.textContent = `${Math.round(state.zoomLevel * 100)}%`;
}

function updateImageCollectionControls() {
  elements.imagePicker.replaceChildren();

  if (!state.imageEntries.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Carga una carpeta para navegar entre imágenes.";
    elements.imagePicker.append(option);
    elements.imagePicker.value = "";
    elements.imageCollectionMeta.textContent = DEFAULT_COLLECTION_META;
    elements.imagePicker.title = DEFAULT_COLLECTION_META;
    return;
  }

  state.imageEntries.forEach((entry, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${entry.label}`;
    elements.imagePicker.append(option);
  });

  const hasActiveImage = state.activeImageIndex >= 0 && state.activeImageIndex < state.imageEntries.length;
  elements.imagePicker.value = String(hasActiveImage ? state.activeImageIndex : 0);
  elements.imageCollectionMeta.textContent = hasActiveImage
    ? `Imagen ${state.activeImageIndex + 1} de ${state.imageEntries.length}`
    : `${state.imageEntries.length} Cargar`;
  elements.imagePicker.title = hasActiveImage
    ? state.imageEntries[state.activeImageIndex].label
    : `${state.imageEntries.length} Cargar`;
}

function updateControlState() {
  const hasImage = Boolean(state.image && state.imageBlob);
  const hasSelection = Boolean(state.selection);
  const canRequest = hasImage && state.modelReady && !state.busy;
  const canAdjustImage = hasImage && !state.busy;
  const hasOcrText = Boolean(elements.ocrOutput.value.trim());
  const hasTranslatedText = Boolean(elements.translationOutput.value.trim());
  const canTranslate = hasOcrText && state.translationReady && !state.busy;

  elements.chooseFileButton.disabled = state.busy;
  elements.chooseFolderButton.disabled = state.busy;
  elements.clipboardButton.disabled = state.busy;
  elements.imagePicker.disabled = !(state.imageEntries.length && !state.busy);
  elements.ocrFullButton.disabled = !canRequest;
  elements.ocrSelectionButton.disabled = !(canRequest && hasSelection);
  elements.clearSelectionButton.disabled = !(hasSelection && !state.busy);
  elements.clearImageButton.disabled = !canAdjustImage;
  elements.zoomOutButton.disabled = !(canAdjustImage && state.zoomLevel > MIN_ZOOM);
  elements.zoomResetButton.disabled = !(canAdjustImage && state.zoomLevel !== 1);
  elements.zoomInButton.disabled = !(canAdjustImage && state.zoomLevel < MAX_ZOOM);
  elements.translateOutputButton.disabled = !canTranslate;
  elements.copyOutputButton.disabled = !hasOcrText;
  elements.clearOutputButton.disabled = !(hasOcrText && !state.busy);
  elements.copyTranslationButton.disabled = !hasTranslatedText;
  elements.clearTranslationButton.disabled = !(hasTranslatedText && !state.busy);
}

function changeZoom(delta) {
  setZoom(state.zoomLevel + delta);
}

function setZoom(nextZoomLevel) {
  if (!state.image) {
    return;
  }

  const clampedZoom = clamp(Number(nextZoomLevel.toFixed(2)), MIN_ZOOM, MAX_ZOOM);
  if (clampedZoom === state.zoomLevel) {
    return;
  }

  const focus = getViewportFocus();
  state.zoomLevel = clampedZoom;
  updateZoomReadout();
  updateControlState();
  drawCanvas();
  restoreViewportFocus(focus);
}

async function submitOcrRequest({ selectionOnly }) {
  if (!state.image || !state.imageBlob) {
    setNotice("error", "Primero carga una imagen.");
    return;
  }

  if (!state.modelReady) {
    setNotice("error", "El modelo todavía no está listo.");
    return;
  }

  let blob = state.imageBlob;
  if (selectionOnly) {
    if (!state.selection) {
      setNotice("error", "No hay una selección activa.");
      return;
    }
    blob = await cropSelectionToBlob(state.selection);
  }

  const formData = new FormData();
  formData.append("image", blob, selectionOnly ? "selection.png" : "full-image.png");

  state.busy = true;
  updateControlState();
  elements.requestMeta.textContent = selectionOnly ? "Procesando recorte" : "Procesando imagen completa";
  setNotice("neutral", "Enviando imagen a Manga-OCR...");

  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail ?? "La petición OCR falló.");
    }

    elements.ocrOutput.value = payload.text ?? "";
    clearTranslationOutput({ keepNotice: true });
    elements.requestMeta.textContent = `${payload.elapsedMs ?? 0} ms`;
    if (elements.ocrOutput.value.trim()) {
      setNotice("success", "OCR completado. El texto ya está listo para copiar.");
    } else {
      setNotice("error", "OCR completado, pero no se obtuvo texto en ese recorte.");
    }
  } catch (error) {
    elements.requestMeta.textContent = "Error";
    const message = error instanceof Error ? error.message : "No se pudo completar OCR.";
    setNotice("error", message);
  } finally {
    state.busy = false;
    updateControlState();
  }
}

async function submitTranslationRequest() {
  const sourceText = elements.ocrOutput.value.trim();
  if (!sourceText) {
    setNotice("error", "No hay texto OCR para traducir.");
    return;
  }

  if (!state.translationReady) {
    setNotice("error", "El traductor todavía no está listo.");
    return;
  }

  state.busy = true;
  updateControlState();
  elements.translationMeta.textContent = "Traduciendo";
  setNotice("neutral", `Traduciendo al ${state.translationTargetLabel.toLowerCase()}...`);

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: sourceText }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail ?? "La petición de traducción falló.");
    }

    elements.translationOutput.value = payload.text ?? "";
    elements.translationMeta.textContent = `${payload.elapsedMs ?? 0} ms`;
    if (elements.translationOutput.value.trim()) {
      setNotice("success", `Traducción completada al ${state.translationTargetLabel.toLowerCase()}.`);
    } else {
      setNotice("error", "La traducción terminó, pero no devolvió texto.");
    }
  } catch (error) {
    elements.translationMeta.textContent = "Error";
    const message = error instanceof Error ? error.message : "No se pudo completar la traducción.";
    setNotice("error", message);
  } finally {
    state.busy = false;
    updateControlState();
  }
}

async function cropSelectionToBlob(rect) {
  const safeRect = sanitizeRect(rect);
  if (!safeRect || !state.image) {
    throw new Error("La selección no es válida.");
  }

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = safeRect.width;
  cropCanvas.height = safeRect.height;
  const context = cropCanvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear el canvas del recorte.");
  }

  context.drawImage(
    state.image,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height,
    0,
    0,
    safeRect.width,
    safeRect.height,
  );

  return new Promise((resolve, reject) => {
    cropCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo convertir el recorte en imagen."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

async function copyOutput() {
  const text = elements.ocrOutput.value.trim();
  if (!text) {
    setNotice("error", "No hay texto para copiar.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setNotice("success", "Texto copiado al clipboard.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo copiar el texto.";
    setNotice("error", message);
  }
}

async function copyTranslationOutput() {
  const text = elements.translationOutput.value.trim();
  if (!text) {
    setNotice("error", "No hay traducción para copiar.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setNotice("success", "Traducción copiada al clipboard.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo copiar la traducción.";
    setNotice("error", message);
  }
}

function handleOcrOutputInput() {
  clearTranslationOutput({ keepNotice: true });
  updateControlState();
}

function clearTranslationOutput({ keepNotice } = {}) {
  elements.translationOutput.value = "";
  elements.translationMeta.textContent = DEFAULT_TRANSLATION_META;
  if (!keepNotice) {
    setNotice("neutral", DEFAULT_NOTICE);
  }
}

function setNotice(tone, message) {
  elements.notice.dataset.tone = tone;
  elements.notice.textContent = message;
}

function getCanvasPoint(event) {
  const rect = elements.previewCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getViewportFocus() {
  if (!state.displayBounds) {
    return { x: 0.5, y: 0.5 };
  }

  const viewportCenterX = elements.canvasViewport.scrollLeft + elements.canvasViewport.clientWidth / 2;
  const viewportCenterY = elements.canvasViewport.scrollTop + elements.canvasViewport.clientHeight / 2;

  return {
    x: clamp((viewportCenterX - state.displayBounds.x) / state.displayBounds.width, 0, 1),
    y: clamp((viewportCenterY - state.displayBounds.y) / state.displayBounds.height, 0, 1),
  };
}

function restoreViewportFocus(focus) {
  if (!state.displayBounds) {
    return;
  }

  window.requestAnimationFrame(() => {
    const targetLeft = state.displayBounds.x + state.displayBounds.width * focus.x - elements.canvasViewport.clientWidth / 2;
    const targetTop = state.displayBounds.y + state.displayBounds.height * focus.y - elements.canvasViewport.clientHeight / 2;

    elements.canvasViewport.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
    });
  });
}

function centerViewport() {
  restoreViewportFocus({ x: 0.5, y: 0.5 });
}

function displayPointToImagePoint(point) {
  if (!state.displayBounds || !state.image) {
    return null;
  }

  const { x, y, width, height } = state.displayBounds;
  if (point.x < x || point.y < y || point.x > x + width || point.y > y + height) {
    return null;
  }

  const relativeX = (point.x - x) / width;
  const relativeY = (point.y - y) / height;
  return {
    x: Math.round(relativeX * state.image.naturalWidth),
    y: Math.round(relativeY * state.image.naturalHeight),
  };
}

function imageRectToDisplayRect(rect) {
  const bounds = state.displayBounds;
  const image = state.image;
  if (!bounds || !image) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: bounds.x + (rect.x / image.naturalWidth) * bounds.width,
    y: bounds.y + (rect.y / image.naturalHeight) * bounds.height,
    width: (rect.width / image.naturalWidth) * bounds.width,
    height: (rect.height / image.naturalHeight) * bounds.height,
  };
}

function normalizeRect(startPoint, endPoint) {
  return {
    x: Math.min(startPoint.x, endPoint.x),
    y: Math.min(startPoint.y, endPoint.y),
    width: Math.abs(endPoint.x - startPoint.x),
    height: Math.abs(endPoint.y - startPoint.y),
  };
}

function sanitizeRect(rect) {
  if (!rect || !state.image) {
    return null;
  }

  const x = clamp(Math.round(rect.x), 0, state.image.naturalWidth - 1);
  const y = clamp(Math.round(rect.y), 0, state.image.naturalHeight - 1);
  const width = clamp(Math.round(rect.width), 0, state.image.naturalWidth - x);
  const height = clamp(Math.round(rect.height), 0, state.image.naturalHeight - y);
  if (width < 4 || height < 4) {
    return null;
  }

  return { x, y, width, height };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function revokeObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
  }
}
