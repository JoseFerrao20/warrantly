import { existsSync } from 'node:fs'

import type { ConfigContext, ExpoConfig } from 'expo/config'

// O resto da configuração está no app.json; aqui só o que depende do ambiente.
export default ({ config }: ConfigContext): ExpoConfig => {
  // Credenciais do Firebase (FCM) para o push no Android: no EAS vêm da variável de ficheiro
  // GOOGLE_SERVICES_JSON; localmente, do google-services.json (fora do git). Ver docs/push.md.
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync('./google-services.json') ? './google-services.json' : undefined)
  return {
    ...config,
    name: config.name ?? 'Warrantly',
    slug: config.slug ?? 'warrantly',
    android: { ...config.android, ...(googleServicesFile && { googleServicesFile }) },
  }
}
