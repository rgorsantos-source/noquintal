// =====================================
// IMPORTAÇÕES
// =====================================
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");

// =====================================
// CARREGA BANCO DE PRODUTOS (DINÂMICO)
// =====================================
function carregarProdutos() {
  try {
    const dados = JSON.parse(fs.readFileSync("./produtos.json", "utf-8"));
    return dados.produtos;
  } catch (error) {
    console.error("❌ Erro ao carregar produtos.json:", error.message);
    return [];
  }
}

// Teste inicial
const produtosInicial = carregarProdutos();
console.log(`📦 ${produtosInicial.length} produtos encontrados no arquivo.`);

// =====================================
// CONFIGURAÇÃO DO CLIENTE
// =====================================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/app/.wwebjs_auth"
  }),
  puppeteer: {
    headless: true,
    executablePath: "/usr/bin/google-chrome-stable",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  },
});

// =====================================
// CHAVE PIX
// =====================================
const PIX_CHAVE = "55636845000160";
const PIX_NOME = "No Quintal";

// =====================================
// CONTROLE DE SESSÃO POR USUÁRIO
// =====================================
const sessoes = {};

function getSessao(userId) {
  if (!sessoes[userId]) {
    sessoes[userId] = {
      etapa: null,
      carrinho: [],
      total: 0,
    };
  }
  return sessoes[userId];
}

function resetSessao(userId) {
  sessoes[userId] = {
    etapa: null,
    carrinho: [],
    total: 0,
  };
}

// =====================================
// FUNÇÃO DE BUSCA DE PRODUTOS
// =====================================
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buscarProduto(termo, PRODUTOS) {
  const termoNorm = normalize(termo);

  // 1. Busca exata pelo nome normalizado
  let resultado = PRODUTOS.find(
    (p) => normalize(p.nome) === termoNorm
  );
  if (resultado) return resultado;

  // 2. Busca nas palavras-chave (match exato)
  resultado = PRODUTOS.find((p) =>
    p.palavras_chave.some((kw) => normalize(kw) === termoNorm)
  );
  if (resultado) return resultado;

  // 3. Busca parcial - nome contém o termo
  resultado = PRODUTOS.find((p) =>
    normalize(p.nome).includes(termoNorm)
  );
  if (resultado) return resultado;

  // 4. Busca parcial - termo contém alguma palavra-chave
  resultado = PRODUTOS.find((p) =>
    p.palavras_chave.some(
      (kw) =>
        termoNorm.includes(normalize(kw)) ||
        normalize(kw).includes(termoNorm)
    )
  );
  if (resultado) return resultado;

  return null;
}

function buscarProdutosSimilares(termo, PRODUTOS) {
  const termoNorm = normalize(termo);
  return PRODUTOS.filter(
    (p) =>
      normalize(p.nome).includes(termoNorm) ||
      p.palavras_chave.some((kw) => normalize(kw).includes(termoNorm))
  ).slice(0, 5);
}

// =====================================
// FUNÇÃO PARA PARSEAR PEDIDO
// =====================================
function parsearPedido(texto, PRODUTOS) {
  const itens = [];
  const naoEncontrados = [];

  // Divide por vírgula, "e", ou quebra de linha
  const partes = texto.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean);

  for (const parte of partes) {
    let qtd = 1;
    let nomeProduto = parte;

    // Formato: "2x produto" ou "2 produto"
    const matchInicio = parte.match(/^(\d+)\s*[xX]?\s+(.+)/);
    if (matchInicio) {
      qtd = parseInt(matchInicio[1]);
      nomeProduto = matchInicio[2];
    } else {
      // Formato: "produto 2x" ou "produto 2"
      const matchFim = parte.match(/(.+?)\s+(\d+)\s*[xX]?$/);
      if (matchFim) {
        nomeProduto = matchFim[1];
        qtd = parseInt(matchFim[2]);
      }
    }

    const produto = buscarProduto(nomeProduto, PRODUTOS);
    if (produto) {
      itens.push({
        produto: produto,
        quantidade: qtd,
        subtotal: produto.preco * qtd,
      });
    } else {
      naoEncontrados.push(nomeProduto);
    }
  }

  return { itens, naoEncontrados };
}

// =====================================
// FORMATA VALOR EM REAIS
// =====================================
function formatarReais(valor) {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

// =====================================
// QR CODE
// =====================================
client.on("qr", (qr) => {
  console.log("📲 Escaneie o QR Code abaixo:");
  qrcode.generate(qr, { small: true });
});

// =====================================
// WHATSAPP CONECTADO
// =====================================
client.on("ready", () => {
  console.log("✅ Tudo certo! WhatsApp conectado.");
  const produtos = carregarProdutos();
  console.log(`📦 ${produtos.length} produtos carregados e prontos!`);
});

// =====================================
// DESCONEXÃO
// =====================================
client.on("disconnected", (reason) => {
  console.log("⚠️ Desconectado:", reason);
});

// =====================================
// INICIALIZA
// =====================================
client.initialize();

// =====================================
// FUNÇÃO DE DELAY
// =====================================
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// =====================================
// FUNIL DE MENSAGENS
// =====================================
client.on("message", async (msg) => {
  try {
    if (!msg.from || msg.from.endsWith("@g.us")) return;

    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const texto = msg.body ? msg.body.trim() : "";
    const textoLower = texto.toLowerCase();
    const sessao = getSessao(msg.from);

    // ===========================================
    // CARREGA PRODUTOS ATUALIZADOS A CADA PEDIDO
    // ===========================================
    const PRODUTOS = carregarProdutos();

    // Função de digitação
    const typing = async (tempo = 2000) => {
      await delay(1000);
      await chat.sendStateTyping();
      await delay(tempo);
    };

    // =====================================
    // COMANDO: CANCELAR (funciona em qualquer etapa)
    // =====================================
    if (textoLower === "cancelar" || textoLower === "0") {
      resetSessao(msg.from);
      await typing();
      await client.sendMessage(
        msg.from,
        "❌ Operação cancelada.\n\nDigite *oi* ou *menu* para voltar ao início."
      );
      return;
    }

    // =====================================
    // ETAPA: AGUARDANDO LISTA DE PRODUTOS
    // =====================================
    if (sessao.etapa === "aguardando_pedido") {
      await typing(3000);

      const { itens, naoEncontrados } = parsearPedido(texto, PRODUTOS);

      if (itens.length === 0) {
        let resposta =
          "😕 Não encontrei nenhum produto com esses nomes.\n\n";
        resposta += "Tente novamente com o nome do produto.\n";
        resposta +=
          "📝 *Exemplo:* 2 coca cola 2Lt, 1 arroz 5Kg, 3 guarana 350ml\n\n";

        if (naoEncontrados.length > 0) {
          for (const termo of naoEncontrados) {
            const similares = buscarProdutosSimilares(termo, PRODUTOS);
            if (similares.length > 0) {
              resposta += `🔍 Você quis dizer *"${termo}"*?\n`;
              similares.forEach((s) => {
                resposta += `   • ${s.nome} - ${formatarReais(s.preco)}\n`;
              });
              resposta += "\n";
            }
          }
        }

        resposta += 'Digite *cancelar* para voltar ao menu.';
        await client.sendMessage(msg.from, resposta);
        return;
      }

      // Salva carrinho na sessão
      sessao.carrinho = itens;
      sessao.total = itens.reduce((sum, i) => sum + i.subtotal, 0);
      sessao.etapa = "aguardando_confirmacao";

      // Monta resumo
      let resumo = "📋 *RESUMO DO SEU PEDIDO:*\n\n";
      itens.forEach((item) => {
        resumo += `  ${item.quantidade}x ${item.produto.nome}\n`;
        resumo += `     ➜ ${formatarReais(item.subtotal)}\n`;
      });

      resumo += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      resumo += `💰 *TOTAL: ${formatarReais(sessao.total)}*\n`;
      resumo += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (naoEncontrados.length > 0) {
        resumo += `⚠️ *Não encontrei:*\n`;
        naoEncontrados.forEach((n) => {
          resumo += `   • ${n}\n`;
        });
        resumo += "\n";
      }

      resumo += `✅ Confirma os produtos, por favor? Digite *sim* ou *não*`;

      await client.sendMessage(msg.from, resumo);
      return;
    }

    // =====================================
    // ETAPA: CONFIRMAÇÃO DO PEDIDO
    // =====================================
    if (sessao.etapa === "aguardando_confirmacao") {
      if (textoLower === "sim" || textoLower === "s") {
        await typing(2000);

        const total = formatarReais(sessao.total);

        const msgPix =
          `✅ *Produtos comprados:*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💳 *DADOS PARA PAGAMENTO PIX:*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🔑 *Chave PIX (CNPJ):*\n${PIX_CHAVE}\n\n` +
          `💰 *Valor:* ${total}\n` +
          `🏪 *Destinatário:* ${PIX_NOME}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📸 *Após pagar, envie o comprovante aqui nesta conversa!*\n\n` +
          `⏳ Aguardamos a confirmação do pagamento.`;

        await client.sendMessage(msg.from, msgPix);

        sessao.etapa = "aguardando_comprovante";
        return;
      } else if (textoLower === "nao" || textoLower === "não" || textoLower === "n") {
        await typing();
        await client.sendMessage(
          msg.from,
          "❌ Pedido cancelado.\n\nSe quiser refazer digite *menu* para voltar."
        );
        resetSessao(msg.from);
        return;
      } else {
        await typing();
        await client.sendMessage(
          msg.from,
          "Por favor, responda com *sim* para confirmar ou *não* para cancelar o pedido."
        );
        return;
      }
    }

    // =====================================
    // ETAPA: AGUARDANDO COMPROVANTE
    // =====================================
    if (sessao.etapa === "aguardando_comprovante") {
      if (msg.hasMedia) {
        await typing(2000);
        await client.sendMessage(
          msg.from,
          `✅ *Comprovante recebido!*\n\n` +
          `Estamos verificando o pagamento.\n` +
          `Você receberá a confirmação em breve. 🙏\n\n` +
          `Obrigado por comprar no *${PIX_NOME}*! 💚`
        );
        resetSessao(msg.from);
        return;
      } else {
        await typing();
        await client.sendMessage(
          msg.from,
          `📸 Por favor, envie a *foto ou print do comprovante* de pagamento.\n\n` +
          `Ou digite *cancelar* para voltar ao menu.`
        );
        return;
      }
    }

    // =====================================
    // MENU PRINCIPAL
    // =====================================
    if (/^(menu|oi|olá|ola|bom dia|boa tarde|boa noite|alo|alô|hi|hello)$/i.test(textoLower)) {
      resetSessao(msg.from);
      await typing();

      const hora = new Date().getHours();
      let saudacao = "Olá";

      if (hora >= 5 && hora < 12) saudacao = "Bom dia";
      else if (hora >= 12 && hora < 18) saudacao = "Boa tarde";
      else saudacao = "Boa noite";

      await client.sendMessage(
        msg.from,
        `${saudacao}! Tudo bem? 😊\n\n` +
        `Sou o assistente virtual do *${PIX_NOME}*! Digite o número da opção desejada:\n\n` +
        `1️⃣ - Problemas com pagamento e desejo pagar via PIX 🛒\n` +
        `2️⃣ - Comunicar um problema com produto 📦\n` +
        `3️⃣ - Enviar Reclamação ou Elogio 📝\n` +
        `4️⃣ - Falar com o suporte 🙋\n` +
        `5️⃣ - Encerrar atendimento 👋\n\n` +
        `_Digite o número da opção:_`
      );
      return;
    }

    // =====================================
    // OPÇÃO 1 - FAZER PEDIDO
    // =====================================
    if (textoLower === "1" && msg.from.endsWith("@c.us")) {
      sessao.etapa = "aguardando_pedido";
      await typing();
      await client.sendMessage(
        msg.from,
        `🛒 *Obrigado,*\n\n` +
        `Envie os produtos que pegou e informe a quantidade.\n\n` +
        `📝 *Exemplos de como enviar:*\n` +
        `• 2 coca cola 2L, 1 arroz 5Kg, 3 guarana 350ml\n` +
        `• 1 leite ninho integral, 2 pão de forma, 1 açucar\n` +
        `• 5 agua mineral, 2 cerveja skol\n\n` +
        `💡 _Você pode enviar vários itens separados por vírgula!_\n\n` +
        `Digite *cancelar* para voltar ao menu.`
      );
      return;
    }

    // =====================================
    // OPÇÃO 2 - PROBLEMA COM PRODUTO
    // =====================================
    if (textoLower === "2" && msg.from.endsWith("@c.us")) {
      await typing();
      await client.sendMessage(
        msg.from,
        `📦 *Comunicar problema com produto*\n\n` +
        `Lamentamos o ocorrido! Por favor, descreva:\n\n` +
        `• Qual produto?\n` +
        `• Qual o problema?\n` +
        `• Quando comprou?\n\n` +
        `Envie também uma 📸 *foto* se possível.\n` +
        `Nossa equipe analisará e retornará em breve!`
      );
      return;
    }

    // =====================================
    // OPÇÃO 3 - RECLAMAÇÃO/ELOGIO
    // =====================================
    if (textoLower === "3" && msg.from.endsWith("@c.us")) {
      await typing();
      await client.sendMessage(
        msg.from,
        `📝 *Reclamação ou Elogio*\n\n` +
        `Sua opinião é muito importante para nós!\n` +
        `Por favor, escreva sua mensagem que encaminharemos à nossa equipe.\n\n` +
        `Agradecemos o seu feedback! 💚`
      );
      return;
    }

    // =====================================
    // OPÇÃO 4 - SUPORTE
    // =====================================
    if (textoLower === "4" && msg.from.endsWith("@c.us")) {
      await typing();
      await client.sendMessage(
        msg.from,
        `🙋 *Falar com o Suporte*\n\n` +
        `Um atendente será notificado e entrará em contato com você em breve.\n\n` +
        `⏰ Horário de atendimento:\n` +
        `Segunda a Sábado: 08h às 20h\n\n` +
        `Aguarde, por favor! 🙏`
      );
      return;
    }

    // =====================================
    // OPÇÃO 5 - ENCERRAR
    // =====================================
    if (textoLower === "5" && msg.from.endsWith("@c.us")) {
      resetSessao(msg.from);
      await typing();
      await client.sendMessage(
        msg.from,
        `👋 Obrigado por entrar em contato com o *${PIX_NOME}*!\n\n` +
        `Caso precise de algo, é só enviar *oi* ou *menu* que estaremos aqui.\n\n` +
        `Tenha um ótimo dia! 💚`
      );
      return;
    }

  } catch (error) {
    console.error("❌ Erro no processamento da mensagem:", error);
  }
});