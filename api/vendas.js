// api/pdv.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Função auxiliar para queries
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

// Handler principal
export default async function handler(req, res) {
  const { method, url, body, query: params } = req;

  try {
    // ---------------- CLIENTES ----------------
    if (url.startsWith("/api/clientes")) {
      if (method === "GET") {
        const result = await query("SELECT * FROM clientes ORDER BY id DESC");
        return res.status(200).json(result.rows);
      }
      if (method === "POST") {
        const { nome, telefone, endereco, obs } = body;
        if (!nome || !telefone) return res.status(400).json({ error: "Nome e telefone são obrigatórios" });
        const result = await query(
          "INSERT INTO clientes (nome, telefone, endereco, obs) VALUES ($1,$2,$3,$4) RETURNING *",
          [nome, telefone, endereco || "", obs || ""]
        );
        return res.status(201).json(result.rows[0]);
      }
    }

    // ---------------- PRODUTOS ----------------
    if (url.startsWith("/api/produtos")) {
      if (method === "GET") {
        const result = await query("SELECT * FROM produtos ORDER BY id DESC");
        return res.status(200).json(result.rows);
      }
      if (method === "PUT") {
        const { id, quantidade } = body;
        if (!id || quantidade == null) return res.status(400).json({ error: "ID e quantidade obrigatórios" });
        const result = await query(
          "UPDATE produtos SET quantidade = $1 WHERE id = $2 RETURNING *",
          [quantidade, id]
        );
        return res.status(200).json(result.rows[0]);
      }
    }

    // ---------------- VENDAS ----------------
    if (url.startsWith("/api/vendas")) {
      if (method === "GET") {
        const result = await query("SELECT * FROM vendas ORDER BY id DESC");
        return res.status(200).json(result.rows);
      }
      if (method === "POST") {
        const { cliente_id, itens, forma_pagamento, total } = body;
        if (!cliente_id || !itens || !forma_pagamento || !total) {
          return res.status(400).json({ error: "Todos os campos são obrigatórios" });
        }

        // Inserir venda
        const vendaResult = await query(
          "INSERT INTO vendas (cliente_id, forma_pagamento, total) VALUES ($1,$2,$3) RETURNING *",
          [cliente_id, forma_pagamento, total]
        );
        const venda = vendaResult.rows[0];

        // Inserir itens da venda
        for (const item of itens) {
          await query(
            "INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco) VALUES ($1,$2,$3,$4)",
            [venda.id, item.produto_id, item.quantidade, item.preco, item.tamanho]
          );
          // Atualizar estoque do produto
          await query(
            "UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2",
            [item.quantidade, item.produto_id]
          );
        }

        // Se forma de pagamento for fiado, cria conta a receber
        if (forma_pagamento.toLowerCase() === "fiado") {
          await query(
            "INSERT INTO contasareceber (cliente_id, valor, status) VALUES ($1,$2,$3)",
            [cliente_id, total, "Pendente"]
          );
        }

        return res.status(201).json({ venda });
      }
    }

    return res.status(404).json({ error: "Rota não encontrada" });
  } catch (err) {
    console.error("Erro API PDV:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
