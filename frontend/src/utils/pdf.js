import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

const MAX_PDF_PAGES = 100;
let pdfjsPromise;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}

export async function renderPdfToJpegPages(file) {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDFs can contain up to ${MAX_PDF_PAGES} pages.`);
    }

    const baseName = file.name.replace(/\.pdf$/i, '').replace(/[^\w-]+/g, '_');
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const initialViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 1800 / initialViewport.width, 1800 / initialViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error(`Could not prepare PDF page ${pageNumber} for upload.`));
        }, 'image/jpeg', 0.92);
      });
      pages.push(new File([blob], `${baseName}-page-${pageNumber}.jpg`, { type: 'image/jpeg' }));
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
