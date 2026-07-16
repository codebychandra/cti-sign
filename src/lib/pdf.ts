import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { FormField, RecordValue } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Render one page of a PDF to a canvas at the given render width (px). */
export async function renderPage(
  data: ArrayBuffer,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  renderWidth: number,
) {
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const page = await doc.getPage(pageIndex + 1)
  const unscaled = page.getViewport({ scale: 1 })
  const scale = renderWidth / unscaled.width
  const viewport = page.getViewport({ scale })
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport }).promise
  return { width: viewport.width, height: viewport.height }
}

/** Get the number of pages in a PDF. */
export async function getPageCount(data: ArrayBuffer): Promise<number> {
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise
  return doc.numPages
}

/**
 * Burn field values into the template PDF and return the signed bytes.
 * Field geometry is normalized (0..1) with y measured from the TOP of the page
 * (screen coordinates); pdf-lib's origin is bottom-left, so we flip y.
 */
export async function buildSignedPdf(
  templateBytes: ArrayBuffer,
  fields: FormField[],
  values: RecordValue[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  const valueByField = new Map(values.map((v) => [v.field_id, v.value ?? '']))

  for (const f of fields) {
    const value = valueByField.get(f.id)
    if (!value) continue
    const page = pages[f.page]
    if (!page) continue
    const { width: pw, height: ph } = page.getSize()

    const boxX = f.x * pw
    const boxW = f.width * pw
    const boxH = f.height * ph
    // convert top-based y to bottom-based
    const boxY = ph - f.y * ph - boxH

    if (f.type === 'signature' || f.type === 'initials') {
      if (!value.startsWith('data:image')) continue
      const isPng = value.includes('image/png')
      const bytes = dataUrlToBytes(value)
      const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      const scaled = img.scaleToFit(boxW, boxH)
      page.drawImage(img, {
        x: boxX + (boxW - scaled.width) / 2,
        y: boxY + (boxH - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      })
    } else {
      const padding = 2
      const fontSize = clamp(f.font_size ?? 11, 6, Math.max(6, boxH * 0.9))
      const textWidth = font.widthOfTextAtSize(value, fontSize)
      const align = f.text_align ?? 'left'
      let textX = boxX + padding
      if (align === 'center') textX = boxX + Math.max(padding, (boxW - textWidth) / 2)
      if (align === 'right') textX = boxX + Math.max(padding, boxW - textWidth - padding)

      page.drawText(value, {
        x: textX,
        y: boxY + (boxH - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0.06, 0.06, 0.06),
      })
    }
  }

  return pdf.save()
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
