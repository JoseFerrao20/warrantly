import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

// Testes de ponta a ponta: arrancam a API (FastAPI + Postgres) e o frontend (Vite) e usam a app
// no Chromium como um utilizador. Precisam do Postgres a correr (DATABASE_URL).
const venvPython = '../backend/.venv/bin/python'
const python = existsSync(venvPython) ? '.venv/bin/python' : 'python'
const uploadDir = join(tmpdir(), 'warrantly-e2e-uploads')
// Com E2E_BASE_URL (ex.: http://localhost:8080, o contentor de produção), os testes usam essa
// app e não arrancam a API nem o Vite.
const externalBaseURL = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalBaseURL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'pt-PT',
    timezoneId: 'Europe/Lisbon',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Num ambiente com o Chromium já instalado noutro sítio (ex.: sessões cloud).
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: externalBaseURL ? [] : [
    {
      command: `${python} -m alembic upgrade head && ${python} -m uvicorn app.main:app --port 8000`,
      cwd: '../backend',
      url: 'http://localhost:8000/health',
      env: { UPLOAD_DIR: uploadDir },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
