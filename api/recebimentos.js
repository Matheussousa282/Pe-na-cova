// api/recebimentos.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  const { method } = req;

  if (method === "POST") {
    const { cliente_id, itens, forma_pagamento, total } = req.body;

    if (!cliente_id || !itens || !forma_pagamento || !total)
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });

    try {
      // 1️⃣ Inserir venda
      const vendaResult = await query(
        "INSERT INTO vendas (cliente_id, forma_pagamento, total) VALUES ($1,$2,$3) RETURNING *",
        [cliente_id, forma_pagamento, total]
      );
      const venda = vendaResult.rows[0];

      // 2️⃣ Inserir itens da venda (com tamanho)
      for (const item of itens) {
        await query(
          "INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco, tamanho) VALUES ($1,$2,$3,$4,$5)",
          [venda.id, item.produto_id, item.quantidade, item.preco, item.tamanho]
        );

        // Atualiza estoque
        await query(
          "UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2",
          [item.quantidade, item.produto_id]
        );
      }

      // 3️⃣ Se for fiado, cria conta a receber
      if (forma_pagamento.toLowerCase() === "fiado") {
        await query(
          "INSERT INTO contasareceber (cliente_id, valor, status) VALUES ($1,$2,$3)",
          [cliente_id, total, "Pendente"]
        );
      }

      return res.status(201).json({ venda });
    } catch (err) {
      console.error("Erro API Recebimentos:", err);
      return res.status(500).json({ error: "Erro ao finalizar venda" });
    }
  } else {
    res.status(405).json({ error: "Método não permitido" });
  }
}
