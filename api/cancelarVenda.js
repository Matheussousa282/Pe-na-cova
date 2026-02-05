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

  const { venda_id } = req.body;

  if (!venda_id) {
    return res.status(400).json({ error: "ID da venda não informado" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Buscar itens da venda (somente se não estiver cancelada)
    const { rows: itens } = await client.query(
      `
      SELECT vi.produto_id, vi.quantidade
      FROM vendas_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      WHERE vi.venda_id = $1 AND v.cancelada = false
      `,
      [venda_id]
    );

    if (itens.length === 0) {
      throw new Error("Venda já cancelada ou sem itens");
    }

    // 2️⃣ Devolver estoque (USANDO A COLUNA CORRETA)
    for (const item of itens) {
      await client.query(
        `
        UPDATE produtos
        SET quantidade = quantidade + $1
        WHERE id = $2
        `,
        [item.quantidade, item.produto_id]
      );
    }

    // 3️⃣ Marcar venda como cancelada
    await client.query(
      `
      UPDATE vendas
      SET cancelada = true
      WHERE id = $1 AND cancelada = false
      `,
      [venda_id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Venda cancelada e estoque devolvido com sucesso",
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao cancelar venda:", err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}
