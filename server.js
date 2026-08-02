import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 4190)
const host = process.env.HOST || '127.0.0.1'
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const normalized = normalize(relative)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) return null

  const candidate = join(root, normalized)
  if (!candidate.startsWith(root)) return null
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html')
  return candidate
}

const server = createServer((request, response) => {
  let filePath
  try {
    filePath = resolveRequestPath(request.url)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  createReadStream(filePath).pipe(response)
})

server.listen(port, host, () => {
  console.log(`CityUber running at http://${host}:${port}`)
})
