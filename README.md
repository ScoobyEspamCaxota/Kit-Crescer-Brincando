# Kit Receitas Juninas Lucrativas

Landing page de venda do Kit Receitas Juninas Lucrativas, com checkout PIX via
QuacPay, order bump de divulgação/precificação, tracking da Utmify e eventos do
Meta Pixel.

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
- `PRICE`
- `PRODUCT`
- `BUMP_PRICE`
- `BUMP_PRODUCT`
- `UTMIFY_API_TOKEN`

Nunca publique o arquivo `.env`.

## Deploy

A landing pode ser publicada no Netlify. As rotas de checkout tambem existem em
`netlify/functions` e sao reescritas por `netlify.toml` para manter os endpoints:

- `/api/checkout`
- `/api/status/:chargeId`
- `/api/webhook`
- `/api/health`

No painel da QuacPay, configure o webhook para:

```text
https://SEU-DOMINIO.netlify.app/api/webhook
```

No painel do Netlify, cadastre as variaveis do `.env.example` em Environment
variables e faca um novo deploy.
