import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

// HEIC: fotografias do iPhone (a API converte-as para JPEG).
export const INVOICE_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
const MAX_BYTES = 10 * 1024 * 1024

/** Zona para arrastar a fatura ou escolher um ficheiro (no telemóvel, também tirar fotografia). */
export function InvoicePicker({
  file,
  onChange,
  currentName,
}: {
  file: File | null
  onChange: (file: File | null) => void
  currentName?: string | null
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(selected: File | undefined) {
    if (!selected) return
    if (selected.size > MAX_BYTES) {
      setError('A fatura não pode ter mais de 10 MB')
      return
    }
    setError(null)
    onChange(selected)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files[0])
  }

  return (
    <div>
      {/* Um botão (e não uma div) para também funcionar com o teclado. */}
      <button
        type="button"
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
      >
        {file ? (
          <strong>{file.name}</strong>
        ) : (
          <>
            <strong>Arrasta a fatura</strong>
            <span>ou toca para escolher / tirar uma fotografia</span>
            <small>PDF ou fotografia (JPG, PNG, HEIC), até 10 MB</small>
          </>
        )}
        {!file && currentName && <small>Atual: {currentName}</small>}
      </button>
      <label className="visually-hidden" htmlFor="invoice-file">
        Fatura
      </label>
      <input
        ref={input}
        id="invoice-file"
        type="file"
        accept={INVOICE_ACCEPT}
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />
      {file && (
        <button type="button" className="button-link" onClick={() => onChange(null)}>
          Remover ficheiro escolhido
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
