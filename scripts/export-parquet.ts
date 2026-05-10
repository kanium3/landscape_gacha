import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as duck from '@duckdb/node-api'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
// Using native node-api; no WASM bundles required

const sources: { input: string; output: string }[] = [
  {
    input: path.join(repoRoot, 'static/tenkei_kasho.json'),
    output: path.join(repoRoot, 'static/tenkei_kasho.parquet'),
  },
  {
    input: path.join(repoRoot, 'static/tenkei_daichikei.json'),
    output: path.join(repoRoot, 'static/tenkei_daichikei.parquet'),
  },
]

function toSqlString(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "''")
}

async function main(): Promise<void> {
  const db = await duck.DuckDBInstance.create(':memory:')
  const conn = await db.connect()
  try {
    for (const source of sources) {
      await fs.rm(source.output, { force: true })
      await conn.run(`
        COPY (
          SELECT
            name::VARCHAR AS name,
            kind::VARCHAR AS kind,
            location::VARCHAR AS location,
            description::VARCHAR AS description,
            CAST(lon AS DOUBLE) AS lon,
            CAST(lat AS DOUBLE) AS lat
          FROM read_json_auto('${toSqlString(source.input)}')
        ) TO '${toSqlString(source.output)}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `)
      console.log(`written ${path.relative(repoRoot, source.output)}`)
    }
  } finally {
    try {
      conn.closeSync()
    } catch (e) {
      // best-effort async close if available
      if (typeof (conn as any).close === 'function') await (conn as any).close()
    }
    try {
      if (typeof (db as any).closeSync === 'function') (db as any).closeSync()
    } catch (e) {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
