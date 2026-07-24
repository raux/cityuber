import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
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

createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }

  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname)
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '')
  const candidate = join(root, relative)
  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(candidate)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(candidate).pipe(response)
}).listen(port, host, () => {
  console.log(`CityUber is running at http://${host}:${port}/`)
})
