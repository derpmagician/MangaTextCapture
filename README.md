# Manga OCR Reader

Aplicación web local para usar `manga-ocr` con una interfaz simple: cargar una imagen o una carpeta completa, arrastrar imágenes, pegarlas desde el portapapeles, ver la preview, seleccionar un recorte, extraer texto y traducirlo con Marian NMT.

## Requisitos

- Windows con Python 3.12 disponible
- Entorno virtual en `.venv`
- `manga-ocr` instalado o instalable desde el entorno virtual

## Instalar dependencias

En PowerShell puedes activar el entorno así:

```powershell
.\.venv\Scripts\Activate.ps1
```

Si prefieres evitar activarlo, usa directamente el ejecutable del venv:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Arrancar la app

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --reload
```

Luego abre `http://127.0.0.1:8000`.

## Flujo de uso

1. Carga una imagen con el botón, carga una carpeta completa, arrastra una imagen al área o pégala con `Ctrl + V`.
2. Si cargaste una carpeta, usa el selector `Imágenes cargadas` para elegir cuál quieres trabajar y cambiarla en cualquier momento.
3. Si necesitas inspeccionar mejor el panel, usa `+`, `−` o `Ajustar` para controlar el zoom de la preview.
4. Espera a que el estado del modelo pase a `Modelo listo`.
5. Arrastra dentro de la preview para definir el área que quieres reconocer.
6. Pulsa `OCR selección` para enviar solo el recorte o `OCR imagen completa` para procesar toda la imagen.
7. Revisa o edita el texto OCR en la caja de salida y pulsa `Traducir` para generar la versión traducida.
8. Usa `Quitar imagen` para limpiar la captura actual o el lote cargado cuando quieras empezar de nuevo.
9. Copia tanto el texto OCR como la traducción desde sus cajas respectivas.

## Notas

- En la primera ejecución la app crea una carpeta local `models/` y descarga ahí los modelos OCR y de traducción. En los siguientes reinicios reutiliza esos archivos locales aunque recargues el proceso con `--reload`.
- Cuando ambos modelos ya están completos en `models/`, el arranque siguiente activa `HF_HUB_OFFLINE=1` automáticamente y carga solo desde disco local.
- La traducción usa por defecto `Helsinki-NLP/opus-mt-ja-es`. Puedes cambiar el modelo con `MANGA_TRANSLATION_MODEL` y la etiqueta visible con `MANGA_TRANSLATION_TARGET_LABEL`.
- La carga de carpeta usa el selector del navegador y mantiene las imágenes solo en memoria del navegador mientras la página esté abierta.
- El selector de carpetas depende de `webkitdirectory`, así que conviene probarlo en navegadores Chromium actuales.
- Si quieres otra ubicación para los modelos, define `MANGA_MODELS_DIR` antes de arrancar el servidor.
- Si necesitas volver a permitir consultas remotas aunque ya exista la carpeta local, define `MANGA_OFFLINE_AFTER_DOWNLOAD=0` antes de arrancar.
- La app funciona mejor con texto japonés impreso. Si el recorte no contiene texto, el modelo puede devolver texto erróneo o inventado.
- El botón de clipboard depende de que el navegador permita `navigator.clipboard.read()` en `localhost`. Si no funciona, usa `Ctrl + V` directamente sobre la página.
- Si ves avisos de Hugging Face, define `HF_TOKEN` en tu entorno o usa `huggingface-cli login` para mejorar límites y velocidad de descarga.

## Carpeta local de modelos

Por defecto la app usa esta estructura dentro del proyecto:

```text
models/
	ocr/
		kha-white/
			manga-ocr-base/
	translation/
		Helsinki-NLP/
			opus-mt-ja-es/
```

Si la carpeta del modelo ya existe y está completa, la app carga desde ahí sin volver a descargar. Si falta algún modelo, lo descarga en esa carpeta y luego lo usa localmente.

Con el comportamiento por defecto, cuando los dos modelos requeridos ya existen en esa carpeta, la app entra en modo offline en el siguiente arranque y no consulta Hugging Face durante la carga.

En PowerShell puedes cambiar la ruta así:

```powershell
$env:MANGA_MODELS_DIR = "C:\programing\Manga-OCR\models"
.\.venv\Scripts\python.exe -m uvicorn app:app --reload
```

Si quieres desactivar ese modo offline automático:

```powershell
$env:MANGA_OFFLINE_AFTER_DOWNLOAD = "0"
.\.venv\Scripts\python.exe -m uvicorn app:app --reload
```