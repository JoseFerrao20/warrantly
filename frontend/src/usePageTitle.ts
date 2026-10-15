import { useEffect } from 'react'

/** Título do separador do browser, que é também o que os leitores de ecrã anunciam. */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Warrantly` : 'Warrantly'
  }, [title])
}
