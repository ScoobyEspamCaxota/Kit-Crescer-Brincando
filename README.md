# Kit Crescer Brincando

Landing page de venda do Kit Crescer Brincando, com checkout PIX via QuacPay,
tracking da Utmify e eventos do Meta Pixel.

## Rodar localmente

```bash
npm install
npm start
```

Depois acesse `http://localhost:3000`.

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha as credenciais reais:

- `QP_CLIENT_ID`
- `QP_CLIENT_SECRET`
- `QP_WEBHOOK_SECRET`
- `UTMIFY_API_TOKEN`

Nunca publique o arquivo `.env`.

## Deploy

A landing estatica pode ser publicada em provedores como Netlify. Para o checkout
funcionar em producao no Netlify, as rotas de `server.js` precisam ser adaptadas
para Netlify Functions ou hospedadas em um backend Node separado.
