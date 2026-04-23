# Manga OCR Reader

Aplicación web local para usar `manga-ocr` con una interfaz simple: cargar imagen, arrastrarla, pegarla desde el portapapeles, ver preview, seleccionar un recorte y copiar el texto resultante.

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

1. Carga una imagen con el botón, arrástrala al área o pégala con `Ctrl + V`.
2. Si necesitas inspeccionar mejor el panel, usa `+`, `−` o `Ajustar` para controlar el zoom de la preview.
3. Espera a que el estado del modelo pase a `Modelo listo`.
4. Arrastra dentro de la preview para definir el área que quieres reconocer.
5. Pulsa `OCR selección` para enviar solo el recorte o `OCR imagen completa` para procesar toda la imagen.
6. Usa `Quitar imagen` para limpiar la captura actual cuando quieras empezar de nuevo.
7. Copia el texto desde la caja de salida.

## Notas

- En la primera ejecución `manga-ocr` descarga y prepara el modelo. Puede tardar varios minutos.
- La app funciona mejor con texto japonés impreso. Si el recorte no contiene texto, el modelo puede devolver texto erróneo o inventado.
- El botón de clipboard depende de que el navegador permita `navigator.clipboard.read()` en `localhost`. Si no funciona, usa `Ctrl + V` directamente sobre la página.
