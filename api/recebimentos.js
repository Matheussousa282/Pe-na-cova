// api/recebimentos.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const EPS = 0.005;

export default async function handler(req, res) {
  const { method } = req;

  if (method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { cliente_id, itens, forma_pagamento, total } = req.body;
  const desconto = Number(req.body.desconto) || 0;

  if (!cliente_id || !itens || !forma_pagamento || total == null)
    return res.status(400).json({ error: "Todos os campos são obrigatórios" });

  const totalNum = Number(total);

  if (desconto < 0) {
    return res.status(400).json({ error: "Desconto não pode ser negativo" });
  }
  if (desconto > totalNum + EPS) {
    return res.status(400).json({ error: "Desconto não pode ser maior que o total da venda" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Inserir venda (total = valor original do carrinho,
    //    desconto = valor abatido; total_final é sempre total - desconto)
    const vendaResult = await client.query(
      "INSERT INTO vendas (cliente_id, forma_pagamento, total, desconto) VALUES ($1,$2,$3,$4) RETURNING *",
      [cliente_id, forma_pagamento, totalNum, desconto]
    );
    const venda = vendaResult.rows[0];

    // 2️⃣ Inserir itens da venda (com tamanho)
    for (const item of itens) {
      await client.query(
        "INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco, tamanho) VALUES ($1,$2,$3,$4,$5)",
        [venda.id, item.produto_id, item.quantidade, item.preco, item.tamanho]
      );

      // Atualiza estoque
      await client.query(
        "UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2",
        [item.quantidade, item.produto_id]
      );
    }

    // 3️⃣ Se for fiado, cria conta a receber já com o desconto aplicado.
    //    O cliente passa a dever (total - desconto), e nada foi recebido ainda.
    if (forma_pagamento.toLowerCase() === "fiado") {
      const valorDevido = totalNum - desconto;
      const status = valorDevido <= EPS ? "Pago" : (desconto > 0 ? "Parcial" : "Pendente");

      await client.query(
        `INSERT INTO contasareceber (cliente_id, valor, valor_pago, desconto, status, data)
         VALUES ($1, $2, 0, $3, $4, NOW())`,
        [cliente_id, totalNum, desconto, status]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({ venda });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro API Recebimentos:", err);
    return res.status(500).json({ error: "Erro ao finalizar venda" });
  } finally {
    client.release();
  }
}
