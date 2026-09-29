import https from 'node:https'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const jsonServer = require('json-server')

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 3000)
const rulesApiTarget = new URL('https://rules-editor-qa.br.tkelevator.com')
const proxyPrefix = '/esales-rules'

const server = jsonServer.create()

function setProxyCorsHeaders(request, response) {
  const origin = request.headers.origin

  response.setHeader('Access-Control-Allow-Origin', origin || '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Accept, Content-Type, comentarioAuditoria, versaoEditor',
  )
  response.setHeader('Vary', 'Origin')
}

function proxyEsalesRules(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  const upstreamPath =
    requestUrl.pathname.slice(proxyPrefix.length) || '/'
  const forwardedHeaders = {}

  for (const headerName of [
    'authorization',
    'accept',
    'content-type',
    'content-length',
    'comentarioauditoria',
    'versaoeditor',
  ]) {
    const headerValue = request.headers[headerName]

    if (headerValue) {
      forwardedHeaders[headerName] = headerValue
    }
  }

  const upstreamRequest = https.request(
    {
      protocol: rulesApiTarget.protocol,
      hostname: rulesApiTarget.hostname,
      port: rulesApiTarget.port || 443,
      method: request.method,
      path: `${upstreamPath}${requestUrl.search}`,
      headers: forwardedHeaders,
    },
    (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode || 502

      for (const headerName of [
        'content-type',
        'content-length',
        'cache-control',
        'etag',
        'last-modified',
      ]) {
        const headerValue = upstreamResponse.headers[headerName]

        if (headerValue !== undefined) {
          response.setHeader(headerName, headerValue)
        }
      }

      setProxyCorsHeaders(request, response)
      upstreamResponse.pipe(response)
    },
  )

  upstreamRequest.setTimeout(30_000, () => {
    upstreamRequest.destroy(new Error('Timeout ao acessar a API eSales.'))
  })

  upstreamRequest.on('error', () => {
    if (response.headersSent) {
      response.destroy()
      return
    }

    setProxyCorsHeaders(request, response)
    response.statusCode = 502
    response.setHeader('Content-Type', 'application/json;charset=UTF-8')
    response.end(
      JSON.stringify({ error: 'Não foi possível acessar a API eSales.' }),
    )
  })

  request.on('aborted', () => upstreamRequest.destroy())
  request.pipe(upstreamRequest)
}

server.use((request, response, next) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const isProxyRequest =
    pathname === proxyPrefix || pathname.startsWith(`${proxyPrefix}/`)

  if (!isProxyRequest) {
    next()
    return
  }

  setProxyCorsHeaders(request, response)

  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }

  if (!['GET', 'PUT'].includes(request.method)) {
    response.statusCode = 405
    response.setHeader('Allow', 'GET, PUT, OPTIONS')
    response.setHeader('Content-Type', 'application/json;charset=UTF-8')
    response.end(JSON.stringify({ error: 'Método não permitido.' }))
    return
  }

  proxyEsalesRules(request, response)
})

server.use(jsonServer.defaults())
server.use(jsonServer.bodyParser)
server.use(jsonServer.router(path.join(currentDirectory, 'db.json')))

server.listen(port, '0.0.0.0', () => {
  console.log(`TORQ API disponível na porta ${port}`)
})
