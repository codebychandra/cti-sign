import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib'
import type { FormField, RecordValue } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Render one page of a PDF to a canvas at the given render width (px). */
export async function renderPage(data: ArrayBuffer, pageIndex: number, canvas: HTMLCanvasElement, renderWidth: number) {
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

/** Burn field values into the template PDF and return the signed bytes. */
export async function buildSignedPdf(templateBytes: ArrayBuffer, fields: FormField[], values: RecordValue[]): Promise<Uint8Array> {
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
    const boxY = ph - f.y * ph - boxH

    if (f.type === 'signature' || f.type === 'initials') {
      if (!value.startsWith('data:image')) continue
      const isPng = value.includes('image/png')
      const bytes = dataUrlToBytes(value)
      const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      const scaled = img.scaleToFit(boxW, boxH)
      page.drawImage(img, { x: boxX + (boxW - scaled.width) / 2, y: boxY + (boxH - scaled.height) / 2, width: scaled.width, height: scaled.height })
    } else {
      const padding = 2
      const fontSize = clamp(f.font_size ?? 11, 6, Math.max(6, boxH * 0.9))
      const align = f.text_align ?? 'left'
      const lines = f.type === 'textarea' ? value.split(/\r?\n/) : [value]
      const lineHeight = fontSize * 1.2
      const maxLines = Math.max(1, Math.floor((boxH - padding * 2) / lineHeight))
      const visibleLines = lines.slice(0, maxLines)
      const totalTextHeight = visibleLines.length * lineHeight
      const firstLineY = f.type === 'textarea' ? boxY + boxH - padding - fontSize : boxY + (boxH - fontSize) / 2

      visibleLines.forEach((line, index) => {
        const textWidth = font.widthOfTextAtSize(line, fontSize)
        let textX = boxX + padding
        if (align === 'center') textX = boxX + Math.max(padding, (boxW - textWidth) / 2)
        if (align === 'right') textX = boxX + Math.max(padding, boxW - textWidth - padding)
        const textY = f.type === 'textarea' ? firstLineY - index * lineHeight : boxY + Math.max(padding, (boxH - totalTextHeight) / 2)
        page.drawText(line, { x: textX, y: textY, size: fontSize, font, color: rgb(0.06, 0.06, 0.06) })
      })
    }
  }

  // Fillable templates keep their own AcroForm fields underneath the values
  // we just drew, so the download would still look/behave like an editable
  // form. Flatten it so the burned-in text/signatures are the only thing left.
  try {
    pdf.getForm().flatten()
  } catch {
    // No AcroForm on this template — nothing to flatten.
  }

  return pdf.save()
}

export interface DetectedField {
  name: string
  type: 'text' | 'textarea' | 'signature'
  page: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Read a fillable PDF's own AcroForm fields (name + position + rough type) so
 * they can be dropped straight onto the mapper instead of drawn by hand.
 * Position/type are a starting point — the user still confirms/adjusts each
 * one (especially which project custom field it maps to) in the mapper.
 */
export async function detectFormFields(templateBytes: ArrayBuffer): Promise<DetectedField[]> {
  const pdf = await PDFDocument.load(templateBytes)
  const pages = pdf.getPages()

  let form
  try {
    form = pdf.getForm()
  } catch {
    return []
  }

  const results: DetectedField[] = []
  for (const field of form.getFields()) {
    const name = field.getName()
    let type: DetectedField['type'] = 'text'
    if (field instanceof PDFTextField) type = field.isMultiline() ? 'textarea' : 'text'
    else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) type = 'text'
    if (/sign(ature)?$/i.test(name)) type = 'signature'

    // acroField/getWidgets aren't part of pdf-lib's public .d.ts surface but
    // do exist at runtime — this is the standard (if unofficial) way to read
    // each field's on-page rectangle.
    const widgets: any[] = (field as any).acroField?.getWidgets?.() ?? []
    for (const widget of widgets) {
      const rect = widget.getRectangle()
      const pageRef = widget.P?.()
      const pageIndex = pageRef ? pages.findIndex((p) => p.ref.toString() === pageRef.toString()) : 0
      const page = pages[pageIndex >= 0 ? pageIndex : 0]
      const pw = page.getWidth()
      const ph = page.getHeight()
      results.push({
        name,
        type,
        page: pageIndex >= 0 ? pageIndex : 0,
        x: rect.x / pw,
        y: 1 - (rect.y + rect.height) / ph,
        width: rect.width / pw,
        height: rect.height / ph,
      })
    }
  }
  return results
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
