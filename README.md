# pi-opencode-direct

Provider independente do Pi para os modelos gratuitos do OpenCode Zen, usando HTTP direto — sem executar `opencode` e sem depender do OpenCode CLI em runtime.

## Como funciona

O Zen valida não apenas os headers, mas também a forma da requisição produzida pelo cliente oficial. A extensão usa os engines nativos do `pi-ai`, preserva as ferramentas reais do Pi e acrescenta declarações inertes para os nomes essenciais do OpenCode que não estiverem presentes. Nenhuma ferramenta do OpenCode é executada.

O catálogo é descoberto dinamicamente em `https://opencode.ai/zen/v1/models`. Modelos desconhecidos recebem metadados conservadores; metadados mais ricos vêm de `models.dev`.

## Instalação

```bash
pi install https://github.com/rodrigojager/pi-opencode-direct
pi update --models
```

Depois, execute `/reload` ou reinicie o Pi e selecione `opencode-direct/...` em `/model`.

## Fallback recomendado

A validação do Zen pode mudar. Mantenha também `https://github.com/rodrigojager/opencode-pi`, que delega ao CLI oficial e é mais resiliente a mudanças futuras.

## Segurança

- Não lê credenciais de outras extensões.
- Funciona sem credencial privada; usa apenas o identificador público aceito pelo endpoint Zen.
- Não inicia subprocessos.
- Ferramentas inexistentes continuam sujeitas ao allowlist normal do Pi.

## Desenvolvimento

```bash
npm install
npm run build
npm test
```

Licença GPL-3.0-or-later. Baseado em `pi-opencode-free` de Pedro Alexis.
