// api/trocarItensVenda.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { venda_id, itens } = req.body;

  /*
    itens = [
      { produto_id, tamanho, quantidade, preco }
    ]
  */

  if (!venda_id || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Dados inválidos para troca" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Remover itens antigos da venda
    await client.query(
      "DELETE FROM vendas_itens WHERE venda_id = $1",
      [venda_id]
    );

    // 2️⃣ Inserir novos itens
    let novoTotal = 0;

    for (const item of itens) {
      const subtotal = item.quantidade * item.preco;
      novoTotal += subtotal;

      await client.query(
        `
        INSERT INTO vendas_itens 
        (venda_id, produto_id, tamanho, quantidade, preco)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          venda_id,
          item.produto_id,
          item.tamanho,
          item.quantidade,
          item.preco
        ]
      );
    }

    // 3️⃣ Atualizar total da venda
    await client.query(
      "UPDATE vendas SET total = $1 WHERE id = $2",
      [novoTotal, venda_id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Itens da venda trocados com sucesso",
      novoTotal
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao trocar itens:", err);
    return res.status(500).json({ error: "Erro ao trocar itens da venda" });
  } finally {
    client.release();
  }
}

