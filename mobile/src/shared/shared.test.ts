import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Estes ficheiros são cópias dos do frontend web (as regras dos prazos e dos preços têm de ser
// as mesmas nas duas apps). Se mudares um, copia-o para o outro lado.
const FILES = ['types.ts', 'warranty.ts']

describe('código partilhado com o frontend web', () => {
  it.each(FILES)('%s é igual ao do frontend', (file) => {
    const mobile = readFileSync(join(__dirname, file), 'utf8')
    const web = readFileSync(join(__dirname, '../../../frontend/src', file), 'utf8')
    expect(mobile).toBe(web)
  })
})
