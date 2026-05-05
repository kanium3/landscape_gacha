import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import seed from '$lib/seed.json';

export type Landscape = {
	name: string;
	kind: string;
	location: string;
	description: string | null;
	lon: number | null;
	lat: number | null;
};

type GeoJsonFeature = {
	geometry?: {
		type?: string;
		coordinates?: [number, number];
	};
	properties?: Record<string, unknown>;
};

type GeoJson = {
	features?: GeoJsonFeature[];
};

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdb_wasm,
		mainWorker: mvp_worker
	},
	eh: {
		mainModule: duckdb_wasm_eh,
		mainWorker: eh_worker
	}
};
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let seeded = false;

export async function initDb(): Promise<duckdb.AsyncDuckDB> {
	if (dbPromise) return dbPromise;

	dbPromise = (async () => {
		const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
		const worker = new Worker(bundle.mainWorker!);
		const logger = new duckdb.ConsoleLogger();
		const db = new duckdb.AsyncDuckDB(logger, worker);
		await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

		const conn = await db.connect();
		await loadSpatial(conn);
		await ensureSchema(conn);
		await seedIfNeeded(conn);
		await conn.close();

		return db;
	})();

	return dbPromise;
}

export async function getRandomLandscape(): Promise<Landscape | null> {
	const db = await initDb();
	const conn = await db.connect();

	const result = await conn.query(`
		SELECT
			name,
			kind,
			location,
			description,
			ST_X(geom) AS lon,
			ST_Y(geom) AS lat
		FROM landscapes
		ORDER BY random()
		LIMIT 1
	`);

	const rows = result.toArray() as Landscape[];
	await conn.close();

	return rows[0] ?? null;
}

async function loadSpatial(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
	try {
		await conn.query('INSTALL spatial');
	} catch {
		// Ignore: the extension may already be bundled in WASM.
	}
	await conn.query('LOAD spatial');
}

async function ensureSchema(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
	await conn.query(`
		CREATE TABLE IF NOT EXISTS landscapes (
			id BIGINT,
			name TEXT,
			kind TEXT,
			location TEXT,
			description TEXT,
			geom GEOMETRY
		)
	`);
}

async function seedIfNeeded(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
	if (seeded) return;

	const countResult = await conn.query('SELECT COUNT(*) AS count FROM landscapes');
	const countRows = countResult.toArray() as Array<{ count: number }>;
	if ((countRows[0]?.count ?? 0) > 0) {
		seeded = true;
		return;
	}

	const tiles = buildTileUrls(seed.zoom, seed.points);
	const insert = await conn.prepare(`
		INSERT INTO landscapes (name, kind, location, description, geom)
		VALUES (?, ?, ?, ?, ST_GeomFromGeoJSON(?))
	`);

	try {
		for (const url of tiles) {
			const response = await fetch(url);
			if (!response.ok) continue;

			const geojson = (await response.json()) as GeoJson;
			const features = geojson.features ?? [];

			for (const feature of features) {
				const geometry = feature.geometry;
				if (!geometry || geometry.type !== 'Point') continue;
				if (!geometry.coordinates) continue;

				const props = feature.properties ?? {};
				const name = pickString(props, ['点名', '名称', 'name']) ?? '不明';
				const kind = pickString(props, ['点種別', '点種', '種別', 'type']) ?? '不明';
				const location = pickString(props, ['所在', '所在地', 'location']) ?? '不明';
				const description = pickString(props, ['備考', '説明', 'description', '基準点コード']);

				await insert.query(name, kind, location, description ?? null, JSON.stringify(geometry));
			}
		}
	} finally {
		await insert.close();
		seeded = true;
	}
}

function buildTileUrls(
	zoom: number,
	points: Array<{ lon: number; lat: number }>
): string[] {
	const tiles = new Set<string>();

	for (const point of points) {
		const { x, y } = lonLatToTile(point.lon, point.lat, zoom);
		tiles.add(`https://cyberjapandata.gsi.go.jp/xyz/cp/${zoom}/${x}/${y}.geojson`);
	}

	return Array.from(tiles);
}

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
	const n = Math.pow(2, zoom);
	const x = Math.floor(((lon + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
	);

	return { x, y };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim().length > 0) return value.trim();
		if (typeof value === 'number') return String(value);
	}
	return null;
}
