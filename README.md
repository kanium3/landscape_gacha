# landscape-gacha

日本の地形ガチャ
DuckDB WASM + Spatial を使って、ランダムに1件を表示します。

## Development

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm run build
pnpm run preview
```

## Check

```sh
pnpm run check
```

## Export parquet

```sh
pnpm run refresh:data
pnpm run export:parquet
```

This regenerates the static JSON from the GSI pages and then writes `static/tenkei_kasho.parquet` and `static/tenkei_daichikei.parquet`.
