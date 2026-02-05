// /api/produtos.js
import pkg from "pg";
const { Pool } = pkg;

// Pool de conexão com Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_CUSTOM,
  ssl: { rejectUnauthorized: false },
});

// Função auxiliar para queries
async function query(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result;
  } catch (err) {
    console.error("Erro na execução da query:", err.message, sql, params);
    throw err;
  }
}

export default async function handler(req, res) {
  const { method, body, query: queryParams } = req;

  try {
    // ---------------- GET: listar produtos ----------------
    if (method === "GET") {
      const result = await query(
        "SELECT * FROM produtos ORDER BY id DESC"
      );
      return res.status(200).json(result.rows);
    }

    // ---------------- POST: cadastrar produto ----------------
    if (method === "POST") {
      const { codigo, descricao, tamanho, quantidade, preco } = body;

      if (!codigo || !descricao || !tamanho || quantidade == null || preco == null) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios" });
      }

      const result = await query(
        `INSERT INTO produtos (codigo, descricao, tamanho, quantidade, preco)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [codigo, descricao, tamanho, Number(quantidade), Number(preco)]
      );

      return res.status(201).json(result.rows[0]);
    }

    // ---------------- DELETE: remover produto ----------------
    if (method === "DELETE") {
      const { id } = queryParams;

      if (!id) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await query("DELETE FROM produtos WHERE id=$1 RETURNING *", [id]);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      return res.status(200).json({ message: "Produto excluído com sucesso", produto: result.rows[0] });
    }

    // ---------------- PUT: atualizar produto ----------------
    if (method === "PUT") {
      const { id, codigo, descricao, tamanho, quantidade, preco } = body;

      if (!id) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const result = await query(
        `UPDATE produtos 
         SET codigo=$1, descricao=$2, tamanho=$3, quantidade=$4, preco=$5
         WHERE id=$6 RETURNING *`,
        [codigo, descricao, tamanho, Number(quantidade), Number(preco), id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      return res.status(200).json(result.rows[0]);
    }

    // ---------------- Método não permitido ----------------
    return res.status(405).json({ error: "Método não permitido" });

  } catch (error) {
    console.error("Erro na API produtos:", error.message);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
