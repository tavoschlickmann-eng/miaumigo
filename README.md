# Miaumigo 🐾

App web para gerenciar a vida dos seus pets: perfil, saúde, peso e gastos.
Funciona sem instalar nada e os dados ficam salvos no próprio navegador.

## Como rodar

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Depois abra http://localhost:5173.

## O que tem

- **Pets**: perfil com foto, espécie, raça, sexo, nascimento (idade calculada), castração, microchip, veterinário e observações.
- **Saúde e agenda**: vacinas, vermífugo, antipulgas, remédios, consultas e banho. Com repetição: ao marcar como feito, o próximo é agendado sozinho.
- **Peso**: histórico com gráfico e variação desde a última pesagem.
- **Carteirinha de vacinação**: vacinas, vermífugos e antipulgas aplicados, com a próxima dose. Imprime ou salva em PDF e pode ser compartilhada como texto (WhatsApp, e-mail).
- **Ração**: pacote atual com peso e consumo diário; mostra quanto resta, até quando dura, avisa quando está acabando e lança o preço nos gastos. Guarda o histórico e calcula o custo médio por dia.
- **Anexos**: fotos e PDFs (receitas, exames, comprovantes) em cada cuidado. Ficam no IndexedDB do navegador, fotos reduzidas para até 1600 px, limite de 10 MB por arquivo.
- **Gastos**: por mês, por categoria e por pet, com comparação com o mês anterior.
- **Início**: atrasados, próximos cuidados, total do mês e aviso de aniversário.
- **Lembretes**: cada cuidado pode avisar no dia, 1, 3 ou 7 dias antes, no horário escolhido em Configurações.
  - *Notificações do navegador*: disparam quando o app está aberto ou volta a ser aberto (um app web não consegue acordar sozinho sem servidor de push).
  - *Calendário do celular*: “Enviar para o calendário” gera um `.ics` com alertas e repetição; o aviso chega mesmo com o app fechado.
- **Instalável (PWA)**: funciona offline e pode ser adicionado à tela inicial do celular.
- **Backup**: exportar e importar em JSON, incluindo os anexos (engrenagem na tela inicial). Tema claro, escuro ou automático.

## Ícones

[Lucide](https://lucide.dev) v1.69.0 (licença ISC), estilo outline. Os SVGs usados ficam embutidos em `icons.js`, então o app não depende de CDN. Para adicionar um ícone, pegue o conteúdo do SVG em `https://unpkg.com/lucide-static@1.69.0/icons/<nome>.svg` e inclua no objeto `ICONS`.

## Arquivos

- `index.html`: estrutura e navegação
- `styles.css`: visual (mobile first, modo escuro)
- `app.js`: dados, telas, formulários e lembretes
- `icons.js`: ícones Lucide embutidos
- `sw.js`, `manifest.webmanifest`, `icon.svg`: PWA (offline, instalação e notificações)
- `serve.ps1`: servidor local em PowerShell
