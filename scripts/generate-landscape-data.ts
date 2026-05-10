import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type PlaceRecord = {
  name: string
  kind: string
  location: string
  description: string | null
  lon: number | null
  lat: number | null
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputTargets: {
  key: string
  indexUrl: string
  sourceUrls: string[] | null
  outputPath: string
}[] = [
  {
    key: 'tenkei_kasho',
    indexUrl: 'https://www.gsi.go.jp/kikaku/tenkei_kasho.html',
    sourceUrls: null,
    outputPath: resolve(repoRoot, 'static/tenkei_kasho.json'),
  },
  {
    key: 'tenkei_daichikei',
    indexUrl: 'https://www.gsi.go.jp/kikaku/tenkei_daichikei.html',
    sourceUrls: ['https://www.gsi.go.jp/kikaku/tenkei_daichikei.html'],
    outputPath: resolve(repoRoot, 'static/tenkei_daichikei.json'),
  },
]

function fetchHtml(url: string): string {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl'
  return execFileSync(command, ['-L', '--insecure', '-s', url], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  }) as string
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
}

function textFromHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\t\r\f\v]+/g, ' '),
  )
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function compactText(html: string): string {
  return textFromHtml(html).replace(/\s+/g, ' ').trim()
}

function extractMapCoordinates(href: string): { lat: number | null; lon: number | null } {
  const hashMatch = href.match(/#\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/)
  if (hashMatch) {
    return {
      lat: Number.parseFloat(hashMatch[1]),
      lon: Number.parseFloat(hashMatch[2]),
    }
  }

  const queryMatch = href.match(/[?&]ll=(-?\d+(?:\.\d+)?)%2C(-?\d+(?:\.\d+)?)/)
  if (queryMatch) {
    return {
      lat: Number.parseFloat(queryMatch[1]),
      lon: Number.parseFloat(queryMatch[2]),
    }
  }

  const altQueryMatch = href.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (altQueryMatch) {
    return {
      lat: Number.parseFloat(altQueryMatch[1]),
      lon: Number.parseFloat(altQueryMatch[2]),
    }
  }

  return { lat: null, lon: null }
}

function parseRowsFromTable(tableHtml: string, sectionName: string, definitionText: string | null): PlaceRecord[] {
  const rows: PlaceRecord[] = []
  const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))

  for (const rowMatch of rowMatches.slice(1)) {
    const cellHtml = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((m) => m[1])
    if (cellHtml.length === 0) continue

    const nameCell = cellHtml[0] ?? ''
    const placeName = compactText(nameCell)
    if (!placeName) continue

    const hrefMatch = nameCell.match(/href="([^"]+)"/)
    const coordinates = hrefMatch ? extractMapCoordinates(hrefMatch[1]) : { lat: null, lon: null }
    const prefecture = compactText(cellHtml[1] ?? '')
    const location = compactText(cellHtml[2] ?? '')
    const remark = compactText(cellHtml[3] ?? '')

    const details = [definitionText, prefecture, location, remark].filter(Boolean).join(' / ')

    rows.push({
      name: placeName,
      kind: sectionName,
      location: [prefecture, location].filter(Boolean).join(' / '),
      description: details || null,
      lon: coordinates.lon,
      lat: coordinates.lat,
    })
  }

  return rows
}

function parseMapLinksFromHtml(detailHtml: string, sectionName: string, definitionText: string | null): PlaceRecord[] {
  const rows: PlaceRecord[] = []
  const linkMatches = Array.from(detailHtml.matchAll(/<a href="(https:\/\/maps\.gsi\.go\.jp[^"]+)">([\s\S]*?)<\/a>/g))

  for (const match of linkMatches) {
    const placeName = compactText(match[2])
    if (!placeName) continue

    const coordinates = extractMapCoordinates(match[1])

    rows.push({
      name: placeName,
      kind: sectionName,
      location: placeName,
      description: definitionText || null,
      lon: coordinates.lon,
      lat: coordinates.lat,
    })
  }

  return rows
}

function parseSectionBlocks(html: string) {
  const sectionPattern = /(?:<div class="base_txt">)?(?:<hr\s*\/?>(?:\s*)?)?<span class="aly_tx_xl"><a name="([^"]+)"><strong>(.*?)<\/strong><\/a><\/span><br\s*\/?>([\s\S]*?)(?=(?:<hr\s*\/?>(?:\s*)?)?<span class="aly_tx_xl">|<\/body>)/g
  const sections: { sectionName: string; definitionText: string | null; detailHtml: string }[] = []

  for (const match of html.matchAll(sectionPattern)) {
    const sectionName = compactText(match[2])
    const block = match[3]
    const definitionMatch = block.match(/<strong>定義<\/strong><br\s*\/?>([\s\S]*?)(?:<strong>具体的箇所<\/strong>|$)/)
    const definitionText = definitionMatch ? compactText(definitionMatch[1]) : null
    const detailStart = block.indexOf('<strong>具体的箇所</strong>')

    if (detailStart === -1) continue

    sections.push({
      sectionName,
      definitionText,
      detailHtml: block.slice(detailStart),
    })
  }

  return sections
}

function extractSourceUrls(indexUrl: string): string[] {
  const html = fetchHtml(indexUrl)
  const hrefs = Array.from(html.matchAll(/href="([^"]+tenkei_[^"]+\.html)"/g))
    .map((m) => m[1])
    .filter((href) => !href.endsWith('tenkei_top.html'))
    .filter((href) => !href.endsWith('tenkei_kasho.html'))
    .filter((href) => !href.endsWith('tenkei_daichikei.html'))
  return [...new Set(hrefs)].map((href) => new URL(href, indexUrl).href)
}

function generateRecords(sourceUrls: string[]) {
  const records: PlaceRecord[] = []

  for (const sourceUrl of sourceUrls) {
    const html = fetchHtml(sourceUrl)
    const sections = parseSectionBlocks(html)

    for (const section of sections) {
      const rows = parseRowsFromTable(section.detailHtml, section.sectionName, section.definitionText)
      if (rows.length > 0) {
        records.push(...rows)
        continue
      }

      records.push(...parseMapLinksFromHtml(section.detailHtml, section.sectionName, section.definitionText))
    }
  }

  return records
}

for (const target of outputTargets) {
  const sourceUrls = target.sourceUrls ?? extractSourceUrls(target.indexUrl)
  const records = generateRecords(sourceUrls)
  writeFileSync(target.outputPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  console.log(`${target.key}: ${records.length} records -> ${target.outputPath}`)
}
