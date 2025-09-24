import http from 'node:http'

const port = Number(process.env.MOCK_PROVIDER_PORT ?? 5100)

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = ''
      req.on('data', chunk => {
        body += chunk
      })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}')
          if (payload.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            })
            let step = 0
            const interval = setInterval(() => {
              step += 1
              if (step === 1) {
                res.write(
                  `data: ${JSON.stringify({
                    id: 'stream_1',
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: 'Hello',
                          role: 'assistant'
                        }
                      }
                    ],
                    usage: {
                      prompt_tokens: 5,
                      completion_tokens: step,
                      total_tokens: 5 + step
                    }
                  })}\n\n`
                )
              } else if (step === 2) {
                res.write(
                  `data: ${JSON.stringify({
                    id: 'stream_1',
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: ' world'
                        }
                      }
                    ],
                    usage: {
                      prompt_tokens: 5,
                      completion_tokens: step,
                      total_tokens: 5 + step
                    }
                  })}\n\n`
                )
              } else {
                res.write('data: [DONE]\n\n')
                clearInterval(interval)
                res.end()
              }
            }, 200)
            req.on('close', () => clearInterval(interval))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                id: 'mock_response',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: 'Mock response from provider'
                    },
                    finish_reason: 'stop'
                  }
                ],
                usage: {
                  prompt_tokens: 5,
                  completion_tokens: 2,
                  total_tokens: 7
                }
              })
            )
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })
  .listen(port, () => {
    console.log(`Mock provider listening on http://127.0.0.1:${port}`)
  })
