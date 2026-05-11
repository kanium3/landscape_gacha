import * as duckdb from '@duckdb/duckdb-wasm'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import { Data, Effect } from 'effect'
import type { Landscape } from '$lib/types'

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdbWasm,
		mainWorker: mvpWorker,
	},
	eh: {
		mainModule: duckdbWasmEh,
		mainWorker: ehWorker,
	},
}

const loadSpatial = (conn: duckdb.AsyncDuckDBConnection): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.promise(() => conn.query('INSTALL spatial'))
		yield* Effect.promise(() => conn.query('LOAD spatial'))
	})

const dbCheckPoint = (conn: duckdb.AsyncDuckDBConnection): Effect.Effect<void> =>
	Effect.promise(() => conn.query('CHECKPOINT'))

export class DbInitError extends Data.TaggedError('DBInitError')<{
	message: string
}> {}

export function initDb(): Effect.Effect<duckdb.AsyncDuckDB, DbInitError> {
	const selectBundle = Effect.promise(() => duckdb.selectBundle(MANUAL_BUNDLES))
	const dbInit = (db: duckdb.AsyncDuckDB, bundle: duckdb.DuckDBBundle) =>
		Effect.promise(() => db.instantiate(bundle.mainModule, bundle.pthreadWorker))
	const dbOpenFromFs = (db: duckdb.AsyncDuckDB) => Effect.promise(() => db.open({
		path: "opfs://landscape-gacha.db",
		accessMode: duckdb.DuckDBAccessMode.READ_WRITE
	}))
	const dbConnect = (db: duckdb.AsyncDuckDB) => Effect.promise(() => db.connect())
	const dbClose = (conn: duckdb.AsyncDuckDBConnection) => Effect.promise(() => conn.close())
	const dbFileRegister = (db: duckdb.AsyncDuckDB) =>
		Effect.promise(() =>
			Promise.all([
				db.registerFileURL(
					'tenkei_daichikei.parquet',
					'/tenkei_daichikei.parquet',
					duckdb.DuckDBDataProtocol.HTTP,
					false
				),
				db.registerFileURL(
					'tenkei_kasho.parquet',
					'/tenkei_kasho.parquet',
					duckdb.DuckDBDataProtocol.HTTP,
					false
				),
			])
		)

	const db = Effect.gen(function* () {
		const bundle = yield* selectBundle
		if (!bundle.mainWorker) {
			return yield* Effect.fail(new DbInitError({ message: 'DuckDB worker bundle is missing' }))
		}
		const worker = new Worker(bundle.mainWorker)
		const logger = new duckdb.ConsoleLogger()
		const db = new duckdb.AsyncDuckDB(logger, worker)
		yield* dbInit(db, bundle)
		yield* dbFileRegister(db)
		yield* dbOpenFromFs(db)

		const conn = yield* dbConnect(db)
		yield* loadSpatial(conn)
		yield* dbClose(conn)

		return db
	})

	return db
}

export const loadInitialData = (conn: duckdb.AsyncDuckDBConnection): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			conn.query(`
				CREATE TABLE landscapes AS
					SELECT * FROM read_parquet(['tenkei_daichikei.parquet', 'tenkei_kasho.parquet'])
			`)
		)

		yield* dbCheckPoint(conn)
	})

export const getRandomLandscape = (conn: duckdb.AsyncDuckDBConnection) =>
	Effect.gen(function* () {
		const runQuery = Effect.promise(() =>
			conn.query(`
		SELECT
			name,
			kind,
			location,
			description,
			lon,
			lat
		FROM landscapes
		ORDER BY random()
		LIMIT 1
	`)
		)

		const result = yield* runQuery
		const rows = result.toArray() as Landscape[]

		return rows[0]
	})
